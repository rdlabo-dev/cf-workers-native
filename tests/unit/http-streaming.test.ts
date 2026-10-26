import { afterEach, expect, it, vi } from "vitest";
import { request } from "../../src/compat/http/index";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])(
  "captures writes before queued processing (corked=%s) and sends at end",
  async (corked) => {
    let body!: Blob;
    const fetcher = vi.fn((_url, init) => {
      body = init.body;
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetcher);
    const req = request("http://example.test/upload", { method: "POST" });
    req.on("error", () => {});
    const written = vi.fn(),
      chunk = new Uint8Array([65]);
    if (corked) req.cork();
    req.write(chunk, written);
    chunk[0] = 66;
    if (corked) req.uncork();
    await vi.waitFor(() => expect(written).toHaveBeenCalledOnce());
    expect(written.mock.calls[0]?.[0]).toBeFalsy();
    expect(fetcher).not.toHaveBeenCalled();
    req.end("C");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await body.text()).toBe("AC");
  },
);
it("aborting an unfinished upload does not initiate a fetch", async () => {
  const fetcher = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController(),
    reason = new Error("stopped");
  const req = request("http://example.test/upload", {
    method: "POST",
    signal: controller.signal,
  });
  const errors: Error[] = [];
  req.on("error", (error) => errors.push(error));
  const written = vi.fn();
  req.write(new Uint8Array(65536), written);
  controller.abort(reason);
  await vi.waitFor(() => expect(errors).toHaveLength(1));
  expect(written).toHaveBeenCalledOnce();
  expect(written.mock.calls[0]?.[0]).toBeFalsy();
  expect(errors[0]).toMatchObject({
    name: "AbortError",
    code: "ABORT_ERR",
    cause: reason,
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(req.destroyed).toBe(true);
});
it("settles every accepted write once on destroy", async () => {
  const fetcher = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetcher);
  const req = request("http://example.test/upload", { method: "POST" });
  req.on("error", () => {});
  const callbacks = [vi.fn(), vi.fn(), vi.fn()];
  for (const callback of callbacks) req.write(new Uint8Array(65536), callback);
  req.destroy(new Error("stopped"));
  await vi.waitFor(() =>
    expect(
      callbacks.every((callback) => callback.mock.calls.length === 1),
    ).toBe(true),
  );
  expect(req.writableLength).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
});
