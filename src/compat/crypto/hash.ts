// @ts-nocheck
// Copyright (c) 2017-2022 Cloudflare, Inc.
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

// Ported from workerd@5358e3d337336eaf696a48bc1563d808b10feba5 crypto_hash.ts.
import cryptoImpl from "./hash-handle.js";
import { Buffer } from "node:buffer";
import { KeyObject } from "./keys.js";
import { ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE } from "./sign-errors.js";
const isCryptoKey = (value) =>
  typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
import { isAnyBuffer as isAnyArrayBuffer } from "./validation.js";
function getStringOption(options, key) {
  let value;
  if (options && (value = options[key]) != null)
    validateString(value, `options.${key}`);
  return value;
}
function getArrayBufferOrView(value, name, encoding) {
  return typeof value === "string"
    ? Buffer.from(value, encoding === "buffer" ? undefined : encoding)
    : value;
}

import { Transform } from "../stream/transform.js";
import type { Transform as NodeTransform, TransformOptions } from "node:stream";
import { validateString, validateUint32 } from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE } from "../net/errors.js";
import { NodeError } from "../net/error-base.js";
const kHandle = Symbol("kHandle"),
  kState = Symbol("kState"),
  kFinalized = Symbol("kFinalized");
const isArrayBufferView = ArrayBuffer.isView;
class ERR_CRYPTO_HASH_FINALIZED extends NodeError {
  constructor() {
    super("ERR_CRYPTO_HASH_FINALIZED", "Digest already called");
  }
}
class ERR_CRYPTO_HASH_UPDATE_FAILED extends NodeError {
  constructor() {
    super("ERR_CRYPTO_HASH_UPDATE_FAILED", "Hash update failed");
  }
}
export interface HashOptions extends TransformOptions {
  outputLength?: number;
}

interface _kState {
  [kFinalized]: boolean;
}

declare class Hash extends NodeTransform {
  [kHandle]: InstanceType<typeof cryptoImpl.HashHandle>;
  [kState]: _kState;

  constructor(
    algorithm: string | InstanceType<typeof cryptoImpl.HashHandle>,
    options?: HashOptions,
  );

  copy(options?: HashOptions): Hash;
  update(data: string | Buffer | ArrayBufferView, encoding?: string): this;
  digest(): Buffer;
  digest(outputEncoding: "buffer"): Buffer;
  digest(outputEncoding: BufferEncoding): string;
  digest(outputEncoding?: string): Buffer | string;
}

// These helper functions are needed because the constructors can
// use new, in which case V8 cannot inline the recursive constructor call
export function createHash(algorithm: string, options?: HashOptions): Hash {
  return new Hash(algorithm, options);
}

function Hash(
  this: unknown,
  algorithm: string | InstanceType<typeof cryptoImpl.HashHandle>,
  options?: HashOptions,
): Hash {
  if (!(this instanceof Hash)) {
    return new Hash(algorithm, options);
  }

  const xofLen = typeof options === "object" ? options.outputLength : undefined;
  if (xofLen !== undefined) validateUint32(xofLen, "options.outputLength");
  if (algorithm instanceof cryptoImpl.HashHandle) {
    this[kHandle] = algorithm.copy(xofLen as number);
  } else {
    validateString(algorithm, "algorithm");
    this[kHandle] = new cryptoImpl.HashHandle(algorithm, xofLen as number);
  }
  this[kState] = {
    [kFinalized]: false,
  };

  Transform.call(this, options);
  return this;
}

Object.setPrototypeOf(Hash.prototype, Transform.prototype);
Object.setPrototypeOf(Hash, Transform);

Hash.prototype.copy = function (this: Hash, options?: HashOptions): Hash {
  const state = this[kState];
  if (state[kFinalized]) throw new ERR_CRYPTO_HASH_FINALIZED();

  return new Hash(this[kHandle], options);
};

Hash.prototype._transform = function (
  this: Hash | Hmac,
  chunk: string | Buffer | ArrayBufferView,
  encoding: string,
  callback: TransformCallback,
): void {
  if (typeof chunk === "string") {
    chunk = Buffer.from(chunk, encoding);
  }
  this[kHandle].update(chunk);
  callback();
};

Hash.prototype._flush = function (
  this: Hash | Hmac,
  callback: TransformCallback,
): void {
  this.push(Buffer.from(this[kHandle].digest()));
  callback();
};

