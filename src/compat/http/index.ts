import { storeHTTPOptions } from "./server-options.js";
import { WebSocket } from "../../browser/websocket/endpoint.js";
import { CloseEvent } from "../../browser/websocket/close-event.js";
import { asyncDispose } from "../../shared/globals/symbols.js";
// Copyright (c) 2017-2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Copyright Joyent and Node contributors. All rights reserved. MIT license.
// Adapted from workerd v1.20261012.1 node:http compatibility sources.
import { Readable, Writable, getDefaultHighWaterMark } from "node:stream";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import {
  ephemeral,
  hasHandler,
  kSetIncomingBody,
  kSetIncomingFetchResponse,
  kSetIncomingSocket,
  release,
  setHandler,
} from "./registry.js";
import type {
  AgentOptions,
  IncomingHttpHeaders,
  OutgoingHttpHeader,
  OutgoingHttpHeaders,
  RequestOptions,
  ServerOptions,
} from "node:http";

import {
  validateInteger,
  validateString,
  validateBoolean,
  validateNumber,
  validateObject,
  validateOneOf,
} from "../net/validators.js";
import { AbortError, ERR_INVALID_ARG_TYPE } from "../net/errors.js";
import {
  kIncomingMessage,
  kServerResponse,
  kUniqueHeaders,
} from "./symbols.js";
import { parseUniqueHeadersOption } from "./unique-headers.js";

export const METHODS = [
  "ACL",
  "BIND",
  "CHECKOUT",
  "CONNECT",
  "COPY",
  "DELETE",
  "GET",
  "HEAD",
  "LINK",
  "LOCK",
  "M-SEARCH",
  "MERGE",
  "MKACTIVITY",
  "MKCALENDAR",
  "MKCOL",
  "MOVE",
  "NOTIFY",
  "OPTIONS",
  "PATCH",
  "POST",
  "PROPFIND",
  "PROPPATCH",
  "PURGE",
  "PUT",
  "QUERY",
  "REBIND",
  "REPORT",
  "SEARCH",
  "SOURCE",
  "SUBSCRIBE",
  "TRACE",
  "UNBIND",
  "UNLINK",
  "UNLOCK",
  "UNSUBSCRIBE",
];
export const STATUS_CODES: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  509: "Bandwidth Limit Exceeded",
  510: "Not Extended",
  511: "Network Authentication Required",
};
export const maxHeaderSize = 16384;

