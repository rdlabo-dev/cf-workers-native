import { viewBytes } from "../../shared/buffer-source.js";
import { bindingBuffers } from "./input.js";
import * as codecs from "./codec-binding.js";
import { Buffer } from "node:buffer";
import { library, message } from "./native-zlib.js";
import * as constants from "./constants.js";
const codes: Record<number, string> = {
  0: "Z_OK",
  1: "Z_STREAM_END",
  2: "Z_NEED_DICT",
  [-1]: "Z_ERRNO",
  [-2]: "Z_STREAM_ERROR",
  [-3]: "Z_DATA_ERROR",
  [-4]: "Z_MEM_ERROR",
  [-5]: "Z_BUF_ERROR",
  [-6]: "Z_VERSION_ERROR",
};
export class ZlibStream {
  private api = library();
  private context = 0;
  private dictionarySize = 0;
  private state!: Uint32Array;
  private callback!: () => void;
  private onerror?: (errno: number, code: string, message: string) => void;
  constructor(readonly mode: number) {}
  initialize(
    windowBits: number,
    level: number,
    memLevel: number,
    strategy: number,
    state: Uint32Array,
    callback: () => void,
    dictionary?: ArrayBufferView,
  ) {
    this.state = state;
    this.callback = callback;
    const bytes = dictionary && Buffer.from(viewBytes(dictionary));
    this.dictionarySize = bytes?.length ?? 0;
    const pointer = bytes ? this.api.malloc(bytes.length || 1) : 0;
    try {
      if (bytes) {
        if (!pointer) throw new RangeError("Memory limit exceeded");
        new Uint8Array(this.api.memory.buffer).set(bytes, pointer);
      }
      this.context = this.api.cz_create(
        this.mode,
        windowBits,
        Math.trunc(level),
        Math.trunc(memLevel),
        Math.trunc(strategy),
        pointer,
        bytes?.length ?? 0,
      );
      if (!this.context) throw new Error("Zlib error");
    } finally {
      if (pointer) this.api.free(pointer);
    }
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
    const api = this.api;
    const bounds = bindingBuffers(
      "ZlibContext",
      input,
      inputOffset,
      inputLength,
      output,
      outputOffset,
      outputLength,
    );
    const buffer = bounds.source;
    ({ inputOffset, inputLength, outputOffset, outputLength } = bounds);
    const pointer = api.malloc(Math.max(1, inputLength) + outputLength + 8);
    if (!pointer) throw new RangeError("Memory limit exceeded");
    const out = pointer + Math.max(1, inputLength),
      state = out + outputLength;
    try {
      new Uint8Array(api.memory.buffer).set(
        buffer.subarray(inputOffset, inputOffset + inputLength),
        pointer,
      );
      const result = api.cz_process(
        this.context,
        pointer,
        inputLength,
        out,
        outputLength,
        flush,
        state,
      );
      const view = new DataView(api.memory.buffer);
      this.state[0] = view.getUint32(state, true);
      this.state[1] = view.getUint32(state + 4, true);
      bounds.target.set(
        new Uint8Array(api.memory.buffer, out, outputLength - this.state[0]),
        outputOffset,
      );
      if (
        result !== 0 &&
        result !== 1 &&
        (result !== -5 || (flush === 4 && this.state[0] !== 0))
      )
        this.onerror?.(
          result,
          codes[result],
          result === -5
            ? "unexpected end of file"
            : result === 2
              ? this.dictionarySize === 0
                ? "Missing dictionary"
                : "Bad dictionary"
              : message(api, api.cz_message(this.context)),
        );
    } finally {
      api.free(pointer);
    }
  }
  write(...args: Parameters<ZlibStream["writeSync"]>) {
    this.writeSync(...args);
    this.callback();
  }
  reset() {
    const result = this.api.cz_reset(this.context);
    if (result !== 0)
      this.onerror?.(result, codes[result], "Failed to reset stream");
  }
  params(level: number, strategy: number) {
    const result = this.api.cz_params(this.context, level, strategy);
    if (result !== 0)
      this.onerror?.(result, codes[result], "Failed to set parameters");
  }
  close() {
    if (this.context) {
      this.api.cz_free(this.context);
      this.context = 0;
    }
  }
}
export default Object.assign(
  { ZlibStream, ...codecs },
  Object.fromEntries(
    Object.entries(constants).map(([name, value]) => ["CONST_" + name, value]),
  ),
);
