import { test, expect, expectTypeOf } from "vitest";
// @ts-expect-error Pinned upstream JavaScript fixture.
import * as fixtures from "./upstream-random.fixture.mjs";
for (const [name, fixture] of Object.entries(fixtures))
  test("pinned Workers random: " + name, () =>
    (fixture as { test: () => unknown }).test(),
  );

import { Buffer } from "node:buffer";
import crypto, {
  randomBytes,
  randomFill,
  randomFillSync,
  pseudoRandomBytes,
} from "./index.js";
test("random API declarations retain result and input brands", () => {
  expectTypeOf(randomBytes(0)).toEqualTypeOf<Buffer>();
  expect(randomBytes(0).toString("hex")).toBe("");
  expectTypeOf(randomFillSync(new Int32Array(0))).toEqualTypeOf<
    Int32Array<ArrayBuffer>
  >();
  expectTypeOf(
    randomFillSync(new DataView(new ArrayBuffer(0))),
  ).toEqualTypeOf<Uint8Array>();
  expectTypeOf(randomFillSync(new ArrayBuffer(0))).toEqualTypeOf<Buffer>();
  expectTypeOf(
    randomFillSync(new SharedArrayBuffer(0)),
  ).toEqualTypeOf<Buffer>();
  randomFill(new ArrayBuffer(0), (_error, buffer) => {
    expectTypeOf(buffer).toEqualTypeOf<ArrayBuffer | undefined>();
  });
  randomFill(new Uint16Array(0), 0, 0, (_error, buffer) => {
    expectTypeOf(buffer).toEqualTypeOf<Uint16Array<ArrayBuffer> | undefined>();
  });
  expect(pseudoRandomBytes).toBe(randomBytes);
  expect(crypto.pseudoRandomBytes).toBe(randomBytes);
});

// Declaration-only invalid calls must be rejected without executing them.
function invalidRandomFillCalls() {
  // @ts-expect-error A callback is required.
  randomFill(new Uint8Array(0));
  // @ts-expect-error A callback is required after offset.
  randomFill(new Uint8Array(0), 0);
  // @ts-expect-error A callback is required after size.
  randomFill(new Uint8Array(0), 0, 0);
}
void invalidRandomFillCalls;