function coded<T extends Error>(error: T, code: string): T {
  return Object.assign(error, { code });
}
function validateType(value: unknown, type: string, name: string) {
  if (typeof value !== type) throw new ERR_INVALID_ARG_TYPE(name, type, value);
}
function unsupportedOption(name: string): never {
  throw coded(
    new Error(`The ${name} option is not implemented`),
    "ERR_OPTION_NOT_IMPLEMENTED",
  );
}
function notImplemented(name: string): Error {
  return coded(
    new Error(`The ${name} method is not implemented`),
    "ERR_METHOD_NOT_IMPLEMENTED",
  );
}
export function validateHeaderName(
  name: unknown,
  label = "Header name",
): asserts name is string {
  if (typeof name !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
    throw coded(
      new TypeError(`${label} must be a valid HTTP token ["${String(name)}"]`),
      "ERR_INVALID_HTTP_TOKEN",
    );
}
export function validateHeaderValue(name: string, value: unknown): void {
  if (value === undefined)
    throw coded(
      new TypeError(`Invalid value "undefined" for header "${name}"`),
      "ERR_HTTP_INVALID_HEADER_VALUE",
    );
  for (const item of Array.isArray(value) ? value : [value])
    if (/[^\t\x20-\x7e\x80-\xff]/.test(String(item)))
      throw coded(
        new TypeError(`Invalid character in header content ["${name}"]`),
        "ERR_INVALID_CHAR",
      );
}

const kHeaders = Symbol("headers");
type HeaderEntry = [string, number | string | string[]];

export class OutgoingMessage extends Writable {
  [kHeaders]: Record<string, HeaderEntry> | null = null;
  strictContentLength = false;
  private bytesWritten = 0;
  private endingChunk = false;
  #rejectNonStandardBodyWrites = false;
  chunkedEncoding = false;
  sendDate = false;
  shouldKeepAlive = true;
  useChunkedEncodingByDefault = true;
  maxRequestsOnConnectionReached = false;
  outputData: unknown[] = [];
  outputSize = 0;
  writtenHeaderBytes = 0;
  finished = false;
  _closed = false;
  _headerSent = false;
  _header: string | null = null;
  _contentLength: number | null = null;
  _hasBody = true;
  _removedContLen = false;
  _removedConnection = false;
  _removedTE = false;
  _last = false;
  _defaultKeepAlive = true;
  _maxRequestsPerSocket?: number;
  _keepAliveTimeout = 0;
  _onPendingData: (delta: number) => void = () => {};

  constructor(
    _req?: IncomingMessage,
    options: {
      highWaterMark?: number;
      rejectNonStandardBodyWrites?: boolean;
    } = {},
  ) {
    super({ autoDestroy: false, highWaterMark: options.highWaterMark });
    this.#rejectNonStandardBodyWrites =
      options.rejectNonStandardBodyWrites ?? false;
  }
  get headersSent() {
    return this._header !== null || this._headerSent;
  }
  setHeader(name: string, value: number | string | readonly string[]) {
    if (this.headersSent)
      throw coded(
        new Error("Cannot set headers after they are sent to the client"),
        "ERR_HTTP_HEADERS_SENT",
      );
    validateHeaderName(name);
    validateHeaderValue(name, value);
    this[kHeaders] ??= Object.create(null) as Record<string, HeaderEntry>;
    this[kHeaders][name.toLowerCase()] = [
      name,
      value as number | string | string[],
    ];
    return this;
  }
  setHeaders(
    headers: Headers | Map<string, string | number | readonly string[]>,
  ) {
    if (this.headersSent)
      throw coded(
        new Error("Cannot set headers after they are sent"),
        "ERR_HTTP_HEADERS_SENT",
      );
    if (
      !headers ||
      Array.isArray(headers) ||
      typeof headers !== "object" ||
      typeof headers.keys !== "function" ||
      typeof headers.get !== "function"
    )
      throw coded(
        new TypeError("headers must be Headers or Map"),
        "ERR_INVALID_ARG_TYPE",
      );
    const cookies: string[] = [];
    for (const [name, value] of headers) {
      if (name === "set-cookie")
        cookies.push(...((Array.isArray(value) ? value : [value]) as string[]));
      else this.setHeader(name, value);
    }
    if (cookies.length) this.setHeader("set-cookie", cookies);
    return this;
  }
  appendHeader(name: string, value: OutgoingHttpHeader | readonly string[]) {
    validateHeaderName(name);
    validateHeaderValue(name, value);
    const old = this.getHeader(name);
    if (old === undefined)
      return this.setHeader(name, value as string | string[]);
    return this.setHeader(name, [
      ...(Array.isArray(old) ? old : [String(old)]),
      ...(Array.isArray(value) ? value : [String(value)]),
    ]);
  }
  getHeader(name: string) {
    validateString(name, "name");
    return this[kHeaders]?.[name.toLowerCase()]?.[1];
  }
  getHeaders(): OutgoingHttpHeaders {
    const result = Object.create(null) as OutgoingHttpHeaders;
    for (const [key, entry] of Object.entries(this[kHeaders] ?? {}))
      result[key] = entry[1];
    return result;
  }
  getHeaderNames() {
    return Object.keys(this[kHeaders] ?? {});
  }
  getRawHeaderNames() {
    return Object.values(this[kHeaders] ?? {}).map(([name]) => name);
  }
  hasHeader(name: unknown) {
    validateString(name, "name");
    return this[kHeaders]?.[name.toLowerCase()] !== undefined;
  }
  removeHeader(name: string) {
    validateString(name, "name");
    if (this.headersSent)
      throw coded(
        new Error("Cannot remove headers after they are sent to the client"),
        "ERR_HTTP_HEADERS_SENT",
      );
    if (this[kHeaders]) delete this[kHeaders][name.toLowerCase()];
  }
  override cork() {
    super.cork();
  }
  override uncork() {
    super.uncork();
  }
  #checkContentLength(chunk: unknown, encoding: unknown, final: boolean) {
    if (!this.strictContentLength || this.finished || this.destroyed) return;
    const length =
      typeof chunk === "string"
        ? Buffer.byteLength(
            chunk,
            typeof encoding === "string"
              ? (encoding as BufferEncoding)
              : undefined,
          )
        : chunk instanceof Uint8Array
          ? chunk.byteLength
          : 0;
    const total = this.bytesWritten + length;
    const expected =
      this._contentLength ??
      (final && this.hasHeader("content-length")
        ? Number(this.getHeader("content-length"))
        : null);
    if (
      expected != null &&
      this._hasBody &&
      !this._removedContLen &&
      !this.chunkedEncoding &&
      !this.hasHeader("transfer-encoding") &&
      (final ? total !== expected : total > expected)
    )
      throw coded(
        new Error(
          `Response body's content-length of ${total} byte(s) does not match the content-length of ${expected} byte(s) set in header`,
        ),
        "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
      );
    this.bytesWritten = total;
  }
  #checkBodyAllowed() {
    if (
      !this._hasBody &&
      this.#rejectNonStandardBodyWrites &&
      !this.finished &&
      !this.destroyed
    )
      throw coded(
        new Error("Request with GET/HEAD method cannot have body"),
        "ERR_HTTP_BODY_NOT_ALLOWED",
      );
  }
  override write(
    chunk: unknown,
    encoding?: unknown,
    callback?: unknown,
  ): boolean {
    if (chunk === null)
      throw coded(
        new TypeError("May not write null values to stream"),
        "ERR_STREAM_NULL_VALUES",
      );
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array))
      throw coded(
        new TypeError("chunk must be a string, Buffer or Uint8Array"),
        "ERR_INVALID_ARG_TYPE",
      );
    if (!this.endingChunk) this.#checkContentLength(chunk, encoding, false);
    if (!this._header && !this.finished && !this.destroyed)
      this._implicitHeader();
    this.#checkBodyAllowed();
    return super.write(chunk as never, encoding as never, callback as never);
  }
  override destroy(error?: Error): this {
    super.destroy(error);
    return this;
  }
  flushHeaders() {
    if (!this._header) this._implicitHeader();
    this._headerSent = true;
  }
  _finish() {}
  _flush() {}
  _flushOutput() {
    return undefined;
  }
  _storeHeader(firstLine: string, headers?: OutgoingHttpHeaders | null) {
    if (headers)
      for (const [name, value] of Object.entries(headers))
        if (value !== undefined) this.setHeader(name, value);
    this._header = firstLine;
  }
  _send(
    data: string | Uint8Array,
    encoding?: BufferEncoding | null,
    callback?: (error?: Error) => void,
  ) {
    return this._writeRaw(data, encoding, callback);
  }
  _writeRaw(
    data: string | Uint8Array,
    encoding?: BufferEncoding | null,
    callback?: (error?: Error) => void,
  ) {
    return this.write(data, encoding ?? undefined, callback);
  }
  _implicitHeader(): void {
    throw notImplemented("_implicitHeader()");
  }
  _renderHeaders() {
    if (this.headersSent)
      throw coded(
        new Error("Cannot render headers after they are sent"),
        "ERR_HTTP_HEADERS_SENT",
      );
    return Object.fromEntries(
      Object.values(this[kHeaders] ?? {}).map(([name, value]) => [name, value]),
    );
  }
  override pipe<T extends NodeJS.WritableStream>(destination: T): T {
    this.emit(
      "error",
      coded(new Error("Cannot pipe, not readable"), "ERR_STREAM_CANNOT_PIPE"),
    );
    return destination;
  }
  override end(chunk?: unknown, encoding?: unknown, callback?: unknown): this {
    if (
      !this._header &&
      this.strictContentLength &&
      !this.finished &&
      !this.destroyed
    )
      this._implicitHeader();
    if (
      chunk &&
      typeof chunk !== "function" &&
      !this.finished &&
      !this.destroyed
    ) {
      if (typeof chunk !== "string" && !(chunk instanceof Uint8Array))
        throw new ERR_INVALID_ARG_TYPE(
          "chunk",
          ["string", "Buffer", "Uint8Array"],
          chunk,
        );
      if (!this._header) this._implicitHeader();
      this.#checkBodyAllowed();
    }
    this.#checkContentLength(chunk, encoding, true);
    this.endingChunk = true;
    try {
      super.end(
        (chunk || undefined) as never,
        encoding as never,
        callback as never,
      );
    } finally {
      this.endingChunk = false;
    }
    this.finished = true;
    return this;
  }
}
type WritableStateView = OutgoingMessage & {
  _writableState: {
    corked: number;
    highWaterMark: number;
    length: number;
    needDrain: boolean;
  };
};
Object.defineProperties(OutgoingMessage.prototype, {
  closed: {
    configurable: true,
    get(this: OutgoingMessage) {
      return this._closed;
    },
  },
  errored: {
    configurable: true,
    get() {
      return null;
    },
  },
  writableCorked: {
    configurable: true,
    get(this: OutgoingMessage) {
      return (this as WritableStateView)._writableState.corked;
    },
  },
  writableEnded: {
    configurable: true,
    get(this: OutgoingMessage) {
      return this.finished;
    },
  },
  writableHighWaterMark: {
    configurable: true,
    get(this: OutgoingMessage) {
      return (this as WritableStateView)._writableState.highWaterMark;
    },
  },
  writableLength: {
    configurable: true,
    get(this: OutgoingMessage) {
      return (this as WritableStateView)._writableState.length;
    },
  },
  writableNeedDrain: {
    configurable: true,
    get(this: OutgoingMessage) {
      return (this as WritableStateView)._writableState.needDrain;
    },
  },
  writableObjectMode: {
    configurable: true,
    get() {
      return false;
    },
  },
});

