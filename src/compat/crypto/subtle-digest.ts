import { NativeDigest } from "./native-crypto.js";
import { dictionaryString } from "./key-formats.js";
import { bufferBytes, viewBytes } from "../../shared/buffer-source.js";

const bufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!;
function isBuffer(value: unknown): value is ArrayBuffer {
  try {
    bufferLength.call(value);
    return true;
  } catch {
    return false;
  }
}
const names: Record<string, string> = Object.assign(Object.create(null), {
  "sha-1": "sha1",
  "sha-256": "sha256",
  "sha-384": "sha384",
  "sha-512": "sha512",
  md5: "md5",
});
export function installDigest(subtle: SubtleCrypto): void {
  const digest = {
    digest(
      this: SubtleCrypto,
      algorithm: AlgorithmIdentifier,
      data: BufferSource,
    ): Promise<ArrayBuffer> {
      if (this !== subtle)
        throw new TypeError(
          "Illegal invocation: function called with incorrect `this` reference. See https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors for details.",
        );
      return (async () => {
        if (algorithm == null)
          throw new TypeError(
            "Cannot initialize N7workerd3api12SubtleCrypto13HashAlgorithmE with required members from an undefined or null value.",
          );
        const name = dictionaryString(
          typeof algorithm === "object" || typeof algorithm === "function"
            ? algorithm.name
            : algorithm,
        );
        if (!isBuffer(data) && !ArrayBuffer.isView(data))
          throw new TypeError(
            "Failed to execute 'digest' on 'SubtleCrypto': parameter 2 is not of type 'BufferSource'.",
          );
        const bytes = isBuffer(data) ? bufferBytes(data) : viewBytes(data);
        const normalized = names[name.split("\0")[0]!.toLowerCase()];
        if (!normalized)
          throw new DOMException(
            "Unrecognized or unimplemented digest algorithm requested.",
            "NotSupportedError",
          );
        const handle = new NativeDigest(normalized);
        try {
          handle.update(bytes);
          return handle.final().buffer as ArrayBuffer;
        } finally {
          handle.dispose();
        }
      })();
    },
  }.digest;
  Object.defineProperty(digest, "length", { value: 0 });
  Object.defineProperty(Object.getPrototypeOf(subtle), "digest", {
    value: digest,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
