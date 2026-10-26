import { hasBody } from "../body/index.js";
import {
  Body,
  dictionary,
  webString,
  cloneValue,
  cloneBody,
  setBodyHeaders,
} from "../body/index.js";
import {
  Headers,
  immutableHeaders,
  cloneHeaders,
  type HeadersInit,
} from "../headers/index.js";
import { statusText } from "./status.js";

export interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
  cf?: Record<string, unknown>;
  webSocket?: WebSocket | null;
  encodeBody?: "automatic" | "manual";
}
const encoding = new WeakMap<Response, "automatic" | "manual">();
export function responseEncoding(response: Response) {
  return encoding.get(response);
}
export interface StructuredCloneResponseSnapshot {
  status: number;
  statusText: string;
  serializedStatusText?: string;
  headers: Headers;
  cf: Record<string, unknown> | undefined;
  webSocket: WebSocket | null;
  encodeBody: "automatic" | "manual";
  url: string;
  redirected: boolean;
  type: "default" | "error";
  hasBody: boolean;
}
export let structuredCloneResponseSnapshot: (
  response: Response,
) => StructuredCloneResponseSnapshot;
export let restoreStructuredCloneResponse: (
  snapshot: StructuredCloneResponseSnapshot,
) => Response;
export let networkResponse: (
  body: BodyInit | null,
  init: ResponseInit,
  url: string,
  redirected: boolean,
) => Response;
export class Response extends Body {
  #status: number;
  #statusText: string;
  #serializedStatusText: string | undefined;
  #headers: Headers;
  #cf: Record<string, unknown> | undefined;
  #webSocket: WebSocket | null;
  #url = "";
  #redirected = false;
  static {
    networkResponse = (body, init, url, redirected) => {
      const response = new Response(body, init);
      response.#url = url;
      response.#redirected = redirected;
      immutableHeaders(response.#headers);
      return response;
    };
    structuredCloneResponseSnapshot = (response) => ({
      status: response.#status,
      statusText: response.#statusText,
      serializedStatusText: response.#serializedStatusText,
      headers: response.#headers,
      cf: response.#cf,
      webSocket: response.#webSocket,
      encodeBody: encoding.get(response)!,
      url: response.#url,
      redirected: response.#redirected,
      type: response.type,
      hasBody: hasBody(response),
    });
    restoreStructuredCloneResponse = (snapshot) => {
      if (snapshot.hasBody || snapshot.webSocket)
        throw new DOMException("Response is not cloneable", "DataCloneError");
      const response =
        snapshot.type === "error"
          ? Response.error()
          : new Response(null, {
              status: snapshot.status,
              statusText: snapshot.statusText,
              encodeBody: snapshot.encodeBody,
            });
      response.#headers = snapshot.headers;
      response.#serializedStatusText = snapshot.serializedStatusText;
      setBodyHeaders(response, snapshot.headers);
      response.#cf = snapshot.cf;
      response.#url = snapshot.url;
      response.#redirected = snapshot.redirected;
      encoding.set(response, snapshot.encodeBody);
      return response;
    };
  }
  constructor(body: BodyInit | null = null, init: ResponseInit = {}) {
    init = dictionary(init);
    const status =
      init.status === undefined ? 200 : Math.trunc(Number(init.status));
    const webSocket = init.webSocket ?? null;
    if (webSocket !== null && !isWebSocket(webSocket))
      throw new TypeError("webSocket must be a WebSocket");
    if (webSocket === null ? !(status >= 200 && status <= 599) : status !== 101)
      throw new RangeError(
        webSocket === null
          ? "Responses may only be constructed with status codes in the range 200 to 599, inclusive."
          : "Responses with a WebSocket must have status code 101.",
      );
    const suppliedStatusText = init.statusText;
    const text =
      suppliedStatusText === undefined
        ? statusText(status)
        : webString(suppliedStatusText);
    if (/[\x00-\x1f]/.test(text)) throw new TypeError("Invalid statusText");
    const bodyEncoding =
      init instanceof Response
        ? encoding.get(init)!
        : (init.encodeBody ?? "automatic");
    if (bodyEncoding !== "automatic" && bodyEncoding !== "manual")
      throw new TypeError(`encodeBody: unexpected value: ${bodyEncoding}`);
    const headers = new Headers(init.headers);
    if ([101, 204, 205, 304].includes(status) && body != null) {
      const length =
        typeof body === "string"
          ? body.length
          : body instanceof ArrayBuffer || ArrayBuffer.isView(body)
            ? body.byteLength
            : body instanceof Blob
              ? body.size
              : -1;
      if (length !== 0)
        throw new TypeError(
          "Response with null body status (101, 204, 205, or 304) cannot have a body.",
        );
      body = null;
    }
    super(body, headers);
    this.#status = status;
    this.#statusText = text;
    this.#serializedStatusText =
      suppliedStatusText === undefined ? undefined : text;
    this.#headers = headers;
    this.#cf = cloneValue(init.cf);
    this.#webSocket = webSocket;
    encoding.set(this, bodyEncoding);
  }
  get status() {
    return this.#status;
  }
  get statusText() {
    return this.#statusText;
  }
  get headers() {
    return this.#headers;
  }
  get ok() {
    return this.#status >= 200 && this.#status < 300;
  }
  get redirected() {
    return this.#redirected;
  }
  get url() {
    return this.#url;
  }
  get webSocket() {
    return this.#webSocket;
  }
  get cf() {
    return this.#cf;
  }
  get type() {
    return this.#status === 0 ? "error" : "default";
  }
  clone(): Response {
    if (this.#webSocket)
      throw new TypeError("Cannot clone a response to a WebSocket handshake.");
    const body = cloneBody(this);
    const copy =
      this.#status === 0
        ? Response.error()
        : new Response(body, {
            status: this.status,
            statusText: this.statusText,
            headers: this.headers,
            cf: this.cf,
            encodeBody: encoding.get(this),
          });
    copy.#headers = cloneHeaders(this.#headers);
    copy.#serializedStatusText = this.#serializedStatusText;
    setBodyHeaders(copy, copy.#headers);
    copy.#url = this.#url;
    copy.#redirected = this.#redirected;
    return copy;
  }
  static error() {
    const response = new Response();
    response.#status = 0;
    response.#statusText = "";
    return response;
  }
  static redirect(url: string | URL, status = 302) {
    status = Math.trunc(Number(status));
    if (![301, 302, 303, 307, 308].includes(status))
      throw new RangeError("Invalid redirect status code.");
    const response = new Response(null, {
      status,
      headers: { location: new URL(webString(url)).href },
    });
    immutableHeaders(response.#headers);
    return response;
  }
  static json(value: unknown, init: ResponseInit = {}) {
    init = dictionary(init);
    const body = JSON.stringify(value) ?? "undefined";
    const headers = new Headers(init.headers);
    if (!headers.has("content-type"))
      headers.set("content-type", "application/json");
    return new Response(
      body,
      init instanceof Response
        ? {
            status: init.status,
            statusText: init.statusText,
            cf: init.cf,
            webSocket: init.webSocket,
            encodeBody: responseEncoding(init),
            headers,
          }
        : { ...init, headers },
    );
  }
}
Object.defineProperty(Response, "name", {
  value: "Response",
  configurable: true,
});
Object.defineProperty(Response.prototype, Symbol.toStringTag, {
  value: "Response",
  writable: true,
  configurable: true,
});
for (const key of Object.getOwnPropertyNames(Response.prototype))
  if (key !== "constructor")
    Object.defineProperty(Response.prototype, key, { enumerable: true });
import type { WebSocket } from "../websocket/endpoint.js";
import { isWebSocket } from "../websocket/brand.js";
