import { test, expect } from "vitest";
import { generateKeyPairSync } from "./asymmetric.js";
// @ts-expect-error Upstream JavaScript fixture.
import * as scrypt from "./upstream-scrypt.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture.
import * as limits from "./upstream-scrypt-limits.fixture.mjs";
for (const [name, fixture] of Object.entries({ ...scrypt, ...limits }))
  test("pinned Workers scrypt: " + name, () =>
    (fixture as { test: () => unknown }).test(),
  );
test("RSA rejects excessive modulus size before key generation", () => {
  expect(() => generateKeyPairSync("rsa", { modulusLength: 16385 })).toThrow(
    new RangeError("RSA modulusLength exceeds maximum (16384)"),
  );
});

// @ts-expect-error Upstream JavaScript fixture.
import * as generation from "./upstream-keygen.fixture.mjs";
for (const [name, fixture] of Object.entries(generation))
  test("pinned Workers key generation: " + name, () =>
    (fixture as { test: () => unknown }).test(),
  );

test("RSA generation errors follow Workers stages", () => {
  for (const modulusLength of [0, 1, 16, 255])
    expect(() => generateKeyPairSync("rsa", { modulusLength })).toThrow(
      new Error("Failed to set modulus length"),
    );
  for (const modulusLength of [256, 511])
    expect(() => generateKeyPairSync("rsa", { modulusLength })).toThrow(
      new Error("Failed to generate key"),
    );
  for (const publicExponent of [0, 1, 2, 4])
    expect(() =>
      generateKeyPairSync("rsa", { modulusLength: 512, publicExponent }),
    ).toThrow(new Error("Failed to generate key"));
});
test("DH generation accepts Workers small primes", () => {
  for (const p of [5, 23, 37, 255]) {
    const pair = generateKeyPairSync("dh", {
      prime: new Uint8Array([p]),
      generator: 2,
    });
    expect(pair.publicKey.asymmetricKeyType).toBe("dh");
    expect(() =>
      pair.privateKey.export({ type: "pkcs8", format: "der" }),
    ).toThrow(new Error("Failed to export key"));
  }
});
test("EC SEC1 parameter flags match Workers", () => {
  for (const [paramEncoding, length] of [
    ["named", 109],
    ["explicit", 121],
  ]) {
    const pair = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      paramEncoding,
    });
    expect(pair.privateKey.export({ type: "sec1", format: "der" }).length).toBe(
      length,
    );
  }
});
