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
import type { RandomUUIDOptions } from "node:crypto";
import {
  validateInteger,
  isAnyBuffer as isAnyArrayBuffer,
} from "./validation.js";
import {
  validateBoolean,
  validateObject,
  validateFunction,
} from "../net/validators.js";
const isArrayBufferView = ArrayBuffer.isView;
const dataViewBuffer = Object.getOwnPropertyDescriptor(
  DataView.prototype,
  "buffer",
)!.get!;
function isDataView(value: unknown): value is DataView {
  try {
    dataViewBuffer.call(value);
    return true;
  } catch {
    return false;
  }
}
import { kMaxLength } from "../buffer/internal-buffer.js";
import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../net/errors.js";
export type RandomBytesCallback = (err: Error | null, buffer: Buffer) => void;
export function randomBytes(size: number, callback: RandomBytesCallback): void;
export function randomBytes(size: number): Buffer;
export function randomBytes(
  size: number,
  callback?: RandomBytesCallback,
): Buffer | undefined {
  validateInteger(size, "size", 0, kMaxLength);
  const buf = Buffer.alloc(size);
  if (callback !== undefined) {
    randomFill(buf, callback as RandomFillCallback);
    return undefined;
  } else {
    randomFillSync(buf);
    return buf;
  }
}

export type RandomFillBuffer =
  | NodeJS.ArrayBufferView
  | ArrayBuffer
  | SharedArrayBuffer;
export type RandomFillResult<T extends RandomFillBuffer> = T extends
  | ArrayBuffer
  | SharedArrayBuffer
  ? Buffer
  : T extends DataView
    ? Uint8Array
    : T;
export function randomFillSync<T extends RandomFillBuffer>(
  buffer: T,
  offset?: number,
  size?: number,
): RandomFillResult<T>;
export function randomFillSync(
  buffer: RandomFillBuffer,
  offset?: number,
  size?: number,
): NodeJS.TypedArray {
  if (!isAnyArrayBuffer(buffer) && !isArrayBufferView(buffer)) {
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["TypedArray", "DataView", "ArrayBuffer", "SharedArrayBuffer"],
      buffer,
    );
  }
  // Use byteLength, not length — DataView has no .length property and
  // TypedArray .length is element count, not bytes.
  const maxLength = (buffer as Uint8Array).byteLength;
  if (offset !== undefined) {
    validateInteger(offset, "offset", 0, kMaxLength);
  } else offset = 0;
  if (size !== undefined) {
    validateInteger(size, "size", 0, maxLength - offset);
  } else size = maxLength - offset;
  if (isAnyArrayBuffer(buffer)) {
    buffer = Buffer.from(buffer as unknown as ArrayBuffer);
  } else if (isDataView(buffer)) {
    buffer = new Uint8Array(
      (buffer as DataView).buffer,
      (buffer as DataView).byteOffset,
      buffer.byteLength,
    );
  }
  buffer = (buffer as Buffer).subarray(offset, offset + size);
  return crypto.getRandomValues(buffer as Uint8Array<ArrayBuffer>);
}

export type RandomFillCallback<T extends RandomFillBuffer = RandomFillBuffer> =
  (err: Error | null, buf?: T) => void;
export function randomFill<T extends RandomFillBuffer>(
  buffer: T,
  callback: RandomFillCallback<T>,
): void;
export function randomFill<T extends RandomFillBuffer>(
  buffer: T,
  offset: number,
  callback: RandomFillCallback<T>,
): void;
export function randomFill<T extends RandomFillBuffer>(
  buffer: T,
  offset: number,
  size: number,
  callback: RandomFillCallback<T>,
): void;
export function randomFill<T extends RandomFillBuffer>(
  buffer: T,
  offsetOrCallback?: number | RandomFillCallback<T>,
  sizeOrCallback?: number | RandomFillCallback<T>,
  callback?: RandomFillCallback<T>,
): void {
  if (!isAnyArrayBuffer(buffer) && !isArrayBufferView(buffer)) {
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["TypedArray", "DataView", "ArrayBuffer", "SharedArrayBuffer"],
      buffer,
    );
  }

  let offset = 0;
  let size = 0;
  // Use byteLength, not length — DataView has no .length property and
  // TypedArray .length is element count, not bytes.
  const maxLength = (buffer as Uint8Array).byteLength;
  if (typeof callback === "function") {
    validateInteger(offsetOrCallback, "offset", 0, maxLength);
    offset = offsetOrCallback;

    validateInteger(sizeOrCallback, "size", 0, maxLength - offset);
    size = sizeOrCallback;
  } else if (typeof sizeOrCallback === "function") {
    validateInteger(offsetOrCallback, "offset", 0, maxLength);
    offset = offsetOrCallback;
    size = maxLength - offset;
    callback = sizeOrCallback;
  } else if (typeof offsetOrCallback === "function") {
    offset = 0;
    size = maxLength;
    callback = offsetOrCallback;
  }
  validateFunction(callback, "callback");

  // We're currently not actually implementing the fill itself asynchronously,
  // so we defer to randomFillSync here, but we invoke the callback asynchronously.
  new Promise<void>((res) => {
    randomFillSync(buffer, offset, size);
    res();
  }).then(
    (): unknown => callback(null, buffer),
    (err: unknown): unknown => callback(err as Error),
  );
}

