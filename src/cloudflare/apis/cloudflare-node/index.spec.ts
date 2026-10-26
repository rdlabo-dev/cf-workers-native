import { expect, it, vi } from "vitest";
import * as httpModule from "../../../compat/http/index";
import * as cloudflareNodeModule from "./index";
import {
  Agent,
  ClientRequest,
  IncomingMessage,
  OutgoingMessage,
  Server,
  ServerResponse,
  createServer,
  get,
  globalAgent,
  maxHeaderSize,
  request,
  setMaxIdleHTTPParsers,
} from "../../../compat/http/index";
import {
  connectHandler,
  handleAsNodeConnection,
  httpServerHandler,
} from "./index";
import { release, setHandler } from "../../../compat/http/registry";

it("rejects invalid asynchronous response headers instead of leaving fetch pending", async () => {
  const server = createServer(async (_request, response) => {
    await Promise.resolve();
    response.setHeader("bad\nname", "value");
    response.end("body");
  }).listen(3019);
  try {
    await expect(
      httpServerHandler({ port: 3019 }).fetch(
        new Request("https://example.test/"),
      ),
    ).rejects.toThrow();
  } finally {
    server.close();
  }
});

it("accepts a server and starts it once with an automatically assigned logical port", async () => {
  const server = createServer((request, response) => response.end(request.url));
  const handler = httpServerHandler(server);
  const address = server.address();
  try {
    expect(server.listening).toBe(true);
    expect(address?.port).toBeGreaterThanOrEqual(49152);
    expect(server.address()).toEqual(address);
    expect(
      await (
        await handler.fetch(new Request("https://example.test/path?q=1"))
      ).text(),
    ).toBe("/path?q=1");
    httpServerHandler(server);
    expect(server.address()).toEqual(address);
  } finally {
    server.close();
  }
});

it("accepts numeric and object descriptors and dispatches through the same registry", async () => {
  const { handleAsNodeRequest } = await import("./index");
  const server = createServer((_request, response) =>
    response.end("ok"),
  ).listen(3020);
  try {
    for (const descriptor of [3020, { port: 3020 }]) {
      expect(
        await (
          await httpServerHandler(descriptor).fetch(
            new Request("https://example.test/"),
          )
        ).text(),
      ).toBe("ok");
      expect(
        await (
          await handleAsNodeRequest(
            descriptor,
            new Request("https://example.test/"),
          )
        ).text(),
      ).toBe("ok");
    }
  } finally {
    server.close();
  }
  await expect(
    handleAsNodeRequest(3020, new Request("https://example.test/")),
  ).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
});

it("validates descriptors at handler creation and rejects invalid dispatch ports", async () => {
  const { handleAsNodeRequest } = await import("./index");
  for (const descriptor of [-1, 65536, NaN, Infinity, {}, { port: null }]) {
    expect(() => httpServerHandler(descriptor)).toThrow(
      "Failed to determine port for server",
    );
    await expect(
      handleAsNodeRequest(descriptor, new Request("https://example.test/")),
    ).rejects.toThrow("Failed to determine port for server");
  }
  expect(() => httpServerHandler(null!)).toThrow(
    "Server descriptor cannot be null or undefined",
  );
  // The bridge validates finite range; Server.listen owns integer validation.
  expect(() => httpServerHandler(1.5)).not.toThrow();
});

it("assigns different ports to zero/omitted listeners and preserves explicit overloads", () => {
  const servers = [
    createServer(() => {}),
    createServer(() => {}),
    createServer(() => {}),
  ];
  try {
    servers[0].listen();
    servers[1].listen(0);
    servers[2].listen({ port: "3021" });
    expect(servers[0].address()?.port).not.toBe(servers[1].address()?.port);
    expect(servers[2].address()?.port).toBe(3021);
    expect(() => servers[0].listen()).toThrow();
  } finally {
    for (const server of servers) server.close();
  }
  for (const port of [-1, 65536, 1.5]) {
    expect(() => createServer(() => {}).listen(port)).toThrow(
      expect.objectContaining({ code: "ERR_SOCKET_BAD_PORT" }),
    );
  }
});

it("dispatches before the upload ends and streams the response before end", async () => {
  let upload!: ReadableStreamDefaultController<Uint8Array>;
  let response!: import("../../../compat/http/index").ServerResponse;
  const server = createServer((_request, res) => {
    response = res;
    res.write("first");
  });
  const request = new Request("https://example.test/", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        upload = controller;
      },
    }),
    duplex: "half",
  } as RequestInit);
  try {
    const result = await httpServerHandler(server).fetch(request);
    const reader = result.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    response.end("last");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("last");
    expect((await reader.read()).done).toBe(true);
  } finally {
    upload.close();
    server.close();
  }
});

