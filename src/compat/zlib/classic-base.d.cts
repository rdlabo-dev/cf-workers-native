import { Transform } from "node:stream";
import { Buffer } from "node:buffer";
declare class ZlibBase extends Transform {
  bytesWritten: number;
  bytesRead: number;
  readonly _closed: boolean;
  _finishFlushFlag: number;
  _processChunk(input: ArrayBufferView | ArrayBuffer, flush: number): Buffer;
  _processChunk(
    input: ArrayBufferView | ArrayBuffer,
    flush: number,
    callback: () => void,
  ): void;
  flush(callback?: () => void): void;
  flush(kind: number, callback?: () => void): void;
  reset(): void;
  close(callback?: () => void): void;
}
declare class Zlib extends ZlibBase {
  constructor(options: any, mode: number);
  params(level: number, strategy: number, callback: () => void): void;
}
declare class Brotli extends ZlibBase {
  constructor(options: any, mode: number);
}
declare class Zstd extends ZlibBase {
  constructor(options: any, mode: number, params: Int32Array, max: number);
}
declare const base: {
  Zlib: typeof Zlib;
  Brotli: typeof Brotli;
  Zstd: typeof Zstd;
  zstdInitCParamsArray: Int32Array;
  zstdInitDParamsArray: Int32Array;
  kMaxZstdCParam: number;
  kMaxZstdDParam: number;
};

export = base;
