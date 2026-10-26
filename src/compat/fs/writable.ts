import {
  currentDirectory,
  runWithDirectory,
  registerDirectoryValidator,
} from "../process/directory.js";
export { currentDirectory, changeDirectory } from "../process/directory.js";
import * as embedded from "./embedded.js";
import { fileMode } from "./mode.js";
import { registerRequestScope } from "../../shared/request-scope.js";
// Writable, memory-only /tmp. Embedded bundle files remain read-only.
// This adapter does not expose the device filesystem.
import { Volume, createFsFromVolume } from "memfs";
import { Buffer } from "node:buffer";
import { posix } from "node:path";
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from "../net/errors.js";
import { AsyncLocalStorage } from "../async-hooks/index.js";
export function pathOf(value: any): string {
  let url: URL;
  if (value instanceof URL) url = value;
  else {
    if (Buffer.isBuffer(value)) value = value.toString();
    if (typeof value !== "string")
      throw new ERR_INVALID_ARG_TYPE(
        "path",
        ["string", "Buffer", "URL"],
        value,
      );
    if (value.includes("\0"))
      throw new ERR_INVALID_ARG_VALUE(
        "path",
        value,
        "must not contain null bytes",
      );
    url = new URL(
      value.replace(/[#?]/g, encodeURIComponent).replace(/\/\//g, "/"),
      "file://" + currentDirectory() + "/",
    );
  }
  if (url.protocol !== "file:")
    throw new TypeError("File path must be a file: URL");
  if (url.host) throw new Error("File path must not have a host");
  const normalized = posix.normalize(
    url.pathname.replace(/%([0-9a-f]{2})/gi, (_match, hex) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      return /[A-Za-z0-9._~-]/.test(char) ? char : "%" + hex.toUpperCase();
    }),
  );
  if (Buffer.byteLength(normalized) > 4096)
    throw new Error("File path is too long");
  if ((normalized.match(/\//g) || []).length > 48)
    throw new Error("File path has too many segments");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

const devices = new Set(["/dev/null", "/dev/zero", "/dev/full", "/dev/random"]);
export function temporaryPath(value: any): boolean {
  if (typeof value === "number") return true;
  const path = pathOf(value);
  return (
    path === "/tmp" ||
    path.startsWith("/tmp/") ||
    path === "/dev" ||
    devices.has(path)
  );
}
export function writablePath(value: any, syscall: string) {
  if (typeof value === "number") return value;
  const path = pathOf(value);
  if (
    !(
      path === "/tmp" ||
      path.startsWith("/tmp/") ||
      (devices.has(path) &&
        [
          "writeFile",
          "appendFile",
          "truncate",
          "utimes",
          "lutimes",
          "createWriteStream",
          "WriteStream",
        ].includes(syscall))
    )
  )
    throw Object.assign(
      new Error(`operation not permitted, ${syscall} '${path}'`),
      { code: "EPERM", errno: -1, syscall, path },
    );
  return path;
}

function createTemporary() {
  const volume = new Volume();
  // memfs supplies storage, while Workers keeps timestamps unchanged on writes
  // and caps every file at 128 MiB. Configure nodes at this owned boundary so
  // descriptors, FileHandles and streams cannot bypass these rules.
  const core = (volume as any)._core;
  let nextFd = 3;
  // Workers allocates monotonically within a volume. Reusing a closed number
  // would let a stale FileHandle access or close an unrelated descriptor.
  core.releasedFds.push = () => 0;
  core.newFdNumber = () => {
    if (nextFd === 2147483647)
      throw Object.assign(new Error("Too many open files"), { code: "EMFILE" });
    return nextFd++;
  };
  const createNode = core.createNode.bind(core);
  core.createNode = (...args: any[]) => {
    const node = createNode(...args);
    node.mtime = node.btime = new Date(0);
    node.touch = () => {};
    const write = node.write.bind(node),
      truncate = node.truncate.bind(node),
      set = node._setBuf.bind(node);
    const limit = (size: number) => {
      if (size > 134217728)
        throw Object.assign(new Error("File size limit exceeded"), {
          code: "EPERM",
        });
    };
    node.write = (
      buffer: any,
      offset = 0,
      length = buffer.length,
      position = 0,
    ) => {
      limit(position + length);
      return write(buffer, offset, length, position);
    };
    node.truncate = (length = 0) => {
      limit(length);
      return truncate(length);
    };
    node._setBuf = (buffer: any) => {
      limit(buffer.byteLength);
      return set(buffer);
    };
    return node;
  };
  core.root.getNode().mtime = core.root.getNode().btime = new Date(0);
  volume.mkdirSync("/tmp");
  const fs = createFsFromVolume(volume) as any;
  function installDevices() {
    fs.mkdirSync("/dev");
    for (const path of devices) {
      fs.writeFileSync(path, "");
      const node = core.getResolvedLinkOrThrow(path, "open").getNode();
      node.mode = 0o20666;
      const rejected = () => {
        throw Object.assign(new Error("operation not permitted"), {
          code: "EPERM",
        });
      };
      node.write =
        path === "/dev/full" || path === "/dev/random"
          ? rejected
          : (_buffer: any, _offset: number, length: number) => length;
      node.truncate =
        path === "/dev/full" || path === "/dev/random" ? rejected : () => {};
      node._setBuf =
        path === "/dev/full" || path === "/dev/random" ? rejected : () => {};
      node.read = (
        buffer: Uint8Array,
        offset = 0,
        length = buffer.byteLength,
      ) => {
        if (path === "/dev/null") return 0;
        const bytes = new Uint8Array(
          buffer.buffer,
          buffer.byteOffset + offset,
          length,
        );
        if (path === "/dev/random")
          for (let n = 0; n < bytes.length; n += 65536)
            bytes.set(
              globalThis.crypto.getRandomValues(
                new Uint8Array(Math.min(65536, bytes.length - n)),
              ),
              n,
            );
        else bytes.fill(0);
        return length;
      };
    }
  }
  installDevices();
  for (let fd = 0; fd < 3; fd++) {
    const path = "/tmp/.stdio-" + fd,
      allocated = fs.openSync(path, "w+");
    const file = core.getFileByFdOrThrow(allocated, "stdio");
    delete core.fds[String(allocated)];
    file.fd = fd;
    core.fds[String(fd)] = file;
    fs.unlinkSync(path);
    let pending = "";
    file.node.read = () => 0;
    file.node.write = (
      buffer: Uint8Array,
      offset = 0,
      length = buffer.byteLength,
    ) => {
      pending += Buffer.from(
        buffer.buffer,
        buffer.byteOffset + offset,
        length,
      ).toString();
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines) (fd === 2 ? console.error : console.log)(line);
      return length;
    };
  }
  nextFd = 3;
  const closeSync = fs.closeSync.bind(fs),
    close = fs.close.bind(fs);
  fs.closeSync = (fd: any) => {
    if (typeof fd === "number" && fd >= 0 && fd <= 2 && Number.isInteger(fd))
      return;
    return closeSync(fd);
  };
  fs.close = (fd: any, callback: any) => {
    if (typeof fd === "number" && fd >= 0 && fd <= 2 && Number.isInteger(fd)) {
      if (typeof callback !== "function")
        throw new ERR_INVALID_ARG_TYPE("callback", "function", callback);
      queueMicrotask(() => callback(null));
      return;
    }
    return close(fd, callback);
  };
  const readonlyDescriptors = new Set<number>();
  const readonlyInodes = new Set<number>();
  const denied = (syscall: string, path?: string) =>
    Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
      errno: -1,
      syscall,
      ...(path ? { path } : {}),
    });
  function mount(path: string) {
    if (
      temporaryPath(path) ||
      (fs.existsSync(path) && fs.statSync(path).isFile())
    )
      return;
    let stat;
    try {
      stat = embedded.statSync(path);
    } catch (error) {
      if ((error as any).code === "ENOENT") return;
      throw error;
    }
    if (stat.isDirectory()) {
      fs.mkdirSync(path, { recursive: true });
      for (const name of embedded.readdirSync(path) as string[])
        mount(posix.join(path, name));
    } else {
      fs.mkdirSync(posix.dirname(path), { recursive: true });
      fs.writeFileSync(path, embedded.readFileSync(path));
      readonlyInodes.add(fs.statSync(path).ino);
    }
  }
  function resolved(path: string): string {
    let parent = path;
    const missing = [];
    while (!fs.existsSync(parent) && parent !== "/") {
      missing.unshift(posix.basename(parent));
      parent = posix.dirname(parent);
    }
    return posix.join(fs.realpathSync(parent), ...missing);
  }
  function mutable(value: any, syscall: string, follow = true) {
    if (typeof value === "number") {
      if (readonlyDescriptors.has(value)) throw denied(syscall);
      return value;
    }
    const path = writablePath(value, syscall) as string;
    const target = follow
      ? resolved(path)
      : posix.join(resolved(posix.dirname(path)), posix.basename(path));
    if (
      !temporaryPath(target) ||
      (follow &&
        fs.existsSync(target) &&
        readonlyInodes.has(fs.statSync(target).ino))
    )
      throw denied(syscall, path);
    return path;
  }
  function openPath(value: any, flags: any = "r") {
    const path = pathOf(value);
    mount(path);
    const target = resolved(path);
    const writes =
      typeof flags === "number"
        ? !!(
            flags &
            (fs.constants.O_WRONLY |
              fs.constants.O_RDWR |
              fs.constants.O_CREAT |
              fs.constants.O_TRUNC |
              fs.constants.O_APPEND)
          )
        : typeof flags === "string" && !["r", "rs", "sr"].includes(flags);
    const readonly =
      !temporaryPath(target) ||
      (fs.existsSync(target) && readonlyInodes.has(fs.statSync(target).ino));
    if (readonly && writes) throw denied("open", path);
    return { path, readonly };
  }
  const mutating = new Set([
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
  ]);
  const api: any = {};
  for (const name of Object.keys(fs)) {
    if (typeof fs[name] !== "function") {
      api[name] = fs[name];
      continue;
    }
    if (/^[A-Z]/.test(name)) {
      api[name] = fs[name];
      continue;
    }
    const base = name.replace(/Sync$/, "");
    api[name] = (...args: any[]) => {
      try {
        if (
          ["writeFile", "appendFile"].includes(base) &&
          typeof args[0] !== "number"
        ) {
          const opts = args[2];
          if (typeof opts === "object" && opts !== null) {
            fileMode(opts.mode, 0o666);
            args[2] = { ...opts, mode: 0o666 };
          } else if (typeof opts === "function")
            args.splice(2, 0, { mode: 0o666 });
          else if (opts === undefined || typeof opts === "string")
            args[2] = {
              mode: 0o666,
              ...(typeof opts === "string" ? { encoding: opts } : {}),
            };
        }
        if (base === "symlink") {
          args[1] = mutable(args[1], base, false);
          const target = Buffer.isBuffer(args[0])
            ? args[0].toString()
            : args[0];
          if (typeof target !== "string")
            throw new ERR_INVALID_ARG_TYPE(
              "target",
              ["string", "Buffer"],
              target,
            );
          const absolute = pathOf(target);
          mount(absolute);
          args[0] = absolute;
        } else if (["copyFile", "cp", "link"].includes(base)) {
          args[0] = pathOf(args[0]);
          mount(args[0]);
          args[1] = mutable(args[1], base, base !== "link");
        } else if (base === "rename") {
          args[0] = mutable(args[0], base, false);
          args[1] = mutable(args[1], base, false);
        } else if (mutating.has(base) || base === "createWriteStream")
          args[0] = mutable(
            args[0],
            base,
            !["unlink", "rm", "rmdir", "mkdir"].includes(base),
          );
        else if (
          typeof args[0] === "string" ||
          args[0] instanceof URL ||
          Buffer.isBuffer(args[0])
        )
          args[0] = pathOf(args[0]);
      } catch (error) {
        const callback = args[args.length - 1];
        if (!name.endsWith("Sync") && typeof callback === "function") {
          queueMicrotask(() => callback(error));
          return;
        }
        throw error;
      }
      if (
        ["write", "writev", "ftruncate"].includes(base) &&
        readonlyDescriptors.has(args[0])
      ) {
        const error = denied(base);
        const callback = args[args.length - 1];
        if (!name.endsWith("Sync") && typeof callback === "function") {
          queueMicrotask(() => callback(error));
          return;
        }
        throw error;
      }
      if (
        base === "read" &&
        typeof args[2] === "number" &&
        args[3] === undefined &&
        args[1]?.byteLength !== undefined
      )
        args[3] = args[1].byteLength - args[2];
      if (base === "close") readonlyDescriptors.delete(args[0]);
      return fs[name](...args);
    };
  }
  api.openSync = (path: any, flags: any = "r", mode?: any) => {
    if (typeof flags === "number" && !(flags & 3)) flags &= ~512;
    const entry = openPath(path, flags);
    const fd = fs.openSync(entry.path, flags, mode);
    if (entry.readonly) readonlyDescriptors.add(fd);
    return fd;
  };
  api.open = (path: any, flags: any, mode: any, callback?: any) => {
    if (typeof mode === "function") {
      callback = mode;
      mode = undefined;
    }
    let fd: number | undefined,
      error: unknown = null;
    try {
      fd = api.openSync(path, flags, mode);
    } catch (failure) {
      error = failure;
    }
    queueMicrotask(() => callback(error, fd));
  };
  api.createReadStream = (path: any, options?: any) => {
    if (typeof options?.fd === "number")
      return fs.createReadStream(path, options);
    const entry = openPath(path, options?.flags);
    const stream = fs.createReadStream(entry.path, options);
    if (entry.readonly) {
      stream.prependListener("open", (fd: number) =>
        readonlyDescriptors.add(fd),
      );
      let fd: number | undefined;
      stream.on("open", (value: number) => {
        fd = value;
      });
      stream.on("close", () => {
        if (fd !== undefined) readonlyDescriptors.delete(fd);
      });
    }
    return stream;
  };
  api.promises = {
    ...fs.promises,
    open: async (path: any, flags: any = "r", mode?: any) => {
      if (typeof flags === "number" && !(flags & 3)) flags &= ~512;
      const entry = openPath(path, flags);
      const handle = await fs.promises.open(entry.path, flags, mode);
      handle.readFile = async (options: any = {}) => {
        const encoding =
          typeof options === "string" ? options : options?.encoding;
        const size = (await handle.stat()).size;
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await handle.read(buffer, 0, size, 0);
        core.getFileByFdOrThrow(handle.fd, "readFile").position = size;
        return encoding
          ? buffer.subarray(0, bytesRead).toString(encoding)
          : buffer.subarray(0, bytesRead);
      };
      for (const name of [
        "write",
        "writev",
        "writeFile",
        "appendFile",
        "truncate",
      ]) {
        const operation = handle[name].bind(handle);
        handle[name] = async (...args: any[]) => {
          await handle.stat();
          if (entry.readonly) throw denied(name);
          return operation(...args);
        };
      }
      if (entry.readonly) {
        readonlyDescriptors.add(handle.fd);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          readonlyDescriptors.delete(handle.fd);
          return close();
        };
      }
      return handle;
    },
  };
  for (const name of [
    ...mutating,
    "rename",
    "copyFile",
    "cp",
    "link",
    "symlink",
  ])
    api.promises[name] = (...args: any[]) =>
      new Promise((resolve, reject) =>
        api[name](...args, (error: unknown, value: unknown) =>
          error ? reject(error) : resolve(value),
        ),
      );
  return {
    descriptorFlags(fd: number) {
      return core.getFileByFdOrThrow(fd, "write").flags;
    },
    readDescriptor(fd: number) {
      const file = core.getFileByFdOrThrow(fd, "read");
      const data = Buffer.from(file.node.getBuffer());
      file.position = data.length;
      return data;
    },
    api,
    statEmbedded(path: any, options?: any) {
      const normalized = pathOf(path);
      mount(normalized);
      return fs.statSync(normalized, options);
    },
    readonly(value: any, follow = true) {
      if (typeof value === "number") return readonlyDescriptors.has(value);
      const path = pathOf(value);
      const target = follow ? resolved(path) : path;
      return (
        target === "/dev" ||
        !temporaryPath(target) ||
        (fs.existsSync(target) &&
          readonlyInodes.has((follow ? fs.statSync : fs.lstatSync)(target).ino))
      );
    },
    clear() {
      for (const name of fs.readdirSync("/"))
        fs.rmSync(`/${name}`, { recursive: true, force: true });
      fs.mkdirSync("/tmp");
      installDevices();
      readonlyDescriptors.clear();
      readonlyInodes.clear();
    },
  };
}

const contexts = new AsyncLocalStorage<ReturnType<typeof createTemporary>>();
const fallback = createTemporary();
const active = () => contexts.getStore() ?? fallback;
export const temporary: any = new Proxy(
  {},
  {
    get(_target, name) {
      return active().api[name];
    },
    ownKeys() {
      return Reflect.ownKeys(fallback.api);
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  },
);
export function clearTemporaryFiles() {
  active().clear();
}
export function runWithTemporaryFiles<T>(callback: () => T): T {
  return runWithDirectory(() => contexts.run(createTemporary(), callback));
}

registerRequestScope(runWithTemporaryFiles);

/** Retain the originating virtual volume for descriptor operations. */
export function retainTemporaryFiles() {
  const volume = active();
  return <T>(operation: () => T): T => contexts.run(volume, operation);
}

export function readonlyFile(value: any, follow = true): boolean {
  return active().readonly(value, follow);
}

export function embeddedStat(path: any, options?: any): any {
  return active().statEmbedded(path, options);
}

registerDirectoryValidator((path) => {
  const normalized = pathOf(path);
  const stat = active().statEmbedded(normalized);
  if (!stat.isDirectory())
    throw Object.assign(new Error("not a directory"), {
      code: "ENOTDIR",
      syscall: "chdir",
      path: normalized,
    });
  return normalized;
});

export function readDescriptor(fd: number): Buffer {
  return active().readDescriptor(fd);
}

export function descriptorFlags(fd: number): number {
  return active().descriptorFlags(fd);
}
