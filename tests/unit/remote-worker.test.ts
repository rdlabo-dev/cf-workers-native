import { afterEach, expect, it, vi } from "vitest";
import { createFetchRuntime } from "../../src/cloudflare/workers/worker-runtime.js";
import { workerFor } from "../helpers/isolated-worker.js";
import type { RemoteWorkerOptions } from "../../src/cloudflare/workers/types.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup(
  prefer: "direct" | "worker",
  remote: RemoteWorkerOptions | undefined,
  send = vi.fn(async (_request: Request) => new Response("remote")),
) {
  vi.stubGlobal("fetch", send);
  vi.stubGlobal("Worker", function Worker() {});
  const handler = { fetch: vi.fn(() => new Response("local")) };
  const source = {
    createWorker: () => workerFor(handler) as unknown as Worker,
    loadDirect: async () => handler,
    needsRemote: (request: Request) =>
      new URL(request.url).pathname.startsWith("/api"),
  };
  const runtime = createFetchRuntime({
    baseURL: "https://same.example/",
    worker: source,
    prefer,
    remote,
  });
  cleanups.push(() => runtime.dispose());
  return { runtime, handler, send };
}
for (const prefer of ["direct", "worker"] as const) {
  it(`${prefer}: a failed remote mutation is neither retried nor executed locally`, async () => {
    const send = vi.fn(async (_request: Request): Promise<Response> => {
      throw new TypeError("Connection lost after sending");
    });
    const { runtime, handler } = setup(prefer, undefined, send);
    await runtime.ready;
    await expect(
      runtime.fetch("https://same.example/api/items", {
        method: "POST",
        body: "mutation",
      }),
    ).rejects.toThrow("Connection lost after sending");
    expect(send).toHaveBeenCalledTimes(1);
    expect(handler.fetch).not.toHaveBeenCalled();
  });
  it(`${prefer}: sends remote routes before user code, reusing the existing HTTP request`, async () => {
    let token = "first";
    const getToken = vi.fn(() => token);
    const { runtime, handler, send } = setup(prefer, {
      origin: "https://same.example",
      getToken,
    });
    await runtime.ready;
    expect(await (await runtime.fetch("https://same.example/")).text()).toBe(
      "local",
    );
    expect(getToken).not.toHaveBeenCalled();
    expect(
      await (
        await runtime.fetch("https://same.example/api/items?q=1", {
          method: "POST",
          body: "payload",
          headers: { "content-type": "text/plain", cookie: "local-only" },
        })
      ).text(),
    ).toBe("remote");
    expect(handler.fetch).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][0];
    expect(request.url).toBe("https://same.example/api/items?q=1");
    expect(request.method).toBe("POST");
    expect(await request.text()).toBe("payload");
    expect(request.headers.get("authorization")).toBe("Bearer first");
    expect(request.headers.get("cookie")).toBeNull();
    expect(request.redirect).toBe("manual");
    expect(request.credentials).toBe("include");
    token = "second";
    await runtime.fetch("https://same.example/api/next");
    expect(send.mock.calls[1][0].headers.get("authorization")).toBe(
      "Bearer second",
    );
  });
}
for (const remote of [undefined, { getToken: () => "session" }]) {
  it(`infers the destination with ${remote ? "token options" : "no remote options"}`, async () => {
    const { runtime, send, handler } = setup("direct", remote);
    await runtime.ready;
    await runtime.fetch("https://same.example/api/items?q=1", {
      method: "POST",
      body: "once",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][0];
    expect(request.url).toBe("https://same.example/api/items?q=1");
    expect(request.headers.get("authorization")).toBe(
      remote ? "Bearer session" : null,
    );
    expect(await request.text()).toBe("once");
    expect(handler.fetch).not.toHaveBeenCalled();
  });
}
it("preserves path boundaries and external requests with an inferred destination", async () => {
  const send = vi.fn(async () => new Response("external"));
  vi.stubGlobal("fetch", send);
  const select = vi.fn(() => true);
  const runtime = createFetchRuntime({
    baseURL: "https://same.example/api/",
    prefer: "direct",
    worker: {
      createWorker: vi.fn(),
      loadDirect: async () => ({ fetch: vi.fn() }),
      needsRemote: select,
    },
  });
  cleanups.push(() => runtime.dispose());
  await runtime.ready;
  for (const url of [
    "https://same.example/api/hello?q=1",
    "https://same.example/apiary",
    "https://same.example/LICENSE",
    "https://other.example/api/hello",
  ])
    await runtime.fetch(url);
  expect(select).toHaveBeenCalledTimes(1);
  expect((send.mock.calls[0] as unknown as [Request])[0].url).toBe(
    "https://same.example/api/hello?q=1",
  );
  expect(send).toHaveBeenCalledTimes(4);
});
it("preserves an existing bearer session without a login provider and never retries 401", async () => {
  const send = vi.fn(
    async (_request: Request) => new Response(null, { status: 401 }),
  );
  const { runtime, handler } = setup(
    "direct",
    { origin: "https://server.example" },
    send,
  );
  const response = await runtime.fetch("https://same.example/api", {
    headers: { authorization: "Bearer existing" },
  });
  expect(response.status).toBe(401);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].url).toBe("https://server.example/api");
  expect(send.mock.calls[0][0].headers.get("authorization")).toBe(
    "Bearer existing",
  );
  expect(handler.fetch).not.toHaveBeenCalled();
});
it("aborts a pending credential lookup without sending or falling back locally", async () => {
  let resolveToken!: (token: string) => void;
  const { runtime, handler, send } = setup("direct", {
    origin: "https://server.example",
    getToken: () =>
      new Promise((resolve) => {
        resolveToken = resolve;
      }),
  });
  await runtime.ready;
  const controller = new AbortController();
  const pending = runtime.fetch("https://same.example/api", {
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(resolveToken).toBeTypeOf("function"));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  resolveToken("late");
  await Promise.resolve();
  expect(send).not.toHaveBeenCalled();
  expect(handler.fetch).not.toHaveBeenCalled();
});
it("disposal rejects a pending credential lookup and cannot send into a replacement runtime", async () => {
  let resolveToken!: (token: string) => void;
  const { runtime, send } = setup("direct", {
    origin: "https://server.example",
    getToken: () =>
      new Promise((resolve) => {
        resolveToken = resolve;
      }),
  });
  const pending = runtime.fetch("https://same.example/api");
  const rejected = expect(pending).rejects.toThrow("disposed");
  await vi.waitFor(() => expect(resolveToken).toBeTypeOf("function"));
  await runtime.dispose();
  await rejected;
  resolveToken("late");
  await Promise.resolve();
  expect(send).not.toHaveBeenCalled();
});
it("rejects invalid remote destinations before loading application code", () => {
  const source = {
    createWorker: vi.fn(),
    loadDirect: vi.fn(),
    needsRemote: () => true,
  };
  expect(() =>
    createFetchRuntime({ baseURL: "http://local.example", worker: source }),
  ).toThrow("remote.origin");
  for (const origin of [
    null as unknown as string,
    "",
    "http://example.com",
    "https://example.com/path",
    "https://user:password@example.com",
    "https://example.com/?x=1",
  ])
    expect(() =>
      createFetchRuntime({
        baseURL: "https://local.example",
        worker: source,
        remote: { origin },
      }),
    ).toThrow();
  expect(source.loadDirect).not.toHaveBeenCalled();
  expect(source.createWorker).not.toHaveBeenCalled();
});
it("cannot dispatch locally after disposal while an async selector is pending", async () => {
  let selected!: (remote: boolean) => void;
  const handler = { fetch: vi.fn(() => new Response("local")) };
  const runtime = createFetchRuntime({
    baseURL: "https://local.example",
    prefer: "direct",
    remote: { origin: "https://server.example" },
    worker: {
      createWorker: vi.fn(),
      loadDirect: async () => handler,
      needsRemote: () =>
        new Promise((resolve) => {
          selected = resolve;
        }),
    },
  });
  cleanups.push(() => runtime.dispose());
  const pending = runtime.fetch("https://local.example/");
  await vi.waitFor(() => expect(selected).toBeTypeOf("function"));
  await runtime.dispose();
  selected(false);
  await expect(pending).rejects.toThrow("disposed");
  expect(handler.fetch).not.toHaveBeenCalled();
});

// Remote policy tests use the real dispatcher and cookie boundary with a fake
// wire transport. Native acceptance exercises the same policy over actual TLS.
import { createRemoteWorker } from "../../src/cloudflare/bindings/remote.js";
import * as nativeNetwork from "../../src/browser/fetch/native-network.js";
import * as nativeFetch from "../../src/browser/fetch/index.js";
import { Response as WireResponse } from "../../src/browser/response/index.js";
import { Request as WireRequest } from "../../src/browser/request/index.js";
function nativeRemote(
  send: (request: WireRequest) => Promise<WireResponse>,
  cookies = vi.fn(
    async (
      _plugin: string,
      _method: string,
      _args: Record<string, unknown>,
    ): Promise<unknown> => ({ cookie: "remote=session" }),
  ),
) {
  vi.spyOn(nativeNetwork, "getNativeCall").mockReturnValue(cookies);
  vi.spyOn(nativeFetch, "createFetch").mockReturnValue(
    send as ReturnType<typeof nativeFetch.createFetch>,
  );
  const remote = createRemoteWorker(
    { origin: "https://server.example" },
    fetch,
  );
  cleanups.push(() => remote.dispose());
  return { remote, cookies };
}
it("uses remote cookies, stores Set-Cookie on its origin, strips them from the document response", async () => {
  const send = vi.fn(
    async (_request: WireRequest) =>
      new WireResponse("saved", {
        headers: [
          [
            "set-cookie",
            "session=new; Domain=server.example; Path=/account; Secure; HttpOnly; Max-Age=86400",
          ],
          ["set-cookie", "bad=other; Domain=attacker.example; Path=/"],
        ],
      }),
  );
  const { remote, cookies } = nativeRemote(send);
  const response = await remote.fetch(
    new Request("https://logical.example/account", {
      headers: {
        cookie: "local=private",
        origin: "https://logical.example",
        referer: "https://logical.example/form",
      },
    }),
  );
  expect(send.mock.calls[0][0].headers.get("cookie")).toBe("remote=session");
  expect(send.mock.calls[0][0].headers.get("origin")).toBe(
    "https://server.example",
  );
  expect(send.mock.calls[0][0].headers.get("referer")).toBe(
    "https://server.example/form",
  );
  expect(cookies.mock.calls).toEqual([
    [
      "WorkersCapacitor",
      "cookiesGet",
      { url: "https://server.example/account" },
    ],
    [
      "WorkersCapacitor",
      "cookiesSet",
      {
        url: "https://server.example/account",
        cookies: [
          "session=new; Path=/account; Secure; HttpOnly; Max-Age=86400",
        ],
      },
    ],
  ]);
  expect(response.headers.has("set-cookie")).toBe(false);
});
it("returns manual same-origin redirects in the logical origin for native document navigation", async () => {
  const { remote } = nativeRemote(
    async () =>
      new WireResponse(null, {
        status: 303,
        headers: { location: "https://server.example/account?done=1#saved" },
      }),
  );
  const response = await remote.fetch(
    new Request("https://logical.example/save", {
      method: "POST",
      body: "a=1",
      redirect: "manual",
    }),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://logical.example/account?done=1#saved",
  );
});
for (const status of [303, 307, 308])
  it(`follows ${status} with correct method/body and the updated cookie jar`, async () => {
    const requests: {
      url: string;
      method: string;
      body: string;
      cookie: string | null;
      contentType: string | null;
    }[] = [];
    let cookie = "old=1";
    const cookies = vi.fn(
      async (
        _plugin: string,
        method: string,
        _args: Record<string, unknown>,
      ) => {
        if (method === "cookiesSet") cookie = "new=2";
        return { cookie };
      },
    );
    const { remote } = nativeRemote(async (request) => {
      requests.push({
        url: request.url,
        method: request.method,
        body: await request.text(),
        cookie: request.headers.get("cookie"),
        contentType: request.headers.get("content-type"),
      });
      return requests.length === 1
        ? new WireResponse(null, {
            status,
            headers: { location: "/saved", "set-cookie": "new=2;Secure" },
          })
        : new WireResponse("ok");
    }, cookies);
    const response = await remote.fetch(
      new Request("https://logical.example/save", {
        method: "POST",
        body: "value=1",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({
      url: "https://server.example/saved",
      method: status === 303 ? "GET" : "POST",
      body: status === 303 ? "" : "value=1",
      cookie: "new=2",
      contentType: status === 303 ? null : "application/x-www-form-urlencoded",
    });
    expect(response.redirected).toBe(true);
    expect(response.url).toBe("https://logical.example/saved");
  });
it("rejects external redirects before sending credentials to a second origin", async () => {
  const send = vi.fn(
    async (_request: WireRequest) =>
      new WireResponse(null, {
        status: 307,
        headers: { location: "https://other.example/steal" },
      }),
  );
  const { remote } = nativeRemote(send);
  await expect(
    remote.fetch(
      new Request("https://logical.example/save", {
        headers: { authorization: "Bearer secret" },
      }),
    ),
  ).rejects.toThrow("remote.origin");
  expect(send).toHaveBeenCalledTimes(1);
});
it("bounds redirect loops", async () => {
  const send = vi.fn(
    async (_request: WireRequest) =>
      new WireResponse(null, { status: 302, headers: { location: "/again" } }),
  );
  const { remote } = nativeRemote(send);
  await expect(
    remote.fetch(new Request("https://logical.example/again")),
  ).rejects.toThrow("Too many");
  expect(send).toHaveBeenCalledTimes(21);
});
it("disposal while reading the cookie jar prevents a late network send", async () => {
  let resolve!: (value: unknown) => void;
  const cookies = vi.fn(
    (_plugin: string, _method: string, _args: Record<string, unknown>) =>
      new Promise<unknown>((done) => {
        resolve = done;
      }),
  );
  const send = vi.fn(async (_request: WireRequest) => new WireResponse("no"));
  const { remote } = nativeRemote(send, cookies);
  const pending = remote.fetch(new Request("https://logical.example/account"));
  await vi.waitFor(() => expect(cookies).toHaveBeenCalled());
  const assertion = expect(pending).rejects.toThrow("disposed");
  await remote.dispose();
  await assertion;
  resolve({ cookie: "session=late" });
  await Promise.resolve();
  expect(send).not.toHaveBeenCalled();
});

it("preserves logical origin even for a redirect with a double-slash pathname", async () => {
  const { remote } = nativeRemote(
    async () =>
      new WireResponse(null, {
        status: 303,
        headers: { location: "https://server.example//other.example/path" },
      }),
  );
  const response = await remote.fetch(
    new Request("https://logical.example/save", { redirect: "manual" }),
  );
  expect(response.headers.get("location")).toBe(
    "https://logical.example//other.example/path",
  );
});
it("preserves an external Origin for the existing server CSRF check", async () => {
  const send = vi.fn(
    async (_request: WireRequest) =>
      new WireResponse("denied", { status: 403 }),
  );
  const { remote } = nativeRemote(send);
  await remote.fetch(
    new Request("https://logical.example/save", {
      headers: {
        origin: "https://untrusted.example",
        referer: "https://untrusted.example/form",
      },
    }),
  );
  expect(send.mock.calls[0][0].headers.get("origin")).toBe(
    "https://untrusted.example",
  );
  expect(send.mock.calls[0][0].headers.get("referer")).toBe(
    "https://untrusted.example/form",
  );
});

for (const redirect of ["follow", "manual", "error"] as const) {
  it(`bounds browser ${redirect} uploads before sending, cancelling the producer`, async () => {
    const send = vi.fn(async (_request: Request) => new Response("ok"));
    const cancelled = vi.fn();
    const remote = createRemoteWorker(
      { origin: "https://server.example", maxBufferedBodyBytes: 4 },
      send as typeof fetch,
    );
    cleanups.push(() => remote.dispose());
    const body = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(3));
      },
      cancel: cancelled,
    });
    await expect(
      remote.fetch(
        new Request("https://local.example/file", {
          method: "POST",
          body,
          redirect,
          duplex: "half",
        } as RequestInit),
      ),
    ).rejects.toThrow("maxBufferedBodyBytes");
    expect(send).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
}
it("accepts the exact byte limit without keeping reused chunk buffers", async () => {
  const send = vi.fn(
    async (request: Request) => new Response(await request.arrayBuffer()),
  );
  const remote = createRemoteWorker(
    { origin: "https://server.example", maxBufferedBodyBytes: 4 },
    send as typeof fetch,
  );
  cleanups.push(() => remote.dispose());
  let i = 0;
  const buffer = new Uint8Array(1024 * 1024);
  const body = new ReadableStream(
    {
      pull(c) {
        if (i === 4) return c.close();
        buffer[0] = ++i;
        c.enqueue(buffer.subarray(0, 1));
      },
    },
    { highWaterMark: 0 },
  );
  const result = await remote.fetch(
    new Request("https://local.example/file", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit),
  );
  expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3, 4]);
});
it("cancels a pending buffered producer on disposal without sending", async () => {
  const send = vi.fn(async () => new Response("no"));
  const cancel = vi.fn();
  const remote = createRemoteWorker(
    { origin: "https://server.example" },
    send as typeof fetch,
  );
  const body = new ReadableStream({ cancel });
  const pending = remote.fetch(
    new Request("https://local.example/file", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit),
  );
  const rejected = expect(pending).rejects.toThrow("disposed");
  await Promise.resolve();
  await remote.dispose();
  await rejected;
  expect(cancel).toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it("rejects invalid buffered-upload limits at initialization", () => {
  for (const maxBufferedBodyBytes of [
    -1,
    0.1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    expect(() =>
      createRemoteWorker(
        { origin: "https://server.example", maxBufferedBodyBytes },
        fetch,
      ),
    ).toThrow("safe integer");
});
it("caps native redirect-follow bodies before cookie lookup or network", async () => {
  const { remote, cookies } = nativeRemote(
    vi.fn(async () => new WireResponse("no")),
  );
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
    },
    cancel,
  });
  await expect(
    remote.fetch(
      new Request("https://logical.example/file", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
    ),
  ).rejects.toThrow("maxBufferedBodyBytes");
  expect(cookies).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});
for (const redirect of ["manual", "error"] as const)
  it(`native ${redirect} sends before the streaming producer completes`, async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(new Uint8Array([7]));
      },
    });
    const { remote } = nativeRemote(async (request) => {
      const reader = request.body!.getReader();
      expect((await reader.read()).value).toEqual(new Uint8Array([7]));
      controller.close();
      expect((await reader.read()).done).toBe(true);
      reader.releaseLock();
      return new WireResponse("streamed");
    });
    const response = await remote.fetch(
      new Request("https://logical.example/file", {
        method: "POST",
        body,
        redirect,
        duplex: "half",
      } as RequestInit),
    );
    expect(await response.text()).toBe("streamed");
  });

it("rejects WebSocket upgrades before requesting credentials or sending HTTP", async () => {
  const getToken = vi.fn(() => "secret");
  const { runtime, handler, send } = setup("direct", {
    origin: "https://remote.example",
    getToken,
  });
  await runtime.ready;
  await expect(
    runtime.fetch("https://same.example/api/socket", {
      headers: { upgrade: "websocket" },
    }),
  ).rejects.toThrow("upgrades are not supported");
  expect(handler.fetch).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(getToken).not.toHaveBeenCalled();
});

it("never runs local code if a selector requires an unconfigured remote", async () => {
  const handler = { fetch: vi.fn(() => new Response("must not run")) };
  const runtime = createFetchRuntime({
    baseURL: "https://local.invalid/",
    prefer: "direct",
    worker: {
      createWorker() {
        throw new Error("must stay direct");
      },
      loadDirect: async () => handler,
      needsRemote: () => true,
      requiresRemote: false,
    },
  });
  cleanups.push(() => runtime.dispose());
  await runtime.ready;
  await expect(runtime.fetch("https://local.invalid/")).rejects.toThrow(
    "remote.origin",
  );
  expect(handler.fetch).not.toHaveBeenCalled();
});