export class IncomingMessage extends Readable {
  url = "";
  method: string | null = null;
  statusCode: number | null = null;
  statusMessage: string | null = null;
  httpVersion = "1.1";
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  complete = false;
  rawHeaders: string[] = [];
  joinDuplicateHeaders = false;
  cloudflare: { env?: unknown; ctx?: unknown; cf?: Record<string, unknown> } =
    {};
  aborted = false;
  _dumped = false;
  _consuming = false;
  _paused = false;
  private headerValues: IncomingHttpHeaders | null = null;
  private distinctValues: Record<string, string[]> | null = null;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private bodyStream: ReadableStream<Uint8Array> | null = null;
  private reading = false;
  private idleTimer?: { setTimeout(msecs: number): void; touch(): void };
  private socketValue: EventEmitter & {
    encrypted: boolean;
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remoteFamily: string;
    remotePort: number;
    readable: boolean;
    writable: boolean;
  } = Object.assign(new EventEmitter(), {
    encrypted: false,
    localAddress: "127.0.0.1",
    localPort: 0,
    remoteAddress: "127.0.0.1",
    remoteFamily: "IPv4",
    remotePort: 0,
    readable: true,
    writable: true,
  });

  [kSetIncomingBody](body: ReadableStream<Uint8Array> | null) {
    this.bodyStream = body;
  }
  [kSetIncomingFetchResponse](
    response: Response,
    idleTimer?: { setTimeout(msecs: number): void; touch(): void },
  ) {
    this.idleTimer = idleTimer;
    this.url = response.url;
    this.statusCode = response.status;
    this.statusMessage = response.statusText;
    // workerd's fetch-backed IncomingMessage exposes joined get() values,
    // including Set-Cookie, rather than the iterator's repeated entries.
    this.headerValues = {};
    this.distinctValues = {};
    for (const key of response.headers.keys()) {
      const value = response.headers.get(key)!;
      this.headerValues[key] = value;
      this.distinctValues[key] = [value];
    }
    this[kSetIncomingBody](response.body);
  }
  _addHeaderLine(field: string, value: string, dest: IncomingHttpHeaders) {
    const key = field.toLowerCase();
    if (key === "set-cookie")
      (dest[key] as string[] | undefined)?.push(value) ?? (dest[key] = [value]);
    else if (key === "cookie" && typeof dest[key] === "string")
      dest[key] += `; ${value}`;
    else if (dest[key] === undefined) dest[key] = value;
    else if (
      this.joinDuplicateHeaders ||
      ![
        "age",
        "authorization",
        "content-length",
        "content-type",
        "etag",
        "expires",
        "from",
        "host",
        "if-modified-since",
        "if-unmodified-since",
        "last-modified",
        "location",
        "max-forwards",
        "proxy-authorization",
        "referer",
        "retry-after",
        "server",
        "user-agent",
      ].includes(key)
    )
      dest[key] += `, ${value}`;
  }
  _addHeaderLineDistinct(
    field: string,
    value: string,
    dest: Record<string, string[]>,
  ) {
    (dest[field.toLowerCase()] ??= []).push(value);
  }
  _addHeaderLines(headers: string[] | null, n: number) {
    this.rawHeaders = headers?.slice(0, n) ?? [];
    this.headerValues = null;
    this.distinctValues = null;
  }
  get headers() {
    if (!this.headerValues) {
      this.headerValues = {};
      for (let i = 0; i < this.rawHeaders.length; i += 2)
        this._addHeaderLine(
          this.rawHeaders[i]!,
          this.rawHeaders[i + 1]!,
          this.headerValues,
        );
    }
    return this.headerValues;
  }
  set headers(value: IncomingHttpHeaders) {
    this.headerValues = value;
  }
  get headersDistinct() {
    if (!this.distinctValues) {
      this.distinctValues = {};
      for (let i = 0; i < this.rawHeaders.length; i += 2)
        (this.distinctValues[this.rawHeaders[i]!.toLowerCase()] ??= []).push(
          this.rawHeaders[i + 1]!,
        );
    }
    return this.distinctValues;
  }
  set headersDistinct(value: Record<string, string[]>) {
    this.distinctValues = value;
  }
  get trailers(): Record<string, string | undefined> {
    return {};
  }
  set trailers(_value: Record<string, string | undefined>) {}
  get trailersDistinct(): Record<string, string[]> {
    return {};
  }
  set trailersDistinct(_value: Record<string, string[]>) {}
  get socket() {
    return this.socketValue;
  }
  get connection() {
    return this.socket;
  }
  set connection(value: unknown) {
    this.socketValue = value as typeof this.socketValue;
  }
  [kSetIncomingSocket](values: Partial<typeof this.socketValue>) {
    Object.assign(this.socketValue, values);
  }
  _dump() {
    if (!this._dumped) {
      this._dumped = true;
      this.removeAllListeners("data");
      this.resume();
    }
  }
  setTimeout(msecs: number, callback?: () => void) {
    if (!Number.isFinite(msecs) || msecs < 0)
      throw coded(
        new RangeError('The value of "msecs" is out of range.'),
        "ERR_OUT_OF_RANGE",
      );
    if (callback) this.on("timeout", callback);
    this.idleTimer?.setTimeout(msecs);
    return this;
  }
  override _read() {
    if (this.reading) return;
    if (!this.bodyStream) {
      this.complete = true;
      this.push(null);
      return;
    }
    this.reader ??= this.bodyStream.getReader();
    this.reading = true;
    void this.reader.read().then(
      ({ value, done }) => {
        this.reading = false;
        if (this.destroyed) return;
        if (done) {
          this.complete = true;
          this.reader?.releaseLock();
          this.reader = undefined;
          this.push(null);
        } else {
          this.idleTimer?.touch();
          if (this.push(Buffer.from(value))) this._read();
        }
      },
      (error) => {
        this.reading = false;
        this.destroy(
          this.idleTimer && error instanceof TypeError
            ? new Error(error.message)
            : error,
        );
      },
    );
  }
  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ) {
    if (!this.complete) {
      this.aborted = true;
      this.emit("aborted");
    }
    const reader = this.reader;
    this.reader = undefined;
    const cancellation = reader
      ? reader.cancel(error ?? undefined).finally(() => reader.releaseLock())
      : !this.complete && this.bodyStream && !this.bodyStream.locked
        ? this.bodyStream.cancel(error ?? undefined)
        : Promise.resolve();
    void cancellation.then(
      () => callback(this.listenerCount("error") ? error : null),
      () => callback(this.listenerCount("error") ? error : null),
    );
  }
}

