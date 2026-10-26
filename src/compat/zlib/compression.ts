import type {
  BrotliOptions,
  ZstdOptions,
  SyncCodec,
  AsyncCodec,
} from "./public-types.js";
import {
  nativeNumber,
  codecBytes,
  assertCodecInput,
  nativeInt32,
  optionInteger as integer,
} from "./input.js";
import { isAnyBuffer } from "../../shared/buffer-source.js";
import { Buffer } from "node:buffer";
import { NativeCodec, type Kind } from "./native-codecs.js";
import { ERR_INVALID_ARG_TYPE } from "../net/errors.js";
import {
  Brotli,
  Zstd,
  zstdInitCParamsArray,
  zstdInitDParamsArray,
  kMaxZstdCParam,
  kMaxZstdDParam,
} from "./classic-base.cjs";
export class BrotliCompress extends Brotli {
  constructor(options?: BrotliOptions) {
    super(options, 9);
  }
}
export class BrotliDecompress extends Brotli {
  constructor(options?: BrotliOptions) {
    super(options, 8);
  }
}
export class ZstdCompress extends Zstd {
  constructor(options?: ZstdOptions) {
    super(options, 10, zstdInitCParamsArray, kMaxZstdCParam);
  }
}
export class ZstdDecompress extends Zstd {
  constructor(options?: ZstdOptions) {
    super(options, 11, zstdInitDParamsArray, kMaxZstdDParam);
  }
}
export const createBrotliCompress = (options?: BrotliOptions) =>
  new BrotliCompress(options);
export const createBrotliDecompress = (options?: BrotliOptions) =>
  new BrotliDecompress(options);
export const createZstdCompress = (options?: ZstdOptions) =>
  new ZstdCompress(options);
export const createZstdDecompress = (options?: ZstdOptions) =>
  new ZstdDecompress(options);

function bytes(value: unknown, method: string): Uint8Array {
  if (typeof value === "string") return Buffer.from(value);
  if (ArrayBuffer.isView(value) || isAnyBuffer(value)) return codecBytes(value);
  throw new TypeError(
    `Failed to execute '${method}' on 'ZlibUtil': parameter 1 is not of type 'string or ArrayBuffer or ArrayBufferView'.`,
  );
}

function pledged(value: any) {
  if (value === undefined) return undefined;
  const number = nativeNumber(value);
  if (!Number.isFinite(number) || number < 0 || number >= 18446744073709551616)
    throw new TypeError(
      "The value cannot be converted because it is not an integer.",
    );
  return Math.trunc(number);
}
function convert(options: any, kind: Kind) {
  if (!options || typeof options !== "object")
    throw new TypeError("Options must be an object");
  const flush = integer(options.flush, 0, false);
  const finishFlush = integer(options.finishFlush, 2, false);
  const chunkSize = integer(options.chunkSize, 16384);
  const parameters = options.params;
  if (
    parameters !== undefined &&
    (!parameters || typeof parameters !== "object")
  )
    throw new TypeError(
      "Incorrect type for the 'params' field on 'Options': the provided value is not of type 'object'.",
    );
  const params: Record<string, number> = Object.create(null);
  for (const key of Object.keys(parameters ?? {}))
    params[key] = nativeInt32(parameters[key]);
  const maxOutputLength = integer(options.maxOutputLength, 134217728);
  return {
    flush,
    finishFlush,
    chunkSize,
    params,
    maxOutputLength,
    pledged: kind === "zstd" ? pledged(options.pledgedSrcSize) : undefined,
  };
}

