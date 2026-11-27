import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const script = readFileSync(
  new URL("../../src/browser/documents/service-worker.js", import.meta.url),
  "utf8",
);
function setup(cache = new Map<string, Response>()) {
  let assets = ["/index.html"];
  let hostAvailable = true;
  let hostResponsive = true;
  const getClient = vi.fn(
    async (
      _id: string,
    ): Promise<{ type: string; frameType: string; url: string } | undefined> =>
      undefined,
  );
  const listeners = new Map<string, (event: any) => void>();
  const dispatch = vi.fn(async (request: any) => ({
    url: "https://worker.example" + new URL(request.url).pathname,
    status: 200,
    headers: {},
    body: request.body ?? new TextEncoder().encode("worker").buffer,
  }));
  const nativeFetch = vi.fn(async (request: string | Request) =>
    String(typeof request === "string" ? request : request.url).includes(
      "workers-capacitor-assets.json",
    )
      ? Response.json(assets)
      : new Response("asset"),
  );
  runInNewContext(script, {
    URL,
    Request,
    Response,
    Headers,
    MessageChannel,
    ReadableStream,
    atob,
    crypto,
    setTimeout,
    clearTimeout,
    fetch: nativeFetch,
    caches: {
      open: async () => ({
        match: async (key: string) => cache.get(key),
        put: async (key: string, value: Response) => {
          cache.set(key, value);
        },
        delete: async (key: string) => cache.delete(key),
      }),
    },
    self: {
      location: new URL(
        "https://localhost/workers-capacitor-sw.js?baseURL=https%3A%2F%2Fworker.example",
      ),
      addEventListener: (name: string, handler: any) =>
        listeners.set(name, handler),
      clients: {
        get: getClient,
        matchAll: async () =>
          hostAvailable
            ? [
                {
                  url: "https://localhost/index.html?__workers_capacitor_host=1",
                  postMessage: async (request: any, ports: MessagePort[]) => {
                    if (request === "workers-capacitor:host-ready") {
                      if (hostResponsive) ports[0].postMessage(request);
                    } else ports[0].postMessage(await dispatch(request));
                    ports[0].close();
                  },
                },
              ]
            : [],
      },
    },
  });
  return {
    setHostResponsive: (value: boolean) => {
      hostResponsive = value;
    },
    setHostAvailable: (value: boolean) => {
      hostAvailable = value;
    },
    async disable(disabled = true) {
      let pending!: Promise<void>;
      const port = { postMessage: vi.fn() };
      listeners.get("message")!({
        data: disabled
          ? "workers-capacitor:disable-documents"
          : "workers-capacitor:enable-documents",
        ports: [port],
        waitUntil: (value: Promise<void>) => {
          pending = value;
        },
      });
      await pending;
      expect(port.postMessage).toHaveBeenCalledWith("done");
    },
    dispatch,
    getClient,
    nativeFetch,
    setAssets: (value: string[]) => {
      assets = value;
    },
    fetch(request: Request, clientId = ""): Promise<Response> | undefined {
      let response: Promise<Response> | undefined;
      listeners.get("fetch")!({
        request,
        clientId,
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
      });
      return response;
    },
  };
}
it("passes POST bytes to the common Worker host", async () => {
  const sw = setup();
  const response = await sw.fetch(
    new Request("https://localhost/arbitrary/path", {
      method: "POST",
      body: "payload",
    }),
  );
  expect(await response!.text()).toBe("payload");
  expect(sw.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      url: "https://localhost/arbitrary/path",
    }),
  );
});
it.each([
  ["top-level", "same-origin", undefined, "https://localhost"],
  ["top-level", "same-origin", "null", "null"],
  ["nested", "same-origin", undefined, undefined],
  ["unknown", "same-origin", undefined, undefined],
  ["top-level", "cors", undefined, undefined],
] as const)(
  "forwards Origin for %s client, %s mode and header %s",
  async (frameType, mode, origin, expected) => {
    const sw = setup();
    if (frameType !== "unknown")
      sw.getClient.mockResolvedValue({
        type: "window",
        frameType,
        url: "https://localhost/page",
      });
    await sw.fetch(
      new Request("https://localhost/auth", {
        method: "POST",
        mode,
        headers: origin ? { origin } : {},
      }),
      "source",
    );
    expect(sw.dispatch.mock.calls[0][0].headers.origin).toBe(expected);
  },
);
it("uses the current asset manifest after an application update", async () => {
  const sw = setup();
  await sw.fetch(new Request("https://localhost/page"));
  sw.setAssets(["/index.html", "/assets/new-build.js"]);
  expect(
    await (await sw.fetch(
      new Request("https://localhost/assets/new-build.js"),
    ))!.text(),
  ).toBe("asset");
  expect(sw.dispatch).toHaveBeenCalledTimes(1);
});
it("serves only manifested public assets locally, not arbitrary image or CSS URLs", async () => {
  const sw = setup();
  sw.setAssets(["/assets/style.css", "/assets/pixel.svg"]);
  for (const path of ["/assets/style.css", "/assets/pixel.svg"]) {
    expect(
      await (await sw.fetch(new Request(`https://localhost${path}`)))!.text(),
    ).toBe("asset");
  }
  expect(sw.dispatch).not.toHaveBeenCalled();
  for (const path of ["/private/style.css", "/private/avatar.svg"]) {
    expect(
      await (await sw.fetch(new Request(`https://localhost${path}`)))!.text(),
    ).toBe("worker");
  }
  expect(sw.dispatch).toHaveBeenCalledTimes(2);
});
it("rewrites local redirects and rejects external redirect destinations", async () => {
  const sw = setup();
  sw.dispatch.mockResolvedValueOnce({
    url: "https://worker.example/start",
    status: 307,
    headers: { location: "/end" },
    body: new ArrayBuffer(0),
  });
  const response = await sw.fetch(new Request("https://localhost/start"));
  expect(response!.status).toBe(307);
  expect(response!.headers.get("location")).toBe("https://localhost/end");
  sw.dispatch.mockResolvedValueOnce({
    url: "https://worker.example/start",
    status: 302,
    headers: { location: "https://outside.example/" },
    body: new ArrayBuffer(0),
  });
  await expect(
    sw.fetch(new Request("https://localhost/start")),
  ).rejects.toThrow("not supported");
});
it("leaves external URLs to the browser", () => {
  expect(
    setup().fetch(new Request("https://outside.example/")),
  ).toBeUndefined();
});

