// Workers DigestStream contract, pinned to workerd 5358e3d337336eaf696a48bc1563d808b10feba5.
// Stream state and string conversion follow src/workerd/api/crypto/crypto.c++.
import { WritableStream } from "../stream-web/runtime.js";
import { dispose } from "../../shared/globals/symbols.js";
import { viewBytes } from "./validation.js";
import { NativeDigest } from "./native-crypto.js";

type Chunk = ArrayBuffer | ArrayBufferView | string;
interface Context {
  update(bytes: Uint8Array): void;
  final(): Uint8Array;
  dispose(): void;
}
const crcTables = new Map<bigint, bigint[]>();
class CrcDigest implements Context {
  private value: bigint;
  private mask: bigint;
  private table: bigint[];
  constructor(
    private width: number,
    polynomial: bigint,
  ) {
    this.mask = (1n << BigInt(width)) - 1n;
    this.value = this.mask;
    let table = crcTables.get(polynomial);
    if (!table) {
      table = Array.from({ length: 256 }, (_, n) => {
        let v = BigInt(n);
        for (let bit = 0; bit < 8; bit++)
          v = (v >> 1n) ^ (v & 1n ? polynomial : 0n);
        return v;
      });
      crcTables.set(polynomial, table);
    }
    this.table = table;
  }
  update(bytes: Uint8Array) {
    for (const byte of bytes)
      this.value =
        (this.value >> 8n) ^
        this.table[Number((this.value ^ BigInt(byte)) & 255n)]!;
  }
  final() {
    let value = this.value ^ this.mask;
    const result = new Uint8Array(this.width / 8);
    for (let index = result.length - 1; index >= 0; index--) {
      result[index] = Number(value & 255n);
      value >>= 8n;
    }
    return result;
  }
  dispose() {
    this.value = 0n;
  }
}
function context(name: string): Context {
  name = name.split("\0")[0]!.toLowerCase();
  switch (name) {
    case "crc32":
      return new CrcDigest(32, 0xedb88320n);
    case "crc32c":
      return new CrcDigest(32, 0x82f63b78n);
    case "crc64nvme":
      return new CrcDigest(64, 0x9a6c9329ac4bc9b5n);
    case "sha-1":
    case "sha-256":
    case "sha-384":
    case "sha-512":
    case "md5":
      return new NativeDigest(name.replace("-", ""));
    default:
      throw new DOMException(
        "Unrecognized or unimplemented digest algorithm requested.",
        "NotSupportedError",
      );
  }
}
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  try {
    Object.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      "byteLength",
    )!.get!.call(value);
    return true;
  } catch {
    return false;
  }
}
function encodeWtf8(text: string): Uint8Array {
  const output: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const trail = text.charCodeAt(i + 1);
      if (trail >= 0xdc00 && trail <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + trail - 0xdc00;
        i++;
      }
    }
    if (code < 0x80) output.push(code);
    else if (code < 0x800) output.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000)
      output.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    else
      output.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
  }
  return Uint8Array.from(output);
}
interface State {
  context: Context;
  status: "ready" | "closed" | "errored";
  reason: unknown;
  promise: Promise<ArrayBuffer>;
  resolve(value: ArrayBuffer): void;
  reject(reason: unknown): void;
  count: bigint;
  pending: string;
}
function fail(state: State, reason: unknown) {
  if (state.status !== "ready") return;
  state.status = "errored";
  state.reason = reason;
  state.context.dispose();
  state.reject(reason);
}
export class DigestStream extends WritableStream<Chunk> {
  #state: State;
  constructor(
    algorithm: string | { name: string },
    options?: { toWellFormed?: boolean },
  ) {
    if (algorithm == null)
      throw new TypeError(
        "Cannot initialize N7workerd3api12SubtleCrypto13HashAlgorithmE with required members from an undefined or null value.",
      );
    const name =
      typeof algorithm === "object" || typeof algorithm === "function"
        ? `${algorithm.name}`
        : `${algorithm}`;
    if (
      options != null &&
      typeof options !== "object" &&
      typeof options !== "function"
    )
      throw new TypeError(
        "Failed to construct 'DigestStream': constructor parameter 2 is not of type 'Options'.",
      );
    const wellFormed = !!options?.toWellFormed;
    const native = context(name);
    let resolve!: State["resolve"], reject!: State["reject"];
    const promise = new Promise<ArrayBuffer>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const state: State = {
      context: native,
      status: "ready",
      reason: undefined,
      promise,
      resolve,
      reject,
      count: 0n,
      pending: "",
    };
    const write = (bytes: Uint8Array) => {
      if (!bytes.length) return;
      if (state.status === "errored") throw state.reason;
      if (state.status === "closed") return;
      native.update(bytes);
      state.count += BigInt(bytes.length);
    };
    super({
      write(chunk) {
        if (typeof chunk === "string") {
          if (!wellFormed) return write(encodeWtf8(chunk));
          let text = state.pending + chunk;
          state.pending = "";
          const last = text.charCodeAt(text.length - 1);
          if (last >= 0xd800 && last <= 0xdbff) {
            state.pending = text.slice(-1);
            text = text.slice(0, -1);
          }
          return write(new TextEncoder().encode(text));
        }
        if (!isArrayBuffer(chunk) && !ArrayBuffer.isView(chunk))
          throw new TypeError(
            "DigestStream is a byte stream but received an object of non-ArrayBuffer/ArrayBufferView/string type on its writable side.",
          );
        let bytes: Uint8Array;
        try {
          bytes = isArrayBuffer(chunk)
            ? new Uint8Array(chunk)
            : viewBytes(chunk);
        } catch {
          return;
        } // Detached/out-of-bounds sources have zero extent in Workers.
        write(bytes);
      },
      close() {
        if (state.status === "errored") throw state.reason;
        if (state.status === "closed") return;
        if (state.pending) {
          write(new Uint8Array([0xef, 0xbf, 0xbd]));
          state.pending = "";
        }
        const result = Uint8Array.from(native.final()).buffer;
        native.dispose();
        state.status = "closed";
        state.resolve(result);
      },
      abort(reason) {
        fail(state, reason);
      },
    });
    this.#state = state;
  }
  get digest() {
    if (this == null || typeof this !== "object" || !(#state in this))
      throw new TypeError("Illegal invocation");
    return this.#state.promise;
  }
  get bytesWritten() {
    if (this == null || typeof this !== "object" || !(#state in this))
      throw new TypeError("Illegal invocation");
    return this.#state.count;
  }
  [dispose]() {
    if (this == null || typeof this !== "object" || !(#state in this))
      throw new TypeError("Illegal invocation");
    fail(this.#state, new TypeError("The DigestStream was disposed."));
  }
}
Object.defineProperties(DigestStream.prototype, {
  digest: { enumerable: true },
  bytesWritten: { enumerable: true },
  [Symbol.toStringTag]: { value: "DigestStream", configurable: true },
});
