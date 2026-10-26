import type { ReadStreamOptions, WriteStreamOptions } from "./streams.js";
import type {
  ReadOptions,
  ReadResult,
  WriteResult,
  ReadFileOptions,
  WriteFileOptions,
} from "./public-types.js";
import type { Stats, BigIntStats, ReadStream, WriteStream } from "node:fs";
// FileHandle's public contract follows workerd 5358e3d337336eaf696a48bc1563d808b10feba5.
// The filesystem backend and its request scope remain private.
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { ReadableStream } from "../stream-web/runtime.js";
import {
  asyncDispose,
  installResourceSymbols,
} from "../../shared/globals/symbols.js";
import {
  validateObject,
  validateBoolean,
  validateUint32,
} from "../net/validators.js";
import { validatePosition } from "./io-validation.js";
import { createReadStream, createWriteStream } from "./streams.js";
import { registerFileHandle } from "./stream-utils.js";
installResourceSymbols(globalThis.Symbol);
const badge = Symbol("FileHandle constructor");
const kFileHandle = Symbol("kFileHandle");
type Scope = <T>(operation: () => T) => T;
type Backend = {
  fd: number;
  run: Scope;
  api: Record<string, (...args: any[]) => any>;
};
const handleScopes = new WeakMap<object, Scope>();
const released = new FinalizationRegistry<() => void>((close) => close());
function badDescriptor() {
  return Object.assign(new Error("Bad file descriptor"), {
    code: "EBADF",
    syscall: "stat",
  });
}
export class FileHandle extends EventEmitter {
  #fd: number | undefined;
  #backend: Backend | undefined;
  [kFileHandle] = true;
  constructor(token: symbol, backend: Backend) {
    if (token !== badge) throw new TypeError("Illegal constructor");
    super();
    this.#fd = backend.fd;
    this.#backend = backend;
    released.register(
      this,
      () => backend.run(() => backend.api.closeSync(backend.fd)),
      this,
    );
    registerFileHandle(this);
    handleScopes.set(this, backend.run);
  }
  get fd() {
    return this.#fd;
  }
  #invoke(name: string, ...args: any[]) {
    if (this.#fd === undefined) throw badDescriptor();
    const fd = this.#fd;
    const backend = this.#backend!;
    return backend.run(() => backend.api[name](fd, ...args));
  }
  async appendFile(
    data: string | ArrayBufferView,
    options: WriteFileOptions | BufferEncoding = {},
  ) {
    await this.#invoke("appendFileSync", data, options);
  }
  async chmod(mode: string | number) {
    await this.#invoke("fchmodSync", mode);
  }
  async chown(uid: number, gid: number) {
    await this.#invoke("fchownSync", uid, gid);
  }
  async datasync() {
    await this.#invoke("fdatasyncSync");
  }
  async sync() {
    await this.#invoke("fsyncSync");
  }
  read(options?: ReadOptions<Buffer>): Promise<ReadResult<Buffer>>;
  read<T extends ArrayBufferView>(
    options: ReadOptions<T> & { buffer: T },
  ): Promise<ReadResult<T>>;
  read<T extends ArrayBufferView>(
    buffer: T,
    offsetOrOptions?: number | ReadOptions<T>,
    length?: number,
    position?: number | bigint | null,
  ): Promise<ReadResult<T>>;
  read(
    bufferOrOptions: any = {},
    offsetOrOptions: any = {},
    length?: number,
    position: number | bigint | null = null,
  ) {
    try {
      if (this.#fd === undefined) throw badDescriptor();
      let options: any;
      if (ArrayBuffer.isView(bufferOrOptions))
        options =
          typeof offsetOrOptions === "number"
            ? {
                buffer: bufferOrOptions,
                offset: offsetOrOptions,
                length: length ?? bufferOrOptions.byteLength - offsetOrOptions,
                position: position ?? null,
              }
            : { buffer: bufferOrOptions, ...offsetOrOptions };
      else options = bufferOrOptions;
      const {
        buffer = Buffer.alloc(16384),
        offset = 0,
        length: count = buffer.byteLength - offset,
        position: at = null,
      } = options;
      validateUint32(offset, "offset");
      validateUint32(count, "length");
      validatePosition(at, "position");
      const bytesRead = this.#invoke("readSync", buffer, offset, count, at);
      return Promise.resolve({ bytesRead, buffer });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  readv<T extends readonly ArrayBufferView[]>(
    buffers: T,
    position: number | bigint | null = null,
  ): Promise<{ bytesRead: number; buffers: T }> {
    try {
      return Promise.resolve({
        bytesRead: this.#invoke("readvSync", buffers, position),
        buffers,
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  readFile(
    options: BufferEncoding | (ReadFileOptions & { encoding: BufferEncoding }),
  ): Promise<string>;
  readFile(
    options?:
      | (ReadFileOptions & { encoding?: "buffer" | null })
      | "buffer"
      | null,
  ): Promise<Buffer>;
  readFile(
    options?: ReadFileOptions | BufferEncoding | "buffer" | null,
  ): Promise<string | Buffer>;
  async readFile(options: any = {}) {
    return await this.#invoke("readFileSync", options);
  }
  readLines(_options: unknown = {}): never {
    if (this.#fd === undefined) throw badDescriptor();
    throw new Error("not implemented");
  }
  stat(options: { bigint: true }): Promise<BigIntStats>;
  stat(options?: { bigint?: false }): Promise<Stats>;
  stat(options?: { bigint?: boolean }): Promise<Stats | BigIntStats>;
  async stat(options: any = {}) {
    return await this.#invoke("fstatSync", options);
  }
  async truncate(length = 0) {
    await this.#invoke("ftruncateSync", length);
  }
  async utimes(atime: string | number | Date, mtime: string | number | Date) {
    await this.#invoke("futimesSync", atime, mtime);
  }
  write<T extends ArrayBufferView>(
    buffer: T,
    offsetPositionOrOptions?:
      | number
      | { offset?: number; length?: number; position?: number | bigint | null }
      | null,
    length?: number,
    position?: number | bigint | null,
  ): Promise<WriteResult<T>>;
  write(
    buffer: string,
    position?: number | bigint | null,
    encoding?: BufferEncoding,
  ): Promise<WriteResult<Buffer>>;
  write<T extends string | ArrayBufferView>(
    buffer: T,
    position?: number | null,
  ): Promise<WriteResult<T extends string ? Buffer : T>>;
  write(
    buffer: string | ArrayBufferView,
    offsetPositionOrOptions: any = null,
    lengthOrEncoding?: any,
    position: number | bigint | null = null,
  ) {
    try {
      if (this.#fd === undefined) throw badDescriptor();
      if (typeof buffer === "string")
        buffer = Buffer.from(buffer, lengthOrEncoding);
      const bytesWritten = this.#invoke(
        "writeSync",
        buffer,
        offsetPositionOrOptions,
        lengthOrEncoding,
        position,
      );
      return Promise.resolve({ bytesWritten, buffer });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  writev<T extends readonly ArrayBufferView[]>(
    buffers: T,
    position: number | bigint | null = null,
  ): Promise<{ bytesWritten: number; buffers: T }> {
    try {
      return Promise.resolve({
        bytesWritten: this.#invoke("writevSync", buffers, position),
        buffers,
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  writeFile<T extends ArrayBufferView>(
    data: T,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<WriteResult<T>>;
  writeFile(
    data: string,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<WriteResult<Buffer>>;
  writeFile<T extends string | ArrayBufferView>(
    data: T,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<WriteResult<T extends string ? Buffer : T>>;
  writeFile(data: string | ArrayBufferView, options: any = {}) {
    try {
      const bytesWritten = this.#invoke("writeFileSync", data, options);
      return Promise.resolve({
        bytesWritten,
        buffer: ArrayBuffer.isView(data) ? data : Buffer.from(data, options),
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  close(): Promise<void> {
    try {
      if (this.#fd !== undefined) this.#invoke("closeSync");
      this.#fd = undefined;
      this.#backend = undefined;
      handleScopes.delete(this);
      released.unregister(this);
      this.emit("close");
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  async [asyncDispose]() {
    await this.close();
  }
  readableWebStream(
    options: { autoClose?: boolean } = {},
  ): ReadableStream<Uint8Array> {
    if (this.#fd === undefined) throw badDescriptor();
    validateObject(options, "options");
    const { autoClose = true } = options;
    validateBoolean(autoClose, "options.autoClose");
    const handle = this;
    const read = this.read.bind(this);
    let controller: ReadableByteStreamController,
      ended = false;
    const finish = () => {
      if (!ended) {
        ended = true;
        controller.close();
      }
    };
    const stream = new ReadableStream({
      type: "bytes",
      autoAllocateChunkSize: 16384,
      start(c) {
        controller = c;
      },
      async pull(c) {
        const request = c.byobRequest!,
          view = request.view!;
        const { bytesRead } = await read(
          view,
          view.byteOffset,
          view.byteLength,
        );
        if (bytesRead === 0) {
          finish();
          if (autoClose) await handle.close();
        }
        request.respond(bytesRead);
      },
      async cancel() {
        ended = true;
        if (autoClose) await handle.close();
      },
    });
    this.once("close", finish);
    return stream;
  }
  createReadStream(options: Omit<ReadStreamOptions, "fd"> = {}): ReadStream {
    const run = handleScopes.get(this) ?? ((fn: () => any) => fn());
    return run(() => createReadStream("", { ...options, fd: this }));
  }
  createWriteStream(options: Omit<WriteStreamOptions, "fd"> = {}): WriteStream {
    const run = handleScopes.get(this) ?? ((fn: () => any) => fn());
    return run(() => createWriteStream("", { ...options, fd: this }));
  }
}
Object.defineProperty(FileHandle, "name", {
  value: "FileHandle",
  configurable: true,
});
export function createFileHandle(backend: Backend) {
  return new FileHandle(badge, backend);
}
