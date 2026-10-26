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

// Adapted from workerd@5358e3d337336eaf696a48bc1563d808b10feba5.
import { Buffer } from "node:buffer";
import { NativeDH } from "./dh-handle.js";
import { bytes, isAnyBuffer } from "./validation.js";
import { validateInt32 } from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE } from "../net/errors.js";
const kHandle = Symbol("kHandle");
type Input = string | ArrayBuffer | SharedArrayBuffer | ArrayBufferView;
type Encoding = BufferEncoding | "buffer";
interface SharedDH {
  [kHandle]: NativeDH;
  readonly verifyError: number;
  generateKeys(encoding?: undefined): Buffer;
  generateKeys(encoding: "buffer"): Buffer;
  generateKeys(encoding: BufferEncoding): string;
  computeSecret(key: Input, inputEncoding?: Encoding): Buffer;
  computeSecret(
    key: Input,
    inputEncoding: Encoding | undefined,
    outputEncoding: "buffer",
  ): Buffer;
  computeSecret(
    key: Input,
    inputEncoding: Encoding | undefined,
    outputEncoding: BufferEncoding,
  ): string;
  getPrime(encoding?: undefined): Buffer;
  getPrime(encoding: "buffer"): Buffer;
  getPrime(encoding: BufferEncoding): string;
  getGenerator(encoding?: undefined): Buffer;
  getGenerator(encoding: "buffer"): Buffer;
  getGenerator(encoding: BufferEncoding): string;
  getPublicKey(encoding?: undefined): Buffer;
  getPublicKey(encoding: "buffer"): Buffer;
  getPublicKey(encoding: BufferEncoding): string;
  getPrivateKey(encoding?: undefined): Buffer;
  getPrivateKey(encoding: "buffer"): Buffer;
  getPrivateKey(encoding: BufferEncoding): string;
}
export interface DiffieHellman extends SharedDH {
  setPrivateKey(key: Input, encoding?: Encoding): this;
  setPublicKey(key: Input, encoding?: Encoding): this;
}
export interface DiffieHellmanGroup extends SharedDH {}
type Arguments = [
  sizeOrKey: number | Input,
  keyEncoding?: number | Input,
  generator?: number | Input,
  genEncoding?: Encoding,
];
function decode(
  value: Input,
  encoding?: Encoding,
): ArrayBuffer | ArrayBufferView {
  if (typeof value === "string")
    return Buffer.from(value, encoding === "buffer" ? "utf8" : encoding);
  return bytes(value, "key");
}
function encode(value: Uint8Array, encoding?: Encoding): Buffer | string {
  const result = Buffer.from(value);
  return encoding && encoding !== "buffer" ? result.toString(encoding) : result;
}
export const DiffieHellman = function (
  this: DiffieHellman,
  sizeOrKey: number | Input,
  keyEncoding?: number | Input,
  generator?: number | Input,
  genEncoding?: Encoding,
): DiffieHellman {
  if (!(this instanceof DiffieHellman))
    return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
  if (
    typeof sizeOrKey !== "number" &&
    typeof sizeOrKey !== "string" &&
    !ArrayBuffer.isView(sizeOrKey) &&
    !isAnyBuffer(sizeOrKey)
  )
    throw new ERR_INVALID_ARG_TYPE(
      "sizeOrKey",
      ["number", "string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"],
      sizeOrKey,
    );
  if (typeof sizeOrKey === "number") validateInt32(sizeOrKey, "sizeOrKey");
  if (
    keyEncoding &&
    keyEncoding !== "buffer" &&
    !Buffer.isEncoding(keyEncoding as string)
  ) {
    genEncoding = generator as Encoding;
    generator = keyEncoding;
    keyEncoding = "utf8";
  }
  keyEncoding ??= "utf8";
  genEncoding ??= "utf8";
  if (typeof sizeOrKey !== "number")
    sizeOrKey = decode(sizeOrKey, keyEncoding as Encoding);
  if (!generator) generator = 2;
  else if (typeof generator === "number") validateInt32(generator, "generator");
  else if (typeof generator === "string")
    generator = decode(generator, genEncoding);
  else if (!ArrayBuffer.isView(generator) && !isAnyBuffer(generator))
    throw new ERR_INVALID_ARG_TYPE(
      "generator",
      ["number", "string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"],
      generator,
    );
  this[kHandle] = new NativeDH(
    sizeOrKey as number | ArrayBuffer | ArrayBufferView,
    generator as number | ArrayBuffer | ArrayBufferView,
  );
  Object.defineProperty(DiffieHellman.prototype, "verifyError", {
    get(this: DiffieHellman) {
      return this[kHandle].getVerifyError();
    },
    enumerable: true,
    configurable: true,
  });
  return this;
} as unknown as {
  new (...args: Arguments): DiffieHellman;
  (...args: Arguments): DiffieHellman;
  prototype: DiffieHellman;
};
export const DiffieHellmanGroup = function (
  this: DiffieHellmanGroup,
  name: string,
): DiffieHellmanGroup {
  if (!(this instanceof DiffieHellmanGroup))
    return new DiffieHellmanGroup(name);
  this[kHandle] = NativeDH.group(name);
  Object.defineProperty(DiffieHellmanGroup.prototype, "verifyError", {
    get(this: DiffieHellmanGroup) {
      return this[kHandle].getVerifyError();
    },
    enumerable: true,
    configurable: true,
  });
  return this;
} as unknown as {
  new (name: string): DiffieHellmanGroup;
  (name: string): DiffieHellmanGroup;
  prototype: DiffieHellmanGroup;
};
const methods = {
  generateKeys(this: SharedDH, encoding?: Encoding) {
    return encode(this[kHandle].generateKeys(), encoding);
  },
  computeSecret(
    this: SharedDH,
    key: Input,
    inputEncoding?: Encoding,
    outputEncoding?: Encoding,
  ) {
    return encode(
      this[kHandle].computeSecret(decode(key, inputEncoding)),
      outputEncoding,
    );
  },
  getPrime(this: SharedDH, encoding?: Encoding) {
    return encode(this[kHandle].getPrime(), encoding);
  },
  getGenerator(this: SharedDH, encoding?: Encoding) {
    return encode(this[kHandle].getGenerator(), encoding);
  },
  getPublicKey(this: SharedDH, encoding?: Encoding) {
    return encode(this[kHandle].getPublicKey(), encoding);
  },
  getPrivateKey(this: SharedDH, encoding?: Encoding) {
    return encode(this[kHandle].getPrivateKey(), encoding);
  },
};
const setters = {
  setPublicKey(this: DiffieHellman, key: Input, encoding?: Encoding) {
    this[kHandle].setPublicKey(decode(key, encoding));
    return this;
  },
  setPrivateKey(this: DiffieHellman, key: Input, encoding?: Encoding) {
    this[kHandle].setPrivateKey(decode(key, encoding));
    return this;
  },
};
for (const [name, method] of Object.entries({ ...methods, ...setters }))
  Object.defineProperty(method, "name", {
    value: "dh" + name[0]!.toUpperCase() + name.slice(1),
    configurable: true,
  });
Object.assign(DiffieHellman.prototype, methods, setters);
Object.assign(DiffieHellmanGroup.prototype, methods);
export function createDiffieHellman(
  sizeOrKey: number | Input,
  keyEncoding?: number | Input,
  generator?: number | Input,
  genEncoding?: Encoding,
): DiffieHellman {
  return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
}
export function createDiffieHellmanGroup(name: string): DiffieHellmanGroup {
  return new DiffieHellmanGroup(name);
}
export function getDiffieHellman(name: string): DiffieHellmanGroup {
  return createDiffieHellmanGroup(name);
}
