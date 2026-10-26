import type { FsPromises } from "./public-types.js";
import { createFileHandle, FileHandle } from "./file-handle.js";
import { installIo } from "./io.js";
import * as fileStreams from "./streams.js";
import { Dir as WorkersDir, Dirent as WorkersDirent } from "./directory.js";
import { readDirectory } from "./directory-backend.js";
import { globSync as workersGlob } from "./glob.js";
import { fileMode } from "./mode.js";
import { validateInteger } from "../crypto/validation.js";
import * as embedded from "./embedded.js";
import {
  temporary,
  retainTemporaryFiles,
  temporaryPath,
  clearTemporaryFiles,
  writablePath,
  pathOf,
  readonlyFile,
  embeddedStat,
} from "./writable.js";
import { Buffer } from "node:buffer";
import {
  validateFunction,
  validateObject,
  validateBoolean,
  validateUint32,
} from "../net/validators.js";
import { ERR_INVALID_ARG_VALUE, ERR_INVALID_ARG_TYPE } from "../net/errors.js";
export const registerVirtualFiles = embedded.registerVirtualFiles;
export function clearVirtualFiles() {
  embedded.clearVirtualFiles();
  clearTemporaryFiles();
}
const reads = new Set([
  "readFileSync",
  "readFile",
  "readdirSync",
  "readdir",
  "statSync",
  "stat",
  "lstatSync",
  "realpathSync",
  "existsSync",
]);
const api: any = { ...temporary };
// Stats values are produced by the filesystem; Workers forbids public construction.
api.Stats = new Proxy(api.Stats, {
  construct() {
    throw new TypeError("Illegal constructor");
  },
  apply() {
    throw new TypeError(
      "Class constructor Stats cannot be invoked without 'new'",
    );
  },
});
Object.defineProperty(api.Stats.prototype, "constructor", {
  value: api.Stats,
  configurable: true,
  writable: true,
});
for (const name of Object.keys(api))
  if (typeof api[name] === "function" && /^[a-z]/.test(name))
    api[name] = (...args: any[]) => temporary[name](...args);
for (const name of [
  "ReadStream",
  "WriteStream",
  "FileReadStream",
  "FileWriteStream",
]) {
  api[name] = new Proxy(api[name], {
    construct(_target, args) {
      if (name === "ReadStream" || name === "FileReadStream")
        return temporary.createReadStream(...args);
      args[0] = writablePath(args[0], name);
      return temporary.createWriteStream(...args);
    },
  });
}
for (const name of reads) {
  const old = (embedded as any)[name];
  api[name] = (...args: any[]) =>
    temporaryPath(args[0]) ? temporary[name](...args) : old(...args);
}
for (const name of ["watch", "watchFile", "unwatchFile"])
  api[name] = () => {
    throw Object.assign(new Error("The operation is not supported"), {
      code: "ERR_UNSUPPORTED_OPERATION",
    });
  };
// Workers reports the byte count from these synchronous operations.
for (const name of ["writeFileSync", "appendFileSync"])
  api[name] = (...args: any[]) => {
    temporary[name](...args);
    const encoding = typeof args[2] === "string" ? args[2] : args[2]?.encoding;
    return typeof args[1] === "string"
      ? Buffer.byteLength(args[1], encoding)
      : args[1].byteLength;
  };
const promiseImpl: any = { ...temporary.promises };
for (const name of Object.keys(promiseImpl))
  if (typeof promiseImpl[name] === "function" && /^[a-z]/.test(name))
    promiseImpl[name] = (...args: any[]) => temporary.promises[name](...args);
