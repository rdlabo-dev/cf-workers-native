import { installDigest } from "./subtle-digest.js";
import { installResourceSymbols } from "../../shared/globals/symbols.js";
import { viewBytes } from "./validation.js";
import { DigestStream } from "./digest-stream.js";
import { nativeTimingEqual } from "./native-crypto.js";
import { Buffer } from "node:buffer";

type WorkersSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(
    left: ArrayBuffer | ArrayBufferView,
    right: ArrayBuffer | ArrayBufferView,
  ): boolean;
};
type WorkersCrypto = Crypto & {
  DigestStream: typeof DigestStream;
  subtle: WorkersSubtleCrypto;
};
installResourceSymbols(globalThis.Symbol);
export const webcrypto = globalThis.crypto as WorkersCrypto;
export const subtle = webcrypto.subtle;
installDigest(subtle);
function source(value: ArrayBuffer | ArrayBufferView, parameter: number) {
  if (ArrayBuffer.isView(value)) return viewBytes(value);
  try {
    Object.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      "byteLength",
    )!.get!.call(value);
    try {
      return Buffer.from(value as ArrayBuffer);
    } catch {
      return new Uint8Array(0);
    }
  } catch {
    throw new TypeError(
      `Failed to execute 'timingSafeEqual' on 'SubtleCrypto': parameter ${parameter} is not of type 'BufferSource'.`,
    );
  }
}
function timingSafeEqual(
  this: SubtleCrypto,
  left: ArrayBuffer | ArrayBufferView,
  right: ArrayBuffer | ArrayBufferView,
) {
  if (this !== subtle)
    throw new TypeError(
      "Illegal invocation: function called with incorrect `this` reference. See https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors for details.",
    );
  const a = source(left, 1),
    b = source(right, 2);
  if (a.byteLength !== b.byteLength)
    throw new TypeError("Input buffers must have the same byte length.");
  return nativeTimingEqual(a, b);
}
// Preserve host Crypto/SubtleCrypto identity. Digest uses the Workers registry;
// other standard operations retain their host implementation.
// These Workers extensions use the owned digest and comparison backend.
if (!("DigestStream" in webcrypto))
  Object.defineProperty(Object.getPrototypeOf(webcrypto), "DigestStream", {
    value: DigestStream,
    writable: true,
    enumerable: true,
    configurable: true,
  });
if (!("timingSafeEqual" in subtle))
  Object.defineProperty(Object.getPrototypeOf(subtle), "timingSafeEqual", {
    value: timingSafeEqual,
    writable: true,
    enumerable: true,
    configurable: true,
  });
