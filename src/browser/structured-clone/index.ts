import { isURLInstance } from "../../compat/url/brand.js";
import { isSharedBuffer } from "../../shared/buffer-source.js";
import { isWebSocketPair } from "../websocket/brand.js";
import { platform } from "../../shared/globals/platform.js";
import { cloneHeaders, Headers } from "../headers/index.js";
import { Request, structuredCloneRequestSnapshot } from "../request/index.js";
import {
  Response,
  structuredCloneResponseSnapshot,
  restoreStructuredCloneResponse,
} from "../response/index.js";

import {
  Blob as WorkersBlob,
  File as WorkersFile,
  cloneBlob,
} from "../../compat/buffer/blob.js";

const platformStructuredClone = platform.structuredClone;
const unsupported = new Map([
  [
    "URL",
    'Could not serialize object of type "URL". This type does not support serialization.',
  ],
  [
    "URLSearchParams",
    'Could not serialize object of type "URLSearchParams". This type does not support serialization.',
  ],
  [
    "TextEncoder",
    'Could not serialize object of type "TextEncoder". This type does not support serialization.',
  ],
  [
    "TextDecoder",
    'Could not serialize object of type "TextDecoder". This type does not support serialization.',
  ],
  [
    "AbortController",
    'Could not serialize object of type "AbortController". This type does not support serialization.',
  ],
]);

type Marker = Record<string, unknown>;
type RequestSnapshot = {
  url: string;
  method: string;
  headers: Headers;
  redirect: "follow" | "manual";
  cf: Record<string, unknown> | undefined;
  fetcher: null;
  cache: "no-store" | "no-cache" | undefined;
  encodeResponseBody: "automatic" | "manual";
};
type ResponseSnapshot = {
  status: number;
  statusText: string;
  serializedStatusText?: string;
  headers: Headers;
  cf: Record<string, unknown> | undefined;
  encodeBody: "automatic" | "manual";
  type: "default" | "error";
  url: string;
  redirected: boolean;
  webSocket: WebSocket | null;
  hasBody: boolean;
};
type Metadata =
  | {
      type: "shared-attachment";
      value:
        | SharedArrayBuffer
        | ArrayBufferView
        | WebAssembly.Module
        | WebAssembly.Memory;
    }
  | { type: "blob"; value: WorkersBlob }
  | { type: "headers"; value: Headers }
  | { type: "request"; value: RequestSnapshot }
  | { type: "response"; value: ResponseSnapshot };

function dataCloneError(message: string): DOMException {
  return new DOMException(message, "DataCloneError");
}