it("preserves Cloudflare dispatch context and drains an incremental request body", async () => {
  const env = { value: 1 },
    ctx = { waitUntil() {} };
  const server = createServer((req, res) => {
    expect(req.cloudflare).toEqual({ env, ctx });
    expect(req.headers.host).toBe("example.test");
    expect(req.headers["transfer-encoding"]).toBe("chunked");
    expect(req.complete).toBe(false);
    req.pipe(res);
  });
  try {
    const result = await httpServerHandler(server).fetch(
      new Request("https://example.test/", { method: "POST", body: "upload" }),
      env,
      ctx,
    );
    expect(await result.text()).toBe("upload");
  } finally {
    server.close();
  }
});

it("propagates rejected async handlers instead of leaving the request pending", async () => {
  const server = createServer(async () => {
    await Promise.resolve();
    throw new Error("handler failed");
  });
  try {
    await expect(
      httpServerHandler(server).fetch(new Request("https://example.test/")),
    ).rejects.toThrow("handler failed");
  } finally {
    server.close();
  }
});

it("propagates response errors after headers to the body reader", async () => {
  let response!: import("../../../compat/http/index").ServerResponse;
  const server = createServer((_req, res) => {
    response = res;
    res.flushHeaders();
  });
  try {
    const result = await httpServerHandler(server).fetch(
      new Request("https://example.test/"),
    );
    response.destroy(new Error("body failed"));
    await expect(result.text()).rejects.toThrow("body failed");
  } finally {
    server.close();
  }
});

it("leaves an unread upload uncancelled after an early response", async () => {
  let cancelled = false;
  const upload = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://example.test/", {
    method: "POST",
    body: upload,
    duplex: "half",
  } as RequestInit);
  const server = createServer((_req, res) => res.end("early"));
  try {
    const response = await httpServerHandler(server).fetch(request);
    expect(await response.text()).toBe("early");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(false);
    expect(request.body!.locked).toBe(false);
  } finally {
    server.close();
  }
});

it("fails the response body and unlocks the reader when an upload fails after headers", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const request = new Request("https://example.test/", {
    method: "POST",
    duplex: "half",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
      },
    }),
  } as RequestInit);
  const server = createServer((req, res) => {
    res.flushHeaders();
    req.resume();
  });
  try {
    const response = await httpServerHandler(server).fetch(request);
    source.error(new Error("upload broke"));
    await expect(response.text()).rejects.toThrow("upload broke");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request.body!.locked).toBe(false);
  } finally {
    server.close();
  }
});

it("matches the pinned node:http and cloudflare:node exact public export surfaces", () => {
  expect(Object.keys(httpModule).sort()).toEqual(
    [
      "Agent",
      "ClientRequest",
      "CloseEvent",
      "IncomingMessage",
      "METHODS",
      "MessageEvent",
      "OutgoingMessage",
      "STATUS_CODES",
      "Server",
      "ServerResponse",
      "WebSocket",
      "_connectionListener",
      "createServer",
      "default",
      "get",
      "globalAgent",
      "maxHeaderSize",
      "request",
      "setMaxIdleHTTPParsers",
      "validateHeaderName",
      "validateHeaderValue",
    ].sort(),
  );
  expect(Object.keys(httpModule.default).sort()).toEqual(
    Object.keys(httpModule)
      .filter((name) => name !== "default")
      .sort(),
  );
  expect(Object.keys(cloudflareNodeModule).sort()).toEqual([
    "connectHandler",
    "handleAsNodeConnection",
    "handleAsNodeRequest",
    "httpServerHandler",
  ]);
});

