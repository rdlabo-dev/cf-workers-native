import { int32 } from "./conversion.js";
import { getNativeCall } from "../fetch/native-network.js";
import { platform } from "../../shared/globals/platform.js";
import {
  isAnyBuffer,
  bufferBytes,
  viewBytes,
} from "../../shared/buffer-source.js";
import { Blob } from "../../compat/buffer/blob.js";
import { dictionary, webString } from "../body/index.js";
import { structuredClone, cloneAttachment } from "../structured-clone/index.js";
import { markWebSocket, markWebSocketPair } from "./brand.js";
import { CloseEvent } from "./close-event.js";
import { attachmentSize } from "./attachment-size.js";
import {
  nativeWebSocket,
  type WebSocketTransport,
  type WebSocketObserver,
} from "./native.js";

const pairToken = Symbol("WebSocketPair endpoint");
const acceptMessage =
  "You must call one of accept() or state.acceptWebSocket() on this WebSocket before sending messages.";
type Delivery =
  | { message: string | Uint8Array }
  | { code: number; reason: string; clean: boolean };
type State = {
  url: string | null;
  protocol: string | null;
  extensions: string | null;
  connecting: boolean;
  accepted: boolean;
  failed: boolean;
  sentClose: boolean;
  receivedClose: boolean;
  allowHalfOpen: boolean;
  binaryType: "blob" | "arraybuffer";
  peer?: WebSocket;
  transport?: WebSocketTransport;
  queue: Delivery[];
  scheduled: boolean;
  attachment?: { value: unknown; shared: boolean };
};
const states = new WeakMap<WebSocket, State>();
function state(socket: WebSocket): State {
  const result = states.get(socket);
  if (!result) throw new TypeError("Illegal invocation");
  return result;
}
function syntax(message: string): never {
  throw new DOMException(`WebSocket Constructor: ${message}`, "SyntaxError");
}
function validate(input: unknown, protocols: unknown) {
  const original = webString(input);
  let url: URL;
  try {
    url = new URL(original);
  } catch {
    return syntax("The url is invalid.");
  }
  if (!url.hostname) syntax("The url is invalid.");
  if (!["ws:", "wss:"].includes(url.protocol))
    syntax("The url scheme must be ws or wss.");
  if (original.includes("#")) syntax("The url fragment must be empty.");
  const list: string[] = [];
  if (Array.isArray(protocols)) {
    // JSG converts arrays by indexed access, without consulting the iterator.
    const length = protocols.length;
    for (let index = 0; index < length; index++)
      list.push(webString(protocols[index]));
  } else if (protocols !== undefined) list.push(webString(protocols));
  const seen = new Set<string>();
  for (const token of list) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(token))
      syntax(
        Array.isArray(protocols)
          ? "One of the protocol header tokens is invalid."
          : "The protocol header token is invalid.",
      );
    if (seen.has(token))
      syntax("The protocols header cannot have repeating values.");
    seen.add(token);
  }
  url.username = "";
  url.password = "";
  return { url, original, protocols: list };
}
function errorEvent(error: Error): Event {
  const message = `Uncaught ${String(error)}`;
  if (typeof ErrorEvent === "function")
    return new ErrorEvent("error", { error, message });
  // Node's unit-test host has Event but no ErrorEvent. WebViews take the branch above.
  const event = new Event("error");
  Object.defineProperties(event, {
    error: { value: error, enumerable: true, configurable: true },
    message: { value: message, enumerable: true, configurable: true },
  });
  return event;
}
function enqueue(socket: WebSocket, delivery: Delivery) {
  const s = state(socket);
  s.queue.push(delivery);
  if (!s.accepted || s.scheduled) return;
  s.scheduled = true;
  queueMicrotask(() => {
    s.scheduled = false;
    while (s.queue.length) {
      const item = s.queue.shift()!;
      if ("message" in item) {
        if (s.receivedClose || s.failed) continue;
        const data =
          typeof item.message === "string"
            ? item.message
            : s.binaryType === "blob"
              ? new Blob([item.message as Uint8Array<ArrayBuffer>])
              : item.message.slice().buffer;
        socket.dispatchEvent(new MessageEvent("message", { data }));
      } else {
        if (s.receivedClose) continue;
        s.receivedClose = true;
        if (!s.allowHalfOpen && !s.sentClose && item.clean)
          sendClose(socket, item.code, item.reason);
        const event = new CloseEvent("close", {
          code: item.code,
          reason: item.reason,
          wasClean: item.clean,
        });
        socket.dispatchEvent(event);
      }
    }
  });
}
function sendClose(socket: WebSocket, code: number, reason: string) {
  const s = state(socket);
  s.sentClose = true;
  if (s.peer) enqueue(s.peer, { code, reason, clean: true });
  else s.transport?.close(code, reason);
}
function hostTransport(
  url: URL,
  protocols: readonly string[],
  observer: WebSocketObserver,
): WebSocketTransport {
  const host = new platform.WebSocket(url.href, [...protocols]);
  host.binaryType = "arraybuffer";
  host.addEventListener("open", () =>
    observer.open(host.protocol, host.extensions),
  );
  host.addEventListener("message", (event) =>
    observer.message(
      typeof event.data === "string" ? event.data : new Uint8Array(event.data),
    ),
  );
  host.addEventListener("error", () =>
    observer.error(new Error("WebSocket connection failed.")),
  );
  host.addEventListener("close", (event) =>
    observer.close(event.code, event.reason, event.wasClean),
  );
  return {
    send(value) {
      host.send(value as string | Uint8Array<ArrayBuffer>);
    },
    close(code, reason) {
      if (code === 1005) host.close();
      else host.close(code, reason);
    },
    dispose() {
      host.close();
    },
  };
}