export class ServerResponse<
  Req extends IncomingMessage = IncomingMessage,
> extends OutgoingMessage {
  statusCode = 200;
  statusMessage = "unknown";
  req: Req;
  socket: Req["socket"];
  readonly body: ReadableStream<Uint8Array>;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private pending?: (error?: Error | null) => void;
  private bodyClosed = false;

  constructor(req: Req, options: ServerOptions = {}) {
    super(req, options);
    this.req = req;
    this.socket = req.socket;
    this.once("finish", () =>
      queueMicrotask(() => {
        if (this._closed) return;
        this.destroyed = true;
        this._closed = true;
        this.emit("close");
      }),
    );
    this.body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      pull: () => {
        const pending = this.pending;
        this.pending = undefined;
        pending?.();
      },
      cancel: (reason) => {
        this.bodyClosed = true;
        this.destroy(reason instanceof Error ? reason : undefined);
      },
    });
  }
  override _implicitHeader() {
    this.writeHead(this.statusCode);
  }
  writeHead(
    status: number,
    reason?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ) {
    if (this.headersSent)
      throw coded(
        new Error("Cannot write headers after they are sent to the client"),
        "ERR_HTTP_HEADERS_SENT",
      );
    const original = status;
    status |= 0;
    if (status < 200 || status > 999)
      throw coded(
        new RangeError(`Invalid status code: ${original}`),
        "ERR_HTTP_INVALID_STATUS_CODE",
      );
    this.statusCode = status;
    if (typeof reason === "string") this.statusMessage = reason;
    else {
      this.statusMessage = STATUS_CODES[status] ?? "unknown";
      headers ??= reason;
    }
    if (/[\r\n]/.test(this.statusMessage))
      throw coded(
        new TypeError("Invalid character in statusMessage"),
        "ERR_INVALID_CHAR",
      );
    if (Array.isArray(headers)) {
      if (headers.length % 2)
        throw coded(
          new TypeError("The argument 'headers' is invalid"),
          "ERR_INVALID_ARG_VALUE",
        );
      for (let i = 0; i < headers.length; i += 2)
        this.appendHeader(String(headers[i]), headers[i + 1]!);
    } else if (headers)
      for (const [name, value] of Object.entries(headers))
        if (value !== undefined) this.setHeader(name, value);
    if (status === 204 || status === 304) this._hasBody = false;
    if (this.hasHeader("content-length"))
      this._contentLength = Number(this.getHeader("content-length"));
    this._header = `HTTP/1.1 ${status} ${this.statusMessage}\r\n`;
    this.flushHeaders();
    return this;
  }
  writeHeader = this.writeHead.bind(this);
  override flushHeaders = () => {
    if (!this._header) this._implicitHeader();
    if (!this._headerSent) {
      this._headerSent = true;
      this.emit("headers");
    }
  };
  assignSocket(_socket: unknown) {
    throw notImplemented("assignSocket");
  }
  detachSocket(_socket: unknown) {
    throw notImplemented("detachSocket");
  }
  writeContinue(_callback?: () => void) {
    throw notImplemented("writeContinue");
  }
  writeProcessing(_callback?: () => void) {
    throw notImplemented("writeProcessing");
  }
  writeEarlyHints(_hints: unknown, _callback?: () => void) {
    throw notImplemented("writeEarlyHints");
  }
  override _write = (
    chunk: Buffer | string | Uint8Array,
    encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ) => {
    this.flushHeaders();
    if (this.destroyed || !this._hasBody) {
      done();
      return;
    }
    const data =
      typeof chunk === "string"
        ? Buffer.from(chunk, encoding)
        : new Uint8Array(chunk);
    this.controller.enqueue(data);
    if ((this.controller.desiredSize ?? 0) > 0) done();
    else this.pending = done;
  };
  override _final = (done: (error?: Error | null) => void) => {
    this.finished = true;
    this.flushHeaders();
    if (!this.bodyClosed) {
      this.bodyClosed = true;
      this.controller.close();
    }
    done();
  };
  override destroy(error?: Error): this {
    super.destroy(error);
    return this;
  }
  override _destroy = (
    error: Error | null,
    callback: (error?: Error | null) => void,
  ) => {
    if (!this.bodyClosed) {
      this.bodyClosed = true;
      this.controller.error(
        error ??
          coded(new Error("Premature close"), "ERR_STREAM_PREMATURE_CLOSE"),
      );
    }
    const pending = this.pending;
    this.pending = undefined;
    pending?.(error);
    callback(error);
  };
}