it("matches the pinned node:http prototype member surfaces", () => {
  const expected = {
    Agent: [
      "addRequest",
      "constructor",
      "createConnection",
      "createSocket",
      "destroy",
      "getName",
      "keepSocketAlive",
      "removeSocket",
      "reuseSocket",
    ],
    ClientRequest: [
      "_implicitHeader",
      "_write",
      "abort",
      "addTrailers",
      "clearTimeout",
      "constructor",
      "destroy",
      "end",
      "onSocket",
      "setNoDelay",
      "setSocketKeepAlive",
      "setTimeout",
      "write",
    ],
    IncomingMessage: [
      "_addHeaderLine",
      "_addHeaderLineDistinct",
      "_addHeaderLines",
      "_destroy",
      "_dump",
      "_read",
      "connection",
      "constructor",
      "headers",
      "headersDistinct",
      "setTimeout",
      "socket",
      "trailers",
      "trailersDistinct",
    ],
    OutgoingMessage: [
      "_finish",
      "_flush",
      "_flushOutput",
      "_implicitHeader",
      "_renderHeaders",
      "_send",
      "_storeHeader",
      "_writeRaw",
      "appendHeader",
      "closed",
      "constructor",
      "cork",
      "destroy",
      "end",
      "errored",
      "flushHeaders",
      "getHeader",
      "getHeaderNames",
      "getHeaders",
      "getRawHeaderNames",
      "hasHeader",
      "headersSent",
      "pipe",
      "removeHeader",
      "setHeader",
      "setHeaders",
      "uncork",
      "writableCorked",
      "writableEnded",
      "writableHighWaterMark",
      "writableLength",
      "writableNeedDrain",
      "writableObjectMode",
      "write",
    ],
    Server: [
      "address",
      "close",
      "closeAllConnections",
      "closeIdleConnections",
      "connections",
      "constructor",
      "getConnections",
      "listen",
      "listening",
      "maxConnections",
      "ref",
      "setTimeout",
      "unref",
    ],
    ServerResponse: [
      "_implicitHeader",
      "assignSocket",
      "constructor",
      "destroy",
      "detachSocket",
      "writeContinue",
      "writeEarlyHints",
      "writeHead",
      "writeProcessing",
    ],
  };
  for (const [name, members] of Object.entries(expected)) {
    const constructor = httpModule[
      name as keyof typeof expected
    ] as unknown as { prototype: object };
    expect(
      Object.getOwnPropertyNames(constructor.prototype).sort(),
      name,
    ).toEqual([...members].sort());
  }
});

it("matches pinned node:http prototype descriptor kinds", () => {
  const accessors: Record<string, string[]> = {
    IncomingMessage: [
      "connection",
      "headers",
      "headersDistinct",
      "socket",
      "trailers",
      "trailersDistinct",
    ],
    OutgoingMessage: [
      "closed",
      "errored",
      "headersSent",
      "writableCorked",
      "writableEnded",
      "writableHighWaterMark",
      "writableLength",
      "writableNeedDrain",
      "writableObjectMode",
    ],
    Server: ["connections", "listening", "maxConnections"],
  };
  for (const [className, names] of Object.entries(accessors)) {
    const constructor = httpModule[
      className as "IncomingMessage"
    ] as unknown as { prototype: object };
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(
        constructor.prototype,
        name,
      );
      expect(descriptor?.get, `${className}.${name}`).toBeTypeOf("function");
      expect(descriptor?.value, `${className}.${name}`).toBeUndefined();
    }
  }
});

it("matches pinned node:http constructors and constants", () => {
  expect(maxHeaderSize).toBe(16384);
  expect(globalAgent).toBeInstanceOf(Agent);
  expect(globalAgent.keepAlive).toBe(true);
  expect(new ClientRequest("http://example.test/")).toBeInstanceOf(
    OutgoingMessage,
  );
  expect(new Server()).toBeInstanceOf(Server);
  expect(new IncomingMessage()).toBeInstanceOf(IncomingMessage);
  const req = new IncomingMessage();
  expect(new ServerResponse(req)).toBeInstanceOf(OutgoingMessage);
  expect(typeof request).toBe("function");
  expect(typeof get).toBe("function");
  expect(() => setMaxIdleHTTPParsers(0)).toThrow(
    expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
  );
  expect(() => setMaxIdleHTTPParsers(1)).toThrow(
    expect.objectContaining({ code: "ERR_METHOD_NOT_IMPLEMENTED" }),
  );
});