it("loads the bundled bootstrap when a persisted SW has no native host", async () => {
  const sw = setup();
  sw.setHostAvailable(false);
  const request = new Request("https://localhost/");
  Object.defineProperty(request, "mode", { value: "navigate" });
  expect(await (await sw.fetch(request))!.text()).toBe("asset");
  expect(sw.dispatch).not.toHaveBeenCalled();
  expect(sw.nativeFetch).toHaveBeenLastCalledWith(
    "https://localhost/index.html",
    { cache: "no-store", signal: request.signal },
  );
});

it("stops intercepting existing clients after disable, including navigation and POST", async () => {
  const sw = setup();
  await sw.disable();
  sw.setHostAvailable(false);
  const navigation = new Request("https://localhost/about");
  Object.defineProperty(navigation, "mode", { value: "navigate" });
  expect(sw.fetch(navigation)).toBeUndefined();
  expect(
    sw.fetch(
      new Request("https://localhost/api", { method: "POST", body: "data" }),
    ),
  ).toBeUndefined();
  expect(sw.nativeFetch).not.toHaveBeenCalled();
  expect(sw.dispatch).not.toHaveBeenCalled();
});

it("keeps shutdown across a SW restart and explicitly enables a new rendering session", async () => {
  const cache = new Map<string, Response>();
  await setup(cache).disable();
  const restarted = setup(cache);
  const request = new Request("https://localhost/about");
  expect(await (await restarted.fetch(request))!.text()).toBe("asset");
  expect(restarted.dispatch).not.toHaveBeenCalled();
  await restarted.disable(false);
  expect(await (await restarted.fetch(request))!.text()).toBe("worker");
});

