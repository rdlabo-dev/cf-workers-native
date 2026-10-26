export type {
  CodecInput,
  CodecOptions,
  ZlibOptions,
  BrotliOptions,
  ZstdOptions,
  CodecInfo,
  CodecCallback,
} from "./public-types.js";
import type { CodecInput } from "./public-types.js";
import {
  viewBytes,
  isAnyBuffer,
  bufferBytes,
} from "../../shared/buffer-source.js";
import { Buffer } from "node:buffer";
import { validateUint32 } from "../net/validators.js";
import * as compression from "./compression.js";
export * from "./compression.js";
import * as classic from "./classic.js";
export * from "./classic.js";
export const codes = Object.freeze(
  Object.fromEntries(
    [
      "Z_OK",
      "Z_STREAM_END",
      "Z_NEED_DICT",
      "Z_ERRNO",
      "Z_STREAM_ERROR",
      "Z_DATA_ERROR",
      "Z_MEM_ERROR",
      "Z_BUF_ERROR",
      "Z_VERSION_ERROR",
    ].flatMap((name) => {
      const value = pinnedConstants[name as keyof typeof pinnedConstants];
      return [
        [name, value],
        [value, name],
      ];
    }),
  ),
);
import * as pinnedConstants from "./constants.js";
const topLevelConstants = {
  Z_NO_FLUSH: pinnedConstants.Z_NO_FLUSH,
  Z_PARTIAL_FLUSH: pinnedConstants.Z_PARTIAL_FLUSH,
  Z_SYNC_FLUSH: pinnedConstants.Z_SYNC_FLUSH,
  Z_FULL_FLUSH: pinnedConstants.Z_FULL_FLUSH,
  Z_FINISH: pinnedConstants.Z_FINISH,
  Z_BLOCK: pinnedConstants.Z_BLOCK,
  Z_OK: pinnedConstants.Z_OK,
  Z_STREAM_END: pinnedConstants.Z_STREAM_END,
  Z_NEED_DICT: pinnedConstants.Z_NEED_DICT,
  Z_ERRNO: pinnedConstants.Z_ERRNO,
  Z_STREAM_ERROR: pinnedConstants.Z_STREAM_ERROR,
  Z_DATA_ERROR: pinnedConstants.Z_DATA_ERROR,
  Z_MEM_ERROR: pinnedConstants.Z_MEM_ERROR,
  Z_BUF_ERROR: pinnedConstants.Z_BUF_ERROR,
  Z_VERSION_ERROR: pinnedConstants.Z_VERSION_ERROR,
  Z_NO_COMPRESSION: pinnedConstants.Z_NO_COMPRESSION,
  Z_BEST_SPEED: pinnedConstants.Z_BEST_SPEED,
  Z_BEST_COMPRESSION: pinnedConstants.Z_BEST_COMPRESSION,
  Z_DEFAULT_COMPRESSION: pinnedConstants.Z_DEFAULT_COMPRESSION,
  Z_FILTERED: pinnedConstants.Z_FILTERED,
  Z_HUFFMAN_ONLY: pinnedConstants.Z_HUFFMAN_ONLY,
  Z_RLE: pinnedConstants.Z_RLE,
  Z_FIXED: pinnedConstants.Z_FIXED,
  Z_DEFAULT_STRATEGY: pinnedConstants.Z_DEFAULT_STRATEGY,
  ZLIB_VERNUM: pinnedConstants.ZLIB_VERNUM,
  DEFLATE: pinnedConstants.DEFLATE,
  INFLATE: pinnedConstants.INFLATE,
  GZIP: pinnedConstants.GZIP,
  GUNZIP: pinnedConstants.GUNZIP,
  DEFLATERAW: pinnedConstants.DEFLATERAW,
  INFLATERAW: pinnedConstants.INFLATERAW,
  UNZIP: pinnedConstants.UNZIP,
  BROTLI_DECODE: pinnedConstants.BROTLI_DECODE,
  BROTLI_ENCODE: pinnedConstants.BROTLI_ENCODE,
  Z_MIN_WINDOWBITS: pinnedConstants.Z_MIN_WINDOWBITS,
  Z_MAX_WINDOWBITS: pinnedConstants.Z_MAX_WINDOWBITS,
  Z_DEFAULT_WINDOWBITS: pinnedConstants.Z_DEFAULT_WINDOWBITS,
  Z_MIN_CHUNK: pinnedConstants.Z_MIN_CHUNK,
  Z_MAX_CHUNK: pinnedConstants.Z_MAX_CHUNK,
  Z_DEFAULT_CHUNK: pinnedConstants.Z_DEFAULT_CHUNK,
  Z_MIN_MEMLEVEL: pinnedConstants.Z_MIN_MEMLEVEL,
  Z_MAX_MEMLEVEL: pinnedConstants.Z_MAX_MEMLEVEL,
  Z_DEFAULT_MEMLEVEL: pinnedConstants.Z_DEFAULT_MEMLEVEL,
  Z_MIN_LEVEL: pinnedConstants.Z_MIN_LEVEL,
  Z_MAX_LEVEL: pinnedConstants.Z_MAX_LEVEL,
  Z_DEFAULT_LEVEL: pinnedConstants.Z_DEFAULT_LEVEL,
  BROTLI_OPERATION_PROCESS: pinnedConstants.BROTLI_OPERATION_PROCESS,
  BROTLI_OPERATION_FLUSH: pinnedConstants.BROTLI_OPERATION_FLUSH,
  BROTLI_OPERATION_FINISH: pinnedConstants.BROTLI_OPERATION_FINISH,
  BROTLI_OPERATION_EMIT_METADATA:
    pinnedConstants.BROTLI_OPERATION_EMIT_METADATA,
  BROTLI_PARAM_MODE: pinnedConstants.BROTLI_PARAM_MODE,
  BROTLI_MODE_GENERIC: pinnedConstants.BROTLI_MODE_GENERIC,
  BROTLI_MODE_TEXT: pinnedConstants.BROTLI_MODE_TEXT,
  BROTLI_MODE_FONT: pinnedConstants.BROTLI_MODE_FONT,
  BROTLI_DEFAULT_MODE: pinnedConstants.BROTLI_DEFAULT_MODE,
  BROTLI_PARAM_QUALITY: pinnedConstants.BROTLI_PARAM_QUALITY,
  BROTLI_MIN_QUALITY: pinnedConstants.BROTLI_MIN_QUALITY,
  BROTLI_MAX_QUALITY: pinnedConstants.BROTLI_MAX_QUALITY,
  BROTLI_DEFAULT_QUALITY: pinnedConstants.BROTLI_DEFAULT_QUALITY,
  BROTLI_PARAM_LGWIN: pinnedConstants.BROTLI_PARAM_LGWIN,
  BROTLI_MIN_WINDOW_BITS: pinnedConstants.BROTLI_MIN_WINDOW_BITS,
  BROTLI_MAX_WINDOW_BITS: pinnedConstants.BROTLI_MAX_WINDOW_BITS,
  BROTLI_LARGE_MAX_WINDOW_BITS: pinnedConstants.BROTLI_LARGE_MAX_WINDOW_BITS,
  BROTLI_DEFAULT_WINDOW: pinnedConstants.BROTLI_DEFAULT_WINDOW,
  BROTLI_PARAM_LGBLOCK: pinnedConstants.BROTLI_PARAM_LGBLOCK,
  BROTLI_MIN_INPUT_BLOCK_BITS: pinnedConstants.BROTLI_MIN_INPUT_BLOCK_BITS,
  BROTLI_MAX_INPUT_BLOCK_BITS: pinnedConstants.BROTLI_MAX_INPUT_BLOCK_BITS,
  BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING:
    pinnedConstants.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING,
  BROTLI_PARAM_LARGE_WINDOW: pinnedConstants.BROTLI_PARAM_LARGE_WINDOW,
  BROTLI_PARAM_NPOSTFIX: pinnedConstants.BROTLI_PARAM_NPOSTFIX,
  BROTLI_PARAM_NDIRECT: pinnedConstants.BROTLI_PARAM_NDIRECT,
  BROTLI_DECODER_RESULT_ERROR: pinnedConstants.BROTLI_DECODER_RESULT_ERROR,
  BROTLI_DECODER_RESULT_SUCCESS: pinnedConstants.BROTLI_DECODER_RESULT_SUCCESS,
  BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT:
    pinnedConstants.BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT,
  BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT:
    pinnedConstants.BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT,
  BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION:
    pinnedConstants.BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION,
  BROTLI_DECODER_PARAM_LARGE_WINDOW:
    pinnedConstants.BROTLI_DECODER_PARAM_LARGE_WINDOW,
  BROTLI_DECODER_NO_ERROR: pinnedConstants.BROTLI_DECODER_NO_ERROR,
  BROTLI_DECODER_SUCCESS: pinnedConstants.BROTLI_DECODER_SUCCESS,
  BROTLI_DECODER_NEEDS_MORE_INPUT:
    pinnedConstants.BROTLI_DECODER_NEEDS_MORE_INPUT,
  BROTLI_DECODER_NEEDS_MORE_OUTPUT:
    pinnedConstants.BROTLI_DECODER_NEEDS_MORE_OUTPUT,
  BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE,
  BROTLI_DECODER_ERROR_FORMAT_RESERVED:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_RESERVED,
  BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE,
  BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET,
  BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME,
  BROTLI_DECODER_ERROR_FORMAT_CL_SPACE:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_CL_SPACE,
  BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE,
  BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT,
  BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1,
  BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2,
  BROTLI_DECODER_ERROR_FORMAT_TRANSFORM:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_TRANSFORM,
  BROTLI_DECODER_ERROR_FORMAT_DICTIONARY:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_DICTIONARY,
  BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS,
  BROTLI_DECODER_ERROR_FORMAT_PADDING_1:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_PADDING_1,
  BROTLI_DECODER_ERROR_FORMAT_PADDING_2:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_PADDING_2,
  BROTLI_DECODER_ERROR_FORMAT_DISTANCE:
    pinnedConstants.BROTLI_DECODER_ERROR_FORMAT_DISTANCE,
  BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET:
    pinnedConstants.BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET,
  BROTLI_DECODER_ERROR_INVALID_ARGUMENTS:
    pinnedConstants.BROTLI_DECODER_ERROR_INVALID_ARGUMENTS,
  BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES:
    pinnedConstants.BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES,
  BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS:
    pinnedConstants.BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS,
  BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP:
    pinnedConstants.BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP,
  BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1:
    pinnedConstants.BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1,
  BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2:
    pinnedConstants.BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2,
  BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES:
    pinnedConstants.BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES,
  BROTLI_DECODER_ERROR_UNREACHABLE:
    pinnedConstants.BROTLI_DECODER_ERROR_UNREACHABLE,
  ZSTD_ENCODE: pinnedConstants.ZSTD_ENCODE,
  ZSTD_DECODE: pinnedConstants.ZSTD_DECODE,
  ZSTD_COMPRESS: pinnedConstants.ZSTD_COMPRESS,
  ZSTD_DECOMPRESS: pinnedConstants.ZSTD_DECOMPRESS,
  ZSTD_error_no_error: pinnedConstants.ZSTD_error_no_error,
  ZSTD_error_GENERIC: pinnedConstants.ZSTD_error_GENERIC,
  ZSTD_error_prefix_unknown: pinnedConstants.ZSTD_error_prefix_unknown,
  ZSTD_error_version_unsupported:
    pinnedConstants.ZSTD_error_version_unsupported,
  ZSTD_error_frameParameter_unsupported:
    pinnedConstants.ZSTD_error_frameParameter_unsupported,
  ZSTD_error_frameParameter_windowTooLarge:
    pinnedConstants.ZSTD_error_frameParameter_windowTooLarge,
  ZSTD_error_corruption_detected:
    pinnedConstants.ZSTD_error_corruption_detected,
  ZSTD_error_checksum_wrong: pinnedConstants.ZSTD_error_checksum_wrong,
  ZSTD_error_literals_headerWrong:
    pinnedConstants.ZSTD_error_literals_headerWrong,
  ZSTD_error_dictionary_corrupted:
    pinnedConstants.ZSTD_error_dictionary_corrupted,
  ZSTD_error_dictionary_wrong: pinnedConstants.ZSTD_error_dictionary_wrong,
  ZSTD_error_dictionaryCreation_failed:
    pinnedConstants.ZSTD_error_dictionaryCreation_failed,
  ZSTD_error_parameter_unsupported:
    pinnedConstants.ZSTD_error_parameter_unsupported,
  ZSTD_error_parameter_combination_unsupported:
    pinnedConstants.ZSTD_error_parameter_combination_unsupported,
  ZSTD_error_parameter_outOfBound:
    pinnedConstants.ZSTD_error_parameter_outOfBound,
  ZSTD_error_tableLog_tooLarge: pinnedConstants.ZSTD_error_tableLog_tooLarge,
  ZSTD_error_maxSymbolValue_tooLarge:
    pinnedConstants.ZSTD_error_maxSymbolValue_tooLarge,
  ZSTD_error_maxSymbolValue_tooSmall:
    pinnedConstants.ZSTD_error_maxSymbolValue_tooSmall,
  ZSTD_error_stabilityCondition_notRespected:
    pinnedConstants.ZSTD_error_stabilityCondition_notRespected,
  ZSTD_error_stage_wrong: pinnedConstants.ZSTD_error_stage_wrong,
  ZSTD_error_init_missing: pinnedConstants.ZSTD_error_init_missing,
  ZSTD_error_memory_allocation: pinnedConstants.ZSTD_error_memory_allocation,
  ZSTD_error_workSpace_tooSmall: pinnedConstants.ZSTD_error_workSpace_tooSmall,
  ZSTD_error_dstSize_tooSmall: pinnedConstants.ZSTD_error_dstSize_tooSmall,
  ZSTD_error_srcSize_wrong: pinnedConstants.ZSTD_error_srcSize_wrong,
  ZSTD_error_dstBuffer_null: pinnedConstants.ZSTD_error_dstBuffer_null,
  ZSTD_error_noForwardProgress_destFull:
    pinnedConstants.ZSTD_error_noForwardProgress_destFull,
  ZSTD_error_noForwardProgress_inputEmpty:
    pinnedConstants.ZSTD_error_noForwardProgress_inputEmpty,
};
export const {
  Z_NO_FLUSH,
  Z_PARTIAL_FLUSH,
  Z_SYNC_FLUSH,
  Z_FULL_FLUSH,
  Z_FINISH,
  Z_BLOCK,
  Z_OK,
  Z_STREAM_END,
  Z_NEED_DICT,
  Z_ERRNO,
  Z_STREAM_ERROR,
  Z_DATA_ERROR,
  Z_MEM_ERROR,
  Z_BUF_ERROR,
  Z_VERSION_ERROR,
  Z_NO_COMPRESSION,
  Z_BEST_SPEED,
  Z_BEST_COMPRESSION,
  Z_DEFAULT_COMPRESSION,
  Z_FILTERED,
  Z_HUFFMAN_ONLY,
  Z_RLE,
  Z_FIXED,
  Z_DEFAULT_STRATEGY,
  ZLIB_VERNUM,
  DEFLATE,
  INFLATE,
  GZIP,
  GUNZIP,
  DEFLATERAW,
  INFLATERAW,
  UNZIP,
  BROTLI_DECODE,
  BROTLI_ENCODE,
  Z_MIN_WINDOWBITS,
  Z_MAX_WINDOWBITS,
  Z_DEFAULT_WINDOWBITS,
  Z_MIN_CHUNK,
  Z_MAX_CHUNK,
  Z_DEFAULT_CHUNK,
  Z_MIN_MEMLEVEL,
  Z_MAX_MEMLEVEL,
  Z_DEFAULT_MEMLEVEL,
  Z_MIN_LEVEL,
  Z_MAX_LEVEL,
  Z_DEFAULT_LEVEL,
  BROTLI_OPERATION_PROCESS,
  BROTLI_OPERATION_FLUSH,
  BROTLI_OPERATION_FINISH,
  BROTLI_OPERATION_EMIT_METADATA,
  BROTLI_PARAM_MODE,
  BROTLI_MODE_GENERIC,
  BROTLI_MODE_TEXT,
  BROTLI_MODE_FONT,
  BROTLI_DEFAULT_MODE,
  BROTLI_PARAM_QUALITY,
  BROTLI_MIN_QUALITY,
  BROTLI_MAX_QUALITY,
  BROTLI_DEFAULT_QUALITY,
  BROTLI_PARAM_LGWIN,
  BROTLI_MIN_WINDOW_BITS,
  BROTLI_MAX_WINDOW_BITS,
  BROTLI_LARGE_MAX_WINDOW_BITS,
  BROTLI_DEFAULT_WINDOW,
  BROTLI_PARAM_LGBLOCK,
  BROTLI_MIN_INPUT_BLOCK_BITS,
  BROTLI_MAX_INPUT_BLOCK_BITS,
  BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING,
  BROTLI_PARAM_LARGE_WINDOW,
  BROTLI_PARAM_NPOSTFIX,
  BROTLI_PARAM_NDIRECT,
  BROTLI_DECODER_RESULT_ERROR,
  BROTLI_DECODER_RESULT_SUCCESS,
  BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT,
  BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT,
  BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION,
  BROTLI_DECODER_PARAM_LARGE_WINDOW,
  BROTLI_DECODER_NO_ERROR,
  BROTLI_DECODER_SUCCESS,
  BROTLI_DECODER_NEEDS_MORE_INPUT,
  BROTLI_DECODER_NEEDS_MORE_OUTPUT,
  BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE,
  BROTLI_DECODER_ERROR_FORMAT_RESERVED,
  BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE,
  BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET,
  BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME,
  BROTLI_DECODER_ERROR_FORMAT_CL_SPACE,
  BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE,
  BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT,
  BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1,
  BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2,
  BROTLI_DECODER_ERROR_FORMAT_TRANSFORM,
  BROTLI_DECODER_ERROR_FORMAT_DICTIONARY,
  BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS,
  BROTLI_DECODER_ERROR_FORMAT_PADDING_1,
  BROTLI_DECODER_ERROR_FORMAT_PADDING_2,
  BROTLI_DECODER_ERROR_FORMAT_DISTANCE,
  BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET,
  BROTLI_DECODER_ERROR_INVALID_ARGUMENTS,
  BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES,
  BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS,
  BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP,
  BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1,
  BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2,
  BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES,
  BROTLI_DECODER_ERROR_UNREACHABLE,
  ZSTD_ENCODE,
  ZSTD_DECODE,
  ZSTD_COMPRESS,
  ZSTD_DECOMPRESS,
  ZSTD_error_no_error,
  ZSTD_error_GENERIC,
  ZSTD_error_prefix_unknown,
  ZSTD_error_version_unsupported,
  ZSTD_error_frameParameter_unsupported,
  ZSTD_error_frameParameter_windowTooLarge,
  ZSTD_error_corruption_detected,
  ZSTD_error_checksum_wrong,
  ZSTD_error_literals_headerWrong,
  ZSTD_error_dictionary_corrupted,
  ZSTD_error_dictionary_wrong,
  ZSTD_error_dictionaryCreation_failed,
  ZSTD_error_parameter_unsupported,
  ZSTD_error_parameter_combination_unsupported,
  ZSTD_error_parameter_outOfBound,
  ZSTD_error_tableLog_tooLarge,
  ZSTD_error_maxSymbolValue_tooLarge,
  ZSTD_error_maxSymbolValue_tooSmall,
  ZSTD_error_stabilityCondition_notRespected,
  ZSTD_error_stage_wrong,
  ZSTD_error_init_missing,
  ZSTD_error_memory_allocation,
  ZSTD_error_workSpace_tooSmall,
  ZSTD_error_dstSize_tooSmall,
  ZSTD_error_srcSize_wrong,
  ZSTD_error_dstBuffer_null,
  ZSTD_error_noForwardProgress_destFull,
  ZSTD_error_noForwardProgress_inputEmpty,
} = topLevelConstants;
export const constants = Object.freeze({ ...pinnedConstants });

function data(input: unknown): Uint8Array {
  if (typeof input === "string") return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return viewBytes(input);
  if (isAnyBuffer(input)) return bufferBytes(input);
  throw new TypeError(
    "Failed to execute 'crc32' on 'ZlibUtil': parameter 1 is not of type 'string or ArrayBuffer or ArrayBufferView'.",
  );
}
export function crc32(input: CodecInput, value = 0): number {
  validateUint32(value, "value");
  let crc = value ^ -1;
  for (const byte of data(input)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
export default {
  codes,
  ...classic,
  ...topLevelConstants,
  constants,
  ...compression,
  crc32,
};