export type RequestListener = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;
const captureRejection: typeof EventEmitter.captureRejectionSymbol =
  (EventEmitter.captureRejectionSymbol ??
    Symbol.for(
      "nodejs.rejection",
    )) as typeof EventEmitter.captureRejectionSymbol;

export class Server extends EventEmitter {
  httpAllowHalfOpen = false;
  timeout = 0;
  maxHeadersCount: number | null = null;
  maxRequestsPerSocket = 0;
  connectionsCheckingInterval = 30_000;
  requestTimeout = 300_000;
  headersTimeout = 60_000;
  requireHostHeader = false;
  joinDuplicateHeaders = false;
  rejectNonStandardBodyWrites = false;
  keepAliveTimeout = 5_000;
  keepAliveTimeoutBuffer = 1_000;
  highWaterMark = getDefaultHighWaterMark(false);
  private port?: number;
  [kIncomingMessage]: typeof IncomingMessage = IncomingMessage;
  [kServerResponse]: typeof ServerResponse = ServerResponse;
  [kUniqueHeaders]: Set<string> | null = null;

  constructor(
    options?: ServerOptions | RequestListener,
    listener?: RequestListener,
  ) {
    super({ captureRejections: true });
    this.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
      if (event !== "request")
        return EventEmitter.prototype.emit.call(this, event, ...args);
      const listeners = this.rawListeners(event);
      for (const requestListener of listeners) {
        try {
          const result = requestListener.apply(this, args) as unknown;
          if (
            result &&
            typeof (result as PromiseLike<unknown>).then === "function"
          )
            void Promise.resolve(result).catch((error) =>
              (args[1] as ServerResponse).destroy(error),
            );
        } catch (error) {
          (args[1] as ServerResponse).destroy(error as Error);
          throw error;
        }
      }
      return listeners.length !== 0;
    }) as typeof this.emit;
    if (options != null) storeHTTPOptions.call(this, options);
    const values = options as ServerOptions | undefined;
    if (values?.highWaterMark !== undefined) {
      validateNumber(values.highWaterMark, "options.highWaterMark");
      if (values.highWaterMark > 0) this.highWaterMark = values.highWaterMark;
    }
    if (typeof options === "function") {
      listener = options;
      options = {};
    } else if (options == null) {
      options = {};
    } else {
      validateObject(options, "options");
    }
    if (listener) this.on("request", listener);
    this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);
  }
  [captureRejection](
    error: unknown,
    event: string | symbol,
    ...args: unknown[]
  ) {
    if (event === "request") {
      (args[1] as ServerResponse).destroy(error as Error);
      return;
    }
    this.emit("error", error);
  }
  get listening() {
    return this.port !== undefined;
  }
  listen(
    value?: number | string | { port?: number | string } | null | (() => void),
    ...args: unknown[]
  ) {
    if (this.listening)
      throw coded(
        new Error(
          "Listen method has been called more than once without closing.",
        ),
        "ERR_SERVER_ALREADY_LISTEN",
      );
    const requested =
      typeof value === "object" && value !== null ? value.port : value;
    let port =
      requested == null || typeof requested === "function"
        ? 0
        : Number(requested);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw coded(
        new RangeError(
          `options.port should be >= 0 and < 65536. Received ${String(requested)}.`,
        ),
        "ERR_SOCKET_BAD_PORT",
      );
    if (port === 0) {
      port = ephemeral();
      if (port === 0) throw new Error("No available logical HTTP ports");
    }
    if (hasHandler(port))
      throw Object.assign(
        new Error(
          `listen EADDRINUSE: address already in use 127.0.0.1:${port}`,
        ),
        { code: "EADDRINUSE", port },
      );
    this.port = port;
    setHandler(port, {
      server: this,
      createRequestResponse: () => ({
        IncomingMessage: this[kIncomingMessage],
        ServerResponse: this[kServerResponse],
      }),
    });
    const callback =
      [...args].reverse().find((arg: unknown) => typeof arg === "function") ??
      (typeof value === "function" ? value : undefined);
    if (callback) this.once("listening", callback as () => void);
    queueMicrotask(() => this.emit("listening"));
    return this;
  }
  address() {
    return this.port === undefined
      ? null
      : { port: this.port, address: "127.0.0.1", family: "IPv4" };
  }
  close(callback?: () => void) {
    if (this.port !== undefined) release(this.port);
    this.port = undefined;
    if (callback) this.once("close", callback);
    queueMicrotask(() => this.emit("close"));
    return this;
  }
  closeAllConnections() {}
  closeIdleConnections() {}
  setTimeout(
    msecs?: number | ((socket: unknown) => void),
    callback?: (socket: unknown) => void,
  ) {
    if (typeof msecs === "function") callback = msecs;
    else if (typeof msecs === "number") this.timeout = msecs;
    if (callback) this.on("timeout", callback);
    return this;
  }
  getConnections(callback?: (error: Error | null, count: number) => void) {
    if (callback) {
      validateType(callback, "function", "callback");
      queueMicrotask(() => callback(null, 0));
    }
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  get maxConnections() {
    return Infinity;
  }
  get connections() {
    return 0;
  }
  async [asyncDispose]() {
    await new Promise<void>((resolve) => this.close(resolve));
  }
}