it("implements ClientRequest request/get over fetch with request bodies and response streams", async () => {
  const fetchMock = vi.fn(async (input: URL, init: RequestInit) => {
    expect(String(input)).toBe("http://example.test:8080/path?q=1");
    expect(init.method).toBe("POST");
    expect(await new Response(init.body).text()).toBe("payload");
    return new Response("reply", {
      status: 201,
      statusText: "Created",
      headers: { "x-result": "yes" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(
        "http://example.test:8080/path?q=1",
        { method: "POST", headers: { "x-request": "yes" } },
        resolve,
      );
      req.once("error", reject);
      req.end("payload");
    });
    expect(response.statusCode).toBe(201);
    expect(response.statusMessage).toBe("Created");
    expect(response.headers["x-result"]).toBe("yes");
    let body = "";
    for await (const chunk of response) body += chunk;
    expect(body).toBe("reply");

    fetchMock.mockResolvedValueOnce(new Response("get"));
    const getResponse = await new Promise<IncomingMessage>(
      (resolve, reject) => {
        const req = get("http://example.test/", resolve);
        req.once("error", reject);
      },
    );
    getResponse.resume();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("resets the shared ClientRequest idle timeout for each response chunk", async () => {
  vi.useFakeTimers();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              body = controller;
            },
          }),
        ),
    ),
  );
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = get("http://example.test/", resolve);
      req.once("error", reject);
      req.setTimeout(50);
    });
    const timedOut = vi.fn();
    response.on("timeout", timedOut);
    const reader = response[Symbol.asyncIterator]();
    await vi.advanceTimersByTimeAsync(40);
    body.enqueue(new TextEncoder().encode("first"));
    await reader.next();
    await vi.advanceTimersByTimeAsync(40);
    expect(timedOut).not.toHaveBeenCalled();
    body.enqueue(new TextEncoder().encode("second"));
    await reader.next();
    await vi.advanceTimersByTimeAsync(40);
    expect(timedOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(timedOut).toHaveBeenCalledOnce();
    expect(response.destroyed).toBe(true);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("lets IncomingMessage.setTimeout replace the shared request idle timeout", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new ReadableStream<Uint8Array>())),
  );
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = get("http://example.test/", resolve);
      req.once("error", reject);
      req.setTimeout(10_000);
    });
    const timedOut = vi.fn();
    response.setTimeout(25, timedOut);
    response.resume();
    await vi.advanceTimersByTimeAsync(26);
    expect(timedOut).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("reports a bare pre-response ClientRequest.destroy as ECONNRESET socket hang up", async () => {
  const req = new ClientRequest("http://example.test/");
  const error = new Promise<Error>((resolve) => req.once("error", resolve));
  const close = new Promise<void>((resolve) => req.once("close", resolve));
  req.destroy();
  await expect(error).resolves.toMatchObject({
    code: "ECONNRESET",
    message: "socket hang up",
  });
  await close;
});

it("validates ClientRequest socket option stub arguments like pinned Workerd", () => {
  const req = new ClientRequest("http://example.test/");
  req.on("error", () => {});
  expect(() => req.setNoDelay()).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => req.setNoDelay("yes" as never)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => req.setNoDelay(true)).not.toThrow();
  expect(() => req.setSocketKeepAlive()).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => req.setSocketKeepAlive(true, "1" as never)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => req.setSocketKeepAlive(true, 1)).not.toThrow();
  req.abort();
});

it("implements Agent no-op and throwing stubs as pinned", () => {
  const agent = new Agent({ defaultPort: 81, protocol: "http:" } as never);
  expect(agent.getName({ host: "example.test", port: 81 })).toBe(
    "example.test:81:",
  );
  expect(agent.keepSocketAlive({} as never)).toBe(false);
  expect(agent.addRequest({} as never, {})).toBeUndefined();
  expect(() => agent.createConnection()).toThrow(
    expect.objectContaining({ code: "ERR_METHOD_NOT_IMPLEMENTED" }),
  );
});

it("rejects an inbound connection when no net.Server handler owns its port", async () => {
  const socket = {
    opened: Promise.resolve({ localAddress: "127.0.0.1:3081" }),
  };
  await expect(handleAsNodeConnection(socket)).rejects.toMatchObject({
    code: "ERR_INVALID_ARG_VALUE",
  });
  await expect(connectHandler().connect(socket)).rejects.toMatchObject({
    code: "ERR_INVALID_ARG_VALUE",
  });
});

it("dispatches an inbound socket through the shared logical-port registry", async () => {
  const socket = { opened: Promise.resolve({ localAddress: "[::1]:3082" }) };
  const env = { key: 1 };
  const ctx = { waitUntil() {} };
  const connect = vi.fn(async () => {});
  setHandler(3082, { connect });
  try {
    await connectHandler().connect(socket, env, ctx);
    expect(connect).toHaveBeenCalledWith(socket, env, ctx);
  } finally {
    release(3082);
  }
});

it("leaves the request upload uncancelled when the response reader is cancelled", async () => {
  let cancelled = false;
  const request = new Request("https://example.test/", {
    method: "POST",
    duplex: "half",
    body: new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }),
  } as RequestInit);
  const server = createServer((_req, res) => {
    res.flushHeaders();
  });
  try {
    const response = await httpServerHandler(server).fetch(request);
    await response.body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(false);
    expect(request.body!.locked).toBe(false);
  } finally {
    server.close();
  }
});
