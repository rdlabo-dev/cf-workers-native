// @ts-nocheck
// Copyright (c) 2017-2023 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
//
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

import cryptoImpl, { type CipherHandle } from "./cipher-handle.js";
import { Transform } from "../stream/transform.js";
import type {
  Transform as NodeTransform,
  TransformOptions,
  TransformCallback,
} from "node:stream";
import { KeyObject, createSecretKey } from "./keys.js";
import {
  validateObject,
  validateString,
  validateUint32,
} from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from "../net/errors.js";
import { ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE } from "./sign-errors.js";
import { isAnyBuffer as isAnyArrayBuffer } from "./validation.js";
import { Buffer } from "node:buffer";
const isArrayBufferView = ArrayBuffer.isView;

export interface AADOptions {
  plaintextLength?: number;
  encoding?: string;
}

const kHandle = Symbol("kHandle");

const CipherMode = {
  CIPHER: 0,
  DECIPHER: 1,
};

export interface Cipheriv extends NodeTransform {
  [kHandle]: CipherHandle;
  update(
    data: string | ArrayBuffer | ArrayBufferView,
    inputEncoding?: string,
  ): Buffer;
  update(
    data: string | ArrayBuffer | ArrayBufferView,
    inputEncoding: string | undefined,
    outputEncoding: string,
  ): string;
  update(
    data: string | ArrayBuffer | ArrayBufferView,
    inputEncoding?: string,
    outputEncoding?: string,
  ): string | Buffer;
  final(): Buffer;
  final(outputEncoding: string): string;
  final(outputEncoding?: string): string | Buffer;
  setAAD(
    buffer: string | ArrayBuffer | ArrayBufferView,
    options?: AADOptions,
  ): this;
  setAutoPadding(autoPadding?: boolean): this;
  getAuthTag(): Buffer;
}

export interface Decipheriv extends NodeTransform {
  [kHandle]: CipherHandle;
  update(
    data: string | ArrayBuffer | ArrayBufferView,
    inputEncoding?: string,
  ): Buffer;
  update(
    data: string | ArrayBuffer | ArrayBufferView,
    inputEncoding: string | undefined,
    outputEncoding: string,
  ): string;
  update(
    data: string | ArrayBuffer | ArrayBufferView,
    inputEncoding?: string,
    outputEncoding?: string,
  ): string | Buffer;
  final(): Buffer;
  final(outputEncoding: string): string;
  final(outputEncoding?: string): string | Buffer;
  setAAD(
    buffer: string | ArrayBuffer | ArrayBufferView,
    options?: AADOptions,
  ): this;
  setAutoPadding(autoPadding?: boolean): this;
  setAuthTag(buffer: ArrayBuffer | ArrayBufferView): this;
}

export interface CipherOptions extends TransformOptions {
  authLengthTag?: number;
}

function getSecretKey(key: unknown): unknown {
  if (typeof CryptoKey !== "undefined" && key instanceof CryptoKey)
    key = KeyObject.from(key);
  if (key instanceof KeyObject) {
    if (key.type !== "secret")
      throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(key.type, "secret");
    return key;
  }
  if (isAnyArrayBuffer(key) || isArrayBufferView(key))
    return createSecretKey(key);
  if (typeof key === "string") return createSecretKey(key, "utf8");
  throw new ERR_INVALID_ARG_TYPE(
    "key",
    ["string", "Buffer", "TypedArray", "DataView", "KeyObject", "CryptoKey"],
    key,
  );
}

function getIv(
  iv: string | ArrayBuffer | ArrayBufferView | null,
): ArrayBuffer | ArrayBufferView {
  if (isAnyArrayBuffer(iv) || isArrayBufferView(iv)) {
    return iv;
  } else if (typeof iv === "string") {
    return Buffer.from(iv, "utf8");
  }

  throw new ERR_INVALID_ARG_TYPE(
    "iv",
    ["string", "Buffer", "TypedArray", "DataView", "null"],
    iv,
  );
}