export class Agent extends EventEmitter {
  static defaultMaxSockets = Infinity;
  defaultPort: number;
  protocol: string;
  options: AgentOptions & { __proto__: null };
  agentKeepAliveTimeoutBuffer = 1000;
  keepAliveMsecs: number;
  keepAlive: boolean;
  maxSockets: number;
  maxFreeSockets: number;
  scheduling: "lifo" | "fifo";
  maxTotalSockets: number;
  totalSocketCount = 0;
  readonly freeSockets: NodeJS.ReadOnlyDict<unknown[]> = {};
  readonly sockets: NodeJS.ReadOnlyDict<unknown[]> = {};
  readonly requests: NodeJS.ReadOnlyDict<ClientRequest[]> = {};
  constructor(options: AgentOptions = {}) {
    super();
    this.options = { __proto__: null, ...options };
    const values = this.options as AgentOptions & {
      defaultPort?: number;
      protocol?: string;
      path?: null;
      proxyEnv?: unknown;
    };
    this.defaultPort = values.defaultPort || 80;
    this.protocol = values.protocol || "http:";
    values.path = null;
    if (!("proxyEnv" in values)) values.proxyEnv = undefined;
    if ((values as typeof values & { noDelay?: boolean }).noDelay === undefined)
      (values as typeof values & { noDelay?: boolean }).noDelay = true;
    this.keepAliveMsecs = this.options.keepAliveMsecs || 1000;
    this.keepAlive = this.options.keepAlive || false;
    this.maxSockets = this.options.maxSockets || Agent.defaultMaxSockets;
    this.maxFreeSockets = this.options.maxFreeSockets || 256;
    this.scheduling = this.options.scheduling || "lifo";
    validateOneOf(this.scheduling, "scheduling", ["fifo", "lifo"]);
    const maximum = this.options.maxTotalSockets;
    if (maximum !== undefined) validateNumber(maximum, "maxTotalSockets", 1);
    this.maxTotalSockets = maximum === undefined ? Infinity : maximum;
  }
  createConnection() {
    throw notImplemented("createConnection");
  }
  getName(options: RequestOptions = {}) {
    let name = `${options.host || "localhost"}:${options.port || ""}:${options.localAddress || ""}`;
    if (options.family === 4 || options.family === 6)
      name += `:${options.family}`;
    if (options.socketPath) name += `:${options.socketPath}`;
    return name;
  }
  addRequest(_request: ClientRequest, _options: unknown) {}
  createSocket(
    _request: ClientRequest,
    _options: unknown,
    _callback: () => void,
  ) {}
  removeSocket(_socket: unknown) {}
  keepSocketAlive(_socket: unknown) {
    return false;
  }
  reuseSocket(_socket: unknown, _request: ClientRequest) {}
  destroy(_error?: Error) {}
}
export const globalAgent = new Agent({
  keepAlive: true,
  scheduling: "lifo",
  timeout: 5000,
});

const INVALID_PATH = /[^\u0021-\u00ff]/;
const AUTHORITY_OVERRIDE = /^(?:[/\\]{2}|[^/\\]*:)/;
export class ClientRequest extends OutgoingMessage {
  method = "GET";
  path = "/";
  host: string;
  protocol = "http:";
  port = "80";
  joinDuplicateHeaders?: boolean;
  agent?: Agent;
  aborted = false;
  reusedSocket = false;
  maxHeadersCount = Infinity;
  connection = null;
  socket = null;
  timeout?: number;
  _ended = false;
  private abortController = new AbortController();
  private upload: Uint8Array[] = [];
  private response?: IncomingMessage;
  private timer?: ReturnType<typeof setTimeout>;
  private sent = false;

