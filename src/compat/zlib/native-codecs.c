// Thin bindings to the pinned upstream codecs; see build-native-codecs.mjs.
#include <stdint.h>
#include <stdlib.h>
#include <emscripten/emscripten.h>
#include <zstd.h>
#include <brotli/encode.h>
#include <brotli/decode.h>
#define API EMSCRIPTEN_KEEPALIVE

API void* z_create(int encode) { return encode ? (void*)ZSTD_createCCtx() : (void*)ZSTD_createDCtx(); }
API void z_free(void* ctx, int encode) { if (encode) ZSTD_freeCCtx(ctx); else ZSTD_freeDCtx(ctx); }
API size_t z_param(void* ctx, int encode, int id, int value) {
  return encode ? ZSTD_CCtx_setParameter(ctx, (ZSTD_cParameter)id, value) : ZSTD_DCtx_setParameter(ctx, (ZSTD_dParameter)id, value);
}
API size_t z_reset(void* ctx, int encode) {
  return encode ? ZSTD_CCtx_reset(ctx, ZSTD_reset_session_only) : ZSTD_DCtx_reset(ctx, ZSTD_reset_session_only);
}
API size_t z_process(void* ctx, int encode, const void* src, size_t len, void* dst, size_t capacity, int operation, uint32_t* state) {
  ZSTD_inBuffer in = { src, len, 0 };
  ZSTD_outBuffer out = { dst, capacity, 0 };
  size_t result = encode ? ZSTD_compressStream2(ctx, &out, &in, (ZSTD_EndDirective)operation) : ZSTD_decompressStream(ctx, &out, &in);
  state[0] = in.pos; state[1] = out.pos;
  return result;
}
API int z_is_error(size_t code) { return ZSTD_isError(code); }
API const char* z_error(size_t code) { return ZSTD_getErrorName(code); }
API size_t z_size64(void* ctx, uint32_t low, uint32_t high) { return ZSTD_CCtx_setPledgedSrcSize(ctx, ((uint64_t)high << 32) | low); }
API size_t z_size(void* ctx, uint32_t length) { return ZSTD_CCtx_setPledgedSrcSize(ctx, length); }

API void* b_create(int encode) { return encode ? (void*)BrotliEncoderCreateInstance(NULL, NULL, NULL) : (void*)BrotliDecoderCreateInstance(NULL, NULL, NULL); }
API void b_free(void* ctx, int encode) { if (encode) BrotliEncoderDestroyInstance(ctx); else BrotliDecoderDestroyInstance(ctx); }
API int b_param(void* ctx, int encode, int id, uint32_t value) {
  return encode ? BrotliEncoderSetParameter(ctx, (BrotliEncoderParameter)id, value) : BrotliDecoderSetParameter(ctx, (BrotliDecoderParameter)id, value);
}
API int b_process(void* ctx, int encode, const uint8_t* src, size_t len, uint8_t* dst, size_t capacity, int operation, uint32_t* state) {
  size_t available_in = len, available_out = capacity;
  int result;
  if (encode) {
    result = BrotliEncoderCompressStream(ctx, (BrotliEncoderOperation)operation, &available_in, &src, &available_out, &dst, NULL);
    if (result) result = BrotliEncoderIsFinished(ctx) ? 1 : BrotliEncoderHasMoreOutput(ctx) ? 3 : 2;
  } else result = BrotliDecoderDecompressStream(ctx, &available_in, &src, &available_out, &dst, NULL);
  state[0] = len - available_in; state[1] = capacity - available_out;
  return result;
}
API int b_error(void* ctx) { return BrotliDecoderGetErrorCode(ctx); }
API const char* b_error_string(int code) { return BrotliDecoderErrorString((BrotliDecoderErrorCode)code); }
