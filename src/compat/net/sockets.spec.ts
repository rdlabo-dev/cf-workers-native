import { afterEach, expect, it, vi } from "vitest";
import { connect } from "./sockets.js";
import {
  setNativeCall,
  type NativeCall,
} from "../../browser/fetch/native-network.js";
let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});
it("waits for an in-flight direct TLS handshake before settling close", async () => {
  let finish!: () => void;
  const call = vi.fn<NativeCall>(async (_, method) => {
    if (method === "socketStartTls")
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    if (method === "socketWatch") return new Promise(() => {});
    return {};
  });
  restore = setNativeCall(call);
  const socket = connect("localhost:1234", { secureTransport: "on" });
  const opening = expect(socket.opened).rejects.toThrow("closed");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  let closed = false;
  const closing = socket.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(call.mock.calls.some((args) => args[1] === "socketClose")).toBe(false);
  finish();
  await closing;
  await opening;
  await socket.closed;
  expect(closed).toBe(true);
  expect(call.mock.calls.some((args) => args[1] === "socketClose")).toBe(true);
  expect(call.mock.calls.some((args) => args[1] === "socketWrite")).toBe(false);
});
it("never opens a socket cancelled in the same turn", async () => {
  const call = vi.fn<NativeCall>(async (_, method) =>
    method === "socketWatch" ? new Promise(() => {}) : {},
  );
  restore = setNativeCall(call);
  const socket = connect("localhost:1234");
  const opening = expect(socket.opened).rejects.toThrow("closed");
  await socket.close();
  await opening;
  await socket.closed;
  expect(call.mock.calls.map((args) => args[1])).toEqual(["socketClose"]);
});
it("closes a connection that finishes opening after cancellation", async () => {
  let finish!: (value: unknown) => void;
  const call = vi.fn<NativeCall>(async (_, method) => {
    if (method === "socketOpen")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (method === "socketWatch") return new Promise(() => {});
    return {};
  });
  restore = setNativeCall(call);
  const socket = connect("localhost:1234");
  const opening = expect(socket.opened).rejects.toThrow("closed");
  await Promise.resolve();
  await socket.close();
  finish({});
  await opening;
  expect(call.mock.calls.map((args) => args[1])).toEqual([
    "socketOpen",
    "socketClose",
    "socketClose",
  ]);
});
it("bounds writes and keeps the read half alive after end", async () => {
  const call = vi.fn<NativeCall>(async (_, method) =>
    method === "socketRead"
      ? { eof: true }
      : method === "socketWatch"
        ? new Promise(() => {})
        : {},
  );
  restore = setNativeCall(call);
  const socket = connect("localhost:1234");
  await socket.opened;
  const writer = socket.writable.getWriter();
  await writer.write(new Uint8Array(65537));
  await writer.close();
  expect(
    call.mock.calls
      .filter((args) => args[1] === "socketWrite")
      .map((args) => atob(String(args[2].chunk)).length),
  ).toEqual([65536, 1]);
  expect(call.mock.calls.some((args) => args[1] === "socketClose")).toBe(false);
  const reader = socket.readable.getReader();
  expect((await reader.read()).done).toBe(true);
  await socket.closed;
  expect(call.mock.calls.at(-1)?.[1]).toBe("socketClose");
});

it("normalizes bracketed and unbracketed IPv6 authorities", async () => {
  const call = vi.fn<NativeCall>(async (_, method) =>
    method === "socketWatch" ? new Promise(() => {}) : {},
  );
  restore = setNativeCall(call);
  for (const address of ["[::1]:1234", "::1:1234"]) {
    const socket = connect(address);
    await socket.opened;
    await socket.close();
  }
  expect(
    call.mock.calls
      .filter((args) => args[1] === "socketOpen")
      .map((args) => args[2].host),
  ).toEqual(["::1", "::1"]);
});

it("keeps reads bounded and copies into caller buffers without requiring BYOB", async () => {
  const { socketReader } = await import("./reader.js");
  const reader = socketReader(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
        controller.close();
      },
    }),
  );
  const storage = new Uint8Array(4);
  let view = storage.subarray(1, 3);
  for (const expected of [[1, 2], [3, 4], [5]]) {
    const result = await reader.read(view);
    expect(view.byteLength).toBe(0);
    expect(result.value).toEqual(new Uint8Array(expected));
    expect(new Uint8Array(result.value!.buffer)[0]).toBe(0);
    expect(new Uint8Array(result.value!.buffer)[3]).toBe(0);
    view = new Uint8Array(result.value!.buffer, 1, 2);
  }
  expect((await reader.read(view)).done).toBe(true);
});