for (const name of [
  "readFile",
  "readdir",
  "stat",
  "lstat",
  "realpath",
  "access",
]) {
  const old = (embedded.promises as any)[name];
  promiseImpl[name] = async (...args: any[]) =>
    temporaryPath(args[0]) ? temporary.promises[name](...args) : old(...args);
}
// Keep all writes inside the memory volume, including FileHandle operations.
for (const name of [
  "appendFile",
  "writeFile",
  "mkdir",
  "mkdtemp",
  "rm",
  "rmdir",
  "unlink",
  "truncate",
  "utimes",
  "lutimes",
  "chmod",
  "chown",
  "lchmod",
  "lchown",
  "rename",
  "copyFile",
  "symlink",
]) {
  promiseImpl[name] = async (...args: any[]) => {
    if (name === "symlink") {
      return new Promise((resolve, reject) =>
        temporary.symlink(...args, (error: unknown) =>
          error ? reject(error) : resolve(undefined),
        ),
      );
    }
    const indexes = ["rename", "copyFile", "cp", "link"].includes(name)
      ? [0, 1]
      : [0];
    for (const i of indexes)
      if (
        typeof args[i] !== "object" ||
        args[i] instanceof URL ||
        Buffer.isBuffer(args[i])
      ) {
        if (!temporaryPath(args[i]))
          throw Object.assign(new Error("operation not permitted"), {
            code: "EPERM",
          });
      }
    return temporary.promises[name](...args);
  };
}
promiseImpl.watch = function () {
  throw new Error("Not implemented");
};
// Workers validates ownership/permission requests but has no mutable Unix
// ownership or permissions. These operations must not change the memory VFS.
function installOperation(
  name: string,
  handler: (...args: any[]) => any,
  promise = true,
) {
  api[name + "Sync"] = handler;
  api[name] = (...args: any[]) => {
    const callback = args.pop();
    validateFunction(callback, "callback");
    Promise.resolve()
      .then(() => handler(...args))
      .then(
        (value) => callback(null, value),
        (error) => callback(error),
      );
  };
  if (promise) promiseImpl[name] = async (...args: any[]) => handler(...args);
}
function temporaryStats(stat: any, readonly = false) {
  if (stat == null) return stat;
  const bigint = typeof stat.mode === "bigint";
  const mode =
    (Number(stat.mode) & ~0o777) |
    (readonly || stat.isSymbolicLink() ? 0o444 : 0o666);
  stat.mode = bigint ? BigInt(mode) : mode;
  for (const name of [
    "dev",
    "ino",
    "uid",
    "gid",
    "rdev",
    "blksize",
    "blocks",
    "atimeMs",
  ])
    stat[name] = bigint ? 0n : 0;
  stat.dev = bigint
    ? BigInt(stat.isCharacterDevice())
    : Number(stat.isCharacterDevice());
  stat.nlink = bigint ? 1n : 1;
  stat.atime = new Date(0);
  stat.ctime = stat.mtime;
  stat.ctimeMs = stat.mtimeMs;
  if (bigint) {
    stat.atimeNs = 0n;
    stat.ctimeNs = stat.mtimeNs;
  }
  if (readonly)
    for (const name of ["mtime", "ctime", "birthtime"]) {
      stat[name] = new Date(0);
      stat[name + "Ms"] = bigint ? 0n : 0;
      if (bigint) stat[name + "Ns"] = 0n;
    }
  return stat;
}
// Workers has no executable files. Read-only bundle files also report ENOENT
// for W_OK rather than exposing host-style permission bits.
function accessArgs(path: unknown, mode: unknown = 0) {
  const normalized = pathOf(path);
  mode ??= 0;
  validateInteger(mode, "mode", 0, 7);
  return { path: normalized, mode: mode as number };
}
function checkAccess({ path, mode }: ReturnType<typeof accessArgs>) {
  if (mode & 1 || (mode & 2 && readonlyFile(path)) || !api.existsSync(path))
    throw Object.assign(
      new Error(`ENOENT: no such file or directory, access '${path}'`),
      {
        code: "ENOENT",
        errno: -2,
        syscall: "access",
        path,
      },
    );
}
api.accessSync = (path: unknown, mode?: unknown) =>
  checkAccess(accessArgs(path, mode));
api.access = (path: unknown, mode: unknown, callback?: any) => {
  if (typeof mode === "function") {
    callback = mode;
    mode = undefined;
  }
  const args = accessArgs(path, mode);
  validateFunction(callback, "callback");
  let failure: unknown = null;
  try {
    checkAccess(args);
  } catch (error) {
    failure = error;
  }
  queueMicrotask(() => callback(failure));
};
promiseImpl.access = async (path: unknown, mode?: unknown) =>
  checkAccess(accessArgs(path, mode));
