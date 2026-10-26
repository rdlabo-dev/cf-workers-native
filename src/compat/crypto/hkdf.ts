import { KeyObject } from "./keys.js";
import { createHmac } from "./hash.js";
import { aliases } from "./hash-handle.js";
// RFC 5869 extract-and-expand, using the existing HMAC implementation.
import { Buffer } from "node:buffer";
import {
  arrayBufferOrView,
  inputBytes,
  validateInteger,
  validateCryptoLength,
} from "./validation.js";
import { validateString, validateFunction } from "../net/validators.js";
import { ERR_OUT_OF_RANGE } from "../net/errors.js";
function parameters(
  digest: string,
  key: unknown,
  salt: unknown,
  info: unknown,
  length: number,
) {
  if (key instanceof KeyObject) key = key.export();
  validateString(digest, "digest");
  const ikm = arrayBufferOrView(key, "ikm", [
      "string",
      "SecretKeyObject",
      "ArrayBuffer",
      "TypedArray",
      "DataView",
      "Buffer",
    ]),
    s = arrayBufferOrView(salt, "salt", [
      "string",
      "ArrayBuffer",
      "TypedArray",
      "DataView",
      "Buffer",
    ]),
    i = arrayBufferOrView(info, "info", [
      "string",
      "ArrayBuffer",
      "TypedArray",
      "DataView",
      "Buffer",
    ]);
  validateInteger(length, "length", 0, 2147483647);
  if (i.byteLength > 1024)
    throw new ERR_OUT_OF_RANGE(
      "info",
      "must not contain more than 1024 bytes",
      i.byteLength,
    );
  return { digest, ikm, s, i, length };
}
function derive({
  digest,
  ikm,
  s,
  i,
  length,
}: ReturnType<typeof parameters>): ArrayBuffer {
  const keyBytes = inputBytes(ikm, "getHkdf", 2),
    saltBytes = inputBytes(s, "getHkdf", 3),
    infoBytes = inputBytes(i, "getHkdf", 4);
  if (!aliases[digest.split("\0")[0]!.toLowerCase()])
    throw new TypeError("Invalid Hkdf digest: " + digest);
  validateCryptoLength(infoBytes.byteLength, "Hkdf failed: info is too large");
  validateCryptoLength(saltBytes.byteLength, "Hkdf failed: salt is too large");
  validateCryptoLength(keyBytes.byteLength, "Hkdf failed: key is too large");
  const prk = createHmac(digest, saltBytes).update(keyBytes).digest();

  let previous: Buffer = Buffer.alloc(0);
  try {
    if (length > 255 * prk.length)
      throw new RangeError("Invalid Hkdf key length");
    const output = Buffer.alloc(length);
    for (let offset = 0, counter = 1; offset < length; counter++) {
      const next = createHmac(digest, prk)
        .update(previous)
        .update(infoBytes)
        .update(Buffer.from([counter]))
        .digest();
      previous.fill(0);
      previous = next;
      const size = Math.min(previous.length, length - offset);
      output.set(previous.subarray(0, size), offset);
      offset += size;
    }
    return new Uint8Array(output).buffer;
  } finally {
    prk.fill(0);
    previous.fill(0);
  }
}
export function hkdfSync(
  digest: string,
  key: unknown,
  salt: unknown,
  info: unknown,
  length: number,
) {
  return derive(parameters(digest, key, salt, info, length));
}
export function hkdf(
  digest: string,
  key: unknown,
  salt: unknown,
  info: unknown,
  length: number,
  callback: (error: unknown, value?: ArrayBuffer) => void,
) {
  const args = parameters(digest, key, salt, info, length);
  validateFunction(callback, "callback");
  const result = new Promise<ArrayBuffer>((resolve) => resolve(derive(args)));
  result.then(
    (value) => callback(null, value),
    (error) => callback(error),
  );
}
