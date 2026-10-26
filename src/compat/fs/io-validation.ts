// @ts-nocheck
// Adapted from cloudflare/workerd@5358e3d337336eaf696a48bc1563d808b10feba5.
// Copyright Cloudflare, Inc. Licensed under Apache-2.0; see LICENSE-APACHE.
import { Buffer } from "node:buffer";
import { validateInteger } from "../crypto/validation.js";
import { validateUint32 } from "../net/validators.js";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
} from "../net/errors.js";
const isArrayBufferView = ArrayBuffer.isView;
class ERR_BUFFER_OUT_OF_BOUNDS extends RangeError {
  code = "ERR_BUFFER_OUT_OF_BOUNDS";
  constructor(name) {
    super(`${name} is outside of buffer bounds`);
  }
}
function validateEncoding(value, encoding) {
  if (encoding !== undefined && !Buffer.isEncoding(encoding))
    throw new ERR_INVALID_ARG_VALUE("encoding", encoding);
}
export function getValidatedFd(fd) {
  validateInteger(fd, "fd", 0, 2147483647);
  return fd;
}
export function validatePosition(position, name) {
  if (typeof position === "number") validateUint32(position, name);
  else if (typeof position !== "bigint" && position !== null)
    throw new ERR_INVALID_ARG_TYPE(
      name,
      ["integer", "bigint", "null"],
      position,
    );
}
export function validateWriteArgs(
  fd: number,
  buffer: NodeJS.ArrayBufferView | string,
  offsetOrOptions: WriteSyncOptions | Position | undefined,
  length: number | ValidEncoding | undefined,
  position: Position | undefined,
): { fd: number; buffer: Buffer[]; position: Position } {
  fd = getValidatedFd(fd);

  let offset: number | undefined | null = offsetOrOptions as number;
  if (isArrayBufferView(buffer)) {
    if (typeof offsetOrOptions === "object" && offsetOrOptions != null) {
      ({
        offset = 0,
        length,
        position = null,
      } = offsetOrOptions as WriteSyncOptions);
      offset ??= 0;
      validateInteger(offset, "offset", 0);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (offset != null) {
        validateInteger(offset, "offset", 0);
      }
      offset ??= 0;
      position ??= null;
    }

    validatePosition(position, "position");
    if (offset > buffer.byteLength) {
      throw new ERR_BUFFER_OUT_OF_BOUNDS("offset");
    }
    length ??= buffer.byteLength - offset;
    validateInteger(length, "length", 0);
    if (length > buffer.byteLength - offset) {
      throw new ERR_BUFFER_OUT_OF_BOUNDS("length");
    }

    return {
      fd,
      buffer: [Buffer.from(buffer.buffer, buffer.byteOffset + offset, length)],
      position,
    };
  }

  if (typeof buffer !== "string") {
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["string", "Buffer", "TypedArray", "DataView"],
      buffer,
    );
  }

  // In this case, offsetOrOptions must either be a number, bigint, or null.
  validatePosition(offsetOrOptions, "position");
  position = offsetOrOptions;

  // In this instance, buffer is a string and the length arg specifies
  // the encoding to use.
  validateEncoding(buffer, length as string);
  return {
    fd,
    buffer: [Buffer.from(buffer, length as string /* encoding */)],
    position,
  };
}

export function validateReadArgs(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offsetOrOptions: ReadOptions | number | null,
  length: number | undefined,
  position: Position | undefined,
): { fd: number; buffer: Buffer[]; length: number; position: Position } {
  fd = getValidatedFd(fd);

  // Great fun with polymorphism here. We're going to normalize the arguments
  // to match the first signature (fd, buffer, offset, length, position).
  //
  // If the third argument is an object, then we will pull the offset, length,
  // and position from it, ignoring the remaining arguments. If the third
  // argument is a number, then we will use it as the offset and pull the
  // length and position from the fourth and fifth arguments. If the third
  // position is any other type, then we will throw an error.

  if (!isArrayBufferView(buffer)) {
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["Buffer", "TypedArray", "DataView"],
      buffer,
    );
  }

  let actualOffset: number;
  let actualLength: number;
  let actualPosition = position;

  // Handle the case where the third argument is an options object
  if (offsetOrOptions != null && typeof offsetOrOptions === "object") {
    const {
      offset = 0,
      length = buffer.byteLength - offset,
      position = null,
    } = offsetOrOptions;
    actualOffset = offset;
    actualLength = length;
    actualPosition = position;
  }
  // Handle the case where the third argument is a number (offset)
  else if (typeof offsetOrOptions === "number") {
    actualOffset = offsetOrOptions;
    actualLength = length ?? buffer.byteLength - offsetOrOptions;
    actualPosition = position;
  } else {
    throw new ERR_INVALID_ARG_TYPE(
      "offset",
      ["number", "object"],
      offsetOrOptions,
    );
  }

  validateUint32(actualOffset, "offset");
  validateUint32(actualLength, "length");
  validatePosition(actualPosition, "position");

  // As in Node, a zero-length read is a no-op regardless of offset.
  if (actualLength === 0) {
    return { fd, buffer: [], length: 0, position: actualPosition };
  }

  if (actualOffset + actualLength > buffer.byteLength) {
    throw new ERR_OUT_OF_RANGE(
      "length",
      `<= ${buffer.byteLength - actualOffset}`,
      actualLength,
    );
  }

  return {
    fd,
    buffer: [
      Buffer.from(
        buffer.buffer,
        buffer.byteOffset + actualOffset,
        actualLength,
      ),
    ],
    length: actualLength,
    position: actualPosition,
  };
}