it("pulls streamed document bytes only when consumed and cancels the host stream", async () => {
  const sw = setup();
  sw.dispatch.mockImplementation(async (request: any) => {
    if (request.action === "pull")
      return { body: btoa("chunk"), done: false } as any;
    if (request.action === "cancel") return { done: true, body: "" } as any;
    return {
      url: "https://worker.example/live",
      status: 200,
      headers: {},
      body: "",
      streamId: "live",
    } as any;
  });
  const response = (await sw.fetch(new Request("https://localhost/live")))!;
  expect(sw.dispatch).toHaveBeenCalledTimes(1);
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("chunk");
  await reader.cancel();
  expect(sw.dispatch).toHaveBeenLastCalledWith({
    action: "cancel",
    streamId: "live",
  });
});

it("aborts the host request while response headers are pending", async () => {
  const sw = setup();
  let release!: (value: any) => void;
  sw.dispatch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  sw.dispatch.mockResolvedValue({ done: true } as any);
  const controller = new AbortController();
  const pending = sw.fetch(
    new Request("https://localhost/slow", { signal: controller.signal }),
  )!;
  const rejected = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(sw.dispatch).toHaveBeenCalledOnce());
  const id = (sw.dispatch.mock.calls[0][0] as any).id;
  controller.abort(new Error("cancelled"));
  await rejected;
  await vi.waitFor(() =>
    expect(sw.dispatch).toHaveBeenLastCalledWith({
      action: "cancel",
      streamId: id,
    }),
  );
  release({ streamId: id });
});

it("cancels a host request whose response headers time out", async () => {
  vi.useFakeTimers();
  let release!: (value: any) => void;
  try {
    const sw = setup();
    sw.dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    sw.dispatch.mockResolvedValue({ done: true } as any);
    const pending = sw.fetch(new Request("https://localhost/slow"))!;
    const rejected = expect(pending).rejects.toThrow("Worker response timeout");
    await vi.advanceTimersByTimeAsync(1);
    expect(sw.dispatch).toHaveBeenCalledOnce();
    const id = (sw.dispatch.mock.calls[0][0] as any).id;
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(sw.dispatch).toHaveBeenLastCalledWith({
      action: "cancel",
      streamId: id,
    });
    release({ streamId: id });
  } finally {
    vi.useRealTimers();
  }
});

it("bounds pending headers without blocking stream reads or queued cancellation", async () => {
  const sw = setup();
  const releases: (() => void)[] = [];
  sw.dispatch.mockImplementation(async (request: any) => {
    if (request.action === "pull")
      return { body: btoa("chunk"), done: false } as any;
    if (request.action === "cancel") return { done: true } as any;
    if (request.url.endsWith("/next"))
      return { status: 200, headers: {}, body: "next" } as any;
    return new Promise((resolve) =>
      releases.push(() =>
        resolve({
          status: 200,
          headers: {},
          streamId: request.id,
        } as any),
      ),
    );
  });
  const first = Array.from(
    { length: 6 },
    (_, i) => sw.fetch(new Request("https://localhost/" + i))!,
  );
  await vi.waitFor(() => expect(releases).toHaveLength(6));
  const controller = new AbortController();
  const cancelled = sw.fetch(
    new Request("https://localhost/cancelled", { signal: controller.signal }),
  )!;
  const rejected = expect(cancelled).rejects.toThrow("cancelled");
  const next = sw.fetch(new Request("https://localhost/next"))!;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sw.dispatch).toHaveBeenCalledTimes(6);
  controller.abort(new Error("cancelled"));
  await rejected;
  releases.forEach((release) => release());
  const responses = await Promise.all(first);
  expect(await (await next).text()).toBe("next");
  const more = Array.from(
    { length: 6 },
    (_, i) => sw.fetch(new Request("https://localhost/pending/" + i))!,
  );
  await vi.waitFor(() => expect(releases).toHaveLength(12));
  const reader = responses[0].body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("chunk");
  await reader.cancel();
  await Promise.all(
    responses.slice(1).map((response) => response.body!.cancel()),
  );
  expect(
    sw.dispatch.mock.calls.some(([request]) =>
      request.url?.endsWith("/cancelled"),
    ),
  ).toBe(false);
  releases.slice(6).forEach((release) => release());
  await Promise.all(
    (await Promise.all(more)).map((response) => response.body!.cancel()),
  );
});

