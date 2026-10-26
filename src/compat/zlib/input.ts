import {
  viewBytes,
  isAnyBuffer,
  bufferBytes,
} from "../../shared/buffer-source.js";

const resizable = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const growable =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "growable")
        ?.get;
/** JSG snapshots resizable backing stores but retains fixed stores through option conversion. */
export function codecBytes(
  value: ArrayBufferLike | ArrayBufferView,
): Uint8Array {
  const view = ArrayBuffer.isView(value)
    ? viewBytes(value)
    : bufferBytes(value);
  if (resizable) {
    try {
      if (resizable.call(view.buffer)) return view.slice();
    } catch {
      /* SharedArrayBuffer */
    }
  }
  if (growable) {
    try {
      if (growable.call(view.buffer)) return view.slice();
    } catch {
      /* ArrayBuffer */
    }
  }
  return view;
}
export function assertCodecInput(value: Uint8Array | undefined): void {
  if (!value) return;
  try {
    new Uint8Array(value.buffer, 0, 0);
  } catch {
    throw new TypeError("Codec input was detached during option conversion");
  }
}

export function bindingInput(
  value: unknown,
  context: string,
  parameter = 2,
): Uint8Array {
  if (ArrayBuffer.isView(value)) return viewBytes(value);
  if (isAnyBuffer(value)) return bufferBytes(value);
  throw new TypeError(
    `Failed to execute 'writeSync' on '${context}>': parameter ${parameter} is not of type 'BufferSource'.`,
  );
}
export function nativeNumber(value: any): number {
  const object = (item: any) =>
    item !== null && (typeof item === "object" || typeof item === "function");
  if (object(value)) {
    const exotic = value[Symbol.toPrimitive];
    if (exotic != null) {
      value = Reflect.apply(exotic, value, ["number"]);
      if (object(value))
        throw new TypeError("Cannot convert object to primitive value");
    } else {
      const original = value;
      for (const name of ["valueOf", "toString"]) {
        const method = original[name];
        if (typeof method !== "function") continue;
        value = Reflect.apply(method, original, []);
        if (!object(value)) break;
      }
      if (object(value))
        throw new TypeError("Cannot convert object to primitive value");
    }
  }
  if (typeof value === "bigint")
    throw new TypeError("Cannot convert a BigInt value to a number");
  if (typeof value === "symbol")
    throw new TypeError("Cannot convert a Symbol value to a number");
  return Number(value);
}
export function nativeInt32(value: unknown): number {
  const number = nativeNumber(value);
  // JSG signed integers use V8 Int32Value for non-finite values.
  if (!Number.isFinite(number)) return 0;
  if (number < -2147483648 || number > 2147483647)
    throw new TypeError(
      "Value out of range. Must be between -2147483648 and 2147483647 (inclusive).",
    );
  return Math.trunc(number);
}
export function optionInteger(
  value: unknown,
  fallback: number,
  unsigned = true,
): number {
  return value === undefined
    ? fallback
    : unsigned
      ? nativeUint32(value)
      : nativeInt32(value);
}
export function nativeUint32(value: unknown): number {
  const number = nativeNumber(value);
  if (!Number.isFinite(number))
    throw new TypeError(
      "The value cannot be converted because it is not an integer.",
    );
  if (number < 0)
    throw new TypeError(
      "The value cannot be converted because it is negative and this API expects a positive number.",
    );
  if (number > 4294967295)
    throw new TypeError(
      "Value out of range. Must be less than or equal to 4294967295.",
    );
  return Math.trunc(number);
}
export function bindingBuffers(
  context: string,
  input: unknown,
  inputOffset: number,
  inputLength: number,
  output: unknown,
  outputOffset: number,
  outputLength: number,
) {
  const source =
    input === undefined ? new Uint8Array(0) : bindingInput(input, context);
  inputOffset = nativeUint32(inputOffset);
  inputLength = nativeUint32(inputLength);
  const target = bindingInput(output, context, 5);
  outputOffset = nativeUint32(outputOffset);
  outputLength = nativeUint32(outputLength);
  if (input === undefined) inputOffset = inputLength = 0;
  if (
    inputOffset + inputLength > 4294967295 ||
    inputOffset > source.byteLength ||
    inputLength > source.byteLength - inputOffset
  )
    throw new Error("Input access is not within bounds");
  if (
    outputOffset + outputLength > 4294967295 ||
    outputOffset > target.byteLength ||
    outputLength > target.byteLength - outputOffset
  )
    throw new Error("Output access is not within bounds");
  // Emscripten's wasm32 malloc must not receive a wrapped allocation length.
  if (Math.max(1, inputLength) + outputLength + 8 > 0x7fffffff)
    throw new RangeError("Memory limit exceeded");
  return {
    source,
    target,
    inputOffset,
    inputLength,
    outputOffset,
    outputLength,
  };
}
