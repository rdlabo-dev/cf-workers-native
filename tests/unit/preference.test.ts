import { afterEach, expect, it, vi } from "vitest";
import { createFetchRuntime } from "../../src/cloudflare/workers/worker-runtime";
import { workerFor } from "../helpers/isolated-worker";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
});
function setup(
  prefer?: "worker" | "direct",
  env?: unknown,
  unavailable = false,
) {
  vi.stubGlobal("Worker", unavailable ? undefined : function Worker() {});
  const workerHandler = { fetch: vi.fn(() => new Response("worker")) };
  const direct = {
    fetch: vi.fn((_request: Request, _env: unknown) => new Response("direct")),
  };
  const disposeDirect = vi.fn();
  const source = {
    createWorker: vi.fn(() => workerFor(workerHandler) as unknown as Worker),
    loadDirect: vi.fn(async () => ({
      handler: direct,
      dispose: disposeDirect,
    })),
  };
  const runtime = createFetchRuntime({
    worker: source,
    baseURL: "https://test/api",
    prefer,
    env,
  });
  cleanups.push(() => runtime.dispose());
  return { runtime, source, direct, disposeDirect, workerHandler };
}
it("prefers a worker without loading the direct module", async () => {
  const { runtime, source } = setup();
  expect(await (await runtime.fetch("https://test/api")).text()).toBe("worker");
  expect(runtime.execution).toBe("worker");
  expect(source.loadDirect).not.toHaveBeenCalled();
});
it("prefers direct without creating a worker", async () => {
  const { runtime, source, disposeDirect } = setup("direct");
  await runtime.ready;
  expect(await (await runtime.fetch("https://test/api")).text()).toBe("direct");
  expect(source.createWorker).not.toHaveBeenCalled();
  runtime.dispose();
  expect(disposeDirect).toHaveBeenCalledOnce();
});
it("falls back before dispatch when Worker is unavailable", async () => {
  const { runtime, source } = setup(undefined, {}, true);
  await runtime.ready;
  expect(runtime.execution).toBe("direct");
  expect(source.createWorker).not.toHaveBeenCalled();
});
it("keeps method-bearing binding identity in direct mode", async () => {
  class Binding {
    get() {
      return "value";
    }
  }
  const env = { KV: new Binding() };
  const { runtime, source, direct } = setup(undefined, env);
  await runtime.ready;
  await runtime.fetch("https://test/api");
  expect(source.createWorker).not.toHaveBeenCalled();
  expect(direct.fetch.mock.calls[0]?.[1]).toBe(env);
});
it("does not replay failed requests in another environment", async () => {
  const { runtime, source, workerHandler } = setup();
  workerHandler.fetch.mockImplementation(() => {
    throw new Error("application failed");
  });
  await expect(
    runtime.fetch("https://test/api", { method: "POST", body: "write" }),
  ).rejects.toThrow("application failed");
  expect(source.loadDirect).not.toHaveBeenCalled();
  expect(workerHandler.fetch).toHaveBeenCalledOnce();
});
it("does not dispatch after disposal during lazy initialization", async () => {
  const direct = { fetch: vi.fn(() => new Response()) };
  const disposeDirect = vi.fn();
  let resolve!: (value: {
    handler: typeof direct;
    dispose: typeof disposeDirect;
  }) => void;
  const runtime = createFetchRuntime({
    baseURL: "https://test/api",
    prefer: "direct",
    worker: {
      createWorker: vi.fn(),
      loadDirect: () =>
        new Promise<{
          handler: typeof direct;
          dispose: typeof disposeDirect;
        }>((done) => {
          resolve = done;
        }),
    },
  });
  runtime.dispose();
  resolve({ handler: direct, dispose: disposeDirect });
  await expect(runtime.ready).rejects.toThrow("disposed");
  expect(direct.fetch).not.toHaveBeenCalled();
  expect(disposeDirect).toHaveBeenCalledOnce();
});
it("does not release a newer direct load when an older disposed load resolves", async () => {
  const firstHandler = { fetch: vi.fn(() => new Response("first")) };
  const secondHandler = { fetch: vi.fn(() => new Response("second")) };
  const disposeFirst = vi.fn();
  const disposeSecond = vi.fn();
  let resolveFirst!: (value: {
    handler: typeof firstHandler;
    dispose: typeof disposeFirst;
  }) => void;
  let loads = 0;
  const source = {
    createWorker: vi.fn(),
    loadDirect: () => {
      if (loads++ === 0)
        return new Promise<{
          handler: typeof firstHandler;
          dispose: typeof disposeFirst;
        }>((resolve) => {
          resolveFirst = resolve;
        });
      return Promise.resolve({
        handler: secondHandler,
        dispose: disposeSecond,
      });
    },
  };
  const first = createFetchRuntime({
    baseURL: "https://test/api",
    prefer: "direct",
    worker: source,
  });
  first.dispose();
  const second = createFetchRuntime({
    baseURL: "https://test/api",
    prefer: "direct",
    worker: source,
  });
  await second.ready;

  resolveFirst({ handler: firstHandler, dispose: disposeFirst });
  await expect(first.ready).rejects.toThrow("disposed");
  expect(disposeFirst).toHaveBeenCalledOnce();
  expect(disposeSecond).not.toHaveBeenCalled();
  expect(await (await second.fetch("https://test/api")).text()).toBe("second");

  second.dispose();
  expect(disposeSecond).toHaveBeenCalledOnce();
});
it("falls back on a platform constructor denial, but not a script startup error", async () => {
  vi.stubGlobal("Worker", function Worker() {});
  const loadDirect = vi.fn(async () => ({
    fetch: () => new Response("direct"),
  }));
  const denied = createFetchRuntime({
    baseURL: "https://test/api",
    worker: {
      createWorker() {
        throw new DOMException("blocked", "SecurityError");
      },
      loadDirect,
    },
  });
  cleanups.push(() => denied.dispose());
  await denied.ready;
  expect(denied.execution).toBe("direct");
  loadDirect.mockClear();
  const broken = {
    terminate: vi.fn(),
    onerror: undefined as
      | undefined
      | ((event: { message: string; preventDefault(): void }) => void),
  };
  const failed = createFetchRuntime({
    baseURL: "https://test/api",
    worker: {
      createWorker() {
        queueMicrotask(() =>
          broken.onerror?.({ message: "module failed", preventDefault() {} }),
        );
        return broken as unknown as Worker;
      },
      loadDirect,
    },
  });
  cleanups.push(() => failed.dispose());
  await expect(failed.ready).rejects.toThrow("module failed");
  expect(loadDirect).not.toHaveBeenCalled();
  expect(broken.terminate).toHaveBeenCalled();
});
it("rejects a local top-level await fetch instead of deadlocking direct startup", async () => {
  const { workersCapacitor } = await import("../../src/index");
  const runtime = workersCapacitor({
    baseURL: "https://test/api",
    prefer: "direct",
    worker: {
      createWorker: vi.fn(),
      loadDirect: async () =>
        (await import("../fixtures/direct-startup-fetch")).default,
    },
  });
  cleanups.push(() => runtime.dispose());
  await expect(runtime.ready).rejects.toThrow(
    "Direct module initialization is in progress",
  );
});
for (const shape of ["hidden", "null-prototype"] as const) {
  it(`preserves ${shape} env semantics by selecting direct`, async () => {
    const env =
      shape === "hidden"
        ? Object.defineProperty({}, "TOKEN", { value: "local" })
        : Object.assign(Object.create(null), { TOKEN: "local" });
    const { runtime, source, direct } = setup(undefined, { nested: env });
    await runtime.ready;
    await runtime.fetch("https://test/api");
    expect(runtime.execution).toBe("direct");
    expect(source.createWorker).not.toHaveBeenCalled();
    const received = direct.fetch.mock.calls[0][1] as { nested: typeof env };
    expect(received.nested).toBe(env);
    expect(received.nested.TOKEN).toBe("local");
    expect(Object.getPrototypeOf(received.nested)).toBe(
      Object.getPrototypeOf(env),
    );
  });
}
it("preserves ordinary arrays and cyclic plain env through the actual transport", async () => {
  vi.stubGlobal("Worker", function Worker() {});
  const env = { items: ["local", { n: 2 }], self: null as unknown };
  env.self = env;
  const handler = {
    fetch: vi.fn((_request: Request, received: typeof env) => {
      expect(received).not.toBe(env);
      expect(received.items).toEqual(env.items);
      expect(received.self).toBe(received);
      return new Response("preserved");
    }),
  };
  const runtime = createFetchRuntime({
    baseURL: "https://test/api",
    env,
    worker: {
      createWorker: () => workerFor(handler) as unknown as Worker,
      loadDirect: async () => {
        throw new Error("should not fall back");
      },
    },
  });
  cleanups.push(() => runtime.dispose());
  expect(await (await runtime.fetch("https://test/api")).text()).toBe(
    "preserved",
  );
  expect(runtime.execution).toBe("worker");
});
it("aborts queued worker requests before startup without replaying them", async () => {
  vi.stubGlobal("Worker", function Worker() {});
  const handler = { fetch: vi.fn(() => new Response("ready")) };
  let announce!: () => void;
  const runtime = createFetchRuntime({
    baseURL: "https://test/api",
    worker: {
      createWorker() {
        const client = workerFor(handler);
        let callback: typeof client.onmessage = null;
        Object.defineProperty(client, "onmessage", {
          get: () => (event: { data: unknown }) => {
            announce = () => callback?.(event);
          },
          set: (value: typeof client.onmessage) => {
            callback = value;
          },
        });
        return client as unknown as Worker;
      },
      loadDirect: async () => {
        throw new Error("unexpected fallback");
      },
    },
  });
  cleanups.push(() => runtime.dispose());
  const controller = new AbortController();
  const pending = runtime.fetch("https://test/api", {
    method: "POST",
    body: "write",
    signal: controller.signal,
  });
  const rejection = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await Promise.resolve();
  controller.abort();
  await rejection;
  await vi.waitFor(() => expect(announce).toBeTypeOf("function"));
  announce();
  await runtime.ready;
  expect(await (await runtime.fetch("https://test/api")).text()).toBe("ready");
  expect(handler.fetch).toHaveBeenCalledOnce();
});