/** Workers endpoint lifecycle shared by public globals and node:http. */
export class WebSocket extends EventTarget {
  declare readonly CONNECTING: 0;
  declare readonly READY_STATE_CONNECTING: 0;
  declare readonly OPEN: 1;
  declare readonly READY_STATE_OPEN: 1;
  declare readonly CLOSING: 2;
  declare readonly READY_STATE_CLOSING: 2;
  declare readonly CLOSED: 3;
  declare readonly READY_STATE_CLOSED: 3;
  declare static readonly CONNECTING: 0;
  declare static readonly READY_STATE_CONNECTING: 0;
  declare static readonly OPEN: 1;
  declare static readonly READY_STATE_OPEN: 1;
  declare static readonly CLOSING: 2;
  declare static readonly READY_STATE_CLOSING: 2;
  declare static readonly CLOSED: 3;
  declare static readonly READY_STATE_CLOSED: 3;

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    if (!arguments.length)
      throw new TypeError(
        "Failed to construct 'WebSocket': constructor parameter 1 is not of type 'string'.",
      );
    const paired = (url as unknown) === pairToken;
    const validated = paired ? undefined : validate(url, protocols);
    const s: State = {
      url: validated?.original ?? null,
      protocol: "",
      extensions: "",
      connecting: !paired,
      accepted: false,
      failed: false,
      sentClose: false,
      receivedClose: false,
      allowHalfOpen: false,
      binaryType: "blob",
      queue: [],
      scheduled: false,
    };
    states.set(this, s);
    markWebSocket(this);
    if (paired) return;
    const observer: WebSocketObserver = {
      open: (protocol, extensions) => {
        if (s.failed) return;
        s.connecting = false;
        s.accepted = true;
        s.protocol = protocol || null;
        s.extensions = extensions || null;
        this.dispatchEvent(new Event("open"));
      },
      message: (message) => enqueue(this, { message }),
      close: (code, reason, clean) => {
        s.accepted = true;
        enqueue(this, { code, reason, clean });
      },
      error: (error) => {
        if (s.failed) return;
        s.failed = true;
        s.connecting = false;
        const event = errorEvent(error);
        this.dispatchEvent(event);
      },
    };
    s.transport = getNativeCall()
      ? nativeWebSocket(validated!.url, validated!.protocols, observer)
      : hostTransport(validated!.url, validated!.protocols, observer);
  }
  get readyState(): number {
    const s = state(this);
    return s.failed || (s.sentClose && s.receivedClose)
      ? 3
      : s.sentClose || s.receivedClose
        ? 2
        : s.connecting
          ? 0
          : 1;
  }
  get url(): string | null {
    return state(this).url;
  }
  get protocol(): string | null {
    return state(this).protocol;
  }
  get extensions(): string | null {
    return state(this).extensions;
  }
  get binaryType(): "blob" | "arraybuffer" {
    return state(this).binaryType;
  }
  set binaryType(value: string) {
    const s = state(this);
    value = webString(value);
    if (value === "blob" || value === "arraybuffer") s.binaryType = value;
  }
  accept(options?: { allowHalfOpen?: boolean }): void {
    const s = state(this);
    const allowHalfOpen = dictionary(options ?? {}).allowHalfOpen;
    if (!s.peer)
      throw new TypeError(
        "Websockets obtained from the 'new WebSocket()' constructor cannot call accept",
      );
    if (s.accepted) return;
    if (allowHalfOpen !== undefined) s.allowHalfOpen = Boolean(allowHalfOpen);
    s.accepted = true;
    if (s.queue.length) {
      const queued = s.queue.splice(0);
      for (const item of queued) enqueue(this, item);
    }
  }
  send(value: unknown): void {
    const s = state(this);
    if (!arguments.length)
      throw new TypeError(
        "Failed to execute 'send' on 'WebSocket': parameter 1 is not of type 'ArrayBuffer or ArrayBufferView or string'.",
      );
    const message = isAnyBuffer(value)
      ? bufferBytes(value).slice()
      : ArrayBuffer.isView(value)
        ? viewBytes(value).slice()
        : webString(value);
    if (s.sentClose)
      throw new TypeError("Can't call WebSocket send() after close().");
    if (s.failed) return;
    if (!s.accepted) throw new TypeError(acceptMessage);
    if (s.peer) enqueue(s.peer, { message });
    else s.transport!.send(message);
  }
  serializeAttachment(value: unknown): void {
    const s = state(this);
    if (!arguments.length)
      throw new TypeError(
        "Failed to execute 'serializeAttachment' on 'WebSocket': parameter 1 is not of type 'Value'.",
      );
    const snapshot = cloneAttachment(value);
    const externals = { shared: false };
    const bytes = attachmentSize(snapshot, externals);
    if (bytes > 16384)
      throw new Error(
        `A WebSocket 'attachment' cannot be larger than 16384 bytes.'attachment' was ${bytes} bytes.`,
      );
    // Commit only after cloning and accounting succeed, keeping the prior value
    // intact on both unsupported input and oversize writes.
    s.attachment = {
      value: externals.shared ? undefined : snapshot,
      shared: externals.shared,
    };
  }
  deserializeAttachment(): unknown {
    const attachment = state(this).attachment;
    if (!attachment) return null;
    if (attachment.shared)
      throw new Error("Unable to deserialize cloned data.");
    return structuredClone(attachment.value);
  }
  close(code?: number, reason?: string): void {
    const s = state(this);
    const number = code === undefined ? undefined : int32(code);
    const text =
      reason === undefined
        ? ""
        : new TextDecoder("utf-8", { ignoreBOM: true }).decode(
            new TextEncoder().encode(webString(reason)),
          );
    if (
      number !== undefined &&
      (number < 1000 ||
        number >= 5000 ||
        [1004, 1005, 1006, 1015].includes(number))
    )
      throw new DOMException(
        `Invalid WebSocket close code: ${number}.`,
        "InvalidAccessError",
      );
    if (new TextEncoder().encode(text).length > 123)
      throw new DOMException(
        "WebSocket close reason must not be longer than 123 bytes when UTF-8 encoded.",
        "SyntaxError",
      );
    if (reason !== undefined && number === undefined)
      throw new DOMException(
        "If you specify a WebSocket close reason, you must also specify a code.",
        "InvalidAccessError",
      );
    if (s.sentClose || s.failed) return;
    if (s.connecting) {
      // Workers releases the pending connection synchronously, then reports
      // cancellation as an asynchronous network error/abnormal close.
      s.connecting = false;
      s.transport?.dispose();
      queueMicrotask(() => {
        if (s.failed) return;
        s.failed = true;
        s.accepted = true;
        const event = errorEvent(new Error("Network connection lost."));
        this.dispatchEvent(event);
        enqueue(this, {
          code: 1006,
          reason: "WebSocket disconnected without sending Close frame.",
          clean: false,
        });
      });
      return;
    }
    if (!s.accepted) throw new TypeError(acceptMessage);
    sendClose(this, number ?? 1005, text);
  }
}
export class WebSocketPair {
  declare readonly 0: WebSocket;
  declare readonly 1: WebSocket;
  constructor() {
    markWebSocketPair(this);
    const a = new WebSocket(pairToken as unknown as string),
      b = new WebSocket(pairToken as unknown as string);
    state(a).peer = b;
    state(b).peer = a;
    Object.defineProperties(this, {
      0: { get: () => a, enumerable: true, configurable: true },
      1: { get: () => b, enumerable: true, configurable: true },
    });
  }
  *[Symbol.iterator](): Iterator<WebSocket> {
    yield this[0];
    yield this[1];
  }
}
for (const [name, value] of Object.entries({
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
})) {
  for (const key of [name, `READY_STATE_${name}`]) {
    const descriptor = {
      value,
      enumerable: true,
      configurable: true,
      writable: false,
    };
    Object.defineProperty(WebSocket, key, descriptor);
    Object.defineProperty(WebSocket.prototype, key, descriptor);
  }
}
for (const key of Object.getOwnPropertyNames(WebSocket.prototype)) {
  if (key !== "constructor")
    Object.defineProperty(WebSocket.prototype, key, { enumerable: true });
}
for (const [Constructor, name] of [
  [WebSocket, "WebSocket"],
  [WebSocketPair, "WebSocketPair"],
] as const) {
  Object.defineProperty(Constructor, "name", { value: name });
  Object.defineProperty(Constructor, "length", { value: 0 });
  Object.defineProperty(Constructor.prototype, Symbol.toStringTag, {
    value: name,
    configurable: true,
  });
}
for (const name of [
  "accept",
  "send",
  "close",
  "serializeAttachment",
  "deserializeAttachment",
] as const)
  Object.defineProperty(WebSocket.prototype[name], "length", { value: 0 });
