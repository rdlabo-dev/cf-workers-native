// Copyright (c) 2026 Cloudflare, Inc. Licensed under Apache-2.0.
// Ported from workerd@5358e3d337336eaf696a48bc1563d808b10feba5 internal_fs.ts.
import { Buffer } from "node:buffer";
import {
  validateFunction,
  validateObject,
  validateString,
} from "../net/validators.js";
import { ERR_MISSING_ARGS } from "../net/errors.js";
import type { DirEntryHandle } from "./directory-backend.js";
type FilePath = string | Buffer | URL;
type ValidEncoding = BufferEncoding | "buffer";
const UV_DIRENT_FILE = 1,
  UV_DIRENT_DIR = 2,
  UV_DIRENT_LINK = 3,
  UV_DIRENT_FIFO = 4,
  UV_DIRENT_SOCKET = 5,
  UV_DIRENT_CHAR = 6,
  UV_DIRENT_BLOCK = 7;
class ERR_DIR_CLOSED extends Error {
  code = "ERR_DIR_CLOSED";
  constructor() {
    super("Directory handle was closed");
  }
}
const kType = Symbol("type");

export class Dirent {
  name: string | Buffer;
  parentPath: string | Buffer;
  private [kType]: number;

  constructor(name: string | Buffer, type: number, path: string | Buffer) {
    this.name = name;
    this.parentPath = path;
    this[kType] = type;
  }

  isDirectory(): boolean {
    return this[kType] === UV_DIRENT_DIR;
  }

  isFile(): boolean {
    return this[kType] === UV_DIRENT_FILE;
  }

  isBlockDevice(): boolean {
    return this[kType] === UV_DIRENT_BLOCK;
  }

  isCharacterDevice(): boolean {
    return this[kType] === UV_DIRENT_CHAR;
  }

  isSymbolicLink(): boolean {
    return this[kType] === UV_DIRENT_LINK;
  }

  isFIFO(): boolean {
    return this[kType] === UV_DIRENT_FIFO;
  }

  isSocket(): boolean {
    return this[kType] === UV_DIRENT_SOCKET;
  }
}

export interface DirOptions {
  encoding?: ValidEncoding | undefined;
}

export type DirentReadCallback = (
  err: Error | null,
  dirent: Dirent | null,
) => void;

export class Dir {
  // Unlike our Node.js counterpart, we do not not use an underlying
  // native handle for the directory. Instead we use a simple array
  // of DirEntryHandle objects just like the one used in the readdir
  // API.
  #handle: DirEntryHandle[] | undefined;
  #encoding: ValidEncoding | undefined;
  #path: FilePath;

  constructor(
    handle: DirEntryHandle[] | undefined,
    path: FilePath,
    options: DirOptions,
  ) {
    if (handle == null) {
      throw new ERR_MISSING_ARGS("handle");
    }
    this.#handle = handle;
    this.#path = path;

    validateObject(options, "options");
    const { encoding = "utf8" } = options;
    validateString(encoding, "options.encoding");
    this.#encoding = encoding as BufferEncoding;
  }

  get path(): FilePath {
    return this.#path;
  }

  read(): Promise<Dirent | null>;
  read(callback: DirentReadCallback): void;
  read(callback?: DirentReadCallback): Promise<Dirent | null> | undefined {
    if (typeof callback === "function") {
      validateFunction(callback, "callback");
      try {
        const ent = this.readSync();
        queueMicrotask(() => {
          callback(null, ent);
        });
      } catch (err) {
        queueMicrotask(() => {
          callback(err as Error, null);
        });
      }
      return;
    }

    try {
      const ent = this.readSync();
      return Promise.resolve(ent);
    } catch (err: unknown) {
      return Promise.reject(err as Error);
    }
  }

  readSync(): Dirent | null {
    if (this.#handle === undefined) throw new ERR_DIR_CLOSED();
    const ent = this.#handle.shift();
    if (ent == null) return null;
    const buf = Buffer.from(ent.name);
    if (this.#encoding === "buffer") {
      return new Dirent(buf, ent.type, ent.parentPath);
    }
    return new Dirent(
      buf.toString(this.#encoding != null ? this.#encoding : undefined),
      ent.type,
      ent.parentPath,
    );
  }

  close(callback?: (err: unknown) => void): Promise<void> | undefined {
    this.closeSync();
    if (typeof callback === "function") {
      validateFunction(callback, "callback");
      queueMicrotask(() => {
        callback(null);
      });
      return undefined;
    }
    return Promise.resolve();
  }

  closeSync(): void {
    if (this.#handle === undefined) {
      throw new ERR_DIR_CLOSED();
    }
    this.#handle = undefined;
  }

  async *entries(): AsyncGenerator<Dirent, unknown, unknown> {
    for (;;) {
      const ent = await this.read();
      if (ent == null) return;
      yield ent;
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<Dirent, unknown, unknown> {
    return this.entries();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  [Symbol.dispose](): void {
    this.closeSync();
  }
}
