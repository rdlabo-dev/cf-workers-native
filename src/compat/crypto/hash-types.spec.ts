import { expect, test } from "vitest";
import { Hash, Hmac, createHash, createHmac } from "./hash.js";
import { pbkdf2Sync } from "./pbkdf2.js";
import { Buffer } from "node:buffer";

test("digest and KDF declarations describe ordinary public API usage", () => {
  const callableHash: Hash = Hash("sha256");
  const callableHmac: Hmac = Hmac("sha1", "key");
  const hash: string = callableHash.update("abc").digest("hex");
  const hmac: string = callableHmac.update("data").digest("hex");
  const binary: Buffer = createHash("sha256").update("abc").digest();
  const explicitBinary: Buffer = createHmac("sha1", "key")
    .update("data")
    .digest("buffer");
  const key: Buffer = pbkdf2Sync(
    new Uint8Array([1]),
    new ArrayBuffer(1),
    1,
    8,
    "sha256",
  );
  const constructorHash: string = new Hash("sha256")
    .update("abc")
    .copy()
    .digest("hex");
  const constructorHmac: string = new Hmac("sha1", "key")
    .update("data")
    .digest("hex");

  // This closure is never executed: the declaration must reject a method that
  // the Hmac prototype does not expose, without invoking it at runtime.
  const invalidHmacCopy = () => {
    // @ts-expect-error Hmac has no copy method.
    return callableHmac.copy();
  };
  void invalidHmacCopy;

  expect(hash).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(hmac).toBe("104152c5bfdca07bc633eebd46199f0255c9f49d");
  expect(binary.toString("hex")).toBe(hash);
  expect(explicitBinary.toString("hex")).toBe(hmac);
  expect(constructorHash).toBe(hash);
  expect(constructorHmac).toBe(hmac);
  expect(key.length).toBe(8);
});