function boxedSymbol(value: object): boolean {
  try {
    Symbol.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

function boxedBigInt(value: object): boolean {
  try {
    BigInt.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

function viewField(value: ArrayBufferView, key: string) {
  const prototype =
    value instanceof DataView
      ? DataView.prototype
      : Object.getPrototypeOf(Uint8Array.prototype);
  return Object.getOwnPropertyDescriptor(prototype, key)!.get!.call(value);
}

function nativeValue(value: object) {
  return (
    value instanceof Number ||
    value instanceof Boolean ||
    value instanceof String ||
    boxedBigInt(value) ||
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    isSharedBuffer(value) ||
    value instanceof WebAssembly.Module ||
    value instanceof WebAssembly.Memory ||
    ArrayBuffer.isView(value)
  );
}

function errorName(error: Error) {
  return error instanceof AggregateError
    ? "AggregateError"
    : error instanceof EvalError
      ? "EvalError"
      : error instanceof RangeError
        ? "RangeError"
        : error instanceof ReferenceError
          ? "ReferenceError"
          : error instanceof SyntaxError
            ? "SyntaxError"
            : error instanceof TypeError
              ? "TypeError"
              : error instanceof URIError
                ? "URIError"
                : "Error";
}

function encode(
  value: unknown,
  tag: string,
  metadata: Metadata[] & { attachment?: boolean },
  seen: Map<object, unknown>,
  transferred: Set<ArrayBuffer>,
  markers: object[],
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return value;
  if (typeof value === "symbol" || typeof value === "function")
    throw dataCloneError(`${String(value)} could not be cloned.`);
  if (boxedSymbol(value))
    throw dataCloneError("[object Symbol] could not be cloned.");
  if (seen.has(value)) return seen.get(value);
  const wasmMemoryBuffer =
    value instanceof WebAssembly.Memory
      ? Object.getOwnPropertyDescriptor(
          WebAssembly.Memory.prototype,
          "buffer",
        )!.get!.call(value)
      : undefined;
  if (wasmMemoryBuffer && !isSharedBuffer(wasmMemoryBuffer))
    throw dataCloneError("#<Memory> could not be cloned.");
  for (const [name, Constructor] of [
    ["Instance", WebAssembly.Instance],
    ["Table", WebAssembly.Table],
    ["Global", WebAssembly.Global],
  ] as const)
    if (value instanceof Constructor)
      throw dataCloneError(`#<${name}> could not be cloned.`);
  if (
    metadata.attachment &&
    (value instanceof WebAssembly.Module ||
      value instanceof WebAssembly.Memory ||
      isSharedBuffer(value) ||
      (ArrayBuffer.isView(value) && isSharedBuffer(viewField(value, "buffer"))))
  ) {
    const marker: Marker = { [tag]: metadata.length };
    markers.push(marker);
    seen.set(value, marker);
    metadata.push({
      type: "shared-attachment",
      value: value as
        | SharedArrayBuffer
        | ArrayBufferView
        | WebAssembly.Module
        | WebAssembly.Memory,
    });
    return marker;
  }
  for (const [name, matches] of [
    ["WebSocketPair", isWebSocketPair(value)],
    [
      "CryptoKey",
      typeof CryptoKey === "function" && value instanceof CryptoKey,
    ],
    ["FormData", value instanceof FormData],
    [
      "MessageChannel",
      typeof MessageChannel === "function" && value instanceof MessageChannel,
    ],
    ["Event", value instanceof Event],
  ] as const)
    if (matches)
      throw dataCloneError(
        `Could not serialize object of type "${name}". This type does not support serialization.`,
      );

  if (value instanceof WorkersFile)
    throw dataCloneError(
      'Could not serialize object of type "File". This type does not support serialization.',
    );
  if (value instanceof WorkersBlob) {
    const marker: Marker = { [tag]: metadata.length };
    markers.push(marker);
    seen.set(value, marker);
    metadata.push({ type: "blob", value: cloneBlob(value) });
    return marker;
  }
  if (value instanceof Headers) {
    const marker: Marker = { [tag]: metadata.length };
    markers.push(marker);
    seen.set(value, marker);
    metadata.push({ type: "headers", value: cloneHeaders(value) });
    return marker;
  }
  if (value instanceof Request) {
    const snapshot = structuredCloneRequestSnapshot(value);
    if (snapshot.hasBody)
      throw dataCloneError("ReadableStream can only be serialized for RPC.");
    if (snapshot.signal !== undefined)
      throw dataCloneError("AbortSignal serialization is not enabled.");
    if (snapshot.fetcher !== null)
      throw dataCloneError(
        'Could not serialize object of type "Fetcher". This type does not support serialization.',
      );
    const marker: Marker = { [tag]: metadata.length };
    markers.push(marker);
    seen.set(value, marker);
    metadata.push({
      type: "request",
      value: {
        url: snapshot.url,
        method: snapshot.method,
        headers: snapshot.headers,
        redirect: snapshot.redirect,
        cf: snapshot.cf,
        fetcher: null,
        cache: snapshot.cache,
        encodeResponseBody: snapshot.encodeResponseBody,
      },
    });
    marker.headers = encode(
      snapshot.headers,
      tag,
      metadata,
      seen,
      transferred,
      markers,
    );
    marker.cf = encode(snapshot.cf, tag, metadata, seen, transferred, markers);
    return marker;
  }
  if (value instanceof Response) {
    const snapshot = structuredCloneResponseSnapshot(value);
    if (snapshot.hasBody)
      throw dataCloneError("ReadableStream can only be serialized for RPC.");
    if (snapshot.webSocket !== null)
      throw dataCloneError(
        'Could not serialize object of type "WebSocket". This type does not support serialization.',
      );
    const marker: Marker = { [tag]: metadata.length };
    markers.push(marker);
    seen.set(value, marker);
    metadata.push({
      type: "response",
      value: snapshot,
    });
    marker.headers = encode(
      snapshot.headers,
      tag,
      metadata,
      seen,
      transferred,
      markers,
    );
    marker.cf = encode(snapshot.cf, tag, metadata, seen, transferred, markers);
    return marker;
  }
  if (value instanceof DOMException) {
    const marker: Marker = {
      [tag]: "dom-exception",
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    markers.push(marker);
    seen.set(value, marker);
    return marker;
  }
  if (value instanceof Error) {
    const marker: Marker = {
      [tag]: "error",
      kind: errorName(value),
      message: value.message,
      stack: value.stack,
    };
    markers.push(marker);
    seen.set(value, marker);
    if ("cause" in value)
      marker.cause = encode(
        value.cause,
        tag,
        metadata,
        seen,
        transferred,
        markers,
      );
    if (value instanceof AggregateError)
      marker.errors = encode(
        value.errors,
        tag,
        metadata,
        seen,
        transferred,
        markers,
      );
    for (const key of Object.getOwnPropertyNames(value)) {
      if (["stack", "message", "cause", "errors"].includes(key)) continue;
      const index = Number(key);
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < 0xffffffff &&
        String(index) === key
      )
        continue;
      marker.properties ??= {} as Record<string, unknown>;
      Object.defineProperty(marker.properties, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: encode(
          (value as unknown as Record<string, unknown>)[key],
          tag,
          metadata,
          seen,
          transferred,
          markers,
        ),
      });
    }
    return marker;
  }

  if (isURLInstance(value)) throw dataCloneError(unsupported.get("URL")!);
  for (const [type, Constructor] of [
    ["URLSearchParams", URLSearchParams],
    ["TextEncoder", TextEncoder],
    ["TextDecoder", TextDecoder],
    ["AbortController", AbortController],
  ] as const) {
    if (value instanceof Constructor)
      throw dataCloneError(unsupported.get(type)!);
  }
  if (value instanceof AbortSignal)
    throw dataCloneError("AbortSignal serialization is not enabled.");
  if (value instanceof EventTarget)
    throw dataCloneError(
      `Could not serialize object of type "${value.constructor.name}". This type does not support serialization.`,
    );
  for (const [type, Constructor] of [
    ["ReadableStream", ReadableStream],
    ["WritableStream", WritableStream],
    ["TransformStream", TransformStream],
  ] as const) {
    if (value instanceof Constructor)
      throw dataCloneError(`${type} can only be serialized for RPC.`);
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const buffer =
      value instanceof ArrayBuffer ? value : viewField(value, "buffer");
    try {
      new Uint8Array(buffer);
    } catch {
      throw dataCloneError(
        "An ArrayBuffer is detached and could not be cloned.",
      );
    }
  }
  if (nativeValue(value)) {
    if (value instanceof ArrayBuffer && transferred.has(value)) return value;
    if (ArrayBuffer.isView(value)) {
      const get = (key: string) => viewField(value, key);
      const buffer = get("buffer") as ArrayBuffer;
      if (transferred.has(buffer)) return value;
      const clonedBuffer = encode(
        buffer,
        tag,
        metadata,
        seen,
        transferred,
        markers,
      ) as ArrayBuffer;
      const offset = get("byteOffset") as number;
      let snapshot: ArrayBufferView;
      if (value instanceof DataView)
        snapshot = new DataView(clonedBuffer, offset, get("byteLength"));
      else {
        const Constructor = [
          Int8Array,
          Uint8ClampedArray,
          Uint8Array,
          Int16Array,
          Uint16Array,
          Int32Array,
          Uint32Array,
          Float32Array,
          Float64Array,
          BigInt64Array,
          BigUint64Array,
          ...((globalThis as unknown as { Float16Array?: typeof Float32Array })
            .Float16Array
            ? [
                (globalThis as unknown as { Float16Array: typeof Float32Array })
                  .Float16Array,
              ]
            : []),
        ].find((Constructor) => value instanceof Constructor)!;
        snapshot = new Constructor(clonedBuffer, offset, get("length"));
      }
      seen.set(value, snapshot);
      return snapshot;
    }
    const snapshot = platformStructuredClone(value);
    seen.set(value, snapshot);
    return snapshot;
  }
  if (
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof Promise ||
    value instanceof WeakRef ||
    value instanceof FinalizationRegistry
  )
    return platformStructuredClone(value);

  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);
    for (const [key, item] of Array.from(Map.prototype.entries.call(value)))
      result.set(
        encode(key, tag, metadata, seen, transferred, markers),
        encode(item, tag, metadata, seen, transferred, markers),
      );
    return result;
  }
  if (value instanceof Set) {
    const result = new Set();
    seen.set(value, result);
    for (const item of Array.from(Set.prototype.values.call(value)))
      result.add(encode(item, tag, metadata, seen, transferred, markers));
    return result;
  }
  const result: Record<string, unknown> | unknown[] = Array.isArray(value)
    ? new Array(value.length)
    : {};
  seen.set(value, result);
  for (const key of Object.keys(value))
    Object.defineProperty(result, key, {
      value: encode(
        (value as Record<string, unknown>)[key],
        tag,
        metadata,
        seen,
        transferred,
        markers,
      ),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return result;
}

function createError(kind: string, message: string) {
  const constructors: Record<string, ErrorConstructor> = {
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,
  };
  return kind === "AggregateError"
    ? new AggregateError([], message)
    : new (constructors[kind] ?? Error)(message);
}

function decode(
  value: unknown,
  tag: string,
  metadata: Metadata[],
  seen: Map<object, unknown>,
  markers: Set<object>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) {
    const decoded = seen.get(value);
    if (decoded === undefined)
      throw new Error("Unable to deserialize cloned data.");
    return decoded;
  }
  if (markers.has(value)) {
    const marker = value as Marker;
    const id = marker[tag];
    if (id === "error") {
      const error = createError(String(marker.kind), String(marker.message));
      seen.set(value, error);
      if (marker.stack !== undefined)
        Object.defineProperty(error, "stack", {
          value: marker.stack,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      if (Object.hasOwn(marker, "cause"))
        Object.defineProperty(error, "cause", {
          value: decode(marker.cause, tag, metadata, seen, markers),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      if (error instanceof AggregateError)
        Object.defineProperty(error, "errors", {
          value: decode(marker.errors, tag, metadata, seen, markers),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      const properties = marker.properties as
        | Record<string, unknown>
        | undefined;
      if (properties)
        for (const key of Object.keys(properties))
          Object.defineProperty(error, key, {
            value: decode(properties[key], tag, metadata, seen, markers),
            writable: true,
            enumerable: true,
            configurable: true,
          });
      return error;
    }
    if (id === "dom-exception") {
      const error = new DOMException(
        String(marker.message),
        String(marker.name),
      );
      seen.set(value, error);
      const code = error.code;
      for (const key of ["code", "name", "message", "stack"])
        if (Object.getOwnPropertyDescriptor(error, key)?.configurable)
          delete (error as unknown as Record<string, unknown>)[key];
      for (const [key, content, writable, configurable] of [
        ["code", code, false, true],
        ["name", marker.name, false, true],
        ["message", marker.message, false, true],
        ["stack", marker.stack, true, false],
      ] as const)
        Object.defineProperty(error, key, {
          value: content,
          writable,
          enumerable: true,
          configurable,
        });
      return error;
    }
    const entry = metadata[Number(id)]!;
    if (entry.type === "blob" || entry.type === "shared-attachment") {
      seen.set(value, entry.value);
      return entry.value;
    }
    if (entry.type === "headers") {
      const headers = cloneHeaders(entry.value);
      seen.set(value, headers);
      return headers;
    }
    if (entry.type === "request" || entry.type === "response") {
      // workerd rejects a host object that references itself while deserializing.
      // This happens after the platform clone has committed buffer transfers.
      seen.set(value, undefined);
    }
    if (entry.type === "request") {
      const request = new Request(entry.value.url, {
        method: entry.value.method,
        headers: decode(
          marker.headers,
          tag,
          metadata,
          seen,
          markers,
        ) as Headers,
        redirect: entry.value.redirect,
        cf: decode(marker.cf, tag, metadata, seen, markers) as
          | Record<string, unknown>
          | undefined,
        fetcher: null,
        cache: entry.value.cache,
        encodeResponseBody: entry.value.encodeResponseBody,
      });
      seen.set(value, request);
      return request;
    }
    const response = restoreStructuredCloneResponse({
      ...entry.value,
      headers: decode(marker.headers, tag, metadata, seen, markers) as Headers,
      cf: decode(marker.cf, tag, metadata, seen, markers) as
        | Record<string, unknown>
        | undefined,
    });
    seen.set(value, response);
    return response;
  }
  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);
    for (const [key, item] of Map.prototype.entries.call(value))
      result.set(
        decode(key, tag, metadata, seen, markers),
        decode(item, tag, metadata, seen, markers),
      );
    return result;
  }
  if (value instanceof Set) {
    const result = new Set();
    seen.set(value, result);
    for (const item of Set.prototype.values.call(value))
      result.add(decode(item, tag, metadata, seen, markers));
    return result;
  }
  if (nativeValue(value)) return value;
  const result: Record<string, unknown> | unknown[] = Array.isArray(value)
    ? new Array(value.length)
    : {};
  seen.set(value, result);
  for (const key of Object.keys(value))
    Object.defineProperty(result, key, {
      value: decode(
        (value as Record<string, unknown>)[key],
        tag,
        metadata,
        seen,
        markers,
      ),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return result;
}

function transfers(options: unknown): Transferable[] {
  if (options == null) return [];
  if (typeof options !== "object")
    throw new TypeError(
      "Failed to execute 'structuredClone' on 'ServiceWorkerGlobalScope': parameter 2 is not of type 'StructuredCloneOptions'.",
    );
  const list = (options as { transfer?: unknown }).transfer;
  if (list === undefined) return [];
  if (!Array.isArray(list))
    throw new TypeError(
      "Incorrect type for the 'transfer' field on 'StructuredCloneOptions': the provided value is not of type 'Array'.",
    );
  const unique = new Set<ArrayBuffer>();
  for (const item of list) {
    const buffer =
      item instanceof ArrayBuffer
        ? item
        : ArrayBuffer.isView(item)
          ? viewField(item, "buffer")
          : undefined;
    if (!(buffer instanceof ArrayBuffer))
      throw new TypeError("Object is not transferable");
    unique.add(buffer);
  }
  return [...unique];
}

export function structuredClone<T>(
  value: T,
  options?: StructuredSerializeOptions,
): T {
  if (arguments.length === 0)
    throw new TypeError(
      "Failed to execute 'structuredClone' on 'ServiceWorkerGlobalScope': parameter 1 is not of type 'Value'.",
    );
  return snapshot(value, transfers(options));
}
/** Attachment bytes omit the shared-memory external table. Retain only the
 * brand while validating/counting; deserializeAttachment always rejects it. */
export function cloneAttachment<T>(value: T): T {
  return snapshot(value, [], true);
}
function snapshot<T>(
  value: T,
  transfer: Transferable[],
  attachment = false,
): T {
  const metadata: Metadata[] & { attachment?: boolean } = [];
  metadata.attachment = attachment;
  const tag = "__workers_capacitor_clone__";
  const markers: object[] = [];
  const encoded = encode(
    value,
    tag,
    metadata,
    new Map(),
    new Set(transfer as ArrayBuffer[]),
    markers,
  );
  const cloned = platformStructuredClone({ encoded, markers }, { transfer });
  return decode(
    cloned.encoded,
    tag,
    metadata,
    new Map(),
    new Set(cloned.markers),
  ) as T;
}
Object.defineProperty(structuredClone, "length", { value: 0 });

Object.defineProperty(structuredClone, "name", { value: "structuredClone" });
import type { WebSocket } from "../websocket/endpoint.js";
