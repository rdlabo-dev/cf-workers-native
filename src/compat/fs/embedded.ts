// Read-only in-memory filesystem for bundled worker assets. Build
// integrations register file contents at startup; bundled server code such
// as OpenNext's traced manifests then reads them through the node:fs
// surface. Mutating calls and real device filesystem access are not
// provided.

import { Buffer } from "node:buffer";
const encoder = new TextEncoder();
const files = new Map<string, Uint8Array>();

function normalize(path: unknown): string {
  if (typeof path !== "string") throw new TypeError("path must be a string");
  const raw = path.startsWith("file://") ? new URL(path).pathname : path;
  const parts: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return "/" + parts.join("/");
}

/** Called by generated bundle code; consumers do not invoke this directly. */
export function registerVirtualFiles(
  entries: Record<string, string | Uint8Array | { base64: string }>,
): void {
  for (const [path, contents] of Object.entries(entries)) {
    const key = normalize(path);
    files.set(
      key,
      typeof contents === "string"
        ? encoder.encode(contents)
        : contents instanceof Uint8Array
          ? new Uint8Array(contents)
          : Uint8Array.from(atob(contents.base64), (c) => c.charCodeAt(0)),
    );
  }
}
/** Test/reset helper. */
export function clearVirtualFiles(): void {
  files.clear();
}

function fileEntry(path: string): Uint8Array | undefined {
  const direct = files.get(path);
  if (direct !== undefined) return direct;
  // Bundled runtimes resolve relative to an empty dirname; treat relative
  // and absolute lookups uniformly, then fall back to a suffix match so a
  // build-absolute path resolves against a registered relative one.
  for (const [key, contents] of files)
    if (key === path || key.endsWith(path) || path.endsWith(key))
      return contents;
  return undefined;
}

function dirEntries(path: string): string[] {
  const prefix = path.endsWith("/") ? path : path + "/";
  const names = new Set<string>();
  for (const key of files.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    names.add(rest.split("/")[0]);
  }
  return [...names].sort();
}

function exists(path: string): boolean {
  return fileEntry(path) !== undefined || dirEntries(path).length > 0;
}

function enoent(syscall: string, path: string): Error {
  const error = new Error(
    `ENOENT: no such file or directory, ${syscall} '${path}'`,
  ) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  error.errno = -2;
  error.syscall = syscall;
  error.path = path;
  return error;
}

export class Stats {
  readonly #size: number;
  readonly #directory: boolean;
  readonly #mtime: Date;
  constructor(size: number, directory: boolean, mtime: Date) {
    this.#size = size;
    this.#directory = directory;
    this.#mtime = mtime;
  }
  isFile() {
    return !this.#directory;
  }
  isDirectory() {
    return this.#directory;
  }
  isSymbolicLink() {
    return false;
  }
  isBlockDevice() {
    return false;
  }
  isCharacterDevice() {
    return false;
  }
  isFIFO() {
    return false;
  }
  isSocket() {
    return false;
  }
  get size() {
    return this.#size;
  }
  get mtime() {
    return this.#mtime;
  }
  get mtimeMs() {
    return this.#mtime.getTime();
  }
  get birthtime() {
    return this.#mtime;
  }
  get birthtimeMs() {
    return this.#mtime.getTime();
  }
  get ctime() {
    return this.#mtime;
  }
  get ctimeMs() {
    return this.#mtime.getTime();
  }
  get atime() {
    return this.#mtime;
  }
  get atimeMs() {
    return this.#mtime.getTime();
  }
  get mode() {
    return this.#directory ? 0o40444 : 0o100444;
  }
  get dev() {
    return 0;
  }
  get ino() {
    return 0;
  }
  get nlink() {
    return 1;
  }
  get uid() {
    return 0;
  }
  get gid() {
    return 0;
  }
  get rdev() {
    return 0;
  }
  get blksize() {
    return 4096;
  }
  get blocks() {
    return Math.ceil(this.#size / 512);
  }
}

function statFor(path: string, syscall: string): Stats {
  const data = fileEntry(path);
  if (data !== undefined) return new Stats(data.length, false, new Date(0));
  if (dirEntries(path).length > 0 || path === "/")
    return new Stats(0, true, new Date(0));
  throw enoent(syscall, path);
}

function toPath(input: unknown): string {
  if (input instanceof URL) return normalize(input.href);
  if (Buffer.isBuffer(input)) return normalize(input.toString());
  if (typeof input !== "string" && !(input instanceof String))
    throw new TypeError("path must be a string or URL");
  return normalize(String(input));
}

function decode(data: Uint8Array, encoding?: string | null): string {
  if (encoding === "utf8" || encoding === "utf-8" || encoding == null)
    return new TextDecoder().decode(data);
  throw new Error(`Unsupported encoding '${encoding}'`);
}

export function readFileSync(path: unknown, options?: unknown): unknown {
  const p = toPath(path);
  const data = fileEntry(p);
  if (data === undefined) throw enoent("open", p);
  const encoding =
    typeof options === "string"
      ? options
      : (options as { encoding?: string } | undefined)?.encoding;
  return encoding
    ? Buffer.from(data).toString(encoding as BufferEncoding)
    : Buffer.from(data);
}

export function readFile(
  path: unknown,
  options: unknown,
  callback?: (error: Error | null, data?: unknown) => void,
): void {
  const cb = (typeof options === "function" ? options : callback) as
    | ((error: Error | null, data?: unknown) => void)
    | undefined;
  const promise = Promise.resolve().then(() => readFileSync(path, options));
  if (cb)
    promise.then(
      (data) => cb(null, data),
      (error) => cb(error),
    );
}

export function readdirSync(path: unknown): string[] {
  const p = toPath(path);
  const entries = dirEntries(p);
  if (entries.length === 0 && fileEntry(p) === undefined && p !== "/")
    throw enoent("scandir", p);
  return entries;
}

export function readdir(
  path: unknown,
  callback: (error: Error | null, entries?: string[]) => void,
): void {
  Promise.resolve()
    .then(() => readdirSync(path))
    .then(
      (entries) => callback(null, entries),
      (error) => callback(error),
    );
}

export function existsSync(path: unknown): boolean {
  return exists(toPath(path));
}

export function statSync(path: unknown): Stats {
  return statFor(toPath(path), "stat");
}

export function lstatSync(path: unknown): Stats {
  return statSync(path);
}

export function stat(
  path: unknown,
  callback: (error: Error | null, stats?: Stats) => void,
): void {
  Promise.resolve()
    .then(() => statSync(path))
    .then(
      (stats) => callback(null, stats),
      (error) => callback(error),
    );
}

export function realpathSync(path: unknown): string {
  const p = toPath(path);
  if (!exists(p)) throw enoent("realpath", p);
  return p;
}

export const promises = {
  readFile: (path: unknown, options?: unknown) =>
    Promise.resolve().then(() => readFileSync(path, options)),
  readdir: (path: unknown) => Promise.resolve().then(() => readdirSync(path)),
  stat: (path: unknown) => Promise.resolve().then(() => statSync(path)),
  lstat: (path: unknown) => Promise.resolve().then(() => lstatSync(path)),
  realpath: (path: unknown) => Promise.resolve().then(() => realpathSync(path)),
  access: (path: unknown) =>
    Promise.resolve().then(() => {
      if (!exists(toPath(path))) throw enoent("access", toPath(path));
    }),
};

export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
};

export default {
  readFileSync,
  readFile,
  readdirSync,
  readdir,
  existsSync,
  statSync,
  lstatSync,
  stat,
  realpathSync,
  promises,
  constants,
  Stats,
};
