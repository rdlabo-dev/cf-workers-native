import { expect, it } from "vitest";
import { Serializer } from "node:v8";
import { attachmentSize } from "./attachment-size.js";
function reference(value: unknown) {
  const serializer = new Serializer();
  serializer.writeHeader();
  serializer.writeValue(value);
  return serializer.releaseBuffer().byteLength;
}
it("counts format-15 tags, varints, UTF-16 alignment and references against the V8 serializer", () => {
  const shared = { x: 3 };
  const cyclic: Record<string, unknown> = { shared };
  cyclic.self = cyclic;
  const sparse = new Array(5);
  sparse[3] = "a";
  const error = new TypeError("problem", { cause: cyclic });
  error.stack = "stack";
  const buffer = new ArrayBuffer(256);
  const cases: unknown[] = [
    undefined,
    null,
    false,
    true,
    -0,
    0,
    -1,
    63,
    64,
    127,
    128,
    2147483647,
    -2147483648,
    2147483648,
    NaN,
    Infinity,
    1.5,
    0n,
    1n,
    -1n,
    2n ** 128n,
    "",
    "abc",
    "é",
    "あ",
    "😀",
    "\ud800",
    "a".repeat(127),
    "a".repeat(128),
    {},
    { a: 1, "3": "value" },
    [],
    [1, 2, 3],
    sparse,
    [shared, shared, cyclic],
    new Date(0),
    /a/gi,
    /あ/du,
    Object("あ"),
    Object(1),
    Object(true),
    Object(1n),
    new Map([[shared, cyclic]]),
    new Set([shared, cyclic]),
    buffer,
    new Uint8Array(buffer, 3, 4),
    new DataView(buffer, 7, 9),
    [new Uint8Array(buffer, 3, 4), buffer, new Uint16Array(buffer, 4, 3)],
  ];
  for (const value of cases)
    expect(attachmentSize(value), Object.prototype.toString.call(value)).toBe(
      reference(value),
    );
});
it("uses the same canonical size for dense values constructed with packed or holey storage", () => {
  const packed = [1, 2, 3],
    holey = new Array(3);
  for (let i = 0; i < 3; i++) holey[i] = i + 1;
  expect(attachmentSize(packed)).toBe(attachmentSize(holey));
  expect(attachmentSize([packed, "x".repeat(16363)])).toBe(16384);
  expect(attachmentSize("x".repeat(16379))).toBe(16384);
  expect(attachmentSize(new ArrayBuffer(16379))).toBe(16384);
});

import { Blob } from "../../compat/buffer/blob.js";
import { Headers } from "../headers/index.js";
import { Request } from "../request/index.js";
import { Response } from "../response/index.js";
it("counts Workers host-object payloads against the pinned workerd observations", () => {
  const error = new Error("hello");
  error.stack = "stack";
  const dom = new DOMException("hello", "AbortError");
  dom.stack = "stack";
  const cases: [unknown, number][] = [
    [new Blob(["abc"]), 16412],
    [new Headers({ "x-test": "abc", "content-type": "a" }), 16424],
    [new Request("https://a/"), 16526],
    [new Response(null), 16476],
    [dom, 16430],
    [error, 16432],
    [Object(1n), 16415],
    [new Uint8Array([1, 2]), 16414],
    [undefined, 16406],
    [new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)), 16405],
    [new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }), 16414],
  ];
  for (const [v, bytes] of cases)
    expect(
      attachmentSize({ v, padding: "x".repeat(16384) }),
      Object.prototype.toString.call(v),
    ).toBe(bytes);
});
