import {
  bufferBytes,
  viewBytes,
  isAnyBuffer,
} from "../../shared/buffer-source.js";
import { Buffer } from "node:buffer";
import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../net/errors.js";
export function validateInteger(
  value: unknown,
  name: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): asserts value is number {
  if (typeof value !== "number")
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  if (!Number.isInteger(value))
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  if (value < min || value > max)
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
}
export function bytes(value: unknown, name: string): Buffer {
  if (typeof value === "string") return Buffer.from(value);
  if (isAnyBuffer(value)) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(viewBytes(value));
  throw new ERR_INVALID_ARG_TYPE(
    name,
    ["string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"],
    value,
  );
}

// Native Workers crypto entry points use signed 32-bit buffer lengths.
export function validateCryptoLength(length: number, message: string): void {
  if (length > 0x7fffffff) throw new RangeError(message);
}

export { viewBytes, isAnyBuffer } from "../../shared/buffer-source.js";

// Preserve observable frontend properties until the native boundary.
export function arrayBufferOrView(
  value: unknown,
  name: string,
  expected = ["string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"],
): ArrayBuffer | ArrayBufferView {
  if (typeof value === "string") return Buffer.from(value);
  if (isAnyBuffer(value) || ArrayBuffer.isView(value)) return value;
  throw new ERR_INVALID_ARG_TYPE(name, expected, value);
}
const arrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!;
export function inputBytes(
  value: ArrayBuffer | ArrayBufferView,
  method: string,
  parameter: number,
): Uint8Array {
  if (ArrayBuffer.isView(value)) return viewBytes(value);
  try {
    arrayBufferLength.call(value);
  } catch {
    throw new TypeError(
      `Failed to execute '${method}' on 'CryptoImpl': parameter ${parameter} is not of type 'BufferSource'.`,
    );
  }
  return bufferBytes(value as ArrayBuffer);
}