function statOptions(options: any = {}) {
  validateObject(options, "options");
  validateBoolean(options.bigint ?? false, "options.bigint");
  validateBoolean(options.throwIfNoEntry ?? true, "options.throwIfNoEntry");
  return options;
}
for (const name of ["stat", "lstat"])
  installOperation(name, (path: any, options: any = {}) => {
    statOptions(options);
    return temporaryPath(path)
      ? temporaryStats(
          temporary[name + "Sync"](path, options),
          readonlyFile(path, name !== "lstat"),
        )
      : temporaryStats(embeddedStat(path, options), true);
  });
installOperation(
  "fstat",
  (fd: any, options: any = {}) => {
    statOptions(options);
    validateInteger(fd, "fd", 0, 2147483647);
    return temporaryStats(temporary.fstatSync(fd, options), readonlyFile(fd));
  },
  false,
);
for (const name of ["chmod", "lchmod", "fchmod", "chown", "lchown", "fchown"]) {
  const count = name.endsWith("chmod") ? 2 : 3;
  const prepare = (args: any[]) => {
    const [path, value, gid] = args;
    if (name.endsWith("chmod")) fileMode(value);
    else {
      validateInteger(value, "uid", -1, 0xffffffff);
      validateInteger(gid, "gid", -1, 0xffffffff);
    }
    if (typeof path === "number" || name.startsWith("f"))
      validateInteger(path, "fd", 0, 2147483647);
    else pathOf(path);
    return path;
  };
  const operation = (path: any) => {
    try {
      if (typeof path === "number") temporary.fstatSync(path);
      else api[name.startsWith("l") ? "lstatSync" : "statSync"](path);
    } catch (error: any) {
      if (error.code === "ENOENT") error.syscall = name;
      throw error;
    }
  };
  api[name + "Sync"] = (...args: any[]) => operation(prepare(args));
  api[name] = (...args: any[]) => {
    const path = prepare(args),
      callback = args[count];
    validateFunction(callback, "callback");
    let error: any = null;
    try {
      operation(path);
    } catch (failure) {
      error = failure;
    }
    queueMicrotask(() => callback(error));
  };
  if (!name.startsWith("f"))
    promiseImpl[name] = async (...args: any[]) => operation(prepare(args));
}
installOperation("statfs", (path: any, options: any = {}) => {
  pathOf(path);
  validateObject(options, "options");
  const bigint = options.bigint ?? false;
  validateBoolean(bigint, "options.bigint");
  const value = bigint ? 0n : 0;
  return {
    type: value,
    bsize: value,
    blocks: value,
    bfree: value,
    bavail: value,
    files: value,
    ffree: value,
  };
});
// Workers interprets numeric timestamps as milliseconds and does not change
// metadata belonging to embedded files. Convert before the memfs boundary.
function fileTime(value: any): Date {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number" || typeof value === "string")
    date = new Date(value);
  else if (typeof value === "bigint") date = new Date(Number(value));
  else
    throw new ERR_INVALID_ARG_TYPE(
      "time",
      ["string", "number", "bigint", "Date"],
      value,
    );
  if (!Number.isFinite(date.getTime()))
    throw new TypeError(
      "The value cannot be converted because it is not an integer.",
    );
  return date;
}
for (const name of ["utimes", "lutimes", "futimes"]) {
  installOperation(
    name,
    (path: any, atime: any, mtime: any) => {
      const access = fileTime(atime),
        modified = fileTime(mtime);
      if (name === "futimes") {
        validateInteger(path, "fd", 0, 2147483647);
        api.fstatSync(path);
      } else api[name === "lutimes" ? "lstatSync" : "statSync"](path);
      if (!readonlyFile(path, name !== "lutimes"))
        temporary[name + "Sync"](path, access, modified);
    },
    name !== "futimes",
  );
}
promiseImpl.FileHandle = FileHandle;
promiseImpl.open = async (path: any, flags: any, mode: any) => {
  const run = retainTemporaryFiles();
  const fd = api.openSync(path, flags, mode);
  return createFileHandle({ fd, run, api });
};
// Copy an embedded bundle file into request-local /tmp without granting any
// write access to its source volume.
const temporaryCopyFile = api.copyFileSync;
installOperation("copyFile", (source: any, destination: any, mode = 0) => {
  if (![0, 1, 2, 4].includes(mode))
    throw Object.assign(new TypeError("Invalid copy mode"), {
      code: "ERR_INVALID_ARG_VALUE",
    });
  if (mode === 4)
    throw Object.assign(new Error("The operation is not supported"), {
      code: "ERR_UNSUPPORTED_OPERATION",
    });
  if (temporaryPath(source))
    return temporaryCopyFile(source, destination, mode);
  writablePath(destination, "copyFile");
  if (mode === 1 && api.existsSync(destination))
    throw Object.assign(new Error("File already exists"), { code: "EEXIST" });
  temporary.writeFileSync(destination, embedded.readFileSync(pathOf(source)));
});
const copyTree = (source: string, destination: string, options: any) => {
  const fail = (code: string): never => {
    throw Object.assign(new Error(code), { code, syscall: "cp" });
  };
  source = pathOf(source);
  destination = pathOf(destination);
  if (source === destination)
    throw new Error("Source and destination paths must not be the same");
  if (destination.startsWith(source + "/")) fail("ERR_FS_CP_EINVAL");
  const lookup = (path: string, follow: boolean) => {
    try {
      return api[follow ? "statSync" : "lstatSync"](path);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  };
  const visit = (src: string, dst: string, nested = false) => {
    const stat = lookup(src, nested ? false : options.dereference);
    if (!stat) fail("ENOENT");
    const target = lookup(dst, options.dereference);
    if (stat.isDirectory()) {
      if (!options.recursive) fail("ERR_FS_EISDIR");
      if (target && !target.isDirectory())
        fail(
          target.isSymbolicLink()
            ? nested
              ? "EISDIR"
              : "ENOTDIR"
            : nested
              ? "ENOTDIR"
              : "ERR_FS_CP_DIR_TO_NON_DIR",
        );
      const entries = api.readdirSync(src);
      api.mkdirSync(dst, { recursive: true });
      for (const name of entries)
        visit(src + "/" + name, dst + "/" + name, true);
      return;
    }
    if (target?.isDirectory())
      fail(
        nested
          ? "EISDIR"
          : stat.isSymbolicLink()
            ? "ENOTDIR"
            : "ERR_FS_CP_NON_DIR_TO_DIR",
      );
    if (target && !options.force) {
      if (options.errorOnExist) fail(nested ? "EEXIST" : "ERR_FS_CP_EEXIST");
      return;
    }
    const data = stat.isSymbolicLink()
      ? api.readlinkSync(src)
      : api.readFileSync(src);
    api.mkdirSync(dst.slice(0, dst.lastIndexOf("/")) || "/", {
      recursive: true,
    });
    if (lookup(dst, false)) api.unlinkSync(dst);
    if (stat.isSymbolicLink()) api.symlinkSync(data, dst);
    else api.writeFileSync(dst, data);
  };
  visit(source, destination);
};
installOperation("cp", (source: any, destination: any, options: any = {}) => {
  validateObject(options, "options");
  const {
    dereference = false,
    errorOnExist = false,
    force = true,
    preserveTimestamps = false,
    recursive = false,
    verbatimSymlinks = false,
    mode = 0,
  } = options;
  for (const [key, value] of Object.entries({
    dereference,
    errorOnExist,
    force,
    preserveTimestamps,
    recursive,
    verbatimSymlinks,
  }))
    validateBoolean(value, "options." + key);
  validateUint32(mode, "options.mode");
  if (mode & 4)
    throw new ERR_INVALID_ARG_VALUE(
      "options.mode",
      "COPYFILE_FICLONE_FORCE is not supported",
    );
  if (options.filter !== undefined) {
    if (typeof options.filter !== "function")
      throw new ERR_INVALID_ARG_TYPE(
        "options.filter",
        "function",
        options.filter,
      );
    throw Object.assign(new Error("The requested operation is unsupported"), {
      code: "ERR_UNSUPPORTED_OPERATION",
    });
  }
  return copyTree(source, destination, {
    dereference,
    errorOnExist,
    force,
    recursive,
    verbatimSymlinks: false,
    preserveTimestamps: false,
    mode: 0,
  });
});
api.cp = (source: any, destination: any, options: any, callback?: any) => {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  validateObject(options ?? {}, "options");
  for (const key of [
    "dereference",
    "errorOnExist",
    "force",
    "preserveTimestamps",
    "recursive",
    "verbatimSymlinks",
  ])
    if (options?.[key] !== undefined)
      validateBoolean(options[key], "options." + key);
  if (options?.mode !== undefined) validateUint32(options.mode, "options.mode");
  if (options?.filter !== undefined && typeof options.filter !== "function")
    throw new ERR_INVALID_ARG_TYPE(
      "options.filter",
      "function",
      options.filter,
    );
  if (options?.filter !== undefined)
    throw Object.assign(new Error("The requested operation is unsupported"), {
      code: "ERR_UNSUPPORTED_OPERATION",
    });
  if (options?.mode & 4)
    throw new ERR_INVALID_ARG_VALUE(
      "options.mode",
      "COPYFILE_FICLONE_FORCE is not supported",
    );
  pathOf(source);
  pathOf(destination);
  validateFunction(callback, "callback");
  let error: unknown;
  try {
    api.cpSync(source, destination, options);
  } catch (cause) {
    error = cause;
  }
  queueMicrotask(() => callback(error ?? null));
};
api.promises = promiseImpl;
const promises = promiseImpl as FsPromises;
export { promises };
// Validate public directory arguments before scheduling their callbacks.
function directoryOperation(
  name: string,
  prepare: (path: any, options: any) => any,
  operation: (args: any) => any,
) {
  api[name + "Sync"] = (path: any, options: any = {}) =>
    operation(prepare(path, options));
  api[name] = (path: any, options: any, callback?: any) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const args = prepare(path, options === undefined ? {} : options);
    validateFunction(callback, "callback");
    let value: any,
      error: any = null;
    try {
      value = operation(args);
    } catch (failure) {
      error = failure;
    }
    queueMicrotask(() => callback(error, value));
  };
  promiseImpl[name] = async (path: any, options: any = {}) =>
    operation(prepare(path, options));
}
directoryOperation(
  "mkdir",
  (path, options) => {
    if (typeof options === "number") options = { mode: options };
    validateObject(options, "options");
    const { recursive = false, mode = 0o777 } = options;
    validateBoolean(recursive, "options.recursive");
    fileMode(mode);
    return { path: pathOf(path), recursive };
  },
  ({ path, recursive }) => {
    writablePath(path, "mkdir");
    if (temporary.existsSync(path) && temporary.statSync(path).isDirectory())
      return;
    let created = path;
    if (recursive) {
      let parent = created.slice(0, created.lastIndexOf("/")) || "/";
      while (!temporary.existsSync(parent)) {
        created = parent;
        parent = created.slice(0, created.lastIndexOf("/")) || "/";
      }
    }
    temporary.mkdirSync(path, { recursive, mode: 0o777 });
    return recursive ? created : undefined;
  },
);
directoryOperation(
  "mkdtemp",
  (path, options) => {
    if (typeof options === "string" || options == null)
      options = { encoding: options };
    validateObject(options, "options");
    const { encoding = "utf8" } = options;
    if (encoding !== "buffer" && !Buffer.isEncoding(encoding))
      throw new ERR_INVALID_ARG_VALUE("options.encoding", encoding);
    return { path: pathOf(path) };
  },
  ({ path }) => {
    writablePath(path, "mkdtemp");
    for (;;) {
      const name =
        path + globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
      try {
        temporary.mkdirSync(name);
        return name;
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
      }
    }
  },
);
for (const name of ["rm", "rmdir"])
  directoryOperation(
    name,
    (path, options) => {
      validateObject(options, "options");
      const {
        recursive = false,
        force = false,
        maxRetries = 0,
        retryDelay = 0,
      } = options;
      if (name === "rm") validateBoolean(force, "options.force");
      validateUint32(maxRetries, "options.maxRetries");
      validateBoolean(recursive, "options.recursive");
      validateUint32(retryDelay, "options.retryDelay");
      return { path: pathOf(path), recursive, force };
    },
    ({ path, recursive, force }) => {
      if (
        name === "rm" &&
        !recursive &&
        temporary.existsSync(path) &&
        temporary.lstatSync(path).isDirectory()
      )
        return temporary.rmdirSync(path);
      return temporary[name + "Sync"](path, { recursive, force });
    },
  );
