import { test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
// @ts-expect-error Vendored upstream JavaScript fixture.
import * as cases from "./upstream-cipher.fixture.mjs";
const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const env = {
  "rsa_public.pem": keys.publicKey,
  "rsa_private.pem": keys.privateKey,
};
for (const [name, fixture] of Object.entries(cases))
  test("pinned Workers cipher: " + name, () =>
    (
      fixture as {
        test: (controller: unknown, bindings: typeof env) => unknown;
      }
    ).test(null, env),
  );

import { expect } from "vitest";
import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  Cipheriv,
  Decipheriv,
} from "./symmetric.js";
test("cipher declarations support authentication options and encoded output", () => {
  const key = new Uint8Array(16),
    iv = new Uint8Array(16);
  const cipher = createCipheriv("aes-128-eax", key, iv, { authLengthTag: 16 });
  const encrypted: Buffer = cipher.update("hello", "utf8");
  const last: Buffer = cipher.final();
  const tag: Buffer = cipher.getAuthTag();
  const decipher = createDecipheriv("aes-128-eax", key, iv, {
    authLengthTag: 16,
  });
  decipher.setAuthTag(tag);
  const invalidTag = () => {
    // @ts-expect-error Workers accepts only BufferSource tags, even with encoding.
    decipher.setAuthTag("00", "hex");
  };
  void invalidTag;
  const plain: string = decipher.update(encrypted, undefined, "utf8");
  const end: string = decipher.final("utf8");
  expect(plain + end).toBe("hello");
  expect(last.length).toBe(0);
  const ctor = new Cipheriv("aes-128-eax", key, iv, { authLengthTag: 16 });
  const dec = new Decipheriv("aes-128-eax", key, iv, { authLengthTag: 16 });
  ctor.final();
  dec.final();
});
