import { bindingBuffers } from "./input.js";
import { library, string } from "./native-codecs.js";
class CodecBinding {
  private api = library();
  private context = 0;
  private state!: Uint32Array;
  private callback!: () => void;
  private onerror?: (errno: number, code: string, message: string) => void;
  private params!: Uint32Array | Int32Array;
  private pledged?: number;
  private finished = false;
  private frameInProgress = false;
  constructor(
    private readonly kind: "brotli" | "zstd",
    private readonly encode: boolean,
  ) {}
  initialize(
    params: Uint32Array | Int32Array,
    state: Uint32Array,
    callback: () => void,
    pledged?: number,
  ): boolean {
    this.finished = false;
    this.frameInProgress = false;
    this.params = params.slice();
    this.state = state;
    this.callback = callback;
    this.pledged = pledged;
    const api = this.api;
    this.context = (this.kind === "brotli" ? api.b_create : api.z_create)(
      +this.encode,
    );
    if (!this.context) return false;
    for (let key = 0; key < params.length; key++)
      if ((params[key] | 0) !== -1) {
        const result = (this.kind === "brotli" ? api.b_param : api.z_param)(
          this.context,
          +this.encode,
          key,
          params[key],
        );
        if (this.kind === "brotli" ? !result : api.z_is_error(result)) {
          this.close();
          return false;
        }
      }
    if (pledged !== undefined && this.kind === "zstd" && this.encode) {
      if (
        typeof pledged !== "number" ||
        !Number.isFinite(pledged) ||
        pledged < 0 ||
        pledged >= 18446744073709551616
      ) {
        this.close();
        throw new TypeError(
          "The value cannot be converted because it is not an integer.",
        );
      }
      if (
        api.z_is_error(
          api.z_size64(
            this.context,
            pledged >>> 0,
            Math.floor(pledged / 4294967296) >>> 0,
          ),
        )
      ) {
        this.close();
        return false;
      }
    }
    return true;
  }
  setErrorHandler(
    handler: (errno: number, code: string, message: string) => void,
  ) {
    this.onerror = handler;
  }
  writeSync(
    flush: number,
    input: Uint8Array,
    inputOffset: number,
    inputLength: number,
    output: Uint8Array,
    outputOffset: number,
    outputLength: number,
  ) {
    const bounds = bindingBuffers(
      `${this.kind === "brotli" ? "Brotli" : "Zstd"}${this.encode ? "Encoder" : "Decoder"}Context`,
      input,
      inputOffset,
      inputLength,
      output,
      outputOffset,
      outputLength,
    );
    ({ inputOffset, inputLength, outputOffset, outputLength } = bounds);
    if (
      this.finished &&
      !this.encode &&
      (inputLength === 0 || this.kind === "brotli")
    ) {
      this.state[0] = outputLength;
      this.state[1] = inputLength;
      return;
    }
    const api = this.api,
      buffer = bounds.source;
    const pointer = api.malloc(Math.max(1, inputLength) + outputLength + 8);
    if (!pointer) throw new RangeError("Memory limit exceeded");
    const out = pointer + Math.max(1, inputLength),
      state = out + outputLength;
    try {
      new Uint8Array(api.memory.buffer).set(
        buffer.subarray(inputOffset, inputOffset + inputLength),
        pointer,
      );
      const result = (this.kind === "brotli" ? api.b_process : api.z_process)(
        this.context,
        +this.encode,
        pointer,
        inputLength,
        out,
        outputLength,
        flush,
        state,
      );
      this.finished = this.kind === "brotli" ? result === 1 : result === 0;
      if (this.kind === "zstd" && !this.encode && inputLength > 0)
        this.frameInProgress = result > 0;
      const view = new DataView(api.memory.buffer);
      const consumed = view.getUint32(state, true),
        produced = view.getUint32(state + 4, true);
      this.state[0] = outputLength - produced;
      this.state[1] = inputLength - consumed;
      bounds.target.set(
        new Uint8Array(api.memory.buffer, out, produced),
        outputOffset,
      );
      if (this.kind === "brotli" && !result) {
        const errno = this.encode ? 0 : api.b_error(this.context);
        this.onerror?.(
          errno,
          this.encode
            ? "ERR_BROTLI_COMPRESSION_FAILED"
            : "ERR_" + string(api, api.b_error_string(errno)),
          "Compression failed",
        );
      } else if (this.kind === "zstd" && api.z_is_error(result))
        this.onerror?.(
          -1,
          this.encode
            ? "ERR_ZSTD_COMPRESSION_FAILED"
            : "ERR_ZSTD_DECOMPRESSION_FAILED",
          `Zstd ${this.encode ? "compression" : "decompression"} failed: ${string(api, api.z_error(result))}`,
        );
      else if (
        !this.encode &&
        flush === 2 &&
        produced < outputLength &&
        (this.kind === "brotli" ? result !== 1 : this.frameInProgress)
      ) {
        if (this.kind === "zstd")
          this.onerror?.(
            -1,
            "ERR_ZSTD_DECOMPRESSION_FAILED",
            "unexpected end of file",
          );
        else this.onerror?.(-5, "Z_BUF_ERROR", "Unexpected end of file");
      }
    } finally {
      api.free(pointer);
    }
  }
  write(...args: Parameters<CodecBinding["writeSync"]>) {
    this.writeSync(...args);
    this.callback();
  }
  reset() {
    this.close();
    if (!this.initialize(this.params, this.state, this.callback, this.pledged))
      throw new Error("Initialization failed");
  }
  close() {
    if (this.context) {
      (this.kind === "brotli" ? this.api.b_free : this.api.z_free)(
        this.context,
        +this.encode,
      );
      this.context = 0;
    }
  }
}
export class BrotliEncoder extends CodecBinding {
  constructor() {
    super("brotli", true);
  }
}
export class BrotliDecoder extends CodecBinding {
  constructor() {
    super("brotli", false);
  }
}
export class ZstdEncoder extends CodecBinding {
  constructor() {
    super("zstd", true);
  }
}
export class ZstdDecoder extends CodecBinding {
  constructor() {
    super("zstd", false);
  }
}
