import { ReadableStream as WorkerReadableStream } from "../../compat/stream-web/runtime.js";
import { describe, expect, it, vi } from "vitest";
import {
  FetchTransport,
  type NativeConnection,
  type TransportRequest,
} from "./transport.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const headers = deferred<{
    status: number;
    statusText: string;
    headers: [string, string][];
    hasBody: boolean;
  }>();
  const connection: NativeConnection = {
    headers: headers.promise,
    write: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    read: vi.fn(async () => null),
    close: vi.fn(async () => {}),
  };
  const open = vi.fn(async () => connection);
  const abort = new AbortController();
  const request: TransportRequest = {
    url: "https://example.invalid",
    method: "GET",
    headers: [],
    body: null,
    signal: abort.signal,
  };
  const transport = new FetchTransport({ open });
  const respond = (hasBody = true) =>
    headers.resolve({
      status: 200,
      statusText: "OK",
      headers: [
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
      ],
      hasBody,
    });
  return { connection, open, abort, request, transport, respond };
}

describe("native byte transport ownership", () => {
  it("delivers native response bytes directly in an owned BYOB stream", async () => {
    const { connection, request, transport, respond } = fixture();
    const backing = Buffer.alloc(4);
    backing.set([1, 65, 66, 2]);
    const bytes = backing.subarray(1, 3);
    vi.mocked(connection.read)
      .mockResolvedValueOnce(new Uint8Array(0))
      .mockResolvedValueOnce(bytes)
      .mockResolvedValueOnce(null);
    respond();
    const { body } = await transport.fetch(request);
    expect(body).toBeInstanceOf(WorkerReadableStream);
    expect(connection.read).not.toHaveBeenCalled();
    const reader = body!.getReader({ mode: "byob" });
    const first = await reader.read(new Uint8Array(4));
    expect(first.done).toBe(false);
    expect([...first.value!]).toEqual([65, 66]);
    expect([...backing]).toEqual([1, 65, 66, 2]);
    expect((await reader.read(new Uint8Array(4))).done).toBe(true);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it("finishes an early response without waiting for the retained replay branch", async () => {
    const f = fixture();
    const accepted = deferred<void>();
    vi.mocked(f.connection.write).mockReturnValue(accepted.promise);
    const [upload, replay] = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    }).tee();
    const pending = f.transport.fetch({
      ...f.request,
      method: "POST",
      body: upload,
    });
    await vi.waitFor(() => expect(f.connection.write).toHaveBeenCalledOnce());
    f.respond();
    const response = await pending;
    const done = vi.fn();
    const reading = response.body!.getReader().read().then(done);
    try {
      await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
      expect(f.connection.close).toHaveBeenCalledOnce();
      expect(upload.locked).toBe(false);
    } finally {
      await replay.cancel();
      accepted.resolve();
      await reading;
    }
  });

  it("preserves duplicate headers and reads only on demand", async () => {
    const f = fixture();
    const response = f.transport.fetch(f.request);
    f.respond();
    const result = await response;
    expect(result.headers).toEqual([
      ["set-cookie", "a=1"],
      ["set-cookie", "b=2"],
    ]);
    expect(f.connection.read).not.toHaveBeenCalled();
    const reader = result.body!.getReader();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(f.connection.read).toHaveBeenCalledTimes(1);
    expect(f.connection.close).toHaveBeenCalledTimes(1);
  });

  it("does not resolve cancellation until native resources are released", async () => {
    const f = fixture();
    const released = deferred<void>();
    vi.mocked(f.connection.close).mockReturnValue(released.promise);
    f.respond();
    const response = await f.transport.fetch(f.request);
    const done = vi.fn();
    const cancelled = response.body!.cancel().then(done);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    released.resolve();
    await cancelled;
    expect(done).toHaveBeenCalledOnce();
  });

  it("releases an opening connection even when abort wins", async () => {
    const f = fixture();
    const opening = deferred<NativeConnection>();
    f.open.mockReturnValue(opening.promise);
    const result = f.transport.fetch(f.request);
    f.abort.abort("stop");
    await expect(result).rejects.toBe("stop");
    opening.resolve(f.connection);
    await vi.waitFor(() => expect(f.connection.close).toHaveBeenCalledTimes(1));
  });

  it("bounds upload writes and permits headers before upload completes", async () => {
    const f = fixture();
    const accepted = deferred<void>();
    vi.mocked(f.connection.write).mockReturnValueOnce(accepted.promise);
    const request = {
      ...f.request,
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.enqueue(new Uint8Array([2]));
          controller.close();
        },
      }),
    };
    const pending = f.transport.fetch(request);
    await vi.waitFor(() => expect(f.connection.write).toHaveBeenCalledTimes(1));
    f.respond();
    const response = await pending;
    expect(f.connection.write).toHaveBeenCalledTimes(1);
    accepted.resolve();
    await vi.waitFor(() => expect(f.connection.end).toHaveBeenCalledTimes(1));
    expect(f.connection.write).toHaveBeenCalledTimes(2);
    await response.body!.cancel();
    expect(f.connection.close).toHaveBeenCalledTimes(1);
  });

  it("propagates abort to a pending response read and closes once", async () => {
    const f = fixture();
    vi.mocked(f.connection.read).mockReturnValue(new Promise(() => {}));
    f.respond();
    const result = await f.transport.fetch(f.request);
    const reader = result.body!.getReader();
    const reading = reader.read();
    f.abort.abort(null);
    await expect(reading).rejects.toBe(null);
    expect(f.connection.close).toHaveBeenCalledTimes(1);
  });

  it("closes bodyless responses without attempting a read", async () => {
    const f = fixture();
    f.respond(false);
    expect((await f.transport.fetch(f.request)).body).toBe(null);
    expect(f.connection.read).not.toHaveBeenCalled();
    expect(f.connection.close).toHaveBeenCalledTimes(1);
  });

  it("rejects stream upload failures with the original reason", async () => {
    const f = fixture();
    const failure = new Error("upload");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    await expect(
      f.transport.fetch({ ...f.request, method: "POST", body }),
    ).rejects.toBe(failure);
    expect(f.connection.close).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
});
