import { nativeTlsSession } from "../tls/native-session.js";
import { observeConsumption } from "./reader.js";
import {
  getNativeCall,
  type NativeCall,
} from "../../browser/fetch/native-network.js";

export interface SocketInfo {
  localAddress?: string | null;
  remoteAddress?: string | null;
}
export interface PlatformSocket {
  upgraded?: boolean;
  secureTransport: "on" | "off" | "starttls";
  startTls(options?: { expectedServerHostname?: string }): PlatformSocket;
  opened: Promise<SocketInfo>;
  closed: Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}
function bytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
function encoded(value: Uint8Array) {
  let result = "";
  for (let offset = 0; offset < value.length; offset += 8192)
    result += String.fromCharCode(...value.subarray(offset, offset + 8192));
  return btoa(result);
}
export function connect(
  address: string,
  options: {
    expectedServerHostname?: string;
    allowHalfOpen?: boolean;
    secureTransport?: "on" | "off" | "starttls";
  } = {},
): PlatformSocket {
  const call = getNativeCall();
  if (!call)
    throw new Error("TCP sockets require the Capacitor native transport");
  const separator = address.lastIndexOf(":");
  const hostname = address.slice(0, separator).replace(/^\[|\]$/g, "");
  const portText = address.slice(separator + 1);
  if (separator < 1 || !/^\d+$/.test(portText))
    throw new TypeError("Invalid TCP address");
  const url = new URL(
    `tcp://${hostname.includes(":") ? `[${hostname}]` : hostname}:${portText}`,
  );
  const port = Number(url.port);
  if (
    !url.hostname ||
    !port ||
    url.username ||
    url.password ||
    (url.pathname && url.pathname !== "/")
  )
    throw new TypeError("Invalid TCP address");
  const id = crypto.randomUUID();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const directTls = options.secureTransport === "on";
  let secureCall = call;
  return transport(
    (...args) => {
      const operation = secureCall(...args);
      return directTls
        ? operation.catch((error) => {
            if (
              error instanceof Error &&
              error.message.includes(
                "TLS connection closed without close_notify",
              )
            )
              throw new Error("Network connection lost.");
            throw error;
          })
        : operation;
    },
    id,
    host,
    options.secureTransport ?? "off",
    async () => {
      try {
        const info = await call("WorkersCapacitor", "socketOpen", {
          id,
          host,
          port,
          tls: false,
        });
        if (options.secureTransport === "on") {
          const servername = options.expectedServerHostname ?? host;
          const result = (await call("WorkersCapacitor", "socketStartTls", {
            id,
            servername,
          })) as { tlsEngine?: string } | undefined;
          // Direct TLS and STARTTLS share the authenticated record engine. On iOS
          // this also preserves TLS close_notify information that NW TLS hides.
          if (result?.tlsEngine === "openssl-wasm")
            secureCall = await nativeTlsSession(call, id, servername);
        }
        return info;
      } catch (error) {
        if (directTls)
          throw new Error(
            "proxy request failed, cannot connect to the specified address",
          );
        throw error;
      }
    },
  );
}
function transport(
  call: NativeCall,
  id: string,
  host: string,
  secureTransport: "on" | "off" | "starttls",
  open: () => Promise<unknown>,
  connectionInfo?: Promise<SocketInfo>,
): PlatformSocket {
  let upgraded = false;
  let activeWrite: Promise<void> | undefined;
  let readableController!: ReadableStreamDefaultController<Uint8Array>;
  let writableController!: WritableStreamDefaultController;
  let readEnded = false,
    writeEnded = false,
    stopped = false;
  let resolveClosed!: () => void, rejectClosed!: (error: unknown) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  void closed.catch(() => {});
  let terminal = false,
    readPending = false,
    pendingBytes = 0;
  const notifyTerminal = () => {
    if (upgraded || !terminal || stopped || readPending || pendingBytes !== 0)
      return;
    if (!readEnded) {
      readEnded = true;
      readableController.close();
    }
    resolveClosed();
  };
  let closing: Promise<void> | undefined;
  let openingStarted = false;
  const close = () => {
    if (upgraded) return Promise.resolve();
    if (!closing) {
      stopped = true;
      // workerd Socket::close waits for the direct TLS connection result. A
      // STARTTLS socket exposes TCP establishment separately, so its close can
      // interrupt authentication. Do not synthesize this ordering with timers.
      const pendingConnection =
        secureTransport === "on" && !connectionInfo && openingStarted
          ? opened.catch(() => {})
          : Promise.resolve();
      closing = pendingConnection
        .then(() => call("WorkersCapacitor", "socketClose", { id }))
        .then(
          () => {
            if (!readEnded) {
              readEnded = true;
              readableController.error(new Error("Socket closed"));
            }
            if (!writeEnded) {
              writeEnded = true;
              writableController.error(new Error("Socket closed"));
            }
            resolveClosed();
          },
          (error) => {
            rejectClosed(error);
            throw error;
          },
        );
    }
    return closing;
  };
  const fail = (error: unknown) => {
    if (!stopped && !upgraded) {
      readableController.error(error);
      writableController.error(error);
      rejectClosed(error);
      void close().catch(() => {});
    }
  };
  const finish = async () => {
    if (readEnded && writeEnded) await close();
  };
  const opened = Promise.resolve()
    .then(() => {
      if (stopped) throw new Error("Socket closed before connection");
      openingStarted = true;
      return open();
    })
    .then(async (value) => {
      if (stopped) {
        await call("WorkersCapacitor", "socketClose", { id });
        throw new Error("Socket closed before connection");
      }
      return value as SocketInfo;
    });
  void opened
    .then(async () => {
      if (stopped || upgraded) return;
      await call("WorkersCapacitor", "socketWatch", { id });
      terminal = true;
      notifyTerminal();
    })
    .catch(fail);
  const readable = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        readableController =
          controller as ReadableStreamDefaultController<Uint8Array>;
      },
      async pull(genericController) {
        const controller =
          genericController as ReadableStreamDefaultController<Uint8Array>;
        try {
          await opened;
          if (upgraded) return;
          readPending = true;
          const result = (await call("WorkersCapacitor", "socketRead", {
            id,
            maxBytes: 65536,
          })) as { chunk?: string; eof?: boolean };
          if (stopped || upgraded) return;
          if (result.eof) {
            if (!readEnded) {
              readEnded = true;
              controller.close();
            }
            await finish();
          } else if (typeof result.chunk === "string") {
            const chunk = bytes(result.chunk);
            pendingBytes += chunk.byteLength;
            controller.enqueue(chunk);
          } else throw new Error("Invalid native socket read result");
        } catch (error) {
          fail(error);
        } finally {
          readPending = false;
          notifyTerminal();
        }
      },
      cancel() {
        readEnded = true;
        return close();
      },
    },
    { highWaterMark: 0 },
  );
  const writable = new WritableStream<Uint8Array>({
    start(controller) {
      writableController = controller;
    },
    async write(chunk) {
      if (upgraded) throw new Error("Socket has been upgraded");
      const writing = (async () => {
        await opened;
        for (let offset = 0; offset < chunk.byteLength; offset += 65536)
          await call("WorkersCapacitor", "socketWrite", {
            id,
            chunk: encoded(chunk.subarray(offset, offset + 65536)),
          });
      })();
      activeWrite = writing;
      try {
        await writing;
      } catch (error) {
        fail(error);
        throw error;
      } finally {
        if (activeWrite === writing) activeWrite = undefined;
      }
    },
    async close() {
      if (upgraded) throw new Error("Socket has been upgraded");
      try {
        await opened;
        await call("WorkersCapacitor", "socketEnd", { id });
        writeEnded = true;
        await finish();
      } catch (error) {
        fail(error);
        throw error;
      }
    },
    abort() {
      writeEnded = true;
      return close();
    },
  });
  observeConsumption(readable, (count) => {
    pendingBytes -= count;
    notifyTerminal();
  });
  const socket: PlatformSocket = {
    // Workers STARTTLS inherits the established TCP connection's opened
    // notification. Reads, writes and the terminal watcher still await the
    // private authenticated `opened` promise above.
    opened: connectionInfo ?? opened,
    closed,
    readable,
    writable,
    close,
    secureTransport,
    startTls(options = {}) {
      if (
        upgraded ||
        stopped ||
        secureTransport !== "starttls" ||
        readEnded ||
        writeEnded
      )
        throw new Error("Socket cannot be upgraded");
      upgraded = true;
      socket.upgraded = true;
      const error = new Error("Socket has been upgraded");
      readableController.error(error);
      writableController.error(error);
      resolveClosed();
      let secureCall = call;
      let tlsFailed = false;
      const failedOperation = (method: string) => {
        if (method === "socketRead") return { eof: true };
        if (method === "socketWatch" || method === "socketEnd") return {};
        throw new Error("Network connection lost.");
      };
      return transport(
        async (...args) => {
          const method = args[1];
          const io = [
            "socketRead",
            "socketWatch",
            "socketWrite",
            "socketEnd",
          ].includes(method);
          if (tlsFailed && io) return failedOperation(method);
          try {
            return await secureCall(...args);
          } catch (error) {
            if (!io) throw error;
            // Workers STARTTLS exposes transport/TLS failure as readable EOF,
            // while writes fail. Never forward application bytes after a
            // failed handshake; close still reaches the native resource.
            tlsFailed = true;
            return failedOperation(method);
          }
        },
        id,
        host,
        "on",
        async () => {
          const info = await opened;
          await activeWrite;
          const hostname = options.expectedServerHostname ?? host;
          try {
            const result = (await call("WorkersCapacitor", "socketStartTls", {
              id,
              servername: hostname,
            })) as { tlsEngine?: string } | undefined;
            if (result?.tlsEngine === "openssl-wasm")
              secureCall = await nativeTlsSession(call, id, hostname);
          } catch {
            tlsFailed = true;
          }
          return info;
        },
        opened,
      );
    },
  };
  return socket;
}
export default { connect };
