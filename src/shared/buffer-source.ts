// Intrinsic BufferSource access shared by owned API adapters.
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)!.get!;
const typedArrayOffset = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)!.get!;
const typedArrayLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)!.get!;
const dataViewBuffer = Object.getOwnPropertyDescriptor(
  DataView.prototype,
  "buffer",
)!.get!;
const dataViewOffset = Object.getOwnPropertyDescriptor(
  DataView.prototype,
  "byteOffset",
)!.get!;
const dataViewLength = Object.getOwnPropertyDescriptor(
  DataView.prototype,
  "byteLength",
)!.get!;
let sharedLength: ((this: unknown) => number) | undefined;
try {
  // WebViews can expose shared Wasm memory without a SharedArrayBuffer global.
  // Capture its intrinsic brand getter; do not install or emulate a constructor.
  const prototype =
    typeof SharedArrayBuffer === "function"
      ? SharedArrayBuffer.prototype
      : Object.getPrototypeOf(
          new WebAssembly.Memory({ initial: 0, maximum: 1, shared: true })
            .buffer,
        );
  sharedLength = Object.getOwnPropertyDescriptor(prototype, "byteLength")?.get;
} catch {
  /* This engine has no shared-memory support. */
}
export function isSharedBuffer(value: unknown): value is SharedArrayBuffer {
  if (!sharedLength) return false;
  try {
    sharedLength.call(value);
    return true;
  } catch {
    return false;
  }
}
/** Read the intrinsic view extent, ignoring shadowed user properties. */
export function viewBytes(value: ArrayBufferView): Uint8Array {
  let buffer: ArrayBufferLike;
  try {
    buffer = typedArrayBuffer.call(value);
  } catch {
    buffer = dataViewBuffer.call(value);
    try {
      return new Uint8Array(
        buffer,
        dataViewOffset.call(value),
        dataViewLength.call(value),
      );
    } catch {
      return new Uint8Array(0);
    }
  }
  try {
    return new Uint8Array(
      buffer,
      typedArrayOffset.call(value),
      typedArrayLength.call(value),
    );
  } catch {
    return new Uint8Array(0);
  }
}

export function isAnyBuffer(value: unknown): value is ArrayBuffer {
  try {
    Reflect.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      "byteLength",
    )!.get!.call(value);
    return true;
  } catch {}
  return isSharedBuffer(value);
}

export function bufferBytes(value: ArrayBufferLike): Uint8Array {
  try {
    return new Uint8Array(value);
  } catch {
    return new Uint8Array(0);
  }
}
