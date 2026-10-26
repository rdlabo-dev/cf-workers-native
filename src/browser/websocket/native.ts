import { connect, type PlatformSocket } from "../../compat/net/sockets.js";
import { socketReader } from "../../compat/net/reader.js";
import {
  closePayload,
  decodeClose,
  encodeFrame,
  FrameReader,
  MAX_MESSAGE_BYTES,
  type Frame,
} from "./frames.js";

export interface WebSocketObserver {
  open(protocol: string, extensions: string): void;
  message(value: string | Uint8Array): void;
  close(code: number, reason: string, clean: boolean): void;
  error(error: Error): void;
}
export interface WebSocketTransport {
  send(value: string | Uint8Array): void;
  close(code: number, reason: string): void;
  dispose(): void;
}
import { negotiateCompression } from "./compression.js";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Native TCP/TLS keeps ws:// usable without a WebView mixed-content exception. */
export function nativeWebSocket(
  url: URL,
  protocols: readonly string[],
  observer: WebSocketObserver,
  dial: typeof connect = connect,
): WebSocketTransport {
  let socket: PlatformSocket | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let disposed = false,
    failed = false,
    sentClose = false,
    receivedClose = false,
    remoteInitiatedClose = false;
  let compression: ReturnType<typeof negotiateCompression> | undefined;
  let writes = Promise.resolve();
  let fragments: Uint8Array[] = [];
  let fragmentBytes = 0,
    fragmentOpcode = 0;
  let fragmentCompressed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    compression?.dispose();
    void socket?.close().catch(() => {});
  };
  const fail = (cause: unknown) => {
    if (disposed || failed) return;
    failed = true;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    observer.error(error);
    if (!receivedClose)
      observer.close(
        1006,
        "WebSocket disconnected without sending Close frame.",
        false,
      );
    dispose();
  };
  const write = (opcode: number, bytes: Uint8Array) => {
    // Snapshot before queuing, including a caller-owned view.
    const compress = !!compression && (opcode === 1 || opcode === 2);
    const frame = encodeFrame(
      opcode,
      compress ? compression!.encode(bytes) : bytes,
      compress,
    );
    writes = writes.then(async () => {
      if (disposed) return;
      if (!writer) throw new Error("WebSocket connection is not open.");
      await writer.write(frame);
    });
    void writes.catch(fail);
  };
  const transport: WebSocketTransport = {
    send(value) {
      write(
        typeof value === "string" ? 1 : 2,
        typeof value === "string" ? encoder.encode(value) : value,
      );
    },
    close(code, reason) {
      if (sentClose || disposed) return;
      sentClose = true;
      write(8, closePayload(code, reason));
      // A peer-initiated close still has a live read side. Let its actual EOF
      // settle the transport; workerd reports that loss after the close event.
      if (receivedClose && !remoteInitiatedClose)
        void writes.then(dispose, fail);
    },
    dispose,
  };
  const frame = ({ opcode, final, payload, compressed }: Frame) => {
    if (disposed || receivedClose) return;
    if (opcode === 9) {
      write(10, payload);
      return;
    }
    if (opcode === 10) return;
    if (opcode === 8) {
      const close = decodeClose(payload);
      remoteInitiatedClose = !sentClose;
      receivedClose = true;
      observer.close(close.code, close.reason, true);
      if (sentClose && !remoteInitiatedClose) void writes.then(dispose, fail);
      return;
    }
    if (opcode === 0 ? fragmentOpcode === 0 : fragmentOpcode !== 0)
      throw new Error("Invalid WebSocket continuation frame.");
    if (opcode !== 0) {
      fragmentOpcode = opcode;
      fragmentCompressed = !!compressed;
    }
    fragmentBytes += payload.byteLength;
    if (fragmentBytes > MAX_MESSAGE_BYTES)
      throw new Error("WebSocket message is too large.");
    fragments.push(payload);
    if (!final) return;
    const message = new Uint8Array(fragmentBytes);
    let offset = 0;
    for (const part of fragments) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    const text = fragmentOpcode === 1;
    fragments = [];
    fragmentBytes = 0;
    fragmentOpcode = 0;
    const delivered = fragmentCompressed
      ? compression!.decode(message)
      : message;
    observer.message(text ? decoder.decode(delivered) : delivered);
  };
  void (async () => {
    try {
      const secure = url.protocol === "wss:";
      socket = dial(`${url.hostname}:${url.port || (secure ? 443 : 80)}`, {
        secureTransport: secure ? "on" : "off",
        expectedServerHostname: url.hostname.replace(/^\[|\]$/g, ""),
      });
      await socket.opened;
      if (disposed) {
        await socket.close();
        return;
      }
      writer = socket.writable.getWriter();
      const reader = socketReader(socket.readable);
      const key = base64(crypto.getRandomValues(new Uint8Array(16)));
      const expected = base64(
        new Uint8Array(
          await crypto.subtle.digest("SHA-1", encoder.encode(key + guid)),
        ),
      );
      await writer.write(
        encoder.encode(
          [
            `GET ${url.pathname || "/"}${url.search} HTTP/1.1`,
            `Host: ${url.host}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Extensions: permessage-deflate",
            `Sec-WebSocket-Key: ${key}`,
            ...(protocols.length
              ? [`Sec-WebSocket-Protocol: ${protocols.join(", ")}`]
              : []),
            "",
            "",
          ].join("\r\n"),
        ),
      );
      let pending = new Uint8Array(0);
      let ready = false;
      let parser = new FrameReader();
      while (!disposed) {
        const next = await reader.read(new Uint8Array(65536));
        if (next.done) {
          if (!receivedClose)
            throw new Error(
              "WebSocket disconnected without sending Close frame.",
            );
          if (remoteInitiatedClose)
            observer.error(new Error("Network connection lost."));
          dispose();
          return;
        }
        let bytes: Uint8Array = next.value;
        if (!ready) {
          const combined = new Uint8Array(pending.length + bytes.length);
          combined.set(pending);
          combined.set(bytes, pending.length);
          pending = combined;
          let end = -1;
          for (let i = 3; i < pending.length; i++) {
            if (
              pending[i - 3] === 13 &&
              pending[i - 2] === 10 &&
              pending[i - 1] === 13 &&
              pending[i] === 10
            ) {
              end = i + 1;
              break;
            }
          }
          if (end === -1) {
            if (pending.length > 128 * 1024)
              throw new Error("WebSocket response headers are too large.");
            continue;
          }
          if (end > 128 * 1024)
            throw new Error("WebSocket response headers are too large.");
          const lines = new TextDecoder()
            .decode(pending.subarray(0, end))
            .split("\r\n");
          const status = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines.shift()!);
          if (!status || status[1] !== "101")
            throw new TypeError(
              `Failed to establish the WebSocket connection: expected server to reply with HTTP status code 101 (switching protocols), but received ${status?.[1] ?? 0} instead.`,
            );
          const headers = new Map<string, string[]>();
          for (const line of lines) {
            if (!line) continue;
            const colon = line.indexOf(":");
            if (colon < 1)
              throw new Error("Invalid WebSocket response header.");
            const name = line.slice(0, colon).toLowerCase();
            const values = headers.get(name) ?? [];
            values.push(line.slice(colon + 1).trim());
            headers.set(name, values);
          }
          const tokens = (name: string) =>
            (headers.get(name) ?? []).flatMap((value) =>
              value
                .toLowerCase()
                .split(",")
                .map((token) => token.trim()),
            );
          if (
            !tokens("upgrade").includes("websocket") ||
            !tokens("connection").includes("upgrade") ||
            headers.get("sec-websocket-accept")?.length !== 1 ||
            headers.get("sec-websocket-accept")![0] !== expected
          )
            throw new Error("Invalid WebSocket upgrade response.");
          const selected = headers.get("sec-websocket-protocol") ?? [];
          if (
            selected.length > 1 ||
            (selected.length && !protocols.includes(selected[0]!))
          )
            throw new Error("Invalid WebSocket response protocol.");
          const extensions = headers.get("sec-websocket-extensions") ?? [];
          if (extensions.length > 1)
            throw new Error("Unexpected WebSocket extension.");
          if (extensions.length)
            compression = negotiateCompression(extensions[0]!);
          parser = new FrameReader(!!compression);
          ready = true;
          observer.open(selected[0] ?? "", extensions[0] ?? "");
          bytes = pending.subarray(end);
          pending = new Uint8Array(0);
        }
        parser.push(bytes, frame);
      }
    } catch (error) {
      fail(error);
    }
  })();
  return transport;
}