Hash.prototype.update = function (
  this: Hash | Hmac,
  data: string | Buffer | ArrayBufferView,
  encoding?: string,
): Hash | Hmac {
  encoding ??= "utf8";
  if (encoding === "buffer") {
    encoding = undefined;
  }

  const state = this[kState];
  if (state[kFinalized]) throw new ERR_CRYPTO_HASH_FINALIZED();

  if (typeof data === "string") {
    data = Buffer.from(data, encoding);
  } else if (!isArrayBufferView(data)) {
    throw new ERR_INVALID_ARG_TYPE(
      "data",
      ["string", "Buffer", "TypedArray", "DataView"],
      data,
    );
  }

  if (!this[kHandle].update(data)) throw new ERR_CRYPTO_HASH_UPDATE_FAILED();
  return this;
};

Hash.prototype.digest = function (
  this: Hash,
  outputEncoding?: string,
): Buffer | string {
  const state = this[kState];
  if (state[kFinalized]) throw new ERR_CRYPTO_HASH_FINALIZED();

  // Explicit conversion for backward compatibility.
  const ret = Buffer.from(this[kHandle].digest());
  state[kFinalized] = true;
  if (outputEncoding !== undefined && outputEncoding !== "buffer") {
    return ret.toString(outputEncoding);
  } else {
    return ret;
  }
};

export function hash(
  algorithm: string,
  data: string | ArrayBufferView,
  outputEncoding: string = "hex",
): string | Buffer {
  validateString(algorithm, "algorithm");
  validateString(outputEncoding, "outputEncoding");

  if (typeof data === "string") {
    const hash = createHash(algorithm);
    hash.update(data, "utf8");
    return hash.digest(outputEncoding);
  } else if (isArrayBufferView(data)) {
    const hash = createHash(algorithm);
    hash.update(data, "utf8");
    return hash.digest(outputEncoding);
  }

  throw new ERR_INVALID_ARG_TYPE(
    "data",
    ["string", "Buffer", "TypedArray", "DataView"],
    data,
  );
}

declare class Hmac extends NodeTransform {
  [kHandle]: InstanceType<typeof cryptoImpl.HmacHandle>;
  [kState]: _kState;
  constructor(hmac: string, key: unknown, options?: TransformOptions);
  update(data: string | Buffer | ArrayBufferView, encoding?: string): this;
  digest(): Buffer;
  digest(outputEncoding: "buffer"): Buffer;
  digest(outputEncoding: BufferEncoding): string;
  digest(outputEncoding?: string): Buffer | string;
}

export function createHmac(
  hmac: string,
  key: unknown,
  options?: TransformOptions,
): Hmac {
  return new Hmac(hmac, key, options);
}

function Hmac(
  this: unknown,
  hmac: string,
  key: unknown,
  options?: TransformOptions,
): Hmac {
  if (!(this instanceof Hmac)) {
    return new Hmac(hmac, key, options);
  }
  validateString(hmac, "hmac");
  const encoding = getStringOption(options, "encoding");

  if (key instanceof KeyObject) {
    if (key.type !== "secret") {
      throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(key.type, "secret");
    }
    this[kHandle] = new cryptoImpl.HmacHandle(hmac, key);
  } else if (isCryptoKey(key)) {
    if (key.type !== "secret") {
      throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(key.type, "secret");
    }
    this[kHandle] = new cryptoImpl.HmacHandle(hmac, key);
  } else if (
    typeof key !== "string" &&
    !isArrayBufferView(key) &&
    !isAnyArrayBuffer(key)
  ) {
    throw new ERR_INVALID_ARG_TYPE(
      "key",
      [
        "ArrayBuffer",
        "Buffer",
        "ArrayBufferView",
        "string",
        "KeyObject",
        "CryptoKey",
      ],
      key,
    );
  } else {
    this[kHandle] = new cryptoImpl.HmacHandle(
      hmac,
      getArrayBufferOrView(key, "key", encoding),
    );
  }

  this[kState] = {
    [kFinalized]: false,
  };
  Transform.call(this, options);
  return this;
}
Object.setPrototypeOf(Hmac.prototype, Transform.prototype);
Object.setPrototypeOf(Hmac, Transform);

// eslint-disable-next-line @typescript-eslint/unbound-method
Hmac.prototype.update = Hash.prototype.update;

Hmac.prototype.digest = function (
  this: Hmac,
  outputEncoding?: string,
): Buffer | string {
  const state = this[kState];
  if (state[kFinalized]) {
    return !outputEncoding || outputEncoding === "buffer"
      ? Buffer.from("")
      : "";
  }

  // Explicit conversion for backward compatibility.
  const ret = Buffer.from(this[kHandle].digest());
  state[kFinalized] = true;
  if (outputEncoding !== undefined && outputEncoding !== "buffer") {
    return ret.toString(outputEncoding);
  } else {
    return ret;
  }
};

// eslint-disable-next-line @typescript-eslint/unbound-method
Hmac.prototype._flush = Hash.prototype._flush;
// eslint-disable-next-line @typescript-eslint/unbound-method
Hmac.prototype._transform = Hash.prototype._transform;

export { Hash, Hmac };
