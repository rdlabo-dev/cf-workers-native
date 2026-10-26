import { expect, test } from "vitest";
import { runInNewContext } from "node:vm";
import { bufferBytes, isAnyBuffer, viewBytes } from "./buffer-source.js";

test("intrinsic view access ignores shadow properties and preserves the subview", () => {
  for (const create of [
    (buffer: ArrayBuffer) => new Uint8Array(buffer, 1, 1),
    (buffer: ArrayBuffer) => new DataView(buffer, 1, 1),
  ]) {
    const bytes = new Uint8Array([8, 1, 9]);
    const view = create(bytes.buffer);
    for (const name of ["buffer", "byteOffset", "byteLength"])
      Object.defineProperty(view, name, {
        get() {
          throw new Error("shadowed " + name);
        },
      });
    const actual = viewBytes(view);
    expect(Array.from(actual)).toEqual([1]);
    actual[0] = 2;
    expect(Array.from(bytes)).toEqual([8, 2, 9]);
  }
});

test("detached buffers and views have zero intrinsic extent", () => {
  const buffer = new ArrayBuffer(3),
    typed = new Uint8Array(buffer),
    data = new DataView(buffer);
  structuredClone(buffer, { transfer: [buffer] });
  expect(bufferBytes(buffer).length).toBe(0);
  expect(viewBytes(typed).length).toBe(0);
  expect(viewBytes(data).length).toBe(0);
});

test("cross-realm and shared backing use intrinsic brands", () => {
  const view = runInNewContext("new Uint8Array([1,2])") as Uint8Array;
  expect(isAnyBuffer(view.buffer)).toBe(true);
  expect(Array.from(viewBytes(view))).toEqual([1, 2]);
  const shared = new SharedArrayBuffer(1);
  expect(isAnyBuffer(shared)).toBe(true);
  bufferBytes(shared)[0] = 3;
  expect(viewBytes(new DataView(shared))[0]).toBe(3);
  expect(isAnyBuffer({ [Symbol.toStringTag]: "ArrayBuffer" })).toBe(false);
});