  constructor(
    input: string | URL | RequestOptions | null,
    options?: RequestOptions | ((response: IncomingMessage) => void),
    callback?: (response: IncomingMessage) => void,
  ) {
    super();
    let values: RequestOptions;
    if (typeof input === "string" || input instanceof URL) {
      const url = new URL(input);
      values = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        auth: url.username
          ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
          : undefined,
      };
      if (typeof options === "function") callback = options;
      else Object.assign(values, options);
    } else {
      values = {
        ...(input ?? {}),
        ...(typeof options === "object" ? options : {}),
      };
      if (typeof options === "function") callback = options;
    }
    const path = values.path || "/";
    if (INVALID_PATH.test(path))
      throw coded(
        new TypeError("Request path contains unescaped characters"),
        "ERR_UNESCAPED_CHARACTERS",
      );
    if (AUTHORITY_OVERRIDE.test(path))
      throw coded(
        new TypeError(
          "The property 'options.path' must be a path-only request target",
        ),
        "ERR_INVALID_ARG_VALUE",
      );
    if (values.hostname != null)
      validateType(values.hostname, "string", "hostname");
    if (!values.hostname && values.host != null)
      validateType(values.host, "string", "host");
    if (values.maxHeaderSize !== undefined) {
      validateInteger(values.maxHeaderSize, "maxHeaderSize", 0);
      unsupportedOption("maxHeaderSize");
    }
    if (values.insecureHTTPParser !== undefined)
      validateType(values.insecureHTTPParser, "boolean", "insecureHTTPParser");
    for (const key of ["createConnection", "lookup", "socketPath"] as const) {
      if (values[key] !== undefined) {
        validateType(
          values[key],
          key === "socketPath" ? "string" : "function",
          key,
        );
        unsupportedOption(key);
      }
    }
    if (values.joinDuplicateHeaders !== undefined)
      validateType(
        values.joinDuplicateHeaders,
        "boolean",
        "joinDuplicateHeaders",
      );
    const defaultAgent =
      (values._defaultAgent as Agent | undefined) || globalAgent;
    const agent =
      values.agent === false
        ? new (defaultAgent.constructor as typeof Agent)()
        : ((values.agent as Agent | undefined) ?? defaultAgent);
    if (agent && typeof agent.addRequest !== "function")
      throw coded(
        new TypeError(
          'The "options.agent" property must be an Agent-like Object, undefined, or false.',
        ),
        "ERR_INVALID_ARG_TYPE",
      );
    this.agent = agent;
    this.protocol = values.protocol || defaultAgent.protocol;
    if (this.protocol !== agent.protocol)
      throw coded(
        new TypeError(
          `Protocol "${this.protocol}" not supported. Expected "${agent.protocol}"`,
        ),
        "ERR_INVALID_PROTOCOL",
      );
    this.port = String(
      values.port || values.defaultPort || agent.defaultPort || 80,
    );
    this.host = String(values.hostname || values.host || "localhost");
    this.path = path;
    if (values.method != null && typeof values.method !== "string")
      throw coded(
        new TypeError('The "options.method" property must be of type string.'),
        "ERR_INVALID_ARG_TYPE",
      );
    this.method = (values.method || "GET").toUpperCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(this.method))
      throw coded(
        new TypeError(`Method must be a valid HTTP token ["${this.method}"]`),
        "ERR_INVALID_HTTP_TOKEN",
      );
    this.joinDuplicateHeaders = values.joinDuplicateHeaders;
    if (Array.isArray(values.headers)) {
      if (values.headers.length % 2)
        throw coded(
          new TypeError("The argument 'headers' is invalid"),
          "ERR_INVALID_ARG_VALUE",
        );
      for (let i = 0; i < values.headers.length; i += 2)
        this.setHeader(values.headers[i]!, values.headers[i + 1]!);
    } else
      for (const [name, value] of Object.entries(values.headers ?? {}))
        if (value !== undefined) this.setHeader(name, value);
    if (
      !this.hasHeader("host") &&
      values.setHost !== false &&
      values.setDefaultHeaders !== false
    ) {
      const bracketed =
        this.host.includes(":") && !this.host.startsWith("[")
          ? `[${this.host}]`
          : this.host;
      this.setHeader(
        "Host",
        Number(this.port) === agent.defaultPort
          ? bracketed
          : `${bracketed}:${this.port}`,
      );
    }
    if (values.auth && !this.hasHeader("authorization"))
      this.setHeader(
        "Authorization",
        `Basic ${Buffer.from(values.auth).toString("base64")}`,
      );
    if (values.signal) {
      const onAbort = () =>
        this.destroy(
          new AbortError(undefined, { cause: values.signal!.reason }),
        );
      if (values.signal.aborted) onAbort();
      else values.signal.addEventListener("abort", onAbort, { once: true });
    }
    if (values.timeout !== undefined) this.setTimeout(values.timeout);
    if (callback) this.once("response", callback);
  }

  override _implicitHeader() {
    if (this.hasHeader("content-length"))
      this._contentLength = Number(this.getHeader("content-length"));
    this._header = `${this.method} ${this.path} HTTP/1.1\r\n`;
  }
  override write(
    chunk: unknown,
    encoding?: unknown,
    callback?: unknown,
  ): boolean {
    return super.write(
      chunk instanceof Uint8Array ? Buffer.from(chunk) : chunk,
      encoding,
      callback,
    );
  }
  override _write(
    chunk: Buffer | string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (this.method === "GET" || this.method === "HEAD") {
      callback();
      return;
    }
    this.upload.push(Buffer.from(chunk as never, encoding));
    callback();
  }
  override _final = (callback: (error?: Error | null) => void) => {
    try {
      this.#send();
      callback();
    } catch (error) {
      this.destroy(error as Error);
      callback(error as Error);
    }
  };
  override flushHeaders = () => {
    super.flushHeaders();
  };
  #send() {
    if (this.destroyed || this.sent) return;
    this.sent = true;
    this.#armTimer();
    const missingHost =
      this.host &&
      !this.getHeader("host") &&
      this.getHeaderNames().length === 0;
    let url: URL | undefined;
    if (!missingHost) {
      if (AUTHORITY_OVERRIDE.test(this.path))
        throw coded(
          new TypeError("options.path must be a path-only request target"),
          "ERR_INVALID_ARG_VALUE",
        );
      // Some Android WebViews percent-encode host spaces instead of rejecting
      // them. Preserve the pinned Workers URL validation before network I/O.
      if (/ |%20/i.test(this.host)) throw new TypeError("Invalid URL");
      url = new URL(`${this.protocol}//${this.host}`);
      url.port = this.port;
      if (this.path.length > 0 && this.path !== "/")
        url = new URL(this.path, url);
    }
    const headers: [string, string][] = [];
    for (const [name, value] of Object.values(this[kHeaders] ?? {}))
      for (const item of Array.isArray(value)
        ? this.joinDuplicateHeaders
          ? [value.join(", ")]
          : value
        : [value])
        headers.push([name, String(item)]);
    const body = this.upload.length
      ? new Blob(this.upload as BlobPart[])
      : null;
    const response = missingHost
      ? Promise.resolve(
          new Response(null, {
            status: 400,
            statusText: "Bad Request",
            headers: { connection: "close" },
          }),
        )
      : fetch(url!, {
          method: this.method,
          headers,
          body,
          signal: this.abortController.signal,
          redirect: "manual",
          encodeResponseBody: "manual",
          duplex: "half",
        } as RequestInit & { encodeResponseBody: "manual"; duplex: "half" });
    void response.then(
      (response) => {
        if (this.destroyed) {
          void response.body?.cancel();
          return;
        }
        const incoming = new IncomingMessage();
        incoming[kSetIncomingFetchResponse](response, {
          setTimeout: (msecs) => {
            this.timeout = msecs;
            this.#armTimer();
          },
          touch: () => this.#armTimer(),
        });
        this.response = incoming;
        this._header = [...response.headers]
          .map(([key, value]) => `${key}: ${value}`)
          .join("\r\n");
        incoming.on("error", (error) => {
          if (!this.destroyed) this.emit("error", error);
        });
        incoming.once("close", () => this.#emitClose());
        this.#armTimer();
        if (!this.emit("response", incoming)) incoming._dump();
      },
      (error) => {
        if (!this.destroyed) this.destroy(error);
      },
    );
  }
  addTrailers(_headers: OutgoingHttpHeaders | readonly [string, string][]) {
    throw notImplemented("addTrailers");
  }
  onSocket(_socket: unknown) {}
  setNoDelay(noDelay?: boolean) {
    validateBoolean(noDelay, "noDelay");
  }
  setSocketKeepAlive(enable?: boolean, initialDelay?: number) {
    validateBoolean(enable, "enable");
    validateNumber(initialDelay, "initialDelay");
  }
  clearTimeout(callback?: () => void) {
    return this.setTimeout(0, callback);
  }
  setTimeout(msecs: number, callback?: () => void) {
    if (!Number.isFinite(msecs) || msecs < 0)
      throw coded(
        new RangeError('The value of "msecs" is out of range.'),
        "ERR_OUT_OF_RANGE",
      );
    this.timeout = msecs;
    if (callback) this.once("timeout", callback);
    this.#armTimer();
    return this;
  }
  #armTimer() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.timeout || !this.sent || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.emit("timeout");
      this.response?.emit("timeout");
      this.destroy(coded(new Error("The operation was aborted"), "ABORT_ERR"));
    }, this.timeout);
  }
  #releaseUpload(_error?: Error) {
    this.upload = [];
  }
  #emitClose() {
    if (!this._closed) {
      this._closed = true;
      this.destroyed = true;
      this.#releaseUpload();
      if (this.timer) clearTimeout(this.timer);
      this.emit("close");
    }
  }
  abort() {
    if (!this.aborted) {
      this.aborted = true;
      queueMicrotask(() => this.emit("abort"));
      this.destroy();
    }
  }
  override destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.#releaseUpload(error);
    if (this.timer) clearTimeout(this.timer);
    if (!this.response && error == null && !this.aborted)
      error = coded(new Error("socket hang up"), "ECONNRESET");
    if (error) queueMicrotask(() => this.emit("error", error));
    if (this.response && !this.response.complete)
      this.response.destroy(coded(new Error("aborted"), "ECONNRESET"));
    else this.abortController.abort();
    queueMicrotask(() => this.#emitClose());
    return this;
  }
  override end(chunk?: unknown, encoding?: unknown, callback?: unknown): this {
    this._ended = true;
    return super.end(chunk, encoding, callback);
  }
}

