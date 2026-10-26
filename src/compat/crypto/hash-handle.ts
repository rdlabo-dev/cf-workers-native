import { bufferBytes, viewBytes } from "../../shared/buffer-source.js";
import { validateCryptoLength } from "./validation.js";
import { secretMaterial, KeyObject } from "./keys.js";
import { Buffer } from "node:buffer";
import { NativeDigest, NativeHmac } from "./native-crypto.js";
import { aliases } from "./digests.js";
export { hashNames, aliases } from "./digests.js";
class HashHandle {
  private hash: NativeDigest;
  private cached?: Buffer;
  constructor(algorithm: string | NativeDigest, length?: number) {
    if (algorithm instanceof NativeDigest) this.hash = algorithm;
    else {
      const normalized = aliases[algorithm.split("\0")[0]!.toLowerCase()];
      if (!normalized) throw new Error("Digest method not supported");
      this.hash = new NativeDigest(normalized, "Hash");
    }
    if (length !== undefined && length !== this.hash.size) {
      this.hash.dispose();
      throw new Error("invalid digest size");
    }
  }
  update(data: ArrayBufferView) {
    if (this.cached)
      throw new DOMException(
        "Hash context has already been finalized.",
        "OperationError",
      );
    const input = viewBytes(data);
    validateCryptoLength(input.byteLength, "data is too long");
    this.hash.update(input);
    return 1;
  }
  digest() {
    this.cached ??= Buffer.from(this.hash.final());
    return Buffer.from(this.cached);
  }
  copy(length?: number) {
    if (this.cached)
      throw new DOMException(
        "Hash context has already been finalized.",
        "OperationError",
      );
    return new HashHandle(this.hash.copy(), length);
  }
}
class HmacHandle {
  private hmac: NativeHmac;
  private cached?: Buffer;
  constructor(algorithm: string, key: any) {
    if (typeof CryptoKey !== "undefined" && key instanceof CryptoKey)
      key = KeyObject.from(key);
    key = secretMaterial(key);
    const data = ArrayBuffer.isView(key) ? viewBytes(key) : bufferBytes(key);
    validateCryptoLength(data.byteLength, "key is too long");
    const normalized = aliases[algorithm.split("\0")[0]!.toLowerCase()];
    if (!normalized) throw new Error("Digest method not supported");
    this.hmac = new NativeHmac(normalized, data);
  }
  update(data: ArrayBufferView) {
    if (this.cached)
      throw new DOMException(
        "HMAC context has already been finalized.",
        "OperationError",
      );
    const input = viewBytes(data);
    validateCryptoLength(input.byteLength, "data is too long");
    this.hmac.update(input);
    return 1;
  }
  digest() {
    this.cached ??= Buffer.from(this.hmac.final());
    return Buffer.from(this.cached);
  }
}
export default { HashHandle, HmacHandle };