it("does not announce native EOF until the reader consumes buffered bytes", async () => {
  const { socketReader } = await import("./reader.js");
  let ended!: (value: unknown) => void;
  const call = vi.fn<NativeCall>(async (_, method) => {
    if (method === "socketWatch")
      return new Promise((resolve) => {
        ended = resolve;
      });
    if (method === "socketRead") return { chunk: btoa("abcde") };
    return {};
  });
  restore = setNativeCall(call);
  const socket = connect("localhost:1234");
  await socket.opened;
  const reader = socketReader(socket.readable);
  let closed = false;
  void socket.closed.then(() => {
    closed = true;
  });
  expect(
    new TextDecoder().decode((await reader.read(new Uint8Array(2))).value),
  ).toBe("ab");
  ended({});
  await Promise.resolve();
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(
    new TextDecoder().decode((await reader.read(new Uint8Array(3))).value),
  ).toBe("cde");
  await socket.closed;
  expect((await reader.read(new Uint8Array(1))).done).toBe(true);
  await socket.writable.getWriter().close();
  expect(
    call.mock.calls.filter((args) => args[1] === "socketRead"),
  ).toHaveLength(1);
});

it("preserves the TLS verification name when connecting to a resolved address", async () => {
  const call = vi.fn<NativeCall>(async (_, method) =>
    method === "socketWatch" ? new Promise(() => {}) : {},
  );
  restore = setNativeCall(call);
  const socket = connect("127.0.0.1:443", {
    secureTransport: "on",
    expectedServerHostname: "example.com",
  });
  await socket.opened;
  expect(
    call.mock.calls.find((args) => args[1] === "socketOpen")?.[2],
  ).toMatchObject({
    host: "127.0.0.1",
    port: 443,
    tls: false,
  });
  expect(
    call.mock.calls.find((args) => args[1] === "socketStartTls")?.[2],
  ).toMatchObject({
    id: call.mock.calls.find((args) => args[1] === "socketOpen")?.[2].id,
    servername: "example.com",
  });
  await socket.close();
});

it("flushes an active plain write before TLS handoff and invalidates the old writer", async () => {
  let finish!: () => void;
  const call = vi.fn<NativeCall>(async (_, method) => {
    if (method === "socketWrite")
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    if (method === "socketRead" || method === "socketWatch")
      return new Promise(() => {});
    return {};
  });
  restore = setNativeCall(call);
  const plain = connect("localhost:1234", { secureTransport: "starttls" });
  await plain.opened;
  const writer = plain.writable.getWriter();
  void writer.closed.catch(() => {});
  const writing = writer.write(new Uint8Array([1]));
  await Promise.resolve();
  await Promise.resolve();
  const tls = plain.startTls({ expectedServerHostname: "localhost" });
  await Promise.resolve();
  expect(call.mock.calls.some(([, m]) => m === "socketStartTls")).toBe(false);
  finish();
  await writing;
  await tls.opened;
  await expect(writer.write(new Uint8Array([2]))).rejects.toThrow("upgraded");
  expect(call.mock.calls.filter(([, m]) => m === "socketOpen")).toHaveLength(1);
  expect(call.mock.calls.filter(([, m]) => m === "socketWrite")).toHaveLength(
    1,
  );
  await plain.close();
  expect(call.mock.calls.some(([, m]) => m === "socketClose")).toBe(false);
  await tls.close();
  expect(call.mock.calls.some(([, m]) => m === "socketClose")).toBe(true);
});

it("holds direct TLS open and application IO until authentication completes", async () => {
  let authenticated!: (value: unknown) => void;
  const call = vi.fn<NativeCall>(async (_, method) => {
    if (method === "socketOpen") return { remoteAddress: "127.0.0.1:443" };
    if (method === "socketStartTls")
      return new Promise((resolve) => {
        authenticated = resolve;
      });
    if (method === "socketRead" || method === "socketWatch")
      return new Promise(() => {});
    return {};
  });
  restore = setNativeCall(call);
  const socket = connect("127.0.0.1:443", {
    secureTransport: "on",
    expectedServerHostname: "verified.test",
  });
  let opened = false;
  void socket.opened.then(() => {
    opened = true;
  });
  const write = socket.writable.getWriter().write(new Uint8Array([1]));
  await vi.waitFor(() => expect(authenticated).toBeTypeOf("function"));
  expect(opened).toBe(false);
  expect(call.mock.calls.some(([, method]) => method === "socketWrite")).toBe(
    false,
  );
  expect(
    call.mock.calls.find(([, method]) => method === "socketOpen")?.[2],
  ).toMatchObject({ tls: false });
  expect(
    call.mock.calls.find(([, method]) => method === "socketStartTls")?.[2],
  ).toMatchObject({ servername: "verified.test" });
  authenticated({});
  await socket.opened;
  await write;
  expect(opened).toBe(true);
  await socket.close();
});
