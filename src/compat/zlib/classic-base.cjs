// Derived from Cloudflare workerd 5358e3d337336eaf696a48bc1563d808b10feba5
// Copyright (c) 2017-2022 Cloudflare, Inc. Apache-2.0.
// Copyright Joyent and Node contributors. MIT license.
// Native binding imports adapted for the WebView implementation.
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (
  (target = mod != null ? __create(__getProtoOf(mod)) : {}),
  __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule
      ? __defProp(target, "default", { value: mod, enumerable: true })
      : target,
    mod,
  )
);
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  Brotli: () => Brotli,
  Zlib: () => Zlib,
  ZlibBase: () => ZlibBase,
  Zstd: () => Zstd,
  kMaxZstdCParam: () => kMaxZstdCParam,
  kMaxZstdDParam: () => kMaxZstdDParam,
  owner_symbol: () => owner_symbol,
  zstdInitCParamsArray: () => zstdInitCParamsArray,
  zstdInitDParamsArray: () => zstdInitDParamsArray,
});

var import_classic_binding = __toESM(require("./classic-binding.js"));
var import_node_buffer = require("node:buffer");
var import_validators = require("./validators.js");
var import_errors = require("./errors.js");
var import_node_stream = require("node:stream");
var import_node_stream2 = require("node:stream");
var import_types = require("node:util/types");
var constants = __toESM(require("./constants.js"));
var import_node_assert = __toESM(require("node:assert"));
const {
  CONST_INFLATE,
  CONST_GUNZIP,
  CONST_GZIP,
  CONST_UNZIP,
  CONST_Z_DEFAULT_CHUNK,
  CONST_Z_DEFAULT_STRATEGY,
  CONST_Z_DEFAULT_MEMLEVEL,
  CONST_Z_DEFAULT_WINDOWBITS,
  CONST_Z_DEFAULT_COMPRESSION,
  CONST_Z_FIXED,
  CONST_Z_MAX_LEVEL,
  CONST_Z_MAX_MEMLEVEL,
  CONST_Z_MAX_WINDOWBITS,
  CONST_Z_MIN_LEVEL,
  CONST_Z_MIN_MEMLEVEL,
  CONST_Z_SYNC_FLUSH,
  CONST_Z_NO_FLUSH,
  CONST_Z_BLOCK,
  CONST_Z_MIN_CHUNK,
  CONST_Z_PARTIAL_FLUSH,
  CONST_Z_FULL_FLUSH,
  CONST_Z_FINISH,
  CONST_BROTLI_ENCODE,
  CONST_BROTLI_DECODE,
  CONST_BROTLI_OPERATION_PROCESS,
  CONST_BROTLI_OPERATION_EMIT_METADATA,
  CONST_BROTLI_OPERATION_FINISH,
  CONST_BROTLI_OPERATION_FLUSH,
  CONST_ZSTD_ENCODE,
  CONST_ZSTD_DECODE,
  CONST_ZSTD_e_continue,
  CONST_ZSTD_e_end,
  CONST_ZSTD_e_flush,
} = import_classic_binding.default;
const owner_symbol = /* @__PURE__ */ Symbol("owner");
const FLUSH_BOUND_IDX_NORMAL = 0;
const FLUSH_BOUND_IDX_BROTLI = 1;
const FLUSH_BOUND_IDX_ZSTD = 2;
const FLUSH_BOUND = [
  [CONST_Z_NO_FLUSH, CONST_Z_BLOCK],
  [CONST_BROTLI_OPERATION_PROCESS, CONST_BROTLI_OPERATION_EMIT_METADATA],
  [CONST_ZSTD_e_continue, CONST_ZSTD_e_end],
];
const kFlushFlag = /* @__PURE__ */ Symbol("kFlushFlag");
const kError = /* @__PURE__ */ Symbol("kError");
function processCallback() {
  const handle = this;
  const self = this[owner_symbol];
  (0, import_node_assert.ok)(self, "Owner symbol should exist");
  const state = self._writeState;
  if (self.destroyed) {
    this.buffer = null;
    this.cb();
    return;
  }
  const availOutAfter = state[0];
  const availInAfter = state[1];
  const inDelta = handle.availInBefore - availInAfter;
  self.bytesWritten += inDelta;
  const have = handle.availOutBefore - availOutAfter;
  let streamBufferIsFull = false;
  if (have > 0) {
    const out = self._outBuffer.slice(self._outOffset, self._outOffset + have);
    self._outOffset += have;
    streamBufferIsFull = !self.push(out);
  } else {
    import_node_assert.default.strictEqual(have, 0, "have should not go down");
  }
  if (self.destroyed) {
    this.cb();
    return;
  }
  if (availOutAfter === 0 || self._outOffset >= self._chunkSize) {
    handle.availOutBefore = self._chunkSize;
    self._outOffset = 0;
    self._outBuffer = import_node_buffer.Buffer.allocUnsafe(self._chunkSize);
  }
  if (availOutAfter === 0) {
    handle.inOff += inDelta;
    handle.availInBefore = availInAfter;
    if (!streamBufferIsFull) {
      (0, import_node_assert.ok)(
        this.buffer,
        "Buffer should not have been null",
      );
      this.write(
        handle.flushFlag,
        this.buffer,
        // in
        handle.inOff,
        // in_off
        handle.availInBefore,
        // in_len
        self._outBuffer,
        // out
        self._outOffset,
        // out_off
        self._chunkSize,
      );
    } else {
      const oldRead = self._read;
      self._read = (n) => {
        (0, import_node_assert.ok)(
          this.buffer,
          "Buffer should not have been null",
        );
        self._read = oldRead;
        this.write(
          handle.flushFlag,
          this.buffer,
          // in
          handle.inOff,
          // in_off
          handle.availInBefore,
          // in_len
          self._outBuffer,
          // out
          self._outOffset,
          // out_off
          self._chunkSize,
          // out_len
        );
        self._read(n);
      };
    }
    return;
  }
  if (availInAfter > 0) {
    self.push(null);
  }
  this.buffer = null;
  this.cb();
}
const flushiness = [];
const kFlushFlagList = [
  CONST_Z_NO_FLUSH,
  CONST_Z_BLOCK,
  CONST_Z_PARTIAL_FLUSH,
  CONST_Z_SYNC_FLUSH,
  CONST_Z_FULL_FLUSH,
  CONST_Z_FINISH,
];
for (let i = 0; i < kFlushFlagList.length; i++) {
  flushiness[kFlushFlagList[i]] = i;
}
function maxFlush(a, b) {
  return flushiness[a] > flushiness[b] ? a : b;
}
const kFlushBuffers = [];
{
  const dummyArrayBuffer = new ArrayBuffer(0);
  for (const flushFlag of kFlushFlagList) {
    const buf = import_node_buffer.Buffer.from(dummyArrayBuffer);
    buf[kFlushFlag] = flushFlag;
    kFlushBuffers[flushFlag] = buf;
  }
}
function zlibOnError(errno, code, message) {
  const self = this[owner_symbol];
  (0, import_node_assert.ok)(self, "Owner symbol should exist");
  const error = new import_errors.NodeError(code, message);
  error.errno = errno;
  self.destroy(error);
  self[kError] = error;
}
function processChunkSync(self, chunk, flushFlag) {
  let availInBefore = chunk.byteLength;
  let availOutBefore = self._chunkSize - self._outOffset;
  let inOff = 0;
  let availOutAfter;
  let availInAfter;
  const buffers = [];
  let nread = 0;
  let inputRead = 0;
  const state = self._writeState;
  const handle = self._handle;
  let buffer = self._outBuffer;
  let offset = self._outOffset;
  const chunkSize = self._chunkSize;
  let error;
  self.on("error", function onError(er) {
    error = er;
  });
  while (true) {
    (0, import_node_assert.ok)(handle, "Handle should have been defined");
    handle.writeSync(
      flushFlag,
      chunk,
      // in
      inOff,
      // in_off
      availInBefore,
      // in_len
      buffer,
      // out
      offset,
      // out_off
      availOutBefore,
      // out_len
    );
    if (error) throw error;
    else if (self[kError]) throw self[kError];
    [availOutAfter, availInAfter] = state;
    const inDelta = availInBefore - availInAfter;
    inputRead += inDelta;
    const have = availOutBefore - availOutAfter;
    if (have > 0) {
      const out = buffer.slice(offset, offset + have);
      offset += have;
      buffers.push(out);
      nread += out.byteLength;
      if (nread > self._maxOutputLength) {
        _close(self);
        throw new import_errors.ERR_BUFFER_TOO_LARGE(self._maxOutputLength);
      }
    } else {
      import_node_assert.default.strictEqual(
        have,
        0,
        "have should not go down",
      );
    }
    if (availOutAfter === 0 || offset >= chunkSize) {
      availOutBefore = chunkSize;
      offset = 0;
      buffer = import_node_buffer.Buffer.allocUnsafe(chunkSize);
    }
    if (availOutAfter === 0) {
      inOff += inDelta;
      availInBefore = availInAfter;
    } else {
      break;
    }
  }
  self.bytesWritten = inputRead;
  _close(self);
  if (nread === 0) return import_node_buffer.Buffer.alloc(0);
  return buffers.length === 1
    ? buffers[0]
    : import_node_buffer.Buffer.concat(buffers, nread);
}
function _close(engine) {
  engine._handle?.close();
  engine._handle = null;
}
const zlibDefaultOptions = {
  flush: CONST_Z_NO_FLUSH,
  finishFlush: CONST_Z_FINISH,
  fullFlush: CONST_Z_FULL_FLUSH,
};
class ZlibBase extends import_node_stream.Transform {
  bytesWritten = 0;
  _maxOutputLength;
  _outBuffer;
  _outOffset = 0;
  _chunkSize;
  _defaultFlushFlag;
  _finishFlushFlag;
  _defaultFullFlushFlag;
  _info;
  _handle = null;
  _writeState = new Uint32Array(2);
  _writesInProgress = 0;
  _hadWrites = false;
  [kError];
  constructor(
    opts,
    mode,
    handle,
    { flush, finishFlush, fullFlush } = zlibDefaultOptions,
  ) {
    let chunkSize = CONST_Z_DEFAULT_CHUNK;
    let maxOutputLength = import_node_buffer.kMaxLength;
    let flushBoundIdx;
    if (mode === CONST_BROTLI_ENCODE || mode === CONST_BROTLI_DECODE) {
      flushBoundIdx = FLUSH_BOUND_IDX_BROTLI;
    } else if (mode === CONST_ZSTD_ENCODE || mode === CONST_ZSTD_DECODE) {
      flushBoundIdx = FLUSH_BOUND_IDX_ZSTD;
    } else {
      flushBoundIdx = FLUSH_BOUND_IDX_NORMAL;
    }
    if (opts) {
      if (opts.chunkSize != null) {
        chunkSize = opts.chunkSize;
      }
      if (
        !(0, import_validators.checkFiniteNumber)(
          chunkSize,
          "options.chunkSize",
        )
      ) {
        chunkSize = CONST_Z_DEFAULT_CHUNK;
      } else if (chunkSize < CONST_Z_MIN_CHUNK) {
        throw new import_errors.ERR_OUT_OF_RANGE(
          "options.chunkSize",
          `>= ${CONST_Z_MIN_CHUNK}`,
          chunkSize,
        );
      }
      flush = (0, import_validators.checkRangesOrGetDefault)(
        opts.flush,
        "options.flush",
        FLUSH_BOUND[flushBoundIdx]?.[0],
        FLUSH_BOUND[flushBoundIdx]?.[1],
        flush,
      );
      finishFlush = (0, import_validators.checkRangesOrGetDefault)(
        opts.finishFlush,
        "options.finishFlush",
        FLUSH_BOUND[flushBoundIdx]?.[0],
        FLUSH_BOUND[flushBoundIdx]?.[1],
        finishFlush,
      );
      maxOutputLength = (0, import_validators.checkRangesOrGetDefault)(
        opts.maxOutputLength,
        "options.maxOutputLength",
        1,
        import_node_buffer.kMaxLength,
        import_node_buffer.kMaxLength,
      );
      if (opts.encoding || opts.objectMode || opts.writableObjectMode) {
        opts = { ...opts };
        opts.encoding = void 0;
        opts.objectMode = false;
        opts.writableObjectMode = false;
      }
    }
    super({ autoDestroy: true, ...opts });
    handle.setErrorHandler(zlibOnError.bind(handle));
    handle[owner_symbol] = this;
    this._handle = handle;
    this._outBuffer = import_node_buffer.Buffer.allocUnsafe(chunkSize);
    this._outOffset = 0;
    this._chunkSize = chunkSize;
    this._defaultFlushFlag = flush;
    this._finishFlushFlag = finishFlush;
    this._defaultFullFlushFlag = fullFlush;
    this._info = Boolean(opts.info);
    this._maxOutputLength = maxOutputLength;
  }
  // Note: This is intentionally a getter that shadows the property from Transform
  // @ts-expect-error TS2611 Property/accessor mismatch with Transform._closed
  get _closed() {
    return this._handle == null;
  }
  // @deprecated Use `bytesWritten` instead.
  get bytesRead() {
    return this.bytesWritten;
  }
  // @deprecated Use `bytesWritten` instead.
  set bytesRead(value) {
    this.bytesWritten = value;
  }
  reset() {
    (0, import_node_assert.ok)(this._handle, "zlib binding closed");
    this._handle.reset();
  }
  // This is the _flush function called by the transform class,
  // internally, when the last chunk has been written.
  _flush(callback) {
    if (this._writesInProgress > 0) {
      queueMicrotask(() => this._flush(callback));
      return;
    }
    if (this._hadWrites) {
      queueMicrotask(() => {
        const chunk = import_node_buffer.Buffer.alloc(0);
        chunk[kFlushFlag] = this._finishFlushFlag;
        this._transform(chunk, "utf8", callback);
      });
    } else {
      const chunk = import_node_buffer.Buffer.alloc(0);
      chunk[kFlushFlag] = this._finishFlushFlag;
      this._transform(chunk, "utf8", callback);
    }
  }
  // Force Transform compat behavior.
  _final(callback) {
    callback();
  }
  flush(kind, callback) {
    if (typeof kind === "function" || (kind === void 0 && !callback)) {
      callback = kind;
      kind = this._defaultFullFlushFlag;
    }
    if (this.writableFinished) {
      if (callback) {
        queueMicrotask(callback);
      }
    } else if (this.writableEnded) {
      if (callback) {
        this.once("end", callback);
      }
    } else {
      this.write(kFlushBuffers[kind], "utf8", callback);
    }
  }
  close(callback) {
    if (callback) {
      (0, import_node_stream2.finished)(this, callback);
    }
    this.destroy();
  }
  _destroy(err, callback) {
    _close(this);
    callback(err);
  }
  _transform(chunk, _encoding, cb) {
    let flushFlag = this._defaultFlushFlag;
    if (typeof chunk[kFlushFlag] === "number") {
      flushFlag = chunk[kFlushFlag];
    }
    if (this.writableEnded && this.writableLength === chunk.byteLength) {
      flushFlag = maxFlush(flushFlag, this._finishFlushFlag);
    }
    this.#processChunk(chunk, flushFlag, cb);
  }
  _processChunk(chunk, flushFlag, cb) {
    if (cb != null && typeof cb === "function") {
      this.#processChunk(chunk, flushFlag, cb);
      return;
    }
    return processChunkSync(this, chunk, flushFlag);
  }
  #processChunk(chunk, flushFlag, cb) {
    if (!this._handle) {
      queueMicrotask(cb);
      return;
    }
    if (chunk.byteLength > 0) {
      this._hadWrites = true;
    }
    this._writesInProgress++;
    const originalCb = cb;
    const wrappedCb = () => {
      this._writesInProgress--;
      originalCb();
    };
    this._handle.buffer = chunk;
    this._handle.cb = wrappedCb;
    this._handle.availOutBefore = this._chunkSize - this._outOffset;
    this._handle.availInBefore = chunk.byteLength;
    this._handle.inOff = 0;
    this._handle.flushFlag = flushFlag;
    this._handle.write(
      flushFlag,
      chunk,
      // in
      0,
      // in_off
      this._handle.availInBefore,
      // in_len
      this._outBuffer,
      // out
      this._outOffset,
      // out_off
      this._handle.availOutBefore,
      // out_len
    );
  }
}
class Zlib extends ZlibBase {
  _level = CONST_Z_DEFAULT_COMPRESSION;
  _strategy = CONST_Z_DEFAULT_STRATEGY;
  constructor(options, mode) {
    let windowBits = CONST_Z_DEFAULT_WINDOWBITS;
    let level = CONST_Z_DEFAULT_COMPRESSION;
    let memLevel = CONST_Z_DEFAULT_MEMLEVEL;
    let strategy = CONST_Z_DEFAULT_STRATEGY;
    let dictionary;
    if (options != null) {
      if (
        (options.windowBits == null || options.windowBits === 0) &&
        (mode === CONST_INFLATE ||
          mode === CONST_GUNZIP ||
          mode === CONST_UNZIP)
      ) {
        windowBits = 0;
      } else {
        const min =
          import_classic_binding.default.CONST_Z_MIN_WINDOWBITS +
          (mode === CONST_GZIP ? 1 : 0);
        windowBits = (0, import_validators.checkRangesOrGetDefault)(
          options.windowBits,
          "options.windowBits",
          min,
          CONST_Z_MAX_WINDOWBITS,
          CONST_Z_DEFAULT_WINDOWBITS,
        );
      }
      level = (0, import_validators.checkRangesOrGetDefault)(
        options.level,
        "options.level",
        CONST_Z_MIN_LEVEL,
        CONST_Z_MAX_LEVEL,
        CONST_Z_DEFAULT_COMPRESSION,
      );
      memLevel = (0, import_validators.checkRangesOrGetDefault)(
        options.memLevel,
        "options.memLevel",
        CONST_Z_MIN_MEMLEVEL,
        CONST_Z_MAX_MEMLEVEL,
        CONST_Z_DEFAULT_MEMLEVEL,
      );
      strategy = (0, import_validators.checkRangesOrGetDefault)(
        options.strategy,
        "options.strategy",
        CONST_Z_DEFAULT_STRATEGY,
        CONST_Z_FIXED,
        CONST_Z_DEFAULT_STRATEGY,
      );
      dictionary = options.dictionary;
      if (
        dictionary !== void 0 &&
        !(0, import_types.isArrayBufferView)(dictionary)
      ) {
        if ((0, import_types.isAnyArrayBuffer)(dictionary)) {
          dictionary = import_node_buffer.Buffer.from(dictionary);
        } else {
          throw new import_errors.ERR_INVALID_ARG_TYPE(
            "options.dictionary",
            ["Buffer", "TypedArray", "DataView", "ArrayBuffer"],
            dictionary,
          );
        }
      }
    }
    const writeState = new Uint32Array(2);
    const handle = new import_classic_binding.default.ZlibStream(mode);
    handle.initialize(
      windowBits,
      level,
      memLevel,
      strategy,
      writeState,
      () => {
        queueMicrotask(processCallback.bind(handle));
      },
      dictionary,
    );
    super(options ?? {}, mode, handle);
    this._level = level;
    this._strategy = strategy;
    this._handle = handle;
    this._writeState = writeState;
  }
  params(level, strategy, callback) {
    (0, import_validators.checkRangesOrGetDefault)(
      level,
      "level",
      CONST_Z_MIN_LEVEL,
      CONST_Z_MAX_LEVEL,
    );
    (0, import_validators.checkRangesOrGetDefault)(
      strategy,
      "strategy",
      CONST_Z_DEFAULT_STRATEGY,
      CONST_Z_FIXED,
    );
    if (this._level !== level || this._strategy !== strategy) {
      this.flush(
        CONST_Z_SYNC_FLUSH,
        this.#paramsAfterFlushCallback.bind(this, level, strategy, callback),
      );
    } else {
      queueMicrotask(callback);
    }
  }
  // This callback is used by `.params()` to wait until a full flush happened
  // before adjusting the parameters. In particular, the call to the native
  // `params()` function should not happen while a write is currently in progress
  // on the threadpool.
  #paramsAfterFlushCallback(level, strategy, callback) {
    (0, import_node_assert.ok)(this._handle, "zlib binding closed");
    this._handle.params(level, strategy);
    if (!this.destroyed) {
      this._level = level;
      this._strategy = strategy;
      callback?.();
    }
  }
}
const kMaxBrotliParam = Math.max(
  ...Object.entries(constants).map(([key, value]) =>
    key.startsWith("BROTLI_PARAM_") ? value : 0,
  ),
);
const brotliInitParamsArray = new Uint32Array(kMaxBrotliParam + 1);
const brotliDefaultOptions = {
  flush: CONST_BROTLI_OPERATION_PROCESS,
  finishFlush: CONST_BROTLI_OPERATION_FINISH,
  fullFlush: CONST_BROTLI_OPERATION_FLUSH,
};
class Brotli extends ZlibBase {
  constructor(options, mode) {
    (0, import_node_assert.ok)(
      mode === CONST_BROTLI_DECODE || mode === CONST_BROTLI_ENCODE,
    );
    brotliInitParamsArray.fill(-1);
    if (options?.params) {
      for (const [origKey, value] of Object.entries(options.params)) {
        const key = +origKey;
        if (
          Number.isNaN(key) ||
          key < 0 ||
          key > kMaxBrotliParam ||
          (brotliInitParamsArray[key] | 0) !== -1
        ) {
          throw new import_errors.ERR_BROTLI_INVALID_PARAM(origKey);
        }
        if (typeof value !== "number" && typeof value !== "boolean") {
          throw new import_errors.ERR_INVALID_ARG_TYPE(
            "options.params[key]",
            "number",
            value,
          );
        }
        brotliInitParamsArray[key] = value;
      }
    }
    const handle =
      mode === CONST_BROTLI_DECODE
        ? new import_classic_binding.default.BrotliDecoder(mode)
        : new import_classic_binding.default.BrotliEncoder(mode);
    const _writeState = new Uint32Array(2);
    if (
      !handle.initialize(
        brotliInitParamsArray,
        _writeState,
        processCallback.bind(handle),
      )
    ) {
      throw new import_errors.ERR_ZLIB_INITIALIZATION_FAILED();
    }
    super(options ?? {}, mode, handle, brotliDefaultOptions);
    this._writeState = _writeState;
  }
}
const kMaxZstdCParam = Math.max(
  ...Object.entries(constants).map(([key, value]) =>
    key.startsWith("ZSTD_c_") ? value : 0,
  ),
);
const zstdInitCParamsArray = new Int32Array(kMaxZstdCParam + 1);
const kMaxZstdDParam = Math.max(
  ...Object.entries(constants).map(([key, value]) =>
    key.startsWith("ZSTD_d_") ? value : 0,
  ),
);
const zstdInitDParamsArray = new Int32Array(kMaxZstdDParam + 1);
const zstdDefaultOptions = {
  flush: CONST_ZSTD_e_continue,
  finishFlush: CONST_ZSTD_e_end,
  fullFlush: CONST_ZSTD_e_flush,
};
class Zstd extends ZlibBase {
  constructor(options, mode, initParamsArray, maxParam) {
    (0, import_node_assert.ok)(
      mode === CONST_ZSTD_DECODE || mode === CONST_ZSTD_ENCODE,
    );
    initParamsArray.fill(-1);
    if (options?.params) {
      for (const [origKey, value] of Object.entries(options.params)) {
        const key = +origKey;
        if (
          Number.isNaN(key) ||
          key < 0 ||
          key > maxParam ||
          (initParamsArray[key] | 0) !== -1
        ) {
          throw new import_errors.ERR_ZSTD_INVALID_PARAM(origKey);
        }
        if (typeof value !== "number" && typeof value !== "boolean") {
          throw new import_errors.ERR_INVALID_ARG_TYPE(
            "options.params[key]",
            "number",
            value,
          );
        }
        initParamsArray[key] = value;
      }
    }
    const handle =
      mode === CONST_ZSTD_DECODE
        ? new import_classic_binding.default.ZstdDecoder(mode)
        : new import_classic_binding.default.ZstdEncoder(mode);
    const _writeState = new Uint32Array(2);
    const pledgedSrcSize = options?.pledgedSrcSize;
    if (
      !handle.initialize(
        initParamsArray,
        _writeState,
        () => {
          queueMicrotask(processCallback.bind(handle));
        },
        pledgedSrcSize,
      )
    ) {
      throw new import_errors.ERR_ZLIB_INITIALIZATION_FAILED();
    }
    super(options ?? {}, mode, handle, zstdDefaultOptions);
    this._writeState = _writeState;
  }
}

module.exports = {
  Zlib,
  ZlibBase,
  Brotli,
  Zstd,
  kMaxZstdCParam,
  kMaxZstdDParam,
  zstdInitCParamsArray,
  zstdInitDParamsArray,
};
