import type { Buffer } from "node:buffer";
import type {
  BigIntStats,
  Stats,
  CopySyncOptions,
  Mode,
  MakeDirectoryOptions,
  OpenDirOptions,
} from "node:fs";
import type { FileHandle } from "./file-handle.js";
import type { Dir, Dirent } from "./directory.js";
import type { FilePath, Position } from "./stream-utils.js";
export type ReadOptions<T extends ArrayBufferView = Buffer> = object & {
  buffer?: T;
  offset?: number;
  length?: number;
  position?: Position;
};
export type ReadResult<T extends ArrayBufferView> = {
  bytesRead: number;
  buffer: T;
};
export type WriteResult<T extends string | ArrayBufferView> = {
  bytesWritten: number;
  buffer: T;
};
export interface ReadFileOptions {
  encoding?: BufferEncoding | "buffer" | null;
  flag?: string | number;
  signal?: AbortSignal;
}
export interface WriteFileOptions {
  encoding?: BufferEncoding | null;
  mode?: Mode;
  flag?: string | number;
  signal?: AbortSignal;
  flush?: boolean;
}
export type FileData = string | ArrayBufferView;
export type FileLocation = FilePath | number;
export interface ReadFile {
  (
    path: FileLocation,
    options: BufferEncoding | (ReadFileOptions & { encoding: BufferEncoding }),
  ): Promise<string>;
  (
    path: FileLocation,
    options?:
      | (ReadFileOptions & { encoding?: "buffer" | null })
      | "buffer"
      | null,
  ): Promise<Buffer>;
  (
    path: FileLocation,
    options?: ReadFileOptions | BufferEncoding | "buffer" | null,
  ): Promise<string | Buffer>;
}
export interface Stat {
  (
    path: FilePath,
    options: { bigint: true; throwIfNoEntry?: true },
  ): Promise<BigIntStats>;
  (
    path: FilePath,
    options?: { bigint?: false; throwIfNoEntry?: true },
  ): Promise<Stats>;
  (
    path: FilePath,
    options: { bigint?: boolean; throwIfNoEntry: false },
  ): Promise<Stats | BigIntStats | undefined>;
  (
    path: FilePath,
    options?: { bigint?: boolean; throwIfNoEntry?: boolean },
  ): Promise<Stats | BigIntStats | undefined>;
}
export interface ReadDirectory {
  (
    path: FilePath,
    options: {
      withFileTypes: true;
      encoding?: BufferEncoding | "buffer" | null;
      recursive?: boolean;
    },
  ): Promise<Dirent[]>;
  (
    path: FilePath,
    options:
      | "buffer"
      | { encoding: "buffer"; withFileTypes?: false; recursive?: boolean },
  ): Promise<Buffer[]>;
  (
    path: FilePath,
    options?:
      | BufferEncoding
      | null
      | {
          encoding?: BufferEncoding | null;
          withFileTypes?: false;
          recursive?: boolean;
        },
  ): Promise<string[]>;
  (
    path: FilePath,
    options?: {
      encoding?: BufferEncoding | "buffer" | null;
      withFileTypes?: boolean;
      recursive?: boolean;
    },
  ): Promise<string[] | Buffer[] | Dirent[]>;
}
export interface Glob {
  (
    pattern: string | readonly string[],
    options: {
      cwd?: string | URL;
      withFileTypes: true;
      exclude?: string[] | ((entry: Dirent) => boolean);
    },
  ): AsyncGenerator<Dirent>;
  (
    pattern: string | readonly string[],
    options?: {
      cwd?: string | URL;
      withFileTypes?: false;
      exclude?: string[] | ((path: string) => boolean);
    },
  ): AsyncGenerator<string>;
  (
    pattern: string | readonly string[],
    options?: {
      cwd?: string | URL;
      withFileTypes?: boolean;
      exclude?: string[] | ((path: string | Dirent) => boolean);
    },
  ): AsyncGenerator<string | Dirent>;
}
// Only methods present in the pinned Workers namespace are exposed here.
type SharedPromises = Pick<
  typeof import("node:fs/promises"),
  | "access"
  | "chmod"
  | "chown"
  | "constants"
  | "copyFile"
  | "lchmod"
  | "lchown"
  | "link"
  | "lutimes"
  | "readlink"
  | "realpath"
  | "rename"
  | "rm"
  | "rmdir"
  | "statfs"
  | "truncate"
  | "unlink"
  | "utimes"
>;
export interface FsPromises extends SharedPromises {
  FileHandle: typeof FileHandle;
  open(
    path: FilePath,
    flags?: string | number,
    mode?: Mode,
  ): Promise<FileHandle>;
  readFile: ReadFile;
  writeFile(
    path: FileLocation,
    data: FileData,
    options?: BufferEncoding | WriteFileOptions,
  ): Promise<void>;
  appendFile(
    path: FileLocation,
    data: FileData,
    options?: BufferEncoding | WriteFileOptions,
  ): Promise<void>;
  cp(
    source: FilePath,
    destination: FilePath,
    options?: CopySyncOptions,
  ): Promise<void>;
  opendir(path: FilePath, options?: OpenDirOptions): Promise<Dir>;
  readdir: ReadDirectory;
  stat: Stat;
  lstat: Stat;
  mkdtemp(
    prefix: FilePath,
    options?:
      | BufferEncoding
      | "buffer"
      | { encoding?: BufferEncoding | "buffer" },
  ): Promise<string>;
  mkdir(
    path: FilePath,
    options?: number | MakeDirectoryOptions,
  ): Promise<string | undefined>;
  symlink(
    target: FilePath,
    path: FilePath,
    type?: "dir" | "file" | "junction" | null,
  ): Promise<void>;
  glob: Glob;
  watch(...args: unknown[]): never;
}
