import binary from "./native-codecs.wasm";
type API = Record<string, (...args: number[]) => number> & {
  memory: WebAssembly.Memory;
};
let api: API | undefined;
export function library(): API {
  if (!api) {
    const module = new WebAssembly.Module(binary as BufferSource);
    api = new WebAssembly.Instance(module, {
      env: { emscripten_notify_memory_growth() {} },
      wasi_snapshot_preview1: {
        proc_exit(code: number) {
          throw new Error(`Codec exited: ${code}`);
        },
        fd_write() {
          return 8;
        },
      },
    }).exports as unknown as API;
    api._initialize();
  }
  return api;
}
export function string(api: API, pointer: number) {
  const bytes = new Uint8Array(api.memory.buffer);
  let end = pointer;
  while (bytes[end]) end++;
  return new TextDecoder().decode(bytes.subarray(pointer, end));
}
export type Kind = "brotli" | "zstd";
export class NativeCodec {
  private api = library();
  private ctx: number;
  private state: number;
  private output: number;
  private closed = false;
  finished = false;
  private frameInProgress = false;
  consumed = 0;
  constructor(
    readonly kind: Kind,
    readonly encode: boolean,
    readonly chunkSize: number,
    params: Record<string, number | boolean>,
    pledged?: number,
  ) {
    const api = this.api;
    this.ctx = (kind === "brotli" ? api.b_create : api.z_create)(+encode);
    this.state = api.malloc(8);
    this.output = api.malloc(chunkSize);
    if (!this.ctx || !this.state || !this.output) {
      this.close();
      throw new RangeError("Memory limit exceeded");
    }
    try {
      for (const [key, value] of Object.entries(params)) {
        const result = (kind === "brotli" ? api.b_param : api.z_param)(
          this.ctx,
          +encode,
          +key,
          Number(value),
        );
        if (kind === "brotli" ? !result : api.z_is_error(result))
          throw new Error(
            kind === "brotli"
              ? "Setting parameter failed"
              : "Setting parameter failed: " + string(api, api.z_error(result)),
          );
      }
      if (pledged !== undefined && kind === "zstd" && encode)
        this.zcheck(
          api.z_size64(
            this.ctx,
            pledged >>> 0,
            Math.floor(pledged / 4294967296) >>> 0,
          ),
        );
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private zcheck(result: number) {
    if (this.api.z_is_error(result)) {
      const message = string(this.api, this.api.z_error(result));
      throw Object.assign(new Error(message), {
        code: "ZSTD_ERROR",
        errno: result | 0,
      });
    }
  }
  process(
    input: Uint8Array,
    operation: number,
    emit: (bytes: Uint8Array) => void,
  ): void {
    if (this.closed) throw new Error("Codec is closed");
    if (
      this.finished &&
      (this.kind === "brotli" || (!this.encode && input.length === 0))
    )
      return;
    const api = this.api;
    const pointer = api.malloc(Math.max(1, input.byteLength));
    if (!pointer) throw new RangeError("Memory limit exceeded");
    new Uint8Array(api.memory.buffer).set(input, pointer);
    let offset = 0;
    try {
      for (;;) {
        const result = (this.kind === "brotli" ? api.b_process : api.z_process)(
          this.ctx,
          +this.encode,
          pointer + offset,
          input.length - offset,
          this.output,
          this.chunkSize,
          operation,
          this.state,
        );
        const state = new Uint32Array(api.memory.buffer, this.state, 2);
        const consumed = state[0],
          produced = state[1];
        offset += consumed;
        this.consumed += consumed;
        if (this.kind === "zstd") this.zcheck(result);
        else if (!result) {
          const errno = this.encode ? 0 : api.b_error(this.ctx);
          const code = this.encode
            ? "ERR_BROTLI_COMPRESSION_FAILED"
            : "ERR_" + string(api, api.b_error_string(errno));
          throw Object.assign(new Error("Compression failed"), { code, errno });
        }
        if (produced)
          emit(
            new Uint8Array(api.memory.buffer, this.output, produced).slice(),
          );
        this.finished = this.kind === "brotli" ? result === 1 : result === 0;
        if (this.kind === "zstd" && !this.encode && input.length > 0)
          this.frameInProgress = result > 0;
        // Workers' fast helper stops after the first completed frame. The
        // stream binding separately permits concatenated frames.
        if (!this.encode && this.finished) break;
        if (this.encode && operation !== 0 && this.finished) break;
        if (offset === input.length && produced < this.chunkSize) {
          if (this.encode && operation === 2 && !this.finished) {
            if (!consumed && !produced)
              throw new Error("Codec made no progress");
            continue;
          }
          if (
            !this.encode &&
            operation === 2 &&
            !this.finished &&
            (this.kind === "brotli" || this.frameInProgress)
          )
            throw new Error(
              this.kind === "zstd"
                ? "unexpected end of file"
                : "Unexpected end of file",
            );
          break;
        }
        if (!consumed && !produced) throw new Error("Codec made no progress");
      }
    } finally {
      api.free(pointer);
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ctx)
      (this.kind === "brotli" ? this.api.b_free : this.api.z_free)(
        this.ctx,
        +this.encode,
      );
    if (this.state) this.api.free(this.state);
    if (this.output) this.api.free(this.output);
  }
}
