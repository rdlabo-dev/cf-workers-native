import { bufferBytes, viewBytes } from "../../shared/buffer-source.js";
import { isAnyBuffer } from "./validation.js";
import { signatureDigest } from "./digests.js";
import { Buffer } from "node:buffer";
import { NativeDigest } from "./native-crypto.js";
import { keyStates } from "./key-state.js";
import { KeyObject } from "./keys.js";
import { sign, verify } from "./asymmetric.js";
import { der, integer } from "./key-formats.js";
function key(value: any) {
  if (value instanceof globalThis.CryptoKey) value = KeyObject.from(value);
  const result = keyStates.get(value)?.asymmetric;
  if (!result)
    throw Object.assign(
      new Error(
        "Synchronous access to opaque host key material is unavailable",
      ),
      { code: "ERR_METHOD_NOT_IMPLEMENTED" },
    );
  return result;
}
function rawSignature(data: Uint8Array, width: number): Buffer {
  let offset = 0;
  const item = (tag: number) => {
    if (data[offset++] !== tag) throw new Error("Invalid DER signature");
    let length = data[offset++];
    if (length & 128) {
      const count = length & 127;
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + data[offset++];
    }
    if (offset + length > data.length) throw new Error("Invalid DER signature");
    return length;
  };
  const length = item(48);
  if (offset + length !== data.length) throw new Error("Invalid DER signature");
  const output = Buffer.alloc(width * 2);
  for (let part = 0; part < 2; part++) {
    let length = item(2);
    while (length > width && data[offset] === 0) {
      offset++;
      length--;
    }
    if (length > width) throw new Error("Invalid DER signature");
    output.set(
      data.subarray(offset, offset + length),
      part * width + width - length,
    );
    offset += length;
  }
  return output;
}
function rsaParameters(
  type: string,
  padding: number | undefined,
  saltLength: number | undefined,
  verifying: boolean,
) {
  if (type !== "rsa" && type !== "rsa-pss") return;
  const mode = padding ?? (type === "rsa-pss" ? 6 : 1);
  if (
    ![1, 3, 6].includes(mode) ||
    (mode === 6 && saltLength !== undefined && saltLength < -2)
  )
    throw new Error("Failed to set RSA parameters for signature");
  if (mode === 3)
    throw new Error(
      verifying
        ? "Failed to set digest context for signature verification"
        : "Failed to set signature digest",
    );
}
export class SignHandle {
  private hash: NativeDigest;
  constructor(private algorithm: string) {
    this.algorithm = signatureDigest(algorithm);
    this.hash = new NativeDigest(this.algorithm);
  }
  update(data: Uint8Array) {
    this.hash.update(viewBytes(data));
  }
  sign(value: any, padding?: number, saltLength?: number, encoding?: number) {
    this.hash.assertActive();
    const native = key(value),
      hash = this.hash.final();
    if (native.type === "dsa")
      throw new Error("Signing with DSA keys is not currently supported");
    if (native.type === "ed25519")
      throw new Error("Failed to set signature digest");
    if (native.type === "x25519")
      throw new Error("Failed to initialize signing context");
    rsaParameters(native.type, padding, saltLength, false);
    let signed: Uint8Array;
    try {
      signed = native.signHash(
        this.algorithm,
        hash,
        native.type.startsWith("rsa") ? padding : undefined,
        saltLength ?? -1,
      );
    } catch {
      throw new Error("Failed to generate signature");
    }
    return encoding === 1 && native.type === "ec"
      ? rawSignature(signed, Math.ceil(native.bits / 8))
      : signed;
  }
}
export class VerifyHandle {
  private hash: NativeDigest;
  constructor(private algorithm: string) {
    this.algorithm = signatureDigest(algorithm);
    this.hash = new NativeDigest(this.algorithm, "Verification");
  }
  update(data: Uint8Array) {
    this.hash.update(viewBytes(data));
  }
  verify(
    value: any,
    signature: ArrayBuffer | ArrayBufferView,
    padding?: number,
    saltLength?: number,
    encoding?: number,
  ) {
    if (!isAnyBuffer(signature) && !ArrayBuffer.isView(signature))
      throw new TypeError(
        "Failed to execute 'verify' on 'VerifyHandle': parameter 2 is not of type 'BufferSource'.",
      );
    this.hash.assertActive();
    const native = key(value);
    if (native.type === "ed25519" || native.type === "ed448")
      throw new Error("Unsupported operation for this key");
    let signatureBytes: Buffer = Buffer.from(
      isAnyBuffer(signature) ? bufferBytes(signature) : viewBytes(signature),
    );
    const hash = this.hash.final();
    if (native.type === "dsa")
      throw new Error("Verifying with DSA keys is not currently supported");
    if (native.type === "x25519")
      throw new Error("Failed to initialize key for verification");
    rsaParameters(native.type, padding, saltLength, true);
    if (encoding === 1 && native.type === "ec") {
      const width = Math.ceil(native.bits / 8);
      if (signatureBytes.length !== width * 2) return false;
      signatureBytes = der(
        48,
        integer(signatureBytes.subarray(0, width)),
        integer(signatureBytes.subarray(width)),
      );
    }
    return native.verifyHash(
      this.algorithm,
      hash,
      signatureBytes,
      native.type.startsWith("rsa") ? padding : undefined,
      saltLength ?? -1,
    );
  }
}
export default {
  SignHandle,
  VerifyHandle,
  signOneShot(
    key: any,
    algorithm: any,
    data: any,
    padding?: number,
    saltLength?: number,
    encoding?: number,
  ) {
    return sign(algorithm, data, {
      key,
      padding,
      saltLength,
      dsaEncoding: encoding === 1 ? "ieee-p1363" : "der",
    });
  },
  verifyOneShot(
    key: any,
    algorithm: any,
    data: any,
    signature: any,
    padding?: number,
    saltLength?: number,
    encoding?: number,
  ) {
    return verify(
      algorithm,
      data,
      {
        key,
        padding,
        saltLength,
        dsaEncoding: encoding === 1 ? "ieee-p1363" : "der",
      },
      signature,
    );
  },
};
