import { expect, test } from "vitest";
import { bindingBuffers, nativeNumber } from "./input.js";

test("codec input bounds reject lengths larger than the intrinsic view", () => {
  const input = new Uint8Array([65]);
  Object.defineProperty(input, "byteLength", { value: 32 });
  expect(() =>
    bindingBuffers("ZlibContext", input, 0, 32, new Uint8Array(64), 0, 64),
  ).toThrow("Input access is not within bounds");
  expect(
    bindingBuffers("ZlibContext", input, 0, 0, new Uint8Array(64), 0, 64)
      .inputLength,
  ).toBe(0);
});

test("codec bounds cover output extents and uint32 addition overflow", () => {
  const input = new Uint8Array(1),
    output = new Uint8Array(1);
  Object.defineProperty(output, "byteLength", { value: 64 });
  expect(() =>
    bindingBuffers("ZlibContext", input, 0, 1, output, 0, 64),
  ).toThrow("Output access is not within bounds");
  expect(() =>
    bindingBuffers("ZlibContext", input, 4294967295, 1, output, 0, 1),
  ).toThrow("Input access is not within bounds");
  expect(() =>
    bindingBuffers("ZlibContext", input, 0, 1, output, 4294967295, 1),
  ).toThrow("Output access is not within bounds");
});

test("codec buffer conversion validates brands before accessing native memory", () => {
  const output = new Uint8Array(1);
  expect(() => bindingBuffers("ZlibContext", {}, 0, 1, output, 0, 1)).toThrow(
    TypeError,
  );
  expect(() => bindingBuffers("ZlibContext", output, 0, 1, {}, 0, 1)).toThrow(
    TypeError,
  );
  for (const length of [-1, NaN, Infinity, 4294967296])
    expect(() =>
      bindingBuffers("ZlibContext", output, 0, length, output, 0, 1),
    ).toThrow(TypeError);
});

test("native numeric conversion rejects BigInt without repeated coercion", () => {
  let reads = 0;
  const object = {
    valueOf() {
      reads++;
      return 0n;
    },
  };
  for (const value of [
    0n,
    object,
    {
      [Symbol.toPrimitive]() {
        return 0n;
      },
    },
  ])
    expect(() => nativeNumber(value)).toThrow(
      "Cannot convert a BigInt value to a number",
    );
  expect(reads).toBe(1);
  expect(() => nativeNumber(Symbol())).toThrow(
    "Cannot convert a Symbol value to a number",
  );
  expect(
    nativeNumber({
      valueOf() {
        return "1.5";
      },
    }),
  ).toBe(1.5);
});

// Empty buffers must be distinguished from detached buffers, even when their
// byteLength is identical. RAB snapshots and fixed aliases have different lives.
import { codecBytes, assertCodecInput } from "./input.js";
const ResizableBuffer = ArrayBuffer as unknown as new (
  length: number,
  options?: { maxByteLength: number },
) => ArrayBuffer & { resize(size: number): void };
const GrowableBuffer = SharedArrayBuffer as unknown as new (
  length: number,
  options?: { maxByteLength: number },
) => SharedArrayBuffer & { grow(size: number): void };
test("codec input retention distinguishes empty and detached fixed buffers", () => {
  for (const length of [0, 3]) {
    const buffer = new ArrayBuffer(length);
    const captured = codecBytes(buffer);
    expect(() => assertCodecInput(captured)).not.toThrow();
    structuredClone(buffer, { transfer: [buffer] });
    expect(() => assertCodecInput(captured)).toThrow(
      "Codec input was detached during option conversion",
    );
    // Already detached at entry is the Workers empty-input conversion.
    expect(() => assertCodecInput(codecBytes(buffer))).not.toThrow();
  }
});
test("codec conversion snapshots resizable memory and retains fixed input mutations", () => {
  for (const resizable of [false, true]) {
    const buffer = resizable
      ? new ResizableBuffer(3, { maxByteLength: 6 })
      : new ResizableBuffer(3);
    const view = new Uint8Array(buffer);
    view.set([97, 98, 99]);
    const captured = codecBytes(view);
    view[0] = 120;
    expect(Array.from(captured)).toEqual(
      resizable ? [97, 98, 99] : [120, 98, 99],
    );
    if (resizable) {
      buffer.resize(0);
      structuredClone(buffer, { transfer: [buffer] });
      expect(() => assertCodecInput(captured)).not.toThrow();
      expect(Array.from(captured)).toEqual([97, 98, 99]);
    }
  }
});

test("codec conversion snapshots growable shared memory but retains fixed shared mutations", () => {
  for (const growable of [false, true]) {
    const buffer = growable
      ? new GrowableBuffer(3, { maxByteLength: 6 })
      : new GrowableBuffer(3);
    const view = new Uint8Array(buffer);
    view.set([97, 98, 99]);
    const captured = codecBytes(view);
    view[0] = 120;
    expect(Array.from(captured)).toEqual(
      growable ? [97, 98, 99] : [120, 98, 99],
    );
    if (growable) buffer.grow(6);
    expect(() => assertCodecInput(captured)).not.toThrow();
  }
});