export const Cipheriv = function (
  this: Cipheriv,
  algorithm: string,
  key: string | ArrayBuffer | ArrayBufferView | KeyObject | CryptoKey,
  iv: string | ArrayBuffer | ArrayBufferView | null,
  options: CipherOptions = {},
) {
  validateString(algorithm, "algorithm");
  const secretKey = getSecretKey(key);
  const ivBuf = getIv(iv);

  if (options.authLengthTag !== undefined) {
    validateUint32(options.authLengthTag, "options.authLengthTag");
  }
  this[kHandle] = cryptoImpl.newHandle(
    CipherMode.CIPHER,
    algorithm,
    secretKey,
    ivBuf,
    options.authLengthTag,
  );

  Transform.call(this, options as TransformOptions);
} as unknown as {
  new (
    algorithm: string,
    key: string | ArrayBuffer | ArrayBufferView | KeyObject | CryptoKey,
    iv: string | ArrayBuffer | ArrayBufferView | null,
    options?: CipherOptions,
  ): Cipheriv;
};
Object.setPrototypeOf(Cipheriv.prototype, Transform.prototype);
Object.setPrototypeOf(Cipheriv, Transform);

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Cipheriv.prototype.update = function (
  this: Cipheriv,
  data: string | ArrayBuffer | ArrayBufferView,
  inputEncoding?: string,
  outputEncoding?: string,
): string | Buffer {
  let ret: ArrayBuffer;
  if (typeof data === "string") {
    if (inputEncoding === undefined) {
      throw new ERR_INVALID_ARG_VALUE(
        "inputEncoding",
        inputEncoding,
        "If inputEncoding is not provided then the data must be a Buffer",
      );
    }
    ret = this[kHandle].update(Buffer.from(data, inputEncoding));
  } else if (isAnyArrayBuffer(data)) {
    ret = this[kHandle].update(data);
  } else if (isArrayBufferView(data)) {
    ret = this[kHandle].update(data);
  } else {
    throw new ERR_INVALID_ARG_TYPE(
      "data",
      ["string", "Buffer", "TypedArray", "DataView"],
      data,
    );
  }

  if (outputEncoding === undefined) {
    return Buffer.from(ret);
  }

  return Buffer.from(ret).toString(outputEncoding);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Cipheriv.prototype.final = function (
  this: Cipheriv,
  outputEncoding?: string,
): string | Buffer {
  const ret = this[kHandle].final();
  if (outputEncoding === undefined) {
    return Buffer.from(ret);
  }
  return Buffer.from(ret).toString(outputEncoding);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Cipheriv.prototype.setAAD = function (
  this: Cipheriv,
  buffer: string | ArrayBuffer | ArrayBufferView,
  options: AADOptions = {},
): Cipheriv {
  validateObject(options, "options");
  const { plaintextLength, encoding } = options;
  if (plaintextLength !== undefined) {
    validateUint32(plaintextLength, "options.plaintextLength");
  }
  if (encoding !== undefined) {
    validateString(encoding, "options.encoding");
  }

  if (typeof buffer === "string") {
    this[kHandle].setAAD(Buffer.from(buffer, encoding), plaintextLength);
  } else if (isAnyArrayBuffer(buffer) || isArrayBufferView(buffer)) {
    this[kHandle].setAAD(buffer, plaintextLength);
  }
  return this;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Cipheriv.prototype.setAutoPadding = function (
  this: Cipheriv,
  autoPadding?: boolean,
): Cipheriv {
  this[kHandle].setAutoPadding(autoPadding ? true : false);
  return this;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Cipheriv.prototype.getAuthTag = function (this: Cipheriv): Buffer | undefined {
  const ret = this[kHandle].getAuthTag();
  if (ret === undefined) return undefined;
  return Buffer.from(ret);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Cipheriv.prototype._transform = function (
  this: Cipheriv,
  chunk: string | Buffer | ArrayBufferView,
  encoding: string,
  callback: TransformCallback,
): void {
  if (typeof chunk === "string") {
    chunk = Buffer.from(chunk, encoding);
  }
  this.push(Buffer.from(this[kHandle].update(chunk)));
  callback();
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Cipheriv.prototype._flush = function (
  this: Cipheriv,
  callback: TransformCallback,
): void {
  this.push(Buffer.from(this[kHandle].final()));
  callback();
};

export const Decipheriv = function (
  this: Decipheriv,
  algorithm: string,
  key: string | ArrayBuffer | ArrayBufferView | KeyObject | CryptoKey,
  iv: string | ArrayBuffer | ArrayBufferView | null,
  options: CipherOptions = {},
) {
  validateString(algorithm, "algorithm");
  const secretKey = getSecretKey(key);
  const ivBuf = getIv(iv);

  if (options.authLengthTag !== undefined) {
    validateUint32(options.authLengthTag, "options.authLengthTag");
  }

  this[kHandle] = cryptoImpl.newHandle(
    CipherMode.DECIPHER,
    algorithm,
    secretKey,
    ivBuf,
    options.authLengthTag,
  );

  Transform.call(this, options as TransformOptions);
  return this;
} as unknown as {
  new (
    algorithm: string,
    key: string | ArrayBuffer | ArrayBufferView | KeyObject | CryptoKey,
    iv: string | ArrayBuffer | ArrayBufferView | null,
    options?: CipherOptions,
  ): Decipheriv;
};

Object.setPrototypeOf(Decipheriv.prototype, Transform.prototype);
Object.setPrototypeOf(Decipheriv, Transform);

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Decipheriv.prototype.update = function (
  this: Decipheriv,
  data: string | ArrayBuffer | ArrayBufferView,
  inputEncoding?: string,
  outputEncoding?: string,
): string | Buffer {
  let ret: ArrayBuffer;
  if (typeof data === "string") {
    if (inputEncoding === undefined) {
      throw new ERR_INVALID_ARG_VALUE(
        "inputEncoding",
        inputEncoding,
        "If inputEncoding is not provided then the data must be a Buffer",
      );
    }
    ret = this[kHandle].update(Buffer.from(data, inputEncoding));
  } else if (isAnyArrayBuffer(data)) {
    ret = this[kHandle].update(data);
  } else if (isArrayBufferView(data)) {
    ret = this[kHandle].update(data);
  } else {
    throw new ERR_INVALID_ARG_TYPE(
      "data",
      ["string", "Buffer", "TypedArray", "DataView"],
      data,
    );
  }

  if (outputEncoding === undefined) {
    return Buffer.from(ret);
  }

  return Buffer.from(ret).toString(outputEncoding);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Decipheriv.prototype.final = function (
  this: Decipheriv,
  outputEncoding?: string,
): string | Buffer {
  const ret = this[kHandle].final();
  if (outputEncoding === undefined) {
    return Buffer.from(ret);
  }
  return Buffer.from(ret).toString(outputEncoding);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Decipheriv.prototype.setAAD = function (
  this: Decipheriv,
  buffer: string | ArrayBuffer | ArrayBufferView,
  options: AADOptions = {},
): Decipheriv {
  validateObject(options, "options");
  const { plaintextLength, encoding } = options;
  if (plaintextLength !== undefined) {
    validateUint32(plaintextLength, "options.plaintextLength");
  }
  if (encoding !== undefined) {
    validateString(encoding, "options.encoding");
  }

  if (typeof buffer === "string") {
    this[kHandle].setAAD(Buffer.from(buffer, encoding), plaintextLength);
  } else if (isAnyArrayBuffer(buffer) || isArrayBufferView(buffer)) {
    this[kHandle].setAAD(buffer, plaintextLength);
  }
  return this;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Decipheriv.prototype.setAutoPadding = function (
  this: Decipheriv,
  autoPadding?: boolean,
): Decipheriv {
  this[kHandle].setAutoPadding(autoPadding ? true : false);
  return this;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Decipheriv.prototype.setAuthTag = function (
  this: Decipheriv,
  buffer: ArrayBuffer | ArrayBufferView,
): Decipheriv {
  this[kHandle].setAuthTag(buffer);
  return this;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Decipheriv.prototype._transform = function (
  this: Decipheriv,
  chunk: string | Buffer | ArrayBufferView,
  encoding: string,
  callback: TransformCallback,
): void {
  if (typeof chunk === "string") {
    chunk = Buffer.from(chunk, encoding);
  }
  this.push(Buffer.from(this[kHandle].update(chunk)));
  callback();
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Decipheriv.prototype._flush = function (
  this: Decipheriv,
  callback: TransformCallback,
): void {
  this.push(Buffer.from(this[kHandle].final()));
  callback();
};

export function createCipheriv(
  algorithm: string,
  key: string | ArrayBuffer | ArrayBufferView | KeyObject | CryptoKey,
  iv: string | ArrayBuffer | ArrayBufferView | null,
  options: CipherOptions = {},
): Cipheriv {
  return new Cipheriv(algorithm, key, iv, options);
}

export function createDecipheriv(
  algorithm: string,
  key: string | ArrayBuffer | ArrayBufferView | KeyObject | CryptoKey,
  iv: string | ArrayBuffer | ArrayBufferView | null,
  options: CipherOptions = {},
): Decipheriv {
  return new Decipheriv(algorithm, key, iv, options);
}