it("bootstraps a navigation without dispatching to an unresponsive listed host", async () => {
  vi.useFakeTimers();
  try {
    const sw = setup();
    sw.setHostResponsive(false);
    const request = new Request("https://localhost/page");
    Object.defineProperty(request, "mode", { value: "navigate" });
    const pending = sw.fetch(request)!;
    await vi.advanceTimersByTimeAsync(2001);
    expect(await (await pending).text()).toBe("asset");
    expect(sw.dispatch).not.toHaveBeenCalled();
    expect(sw.nativeFetch).toHaveBeenLastCalledWith(
      "https://localhost/index.html",
      { cache: "no-store", signal: request.signal },
    );
  } finally {
    vi.useRealTimers();
  }
});

it("dispatches a live navigation once and never bootstraps after a sent request times out", async () => {
  vi.useFakeTimers();
  const sw = setup();
  const request = new Request("https://localhost/page");
  Object.defineProperty(request, "mode", { value: "navigate" });
  expect(await (await sw.fetch(request))!.text()).toBe("worker");
  expect(sw.dispatch).toHaveBeenCalledOnce();
  sw.dispatch.mockClear();
  let release!: (value: any) => void;
  try {
    sw.dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    sw.dispatch.mockResolvedValue({ done: true } as any);
    const pending = sw.fetch(request)!;
    const rejected = expect(pending).rejects.toThrow("Worker response timeout");
    // Deliver the readiness MessagePort reply before advancing the RPC deadline.
    await vi.waitFor(() => expect(sw.dispatch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(
      sw.nativeFetch.mock.calls.some(([url]) =>
        String(url).endsWith("/index.html"),
      ),
    ).toBe(false);
    expect(
      sw.dispatch.mock.calls.filter(([value]) => !(value as any).action),
    ).toHaveLength(1);
    release({ done: true });
  } finally {
    vi.useRealTimers();
  }
});

it("aborts a navigation readiness check without dispatch or bootstrap", async () => {
  vi.useFakeTimers();
  try {
    const sw = setup();
    sw.setHostResponsive(false);
    const controller = new AbortController();
    const request = new Request("https://localhost/page", {
      signal: controller.signal,
    });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const pending = sw.fetch(request)!;
    const rejected = expect(pending).rejects.toThrow("cancel readiness");
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(new Error("cancel readiness"));
    await rejected;
    await vi.advanceTimersByTimeAsync(2001);
    expect(sw.dispatch).not.toHaveBeenCalled();
    expect(
      sw.nativeFetch.mock.calls.some(([url]) =>
        String(url).endsWith("/index.html"),
      ),
    ).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it.each([false, true])(
  "a live host may start slowly or report startup failure without bootstrap (failure=%s)",
  async (failure) => {
    vi.useFakeTimers();
    let release!: (value: any) => void;
    try {
      const sw = setup();
      sw.dispatch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const request = new Request("https://localhost/page");
      Object.defineProperty(request, "mode", { value: "navigate" });
      const pending = sw.fetch(request)!;
      const result = failure
        ? expect(pending).rejects.toThrow("original startup failed")
        : pending;
      await vi.waitFor(() => expect(sw.dispatch).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(2500);
      expect(
        sw.nativeFetch.mock.calls.some(([url]) =>
          String(url).endsWith("/index.html"),
        ),
      ).toBe(false);
      release(
        failure
          ? { error: "original startup failed" }
          : {
              status: 200,
              headers: {},
              body: new TextEncoder().encode("started").buffer,
            },
      );
      if (failure) await result;
      else expect(await (await pending).text()).toBe("started");
      expect(sw.dispatch).toHaveBeenCalledOnce();
      expect(
        sw.nativeFetch.mock.calls.some(([url]) =>
          String(url).endsWith("/index.html"),
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  },
);
