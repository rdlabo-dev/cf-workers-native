import { expect, expectTypeOf, test } from "vitest";
import { Buffer } from "node:buffer";
import {
  createSign,
  createVerify,
  sign,
  verify,
  generateKeyPairSync,
} from "./index.js";

test("signature public types preserve binary and encoded results", () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const data = new Uint8Array([1, 2]);
  const signature = createSign("sha256")
    .update(data)
    .sign(pair.privateKey, "buffer");
  expectTypeOf(signature).toEqualTypeOf<Buffer>();
  expectTypeOf(
    createSign("sha256").update(data).sign(pair.privateKey, "hex"),
  ).toEqualTypeOf<string>();
  expect(
    createVerify("sha256").update(data).verify(pair.publicKey, signature),
  ).toBe(true);
  expectTypeOf(sign("sha256", data, pair.privateKey)).toEqualTypeOf<Buffer>();
  expectTypeOf(
    verify("sha256", data, pair.publicKey, signature),
  ).toEqualTypeOf<boolean>();
  const invalid = () => {
    // @ts-expect-error Workers requires an ArrayBufferView for one-shot data.
    sign("sha256", new ArrayBuffer(1), pair.privateKey);
    // @ts-expect-error One-shot signatures cannot be encoded strings.
    verify("sha256", data, pair.publicKey, "abc");
  };
  void invalid;
});
