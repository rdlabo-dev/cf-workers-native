// @ts-nocheck
// Ported from pinned workerd crypto_dh.ts; see LICENSE-APACHE and LICENSE-3RD-PARTY.md.
import { Buffer } from "node:buffer";
import { NativeECDH } from "./native-crypto.js";
import { validateString, validateOneOf } from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE } from "../net/errors.js";
import { isArrayBufferView } from "../util/types/index.js";
const cryptoImpl = { ECDHHandle: NativeECDH };
const kHandle = Symbol("kHandle");
export type ECDHFormat = "compressed" | "uncompressed" | "hybrid";
type ECDHInput = string | ArrayBufferView;
export interface ECDH {
  [kHandle]: NativeECDH;
  computeSecret(
    key: ECDHInput,
    inputEncoding?: BufferEncoding,
    outputEncoding?: undefined,
  ): Buffer;
  computeSecret(
    key: ECDHInput,
    inputEncoding: BufferEncoding | undefined,
    outputEncoding: BufferEncoding,
  ): string;
  generateKeys(encoding?: undefined, format?: ECDHFormat): Buffer;
  generateKeys(encoding: BufferEncoding, format?: ECDHFormat): string;
  getPrivateKey(encoding?: undefined): Buffer;
  getPrivateKey(encoding: BufferEncoding): string;
  getPublicKey(encoding?: undefined, format?: ECDHFormat): Buffer;
  getPublicKey(encoding: BufferEncoding, format?: ECDHFormat): string;
  setPrivateKey(key: ECDHInput, encoding?: BufferEncoding): void;
}

export const ECDH = function (this: ECDH, curveName: string) {
  if (!(this instanceof ECDH)) {
    return new ECDH(curveName);
  }
  validateString(curveName, "curveName");
  this[kHandle] = new cryptoImpl.ECDHHandle(curveName);
  return this;
} as unknown as {
  new (curveName: string): ECDH;
  (curveName: string): ECDH;
  convertKey(
    key: ECDHInput,
    curve: string,
    inputEncoding?: BufferEncoding,
    outputEncoding?: undefined,
    format?: ECDHFormat,
  ): Buffer;
  convertKey(
    key: ECDHInput,
    curve: string,
    inputEncoding: BufferEncoding | undefined,
    outputEncoding: BufferEncoding,
    format?: ECDHFormat,
  ): string;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
ECDH.prototype.computeSecret = function (
  this: ECDH,
  otherPublicKey: string | ArrayBufferView | ArrayBuffer,
  inputEncoding?: string,
  outputEncoding?: string,
): Buffer | string {
  if (typeof otherPublicKey === "string") {
    otherPublicKey = Buffer.from(otherPublicKey, inputEncoding);
  }
  if (!isArrayBufferView(otherPublicKey)) {
    throw new ERR_INVALID_ARG_TYPE(
      "otherPublicKey",
      ["string", "Buffer", "TypedArray", "DataView"],
      otherPublicKey,
    );
  }
  if (inputEncoding != null) {
    validateString(inputEncoding, "inputEncoding");
  }
  if (outputEncoding != null) {
    validateString(outputEncoding, "outputEncoding");
  }
  const ret = this[kHandle].computeSecret(otherPublicKey);
  if (typeof outputEncoding === "string") {
    return Buffer.from(ret).toString(outputEncoding);
  }
  return Buffer.from(ret);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
ECDH.prototype.generateKeys = function (
  this: ECDH,
  encoding?: string,
  format?: string,
): Buffer | string {
  if (encoding != null) {
    validateString(encoding, "encoding");
  }
  if (format != null) {
    validateOneOf(format, "format", ["compressed", "uncompressed", "hybrid"]);
  }
  this[kHandle].generateKeys();
  return this.getPublicKey(encoding, format);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
ECDH.prototype.getPrivateKey = function (
  this: ECDH,
  encoding?: string,
): Buffer | string {
  if (encoding != null) {
    validateString(encoding, "encoding");
  }
  const pvt = this[kHandle].getPrivateKey();
  if (typeof encoding === "string") {
    return Buffer.from(pvt).toString(encoding);
  }
  return Buffer.from(pvt);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
ECDH.prototype.getPublicKey = function (
  this: ECDH,
  encoding?: string,
  format: ECDHFormat = "uncompressed",
): Buffer | string {
  if (encoding != null) {
    validateString(encoding, "encoding");
  }
  validateOneOf(format, "format", ["compressed", "uncompressed", "hybrid"]);
  const pub = this[kHandle].getPublicKey(format);
  if (typeof encoding === "string") {
    return Buffer.from(pub).toString(encoding);
  }
  return Buffer.from(pub);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
ECDH.prototype.setPrivateKey = function (
  this: ECDH,
  key: string | ArrayBufferView | ArrayBuffer,
  encoding?: string,
): void {
  if (encoding != null) {
    validateString(encoding, "encoding");
  }
  if (typeof key === "string") {
    key = Buffer.from(key, encoding);
  }
  if (!isArrayBufferView(key)) {
    throw new ERR_INVALID_ARG_TYPE(
      "key",
      ["string", "Buffer", "TypedArray", "DataView"],
      key,
    );
  }
  this[kHandle].setPrivateKey(key);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access
(ECDH as any).convertKey = function (
  key: string | ArrayBufferView | ArrayBuffer,
  curve: string,
  inputEncoding?: string,
  outputEncoding?: string,
  format: ECDHFormat = "uncompressed",
): Buffer | string {
  if (typeof key === "string") {
    key = Buffer.from(key, inputEncoding);
  }
  if (!isArrayBufferView(key)) {
    throw new ERR_INVALID_ARG_TYPE(
      "key",
      ["string", "Buffer", "TypedArray", "DataView"],
      key,
    );
  }
  validateString(curve, "curve");
  if (inputEncoding != null) {
    validateString(inputEncoding, "inputEncoding");
  }
  if (outputEncoding != null) {
    validateString(outputEncoding, "outputEncoding");
  }
  validateOneOf(format, "format", ["compressed", "uncompressed", "hybrid"]);
  const ret = cryptoImpl.ECDHHandle.convertKey(key, curve, format);
  if (typeof outputEncoding === "string") {
    return Buffer.from(ret).toString(outputEncoding);
  }
  return Buffer.from(ret);
};

export function createECDH(curveName: string): ECDH {
  return new ECDH(curveName);
}