const RAND_MAX = 0xffff_ffff_ffff;
// Cache random data to use in randomInt. The cache size must be evenly
// divisible by 6 because each attempt to obtain a random int uses 6 bytes.
const randomCache = Buffer.alloc(6 * 1024);
let randomCacheOffset = 0;
let initialized = false;

function getRandomInt(min: number, max: number): number {
  if (!initialized) {
    randomFillSync(randomCache);
    initialized = true;
  }
  // First we generate a random int between [0..range)
  const range = max - min;

  if (!(range <= RAND_MAX)) {
    throw new ERR_OUT_OF_RANGE(
      `max${max ? "" : " - min"}`,
      `<= ${RAND_MAX}`,
      range,
    );
  }

  // For (x % range) to produce an unbiased value greater than or equal to 0 and
  // less than range, x must be drawn randomly from the set of integers greater
  // than or equal to 0 and less than randLimit.
  const randLimit = RAND_MAX - (RAND_MAX % range);

  // If we don't have a callback, or if there is still data in the cache, we can
  // do this synchronously, which is super fast.
  while (randomCacheOffset <= randomCache.length) {
    if (randomCacheOffset === randomCache.length) {
      // This might block the thread for a bit, but we are in sync mode.
      randomFillSync(randomCache);
      randomCacheOffset = 0;
    }

    const x = randomCache.readUIntBE(randomCacheOffset, 6);
    randomCacheOffset += 6;
    if (x < randLimit) {
      return (x % range) + min;
    }
  }
  return 0; // Should be unreachable.
}

export type RandomIntCallback = (err: Error | null, n?: number) => void;
export function randomInt(max: number): number;
export function randomInt(min: number, max: number): number;
export function randomInt(max: number, callback: RandomIntCallback): void;
export function randomInt(
  min: number,
  max: number,
  callback: RandomIntCallback,
): void;
export function randomInt(
  minOrMax: number,
  maxOrCallback?: number | RandomIntCallback,
  callback?: RandomIntCallback,
): number | undefined {
  let min = 0;
  let max = 0;
  if (typeof callback === "function") {
    validateInteger(minOrMax, "min");
    validateInteger(maxOrCallback, "max");
    min = minOrMax;
    max = maxOrCallback;
  } else if (typeof maxOrCallback === "function") {
    min = 0;
    validateInteger(minOrMax, "max");
    max = minOrMax;
    callback = maxOrCallback;
  } else if (arguments.length === 2) {
    validateInteger(minOrMax, "min");
    validateInteger(maxOrCallback, "max");
    min = minOrMax;
    max = maxOrCallback;
  } else {
    min = 0;
    validateInteger(minOrMax, "max");
    max = minOrMax;
  }

  if (min >= max) {
    throw new ERR_OUT_OF_RANGE("min", "min < max", min);
  }

  if (callback != null) {
    new Promise<number>((res) => {
      res(getRandomInt(min, max));
    }).then(
      (n: number): void => {
        callback(null, n);
      },
      (err: unknown): void => {
        callback(err as Error);
      },
    );
  } else {
    return getRandomInt(min, max);
  }

  return undefined;
}

export function randomUUID(options?: RandomUUIDOptions): string {
  // While we do not actually use the entropy cache, we go ahead and validate
  // the input parameters as Node.js does.
  if (options !== undefined) {
    validateObject(options, "options");
    if (options.disableEntropyCache !== undefined) {
      validateBoolean(
        options.disableEntropyCache,
        "options.disableEntropyCache",
      );
    }
  }
  return crypto.randomUUID();
}