it("releases a loaded worker when its fetch accessor throws", async () => {
  const failure = new Error("fetch getter failed");
  const dispose = vi.fn();
  const runtime = createFetchRuntime({
    baseURL: "https://test/api",
    prefer: "direct",
    worker: {
      createWorker: vi.fn(),
      loadDirect: async () => ({
        handler: {
          get fetch(): never {
            throw failure;
          },
        },
        dispose,
      }),
    },
  });
  await expect(runtime.ready).rejects.toBe(failure);
  runtime.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});

it("preserves the loaded worker as the disposer receiver", async () => {
  const owned = {
    handler: { fetch: () => new Response("ok") },
    releases: 0,
    dispose() {
      this.releases++;
    },
  };
  const runtime = createFetchRuntime({
    baseURL: "https://test/api",
    prefer: "direct",
    worker: { createWorker: vi.fn(), loadDirect: async () => owned },
  });
  await runtime.ready;
  runtime.dispose();
  runtime.dispose();
  expect(owned.releases).toBe(1);
});
it("exposes the direct handler bindings through the imported worker env", async () => {
  const { env } =
    await import("../../src/cloudflare/apis/cloudflare-workers/index");
  const binding = {
    get() {
      return "registered";
    },
  };
  const { runtime, direct } = setup("direct", { STORE: binding });
  direct.fetch.mockImplementation(() => {
    expect(env.STORE).toBe(binding);
    return new Response("ok");
  });
  expect(await (await runtime.fetch("https://test/api")).text()).toBe("ok");
  expect(env.STORE).toBeUndefined();
});