export function request(
  url: string | URL | RequestOptions,
  options?: RequestOptions | ((response: IncomingMessage) => void),
  callback?: (response: IncomingMessage) => void,
) {
  return new ClientRequest(url, options, callback);
}
export function get(
  url: string | URL | RequestOptions,
  options?: RequestOptions | ((response: IncomingMessage) => void),
  callback?: (response: IncomingMessage) => void,
) {
  const result = request(url, options, callback);
  result.end();
  return result;
}
export function createServer(
  options?: ServerOptions | RequestListener,
  listener?: RequestListener,
) {
  return new Server(options, listener);
}
export function setMaxIdleHTTPParsers(max: unknown): never {
  if (!Number.isInteger(max) || (max as number) < 1)
    throw coded(
      new RangeError('The value of "max" is out of range.'),
      "ERR_OUT_OF_RANGE",
    );
  throw notImplemented("setMaxIdleHTTPParsers");
}
export function _connectionListener(): never {
  throw notImplemented("_connectionListener");
}
export { WebSocket, CloseEvent };
export const MessageEvent = globalThis.MessageEvent;

export default {
  validateHeaderName,
  validateHeaderValue,
  METHODS,
  STATUS_CODES,
  ClientRequest,
  request,
  get,
  OutgoingMessage,
  Agent,
  globalAgent,
  IncomingMessage,
  Server,
  ServerResponse,
  createServer,
  maxHeaderSize,
  setMaxIdleHTTPParsers,
  _connectionListener,
  WebSocket,
  CloseEvent,
  MessageEvent,
};
