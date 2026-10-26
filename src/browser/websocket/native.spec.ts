import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { nativeWebSocket, type WebSocketObserver } from "./native.js";
import type { PlatformSocket } from "../../compat/net/sockets.js";

function fixture(response?: (key: string) => Uint8Array) {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  let resolveOpen!: () => void;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const written: Uint8Array[] = [];
  const close = vi.fn(async () => {
    input.close();
    resolveClosed();
  });
  const socket: PlatformSocket = {
    secureTransport: "off",
    startTls() {
      throw new Error("unexpected upgrade");
    },
    opened: new Promise<void>((resolve) => {
      resolveOpen = resolve;
    }).then(() => ({})),
    closed,
    readable: new ReadableStream({
      start(controller) {
        input = controller;
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        written.push(chunk.slice());
        if (written.length !== 1) return;
        const request = new TextDecoder().decode(chunk);
        const key = request.match(/Sec-WebSocket-Key: (.*)\r\n/)![1]!;
        const bytes =
          response?.(key) ??
          new TextEncoder().encode(
            `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Accept: ${createHash(
              "sha1",
            )
              .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
              .digest("base64")}\r\nSec-WebSocket-Protocol: compat\r\n\r\n`,
          );
        // Header parsing must survive splitting inside CRLF and the accept hash.
        for (let i = 0; i < bytes.length; i += 7)
          input.enqueue(bytes.slice(i, i + 7));
      },
    }),
    close,
  };
  const observer: WebSocketObserver = {
    open: vi.fn(),
    message: vi.fn(),
    close: vi.fn(),
    error: vi.fn(),
  };
  const dial = vi.fn(() => socket);
  const transport = nativeWebSocket(
    new URL("ws://localhost:8080/echo?q=1"),
    ["compat"],
    observer,
    dial,
  );
  return { observer, transport, written, input, dial, close, resolveOpen };
}
it("waits for the native connection, validates upgrade, snapshots writes and handles fragmented data/ping/close", async () => {
  const f = fixture();
  try {
    expect(f.written).toHaveLength(0);
    expect(f.observer.open).not.toHaveBeenCalled();
    f.resolveOpen();
    await vi.waitFor(() =>
      expect(f.observer.open).toHaveBeenCalledWith("compat", ""),
    );
    expect(new TextDecoder().decode(f.written[0])).toContain(
      "GET /echo?q=1 HTTP/1.1\r\nHost: localhost:8080\r\n",
    );
    const bytes = Uint8Array.of(1, 2, 3);
    f.transport.send(bytes);
    bytes.fill(9);
    await vi.waitFor(() => expect(f.written).toHaveLength(2));
    const wire = f.written[1]!;
    expect([...wire.subarray(6)].map((v, i) => v ^ wire[2 + (i % 4)]!)).toEqual(
      [1, 2, 3],
    );
    f.input.enqueue(
      Uint8Array.of(0x01, 2, 0xe3, 0x81, 0x89, 1, 42, 0x80, 1, 0x82),
    );
    await vi.waitFor(() =>
      expect(f.observer.message).toHaveBeenCalledWith("あ"),
    );
    await vi.waitFor(() => expect(f.written).toHaveLength(3));
    expect(f.written[2]![0]).toBe(0x8a);
    f.input.enqueue(Uint8Array.of(0x88, 2, 3, 232));
    await vi.waitFor(() =>
      expect(f.observer.close).toHaveBeenCalledWith(1000, "", true),
    );
    f.transport.close(1000, "");
    await vi.waitFor(() => expect(f.written).toHaveLength(4));
    expect(f.close).not.toHaveBeenCalled();
    expect(f.observer.error).not.toHaveBeenCalled();
    f.input.close();
    await vi.waitFor(() => expect(f.close).toHaveBeenCalledTimes(1));
    expect(f.observer.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Network connection lost." }),
    );
  } finally {
    f.transport.dispose();
  }
});
it.each([
  "HTTP/1.1 200 OK\r\n\r\n",
  "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: forged\r\n\r\n",
])(
  "rejects an invalid handshake without exposing an open connection",
  async (header) => {
    const f = fixture(() => new TextEncoder().encode(header));
    f.resolveOpen();
    await vi.waitFor(() => expect(f.observer.error).toHaveBeenCalledTimes(1));
    expect(f.observer.open).not.toHaveBeenCalled();
    expect(f.observer.close).toHaveBeenCalledWith(
      1006,
      expect.any(String),
      false,
    );
    expect(f.close).toHaveBeenCalledTimes(1);
  },
);
it("closes a cancelled in-flight native connection without sending a handshake", async () => {
  const f = fixture();
  f.transport.dispose();
  f.resolveOpen();
  await vi.waitFor(() => expect(f.close).toHaveBeenCalled());
  expect(f.written).toEqual([]);
  expect(f.observer.open).not.toHaveBeenCalled();
});
it("rejects invalid fragmented UTF-8 and closes the native resource", async () => {
  const f = fixture();
  f.resolveOpen();
  await vi.waitFor(() => expect(f.observer.open).toHaveBeenCalled());
  f.input.enqueue(Uint8Array.of(0x81, 1, 0xff));
  await vi.waitFor(() => expect(f.observer.error).toHaveBeenCalled());
  expect(f.close).toHaveBeenCalledTimes(1);
});
