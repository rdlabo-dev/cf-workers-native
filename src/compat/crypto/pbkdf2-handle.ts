import { inputBytes, validateCryptoLength } from "./validation.js";
import { nativePbkdf2 } from "./native-crypto.js";
import { aliases } from "./hash-handle.js";
const sizes: Record<string, number> = {
  md4: 16,
  md5: 16,
  sha1: 20,
  sha224: 28,
  sha256: 32,
  sha384: 48,
  sha512: 64,
  "md5-sha1": 36,
};
export default {
  getPbkdf(
    password: ArrayBuffer | ArrayBufferView,
    salt: ArrayBuffer | ArrayBufferView,
    iterations: number,
    length: number,
    digest: string,
  ) {
    const passwordBytes = inputBytes(password, "getPbkdf", 1),
      saltBytes = inputBytes(salt, "getPbkdf", 2);
    const normalized = aliases[digest.split("\0")[0]!.toLowerCase()];
    if (!normalized)
      throw new TypeError("Invalid Pbkdf2 digest: " + digest + ".");
    validateCryptoLength(
      passwordBytes.byteLength,
      "Pbkdf2 failed: password is too large",
    );
    validateCryptoLength(
      saltBytes.byteLength,
      "Pbkdf2 failed: salt is too large",
    );
    if (length > 255 * sizes[normalized])
      throw new RangeError(
        "Pbkdf2 failed: derived key length exceeds maximum for this hash",
      );
    return nativePbkdf2(
      passwordBytes,
      saltBytes,
      iterations,
      length,
      normalized,
    );
  },
};
