/// <reference path="./wasm.d.ts" />
import binary from "./native-zlib.wasm";
export type API = Record<string, (...args: number[]) => number> & {
  memory: WebAssembly.Memory;
};
let api: API | undefined;
export function library(): API {
  if (!api) {
    api = new WebAssembly.Instance(
      new WebAssembly.Module(binary as BufferSource),
      {
        env: { emscripten_notify_memory_growth() {} },
        wasi_snapshot_preview1: {
          proc_exit(code: number) {
            throw Error(`Codec exited: ${code}`);
          },
          fd_write() {
            return 8;
          },
        },
      },
    ).exports as unknown as API;
    api._initialize();
  }
  return api;
}
export function message(api: API, pointer: number): string {
  const bytes = new Uint8Array(api.memory.buffer);
  let end = pointer;
  while (bytes[end]) end++;
  return new TextDecoder().decode(bytes.subarray(pointer, end));
}
