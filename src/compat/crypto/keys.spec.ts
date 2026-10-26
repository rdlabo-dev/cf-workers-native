import { expect, test } from "vitest";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
} from "./index.js";

test("JWK conversion reads unused dictionary members once before parsing", () => {
  let reads = 0;
  const key = createPublicKey({
    key: {
      kty: new String("RSA"),
      get n() {
        return ++reads === 1 ? "AQ" : "@@";
      },
      e: "AQAB",
    },
  });
  expect(reads).toBe(1);
  expect(key.export({ format: "jwk" })).toEqual({
    kty: "RSA",
    n: "AQ",
    e: "AQAB",
  });
  const failure = new Error("unused d");
  expect(() =>
    createPublicKey({
      key: {
        kty: "RSA",
        n: "AQ",
        e: "AQAB",
        get d() {
          throw failure;
        },
      },
    }),
  ).toThrow(failure);
  for (const name of ["key_ops", "oth"]) {
    const array = [null];
    Object.defineProperty(array, 0, {
      get() {
        Object.defineProperty(array, 1, {
          get() {
            throw new Error("added item");
          },
        });
        return name === "key_ops" ? "sign" : {};
      },
    });
    expect(
      createPublicKey({
        key: { kty: "RSA", n: "AQ", e: "AQAB", [name]: array },
      }).type,
    ).toBe("public");
  }
});

test("EC private scalars use the Workers range without requiring point consistency", () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = privateKey.export({ format: "jwk" });
  for (const d of ["", "AA", "_".repeat(43)])
    expect(() => createPrivateKey({ key: { ...jwk, d } })).toThrow(
      "EW JWK invalid private key",
    );
  expect(
    createPrivateKey({ key: { ...jwk, d: "AQ" } }).export({ format: "jwk" }).d,
  ).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE");
});

test("DER decoding respects the selected encoding", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 512 });
  const key = privateKey.export({ format: "der", type: "pkcs8" });
  expect(
    createPrivateKey({ key, format: "der", type: "pkcs8" }).equals(privateKey),
  ).toBe(true);
  expect(
    createPrivateKey({ key, format: "der", type: "pkcs1" }).equals(privateKey),
  ).toBe(true);
  const pkcs1 = privateKey.export({ format: "der", type: "pkcs1" });
  expect(() =>
    createPrivateKey({ key: pkcs1, format: "der", type: "pkcs8" }),
  ).toThrow("Failed to parse private key");
});

test("host key metadata is copied from intrinsic getters", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  Object.defineProperty(pair.publicKey, "algorithm", {
    value: { name: "fake" },
    configurable: true,
  });
  const key = KeyObject.from(pair.publicKey) as ReturnType<
    typeof createPublicKey
  >;
  const get = Object.getOwnPropertyDescriptor(
    CryptoKey.prototype,
    "algorithm",
  )!.get!;
  get.call(pair.publicKey).namedCurve = "fake";
  expect(key.asymmetricKeyType).toBe("ec");
  expect(key.asymmetricKeyDetails).toEqual({ namedCurve: "prime256v1" });
});

test("shared key buffers are decoded when the host provides shared memory", () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const data = new TextEncoder().encode(
    privateKey.export({ format: "pem", type: "pkcs8" }),
  );
  const shared = new SharedArrayBuffer(data.byteLength);
  new Uint8Array(shared).set(data);
  expect(createPrivateKey(shared).equals(privateKey)).toBe(true);
  expect(createPrivateKey({ key: shared }).equals(privateKey)).toBe(true);
});

test("FIPS reporting describes the owned backend capability", async () => {
  const crypto = await import("./index.js");
  expect(crypto.fips).toBe(false);
  expect(crypto.getFips()).toBe(false);
  expect(crypto.default.fips).toBe(false);
  expect(() => {
    crypto.default.fips = true;
  }).toThrow("The setFips method is not implemented");
});
