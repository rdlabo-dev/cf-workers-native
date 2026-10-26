import type { Buffer } from "node:buffer";
import type { TransformOptions } from "node:stream";

export type CodecInput = string | ArrayBufferLike | ArrayBufferView;
export interface CodecOptions extends Omit<TransformOptions, "flush"> {
  flush?: number;
  finishFlush?: number;
  chunkSize?: number;
  maxOutputLength?: number;
  info?: boolean;
}
export interface ZlibOptions extends CodecOptions {
  windowBits?: number;
  level?: number;
  memLevel?: number;
  strategy?: number;
  dictionary?: ArrayBufferLike | ArrayBufferView;
}
export interface BrotliOptions extends CodecOptions {
  params?: Record<number, number | boolean>;
}
export interface ZstdOptions extends CodecOptions {
  params?: Record<number, number | boolean>;
  pledgedSrcSize?: number;
}
export interface CodecInfo<Engine> {
  buffer: Buffer;
  engine: Engine;
}
export type CodecCallback<Result> = (
  error: Error | null,
  result: Result | undefined,
) => void;
export interface SyncCodec<Options extends CodecOptions, Engine> {
  (input: CodecInput, options: Options & { info: true }): CodecInfo<Engine>;
  (input: CodecInput, options?: Options & { info?: false }): Buffer;
  (input: CodecInput, options?: Options): Buffer | CodecInfo<Engine>;
}
export interface AsyncCodec<Options extends CodecOptions, Engine> {
  (input: CodecInput, callback: CodecCallback<Buffer>): void;
  (
    input: CodecInput,
    options: Options & { info: true },
    callback: CodecCallback<CodecInfo<Engine>>,
  ): void;
  (
    input: CodecInput,
    options: Options & { info?: false },
    callback: CodecCallback<Buffer>,
  ): void;
  (
    input: CodecInput,
    options: Options,
    callback: CodecCallback<Buffer | CodecInfo<Engine>>,
  ): void;
}
