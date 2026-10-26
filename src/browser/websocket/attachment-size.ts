/** Canonical V8 wire-format-15 byte accounting; see README.md for the narrowly
 * approved storage-representation boundary. Values must already be snapshotted.
 * This counts wire tags, lengths, references and payloads, not JSON text. */
import { Blob } from "../../compat/buffer/blob.js";
import { isSharedBuffer } from "../../shared/buffer-source.js";
import { Headers, serializedHeaderFields } from "../headers/index.js";
import { Request, structuredCloneRequestSnapshot } from "../request/index.js";
import {
  Response,
  structuredCloneResponseSnapshot,
} from "../response/index.js";
const commonHeaders = new Set(
  `accept-charset accept-encoding accept-language accept-ranges accept access-control-allow-origin age allow authorization cache-control content-disposition content-encoding content-language content-length content-location content-range content-type cookie date etag expect expires from host if-match if-modified-since if-none-match if-range if-unmodified-since last-modified link location max-forwards proxy-authenticate proxy-authorization range referer refresh retry-after server set-cookie strict-transport-security transfer-encoding user-agent vary via www-authenticate`.split(
    " ",
  ),
);
export function attachmentSize(
  value: unknown,
  externals?: { shared: boolean },
): number {
  let size = 2; // Version marker and version 15.
  const seen = new Map<object, number>();
  let sharedCount = 0;
  const wasmBuffers = new Set<object>();
  const uint = (value: number) => {
    let bytes = 1;
    while (value >= 128) {
      bytes++;
      value = Math.floor(value / 128);
    }
    return bytes;
  };
  const string = (value: string) => {
    let latin = true;
    for (let i = 0; i < value.length; i++)
      if (value.charCodeAt(i) > 255) {
        latin = false;
        break;
      }
    const bytes = value.length * (latin ? 1 : 2);
    const prefix = 1 + uint(bytes);
    if (!latin && (size + prefix) % 2) size++;
    size += prefix + bytes;
  };
  const rawString = (value: string) => {
    const bytes = new TextEncoder().encode(value).length;
    size += uint(bytes) + bytes;
  };
  const bigint = (value: bigint) => {
    const magnitude = value < 0n ? -value : value;
    const bytes =
      magnitude === 0n ? 0 : Math.ceil(magnitude.toString(2).length / 64) * 8;
    size += 1 + uint(bytes * 2 + Number(value < 0n)) + bytes;
  };
  const property = (key: string, value: unknown) => {
    const index = Number(key);
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < 0xffffffff &&
      String(index) === key
    ) {
      // Index property names are unsigned integers in the serializer.
      size += 1 + uint(index);
    } else string(key);
    write(value);
  };
  const write = (value: unknown): void => {
    if (value === null || value === undefined || typeof value === "boolean") {
      size++;
      return;
    }
    if (typeof value === "string") {
      string(value);
      return;
    }
    if (typeof value === "number") {
      size +=
        Number.isInteger(value) &&
        !Object.is(value, -0) &&
        value >= -2147483648 &&
        value <= 2147483647
          ? 1 + uint(((value << 1) ^ (value >> 31)) >>> 0)
          : 9;
      return;
    }
    if (typeof value === "bigint") {
      bigint(value);
      return;
    }
    if (typeof value !== "object")
      throw new DOMException(
        `${String(value)} could not be cloned.`,
        "DataCloneError",
      );
    const id = seen.get(value);
    if (id !== undefined) {
      size += 1 + uint(id);
      return;
    }
    // A view's backing buffer receives its reference ID before the view does.
    if (ArrayBuffer.isView(value)) {
      const prototype =
        value instanceof DataView
          ? DataView.prototype
          : Object.getPrototypeOf(Uint8Array.prototype);
      const field = (key: string) =>
        Object.getOwnPropertyDescriptor(prototype, key)!.get!.call(value);
      write(field("buffer"));
      seen.set(value, seen.size);
      size += 2 + uint(field("byteOffset")) + uint(field("byteLength")) + 1;
      return;
    }
    seen.set(value, seen.size);
    if (value instanceof WebAssembly.Module) {
      // workerd has no Wasm-module transfer delegate: no payload is written,
      // and subsequent deserialization fails for the absent external module.
      if (externals) externals.shared = true;
      return;
    }
    if (value instanceof WebAssembly.Memory) {
      const buffer = Object.getOwnPropertyDescriptor(
        WebAssembly.Memory.prototype,
        "buffer",
      )!.get!.call(value) as SharedArrayBuffer;
      if (!isSharedBuffer(buffer))
        throw new DOMException(
          "#<Memory> could not be cloned.",
          "DataCloneError",
        );
      // Maximum capacity is private metadata. Canonical accounting uses current
      // capacity for this opaque, non-deserializable attachment (see README).
      size += 2 + uint((buffer.byteLength / 65536) * 2);
      wasmBuffers.add(buffer);
      write(buffer);
      return;
    }
    // workerd host tags and payloads, pinned to the profile's source revision.
    if (value instanceof Blob) {
      size += 2;
      rawString(value.type);
      size += uint(value.size) + value.size;
      return;
    }
    if (value instanceof Headers) {
      const fields = serializedHeaderFields(value);
      size +=
        3 + uint(fields.reduce((sum, [, entries]) => sum + entries.length, 0));
      for (const [name, entries] of fields)
        for (const entry of entries) {
          size++;
          if (!commonHeaders.has(name)) size += uint(name.length) + name.length;
          rawString(entry);
        }
      return;
    }
    if (value instanceof Request) {
      const s = structuredCloneRequestSnapshot(value);
      size += 2;
      rawString(s.url);
      write({
        method: s.method === "GET" ? undefined : s.method,
        headers: s.headers,
        body: undefined,
        redirect: s.redirect === "manual" ? "manual" : undefined,
        fetcher: undefined,
        cf: s.cf,
        cache: s.cache,
        integrity: undefined,
        signal: undefined,
        encodeResponseBody:
          s.encodeResponseBody === "manual" ? "manual" : undefined,
      });
      return;
    }
    if (value instanceof Response) {
      const s = structuredCloneResponseSnapshot(value);
      size += 2;
      write(null);
      write({
        status: s.status === 200 ? undefined : s.status,
        statusText: s.serializedStatusText,
        headers: s.headers,
        cf: s.cf,
        webSocket: undefined,
        encodeBody: s.encodeBody === "manual" ? "manual" : undefined,
      });
      return;
    }
    if (value instanceof DOMException) {
      size += 2;
      rawString(value.name);
      rawString(value.message);
      rawString(typeof value.stack === "string" ? value.stack : "");
      return;
    }
    if (value instanceof ArrayBuffer) {
      const resizable = Object.getOwnPropertyDescriptor(
        ArrayBuffer.prototype,
        "resizable",
      )?.get?.call(value);
      const length = Object.getOwnPropertyDescriptor(
        ArrayBuffer.prototype,
        "byteLength",
      )!.get!.call(value) as number;
      size += 1 + uint(length) + length;
      if (resizable)
        size += uint(
          Object.getOwnPropertyDescriptor(
            ArrayBuffer.prototype,
            "maxByteLength",
          )!.get!.call(value),
        );
      return;
    }
    if (isSharedBuffer(value)) {
      // The external backing-store table is not persisted with an attachment.
      // Serialization itself is allowed; deserialization must reject separately.
      if (externals) externals.shared = true;
      size += 1 + uint(sharedCount++);
      if (wasmBuffers.has(value)) size += 1 + uint(value.byteLength);
      return;
    }
    if (value instanceof Date) {
      size += 9;
      return;
    }
    if (value instanceof RegExp) {
      size++;
      string(
        Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!.call(
          value,
        ),
      );
      let flags = 0;
      for (const [flag, bit] of [
        ["global", 1],
        ["ignoreCase", 2],
        ["multiline", 4],
        ["sticky", 8],
        ["unicode", 16],
        ["dotAll", 32],
        ["hasIndices", 128],
        ["unicodeSets", 256],
      ] as const)
        if (
          Object.getOwnPropertyDescriptor(RegExp.prototype, flag)?.get?.call(
            value,
          )
        )
          flags |= bit;
      size += uint(flags);
      return;
    }
    if (value instanceof Number) {
      size += 9;
      return;
    }
    if (value instanceof Boolean) {
      size++;
      return;
    }
    if (value instanceof String) {
      size++;
      string(String.prototype.valueOf.call(value));
      return;
    }
    try {
      const unboxed = BigInt.prototype.valueOf.call(value);
      bigint(unboxed);
      return;
    } catch {
      /* Not a boxed BigInt. */
    }
    if (value instanceof Map) {
      size++;
      let count = 0;
      for (const [key, item] of Map.prototype.entries.call(value)) {
        write(key);
        write(item);
        count += 2;
      }
      size += 1 + uint(count);
      return;
    }
    if (value instanceof Set) {
      size++;
      let count = 0;
      for (const item of Set.prototype.values.call(value)) {
        write(item);
        count++;
      }
      size += 1 + uint(count);
      return;
    }
    if (value instanceof Error) {
      // The profile enables workerd's enhanced error serialization, which
      // includes non-enumerable own fields in a host payload (not V8's r tag).
      size += 3;
      if (
        ![
          "Error",
          "TypeError",
          "RangeError",
          "ReferenceError",
          "SyntaxError",
          "CompileError",
          "LinkError",
          "RuntimeError",
          "SuspendError",
          "EvalError",
          "URIError",
          "AggregateError",
          "SuppressedError",
        ].includes(value.name)
      )
        write(value.name);
      write(value.message);
      const properties: Record<string, unknown> = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        const index = Number(key);
        if (
          key === "name" ||
          key === "message" ||
          (Number.isInteger(index) &&
            index >= 0 &&
            index < 0xffffffff &&
            String(index) === key)
        )
          continue;
        Object.defineProperty(properties, key, {
          value: (value as unknown as Record<string, unknown>)[key],
          enumerable: true,
        });
      }
      write(properties);
      return;
    }
    const keys = Object.keys(value);
    if (Array.isArray(value)) {
      // Choose dense encoding from observable own indices, never engine-private
      // packed/holey storage. Sparse arrays retain holes without iterating them.
      const indices = keys.filter(
        (key) =>
          String(Number(key)) === key &&
          Number(key) >= 0 &&
          Number(key) < value.length &&
          Number.isInteger(Number(key)),
      );
      const indexKeys = new Set(indices);
      const dense = indices.length === value.length;
      size += 1 + uint(value.length);
      let count = 0;
      if (dense) {
        for (let i = 0; i < value.length; i++) write(value[i]);
        for (const key of keys)
          if (!indexKeys.has(key)) {
            property(key, (value as unknown as Record<string, unknown>)[key]);
            count++;
          }
      } else {
        for (const key of keys) {
          property(key, (value as unknown as Record<string, unknown>)[key]);
          count++;
        }
      }
      size += 1 + uint(count) + uint(value.length);
      return;
    }
    size++;
    for (const key of keys)
      property(key, (value as Record<string, unknown>)[key]);
    size += 1 + uint(keys.length);
  };
  write(value);
  return size;
}