function bounded(value: number, name: string, min: number, max: number) {
  if (value < min || value > max)
    throw new RangeError(
      `The value of "options.${name}" is out of range. It must be >= ${min} and <= ${max}. Received ${value}`,
    );
}
function fast(
  kind: Kind,
  encode: boolean,
  data: Uint8Array,
  config: ReturnType<typeof convert>,
) {
  bounded(config.chunkSize, "chunkSize", 64, 134217728);
  bounded(config.maxOutputLength, "maxOutputLength", 1, 134217728);
  for (const key of Object.keys(config.params))
    if (!/^[+-]?\d+$/.test(key)) throw new Error("Invalid parameter name");
  const codec = new NativeCodec(
    kind,
    encode,
    Math.min(16384, config.maxOutputLength),
    config.params,
    config.pledged ?? (encode && kind === "zstd" ? data.length : undefined),
  );
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    bounded(config.flush, "flush", 0, kind === "brotli" ? 3 : 2);
    bounded(config.finishFlush, "finishFlush", 0, kind === "brotli" ? 3 : 2);
    assertCodecInput(data);
    codec.process(data, config.finishFlush, (output) => {
      length += output.length;
      if (length > config.maxOutputLength)
        throw kind === "zstd" && encode
          ? new Error("Unexpected end of file")
          : new RangeError("Memory limit exceeded");
      chunks.push(output);
    });
    return Buffer.concat(chunks, length);
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof RangeError ||
      (error instanceof Error &&
        ["Unexpected end of file", "unexpected end of file"].includes(
          error.message,
        ))
    )
      throw error;
    if (
      kind === "zstd" &&
      !encode &&
      (error as { code?: string })?.code === "ZSTD_ERROR"
    )
      throw new Error(`Zstd decompression failed: ${(error as Error).message}`);
    throw new Error("Compression failed");
  } finally {
    codec.close();
  }
}
function engine(kind: Kind, encode: boolean, options: any) {
  return new (
    kind === "brotli"
      ? encode
        ? BrotliCompress
        : BrotliDecompress
      : encode
        ? ZstdCompress
        : ZstdDecompress
  )(options);
}
function sync(kind: Kind, encode: boolean, input: unknown, options: any = {}) {
  if (options.info) {
    const instance = engine(kind, encode, options);
    return {
      buffer: instance._processChunk(
        typeof input === "string"
          ? Buffer.from(input)
          : (input as ArrayBufferView),
        instance._finishFlushFlag,
      ),
      engine: instance,
    };
  }
  return fast(
    kind,
    encode,
    bytes(input, `${kind}${encode ? "Compress" : "Decompress"}Sync`),
    convert(options, kind),
  );
}
function asyncOperation(
  kind: Kind,
  encode: boolean,
  input: unknown,
  options: any,
  callback?: any,
) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  if (typeof callback !== "function")
    throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
  let run: () => unknown;
  if (options.info) {
    const instance = engine(kind, encode, options);
    run = () => ({
      buffer: instance._processChunk(
        typeof input === "string"
          ? Buffer.from(input)
          : (input as ArrayBufferView),
        instance._finishFlushFlag,
      ),
      engine: instance,
    });
  } else {
    const data = bytes(input, `${kind}${encode ? "Compress" : "Decompress"}`),
      config = convert(options, kind);
    run = () => fast(kind, encode, data, config);
  }
  let result: unknown, error: unknown;
  try {
    result = run();
  } catch (failure) {
    error = failure;
  }
  queueMicrotask(() => (error ? callback(error) : callback(null, result)));
}
export const brotliCompressSync: SyncCodec<BrotliOptions, BrotliCompress> = ((
  input: unknown,
  options?: any,
) => sync("brotli", true, input, options)) as SyncCodec<
  BrotliOptions,
  BrotliCompress
>;
export const brotliDecompressSync: SyncCodec<BrotliOptions, BrotliDecompress> =
  ((input: unknown, options?: any) =>
    sync("brotli", false, input, options)) as SyncCodec<
    BrotliOptions,
    BrotliDecompress
  >;
export const zstdCompressSync: SyncCodec<ZstdOptions, ZstdCompress> = ((
  input: unknown,
  options?: any,
) => sync("zstd", true, input, options)) as SyncCodec<
  ZstdOptions,
  ZstdCompress
>;
export const zstdDecompressSync: SyncCodec<ZstdOptions, ZstdDecompress> = ((
  input: unknown,
  options?: any,
) => sync("zstd", false, input, options)) as SyncCodec<
  ZstdOptions,
  ZstdDecompress
>;
export const brotliCompress: AsyncCodec<BrotliOptions, BrotliCompress> = ((
  input: unknown,
  options?: any,
  callback?: any,
) => asyncOperation("brotli", true, input, options, callback)) as AsyncCodec<
  BrotliOptions,
  BrotliCompress
>;
export const brotliDecompress: AsyncCodec<BrotliOptions, BrotliDecompress> = ((
  input: unknown,
  options?: any,
  callback?: any,
) => asyncOperation("brotli", false, input, options, callback)) as AsyncCodec<
  BrotliOptions,
  BrotliDecompress
>;
export const zstdCompress: AsyncCodec<ZstdOptions, ZstdCompress> = ((
  input: unknown,
  options?: any,
  callback?: any,
) => asyncOperation("zstd", true, input, options, callback)) as AsyncCodec<
  ZstdOptions,
  ZstdCompress
>;
export const zstdDecompress: AsyncCodec<ZstdOptions, ZstdDecompress> = ((
  input: unknown,
  options?: any,
  callback?: any,
) => asyncOperation("zstd", false, input, options, callback)) as AsyncCodec<
  ZstdOptions,
  ZstdDecompress
>;
