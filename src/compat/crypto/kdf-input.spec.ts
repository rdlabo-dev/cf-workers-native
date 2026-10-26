import { expect, test } from "vitest";
import * as crypto from "./index.js";

test("KDF native boundaries reject bare shared buffers and accept shared views", async () => {
  const shared = new SharedArrayBuffer(3);
  new Uint8Array(shared).set([9, 1, 8]);
  const sharedView = new Uint8Array(shared, 1, 1);
  for (const [method, base, fields, native] of [
    [
      "hkdf",
      [
        "sha256",
        new Uint8Array([1]),
        new Uint8Array([1]),
        new Uint8Array([1]),
        8,
      ],
      [1, 2, 3],
      "getHkdf",
    ],
    [
      "scrypt",
      [new Uint8Array([1]), new Uint8Array([1]), 8, { N: 16, r: 1, p: 1 }],
      [0, 1],
      "getScrypt",
    ],
    [
      "pbkdf2",
      [new Uint8Array([1]), new Uint8Array([1]), 2, 8, "sha256"],
      [0, 1],
      "getPbkdf",
    ],
  ] as const) {
    const sync = (crypto as any)[method + "Sync"],
      callback = (crypto as any)[method];
    const bytes = (value: ArrayBuffer | Uint8Array) =>
      Array.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    const expected = bytes(sync(...base));
    for (const field of fields) {
      const args: unknown[] = [...base];
      args[field] = sharedView;
      expect(bytes(sync(...args))).toEqual(expected);
      args[field] = shared;
      const message = `Failed to execute '${native}' on 'CryptoImpl': parameter ${field + 1} is not of type 'BufferSource'.`;
      expect(() => sync(...args)).toThrow(message);
      let returned = false;
      const error = await new Promise<Error>((resolve) => {
        callback(...args, (error: Error) => {
          expect(returned).toBe(true);
          resolve(error);
        });
        returned = true;
      });
      expect(error.message).toBe(message);
    }
  }
});
