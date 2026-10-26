import * as z from "../../src/compat/zlib/index.js";
import defaultZlib from "../../src/compat/zlib/index.js";
import type { Buffer } from "node:buffer";
type IsAny<T> = 0 extends 1 & T ? true : false;
const input = new Uint8Array([1, 2, 3]);
const info: boolean = Math.random() > 0.5;
{
  const plain: Buffer = z.deflateSync(input);
  const explicit: Buffer = z.deflateSync(input, { info: false });
  const detail = z.deflateSync(input, { info: true });
  const engine: z.Deflate = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.Deflate> = z.deflateSync(input, {
    info,
  });
  z.deflate(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.deflate(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.Deflate = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.deflate(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.Deflate> = result;
    void maybe;
  });
  const stream = new z.Deflate({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.deflateSync({});
  // @ts-expect-error Callback is required.
  z.deflate(input);
  // @ts-expect-error Invalid numeric option type.
  z.createDeflate({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.inflateSync(input);
  const explicit: Buffer = z.inflateSync(input, { info: false });
  const detail = z.inflateSync(input, { info: true });
  const engine: z.Inflate = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.Inflate> = z.inflateSync(input, {
    info,
  });
  z.inflate(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.inflate(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.Inflate = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.inflate(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.Inflate> = result;
    void maybe;
  });
  const stream = new z.Inflate({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.inflateSync({});
  // @ts-expect-error Callback is required.
  z.inflate(input);
  // @ts-expect-error Invalid numeric option type.
  z.createInflate({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.gzipSync(input);
  const explicit: Buffer = z.gzipSync(input, { info: false });
  const detail = z.gzipSync(input, { info: true });
  const engine: z.Gzip = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.Gzip> = z.gzipSync(input, { info });
  z.gzip(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.gzip(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.Gzip = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.gzip(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.Gzip> = result;
    void maybe;
  });
  const stream = new z.Gzip({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.gzipSync({});
  // @ts-expect-error Callback is required.
  z.gzip(input);
  // @ts-expect-error Invalid numeric option type.
  z.createGzip({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.gunzipSync(input);
  const explicit: Buffer = z.gunzipSync(input, { info: false });
  const detail = z.gunzipSync(input, { info: true });
  const engine: z.Gunzip = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.Gunzip> = z.gunzipSync(input, { info });
  z.gunzip(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.gunzip(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.Gunzip = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.gunzip(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.Gunzip> = result;
    void maybe;
  });
  const stream = new z.Gunzip({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.gunzipSync({});
  // @ts-expect-error Callback is required.
  z.gunzip(input);
  // @ts-expect-error Invalid numeric option type.
  z.createGunzip({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.deflateRawSync(input);
  const explicit: Buffer = z.deflateRawSync(input, { info: false });
  const detail = z.deflateRawSync(input, { info: true });
  const engine: z.DeflateRaw = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.DeflateRaw> = z.deflateRawSync(input, {
    info,
  });
  z.deflateRaw(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.deflateRaw(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.DeflateRaw = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.deflateRaw(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.DeflateRaw> = result;
    void maybe;
  });
  const stream = new z.DeflateRaw({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.deflateRawSync({});
  // @ts-expect-error Callback is required.
  z.deflateRaw(input);
  // @ts-expect-error Invalid numeric option type.
  z.createDeflateRaw({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.inflateRawSync(input);
  const explicit: Buffer = z.inflateRawSync(input, { info: false });
  const detail = z.inflateRawSync(input, { info: true });
  const engine: z.InflateRaw = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.InflateRaw> = z.inflateRawSync(input, {
    info,
  });
  z.inflateRaw(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.inflateRaw(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.InflateRaw = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.inflateRaw(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.InflateRaw> = result;
    void maybe;
  });
  const stream = new z.InflateRaw({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.inflateRawSync({});
  // @ts-expect-error Callback is required.
  z.inflateRaw(input);
  // @ts-expect-error Invalid numeric option type.
  z.createInflateRaw({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.unzipSync(input);
  const explicit: Buffer = z.unzipSync(input, { info: false });
  const detail = z.unzipSync(input, { info: true });
  const engine: z.Unzip = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.Unzip> = z.unzipSync(input, { info });
  z.unzip(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.unzip(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.Unzip = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.unzip(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.Unzip> = result;
    void maybe;
  });
  const stream = new z.Unzip({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.unzipSync({});
  // @ts-expect-error Callback is required.
  z.unzip(input);
  // @ts-expect-error Invalid numeric option type.
  z.createUnzip({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.brotliCompressSync(input);
  const explicit: Buffer = z.brotliCompressSync(input, { info: false });
  const detail = z.brotliCompressSync(input, { info: true });
  const engine: z.BrotliCompress = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.BrotliCompress> = z.brotliCompressSync(
    input,
    { info },
  );
  z.brotliCompress(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.brotliCompress(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.BrotliCompress = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.brotliCompress(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.BrotliCompress> = result;
    void maybe;
  });
  const stream = new z.BrotliCompress({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.brotliCompressSync({});
  // @ts-expect-error Callback is required.
  z.brotliCompress(input);
  // @ts-expect-error Invalid numeric option type.
  z.createBrotliCompress({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.brotliDecompressSync(input);
  const explicit: Buffer = z.brotliDecompressSync(input, { info: false });
  const detail = z.brotliDecompressSync(input, { info: true });
  const engine: z.BrotliDecompress = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.BrotliDecompress> =
    z.brotliDecompressSync(input, { info });
  z.brotliDecompress(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.brotliDecompress(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.BrotliDecompress = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.brotliDecompress(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.BrotliDecompress> = result;
    void maybe;
  });
  const stream = new z.BrotliDecompress({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.brotliDecompressSync({});
  // @ts-expect-error Callback is required.
  z.brotliDecompress(input);
  // @ts-expect-error Invalid numeric option type.
  z.createBrotliDecompress({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.zstdCompressSync(input);
  const explicit: Buffer = z.zstdCompressSync(input, { info: false });
  const detail = z.zstdCompressSync(input, { info: true });
  const engine: z.ZstdCompress = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.ZstdCompress> = z.zstdCompressSync(
    input,
    { info },
  );
  z.zstdCompress(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.zstdCompress(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.ZstdCompress = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.zstdCompress(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.ZstdCompress> = result;
    void maybe;
  });
  const stream = new z.ZstdCompress({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.zstdCompressSync({});
  // @ts-expect-error Callback is required.
  z.zstdCompress(input);
  // @ts-expect-error Invalid numeric option type.
  z.createZstdCompress({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}
{
  const plain: Buffer = z.zstdDecompressSync(input);
  const explicit: Buffer = z.zstdDecompressSync(input, { info: false });
  const detail = z.zstdDecompressSync(input, { info: true });
  const engine: z.ZstdDecompress = detail.engine;
  const data: Buffer = detail.buffer;
  const dynamic: Buffer | z.CodecInfo<z.ZstdDecompress> = z.zstdDecompressSync(
    input,
    { info },
  );
  z.zstdDecompress(input, (error, result) => {
    if (error || result === undefined) return;
    const buffer: Buffer = result;
    const typed: IsAny<typeof result> = false;
    void [buffer, typed];
  });
  z.zstdDecompress(input, { info: true }, (error, result) => {
    if (error || result === undefined) return;
    const engine: z.ZstdDecompress = result.engine;
    const buffer: Buffer = result.buffer;
    void [engine, buffer];
  });
  z.zstdDecompress(input, { info }, (error, result) => {
    if (error || result === undefined) return;
    const maybe: Buffer | z.CodecInfo<z.ZstdDecompress> = result;
    void maybe;
  });
  const stream = new z.ZstdDecompress({ chunkSize: 1024 });
  const count: number = stream.bytesWritten;
  stream.flush(() => {});
  stream.flush(0, () => {});
  stream.reset();
  stream.close(() => {});
  stream.end(input);
  // @ts-expect-error Plain objects are not codec inputs.
  z.zstdDecompressSync({});
  // @ts-expect-error Callback is required.
  z.zstdDecompress(input);
  // @ts-expect-error Invalid numeric option type.
  z.createZstdDecompress({ chunkSize: "large" });
  void [plain, explicit, engine, data, dynamic, count];
}

const normal: Buffer = defaultZlib.gzipSync("text");
const checksum: number = z.crc32(new DataView(new ArrayBuffer(4)));
z.deflateSync(new SharedArrayBuffer(4), {
  dictionary: new DataView(new ArrayBuffer(4)),
});
z.brotliCompressSync(input, {
  params: { [z.constants.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING]: true },
});
z.zstdCompressSync(input, {
  params: { [z.constants.ZSTD_c_checksumFlag]: true },
  pledgedSrcSize: 3,
});
z.createDeflate().params(1, 0, () => {});
// @ts-expect-error Brotli has no zlib params method.
z.createBrotliCompress().params(1, 0, () => {});
// @ts-expect-error Zstd has no zlib params method.
z.createZstdCompress().params(1, 0, () => {});
// @ts-expect-error crc32 requires byte input or text.
z.crc32(Symbol("invalid"));
// @ts-expect-error A callback cannot promise output on failure.
z.gzip(input, (error: Error | null, result: Buffer) => {});
void [normal, checksum];

// Workers rejects an explicit undefined options argument in the three-argument form.
// @ts-expect-error Omit options with the two-argument form instead.
z.deflate(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.inflate(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.gzip(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.gunzip(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.deflateRaw(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.inflateRaw(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.unzip(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.brotliCompress(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.brotliDecompress(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.zstdCompress(input, undefined, () => {});
// @ts-expect-error Omit options with the two-argument form instead.
z.zstdDecompress(input, undefined, () => {});