const statFilesystem = api.statfsSync;
directoryOperation(
  "statfs",
  (path, options) => {
    pathOf(path);
    validateObject(options, "options");
    validateBoolean(options.bigint ?? false, "options.bigint");
    return { path, options };
  },
  ({ path, options }) => statFilesystem(path, options),
);
api.exists = (path: any, callback: any) => {
  validateFunction(callback, "callback");
  let exists = false;
  try {
    exists = api.existsSync(path);
  } catch {}
  queueMicrotask(() => callback(exists));
};
for (const name of ["link", "symlink"]) {
  const prepare = (source: any, destination: any, type: any = null) => {
    if (name === "symlink" && !["dir", "file", "junction", null].includes(type))
      throw new ERR_INVALID_ARG_VALUE("type", type);
    const src = pathOf(source),
      dest = pathOf(destination);
    const raw =
      destination instanceof URL
        ? destination.pathname
        : Buffer.isBuffer(destination)
          ? destination.toString()
          : destination;
    return { src, dest, type, trailing: raw.endsWith("/") };
  };
  const operation = ({ src, dest, type, trailing }: any) => {
    if (trailing)
      throw Object.assign(new Error("Invalid path"), { code: "EINVAL" });
    if (name === "link") {
      let stat;
      try {
        stat = api.statSync(src);
      } catch (error: any) {
        if (error.code === "ENOTDIR") error.code = "ENOENT";
        throw error;
      }
      if (stat.isDirectory())
        throw Object.assign(new Error("operation not permitted"), {
          code: "EPERM",
        });
    }
    const parent = dest.slice(0, dest.lastIndexOf("/")) || "/";
    try {
      const parentStat = api.statSync(parent);
      if (!parentStat.isDirectory())
        throw Object.assign(new Error("Invalid path"), { code: "EINVAL" });
    } catch (error: any) {
      if (error.code === "ENOTDIR") error.code = "EINVAL";
      throw error;
    }
    try {
      return temporary[name + "Sync"](src, dest, type ?? undefined);
    } catch (error: any) {
      if (error.code === "ENOTDIR")
        error.code = api.existsSync(parent) ? "EINVAL" : "ENOENT";
      throw error;
    }
  };
  api[name + "Sync"] = (source: any, destination: any, type?: any) =>
    operation(prepare(source, destination, type));
  api[name] = (source: any, destination: any, type: any, callback?: any) => {
    if (typeof type === "function") {
      callback = type;
      type = null;
    }
    const args = prepare(source, destination, type);
    validateFunction(callback, "callback");
    let error: any = null;
    try {
      operation(args);
    } catch (failure) {
      error = failure;
    }
    queueMicrotask(() => callback(error));
  };
  promiseImpl[name] = async (source: any, destination: any, type?: any) =>
    operation(prepare(source, destination, type));
}
for (const name of ["readlink", "realpath"])
  directoryOperation(
    name,
    (path, options) => {
      if (typeof options === "string" || options == null)
        options = { encoding: options };
      validateObject(options, "options");
      const { encoding = "utf8" } = options;
      if (encoding !== "buffer" && !Buffer.isEncoding(encoding))
        throw new ERR_INVALID_ARG_VALUE("options.encoding", encoding);
      return { path: pathOf(path), encoding };
    },
    ({ path, encoding }) => {
      const stat = api.lstatSync(path);
      let target = path;
      if (stat.isSymbolicLink()) target = temporary.readlinkSync(path);
      else if (name === "readlink")
        throw Object.assign(new Error("invalid argument"), { code: "EINVAL" });
      return Buffer.from(target).toString(encoding);
    },
  );
api.realpathSync.native = api.realpathSync;
api.realpath.native = api.realpath;
const unlinkFile = (path: any) => temporary.unlinkSync(path);
api.unlinkSync = (path: any) => {
  path = pathOf(path);
  if (api.lstatSync(path).isDirectory())
    throw Object.assign(new Error("illegal operation on a directory"), {
      code: "EISDIR",
    });
  return unlinkFile(path);
};
api.unlink = (path: any, callback: any) => {
  path = pathOf(path);
  validateFunction(callback, "callback");
  let error: any = null;
  try {
    api.unlinkSync(path);
  } catch (failure) {
    error = failure;
  }
  queueMicrotask(() => callback(error));
};
promiseImpl.unlink = async (path: any) => api.unlinkSync(path);
api.ReadStream = api.FileReadStream = fileStreams.ReadStream;
api.WriteStream = api.FileWriteStream = fileStreams.WriteStream;
api.createReadStream = fileStreams.createReadStream;
api.createWriteStream = fileStreams.createWriteStream;
api.openAsBlob = (path: any, options: any = {}) => {
  const normalized = pathOf(path);
  validateObject(options, "options");
  const { type = "" } = options;
  if (typeof type !== "string")
    throw new ERR_INVALID_ARG_TYPE("options.type", "string", type);
  if (api.statSync(normalized).isDirectory())
    throw Object.assign(new Error("illegal operation on a directory"), {
      code: "EISDIR",
    });
  const data = api.readFileSync(normalized);
  return new Blob([data], { type });
};
api.Dir = WorkersDir;
api.Dirent = WorkersDirent;
installOperation("glob", workersGlob, false);
promiseImpl.glob = async function* (pattern: any, options?: any) {
  yield* workersGlob(pattern, options);
};
function directoryOptions(options: any, open: boolean) {
  if (!open && (typeof options === "string" || options == null))
    options = { encoding: options };
  validateObject(options, "options");
  const {
    encoding = "utf8",
    recursive = false,
    withFileTypes = false,
    bufferSize = 32,
  } = options;
  if (encoding !== "buffer" && !Buffer.isEncoding(encoding))
    throw new ERR_INVALID_ARG_VALUE("options.encoding", encoding);
  validateBoolean(recursive, "options.recursive");
  if (open) validateUint32(bufferSize, "options.bufferSize");
  else validateBoolean(withFileTypes, "options.withFileTypes");
  return { encoding, recursive, withFileTypes };
}
directoryOperation(
  "readdir",
  (path, options) => ({
    ...directoryOptions(options, false),
    path: pathOf(path),
  }),
  ({ path, encoding, recursive, withFileTypes }) => {
    const entries = readDirectory(path, recursive);
    return entries.map((entry) =>
      withFileTypes
        ? new WorkersDirent(
            encoding === "buffer" ? Buffer.from(entry.name) : entry.name,
            entry.type,
            entry.parentPath,
          )
        : encoding === "buffer"
          ? Buffer.from(entry.name)
          : Buffer.from(entry.name).toString(encoding),
    );
  },
);
directoryOperation(
  "opendir",
  (path, options) => {
    const opts = directoryOptions(options, true);
    pathOf(path);
    return { ...opts, path };
  },
  ({ path, encoding, recursive }) => {
    return new WorkersDir(readDirectory(path, recursive), path, { encoding });
  },
);
installIo(api, promiseImpl);
export const {
  Dir,
  Dirent,
  F_OK,
  FileReadStream,
  FileWriteStream,
  R_OK,
  ReadStream,
  Stats,
  W_OK,
  WriteStream,
  X_OK,
  access,
  accessSync,
  appendFile,
  appendFileSync,
  chmod,
  chmodSync,
  chown,
  chownSync,
  close,
  closeSync,
  constants,
  copyFile,
  copyFileSync,
  cp,
  cpSync,
  createReadStream,
  createWriteStream,
  exists,
  existsSync,
  fchmod,
  fchmodSync,
  fchown,
  fchownSync,
  fdatasync,
  fdatasyncSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  glob,
  globSync,
  lchmod,
  lchmodSync,
  lchown,
  lchownSync,
  link,
  linkSync,
  lstat,
  lstatSync,
  lutimes,
  lutimesSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  open,
  openAsBlob,
  openSync,
  opendir,
  opendirSync,
  read,
  readFile,
  readFileSync,
  readSync,
  readdir,
  readdirSync,
  readlink,
  readlinkSync,
  readv,
  readvSync,
  realpath,
  realpathSync,
  rename,
  renameSync,
  rm,
  rmSync,
  rmdir,
  rmdirSync,
  stat,
  statSync,
  statfs,
  statfsSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  unwatchFile,
  utimes,
  utimesSync,
  watch,
  watchFile,
  write,
  writeFile,
  writeFileSync,
  writeSync,
  writev,
  writevSync,
} = api;
export default api as Record<string, any> & { promises: FsPromises };
