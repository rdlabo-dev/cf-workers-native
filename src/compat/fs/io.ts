import { viewBytes } from "../../shared/buffer-source.js";
import { Buffer } from "node:buffer";
import { pathOf, descriptorFlags, readDescriptor } from "./writable.js";
import { fileMode } from "./mode.js";
import {
  validateWriteArgs,
  validateReadArgs,
  getValidatedFd,
  validatePosition,
} from "./io-validation.js";
import {
  validateBoolean,
  validateObject,
  validateFunction,
  validateUint32,
} from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from "../net/errors.js";
export function installIo(api: any, promises: any) {
  const raw = { ...api };
  const fail = (code: string, message = code): never => {
    throw Object.assign(new Error(message), { code });
  };
  const perform = (fn: () => any) => {
    try {
      return fn();
    } catch (e: any) {
      if (e.code === "EBADF") e.message = "bad file descriptor";
      throw e;
    }
  };
  const install = (
    name: string,
    prepare: (...args: any[]) => any[],
    action: (...args: any[]) => any,
    extra?: (args: any[]) => any[],
  ) => {
    api[name + "Sync"] = (...args: any[]) =>
      perform(() => action(...prepare(...args)));
    api[name] = (...args: any[]) => {
      const callback =
        typeof args.at(-1) === "function" ? args.pop() : undefined;
      if (name === "read") validateFunction(callback, "callback");
      const prepared = prepare(...args);
      validateFunction(callback, "callback");
      let error: unknown, value: any;
      try {
        value = perform(() => action(...prepared));
      } catch (cause) {
        error = cause;
      }
      queueMicrotask(() =>
        callback(error ?? null, value, ...(extra?.(args) ?? [])),
      );
    };
    if (Object.hasOwn(promises, name))
      promises[name] = async (...args: any[]) => {
        const result = api[name + "Sync"](...args);
        // Workers' whole-file promise writers resolve without a value, unlike
        // their synchronous counterparts and FileHandle.writeFile.
        return name === "writeFile" || name === "appendFile"
          ? undefined
          : result;
      };
  };
  const flags = (flag: any) => {
    if (typeof flag === "number") {
      validateUint32(flag, "flags");
      return flag;
    }
    const value: Record<string, number> = {
      r: 0,
      "r+": 2,
      rs: 1052672,
      sr: 1052672,
      "rs+": 1052674,
      "sr+": 1052674,
      w: 577,
      wx: 705,
      xw: 705,
      "w+": 578,
      "wx+": 706,
      "xw+": 706,
      a: 1089,
      ax: 1217,
      xa: 1217,
      "a+": 1090,
      "ax+": 1218,
      "xa+": 1218,
      as: 1053761,
      sa: 1053761,
      "as+": 1053762,
      "sa+": 1053762,
    };
    if (!Object.hasOwn(value, flag))
      throw new ERR_INVALID_ARG_VALUE("flags", flag);
    return value[flag];
  };
  install(
    "close",
    (fd: any) => [getValidatedFd(fd)],
    (fd) => {
      try {
        raw.closeSync(fd);
      } catch (e: any) {
        if (e.code !== "EBADF") throw e;
      }
    },
  );
  for (const name of ["truncate", "ftruncate"])
    install(
      name,
      (path: any, length = 0) => {
        validateUint32(length, "len");
        return [
          name === "ftruncate" ? getValidatedFd(path) : pathOf(path),
          length,
        ];
      },
      (...args: any[]) => raw[name + "Sync"](...args),
    );
  for (const name of ["write", "read"])
    install(
      name,
      (
        fd: any,
        buffer: any,
        offset: any = name === "read" ? 0 : null,
        length?: any,
        position: any = null,
      ) => {
        const result = (
          name === "write" ? validateWriteArgs : validateReadArgs
        )(fd, buffer, offset, length, position);
        return [result.fd, result.buffer, result.position];
      },
      (fd: number, buffers: any[], position: any) => {
        if (typeof position === "bigint") {
          if (position < 0n || position > 0xffffffffn) fail("EINVAL");
          position = Number(position);
        }
        if (!buffers.length) return 0;
        return perform(() =>
          raw[name + "Sync"](
            fd,
            buffers[0],
            0,
            buffers[0].byteLength,
            position,
          ),
        );
      },
      (args) => [args[1]],
    );
  const writeCallback = api.write;
  api.write = (...args: any[]) => {
    if (
      typeof args[1] === "string" &&
      args[2] !== null &&
      typeof args[2] === "object"
    )
      args[2] = args[2].position ?? null;
    return writeCallback(...args);
  };
  for (const name of ["readv", "writev"])
    install(
      name,
      (fd: any, buffers: any, position: any = null) => {
        getValidatedFd(fd);
        validatePosition(position, "position");
        if (
          !Array.isArray(buffers) ||
          buffers.some((b) => !ArrayBuffer.isView(b))
        )
          throw new ERR_INVALID_ARG_TYPE(
            "buffers",
            "ArrayBufferView[]",
            buffers,
          );
        return [fd, buffers, position];
      },
      (fd: number, buffers: any[], position: any) => {
        let count = 0;
        for (const buffer of buffers) {
          const bytes = viewBytes(buffer);
          const size = api[name === "readv" ? "readSync" : "writeSync"](
            fd,
            bytes,
            0,
            bytes.byteLength,
            position === null ? null : Number(position) + count,
          );
          count += size;
        }
        return count;
      },
      (args) => [args[1]],
    );
  const optionsObject = (options: any) =>
    typeof options === "string" || options == null
      ? { encoding: options }
      : options;
  install(
    "readFile",
    (path: any, options: any = {}) => {
      options = optionsObject(options);
      validateObject(options, "options");
      const { encoding = null, flag = "r" } = options;
      flags(flag);
      if (
        encoding !== null &&
        encoding !== "buffer" &&
        !Buffer.isEncoding(encoding)
      )
        throw new ERR_INVALID_ARG_VALUE("options.encoding", encoding);
      return [
        typeof path === "number" ? getValidatedFd(path) : pathOf(path),
        encoding,
      ];
    },
    (path: any, encoding: any) => {
      let data;
      try {
        data =
          typeof path === "number"
            ? readDescriptor(path)
            : raw.readFileSync(path);
      } catch (error) {
        if (typeof path === "string" && (error as any)?.code === "ENOENT") {
          throw Object.assign(
            new Error(`no such file or directory, readAll '${path}'`),
            {
              code: "ENOENT",
              errno: -2,
              syscall: "readAll",
              path,
            },
          );
        }
        throw error;
      }
      return typeof encoding === "string" ? data.toString(encoding) : data;
    },
  );
  for (const name of ["writeFile", "appendFile"])
    install(
      name,
      (path: any, data: any, options: any = {}) => {
        path = typeof path === "number" ? getValidatedFd(path) : pathOf(path);
        options = optionsObject(options);
        validateObject(options, "options");
        const {
          encoding = "utf8",
          mode = 0o666,
          flag = name === "appendFile" ? "a" : "w",
          flush = false,
        } = options;
        if (encoding !== "buffer" && !Buffer.isEncoding(encoding))
          throw new ERR_INVALID_ARG_VALUE("options.encoding", encoding);
        validateBoolean(flush, "options.flush");
        fileMode(mode);
        const value = flags(flag);
        if (!(value & 3) && !(value & 1024))
          throw new ERR_INVALID_ARG_VALUE(
            "flag",
            flag,
            "must indicate write or append",
          );
        if (typeof data === "string") data = Buffer.from(data, encoding);
        if (!ArrayBuffer.isView(data))
          throw new ERR_INVALID_ARG_TYPE(
            "data",
            ["string", "Buffer", "TypedArray", "DataView"],
            data,
          );
        return [
          path,
          Buffer.from(viewBytes(data)),
          Boolean(value & 1024),
          Boolean(value & 128),
        ];
      },
      (path: any, data: Buffer, append: boolean, exclusive: boolean) => {
        if (typeof path !== "number") {
          if (exclusive && api.existsSync(path)) fail("EEXIST");
          raw[append ? "appendFileSync" : "writeFileSync"](path, data);
          return data.length;
        }
        append ||= Boolean(descriptorFlags(path) & 1024);
        if (!append) api.ftruncateSync(path, 0);
        return api.writeSync(
          path,
          data,
          0,
          data.length,
          append ? api.fstatSync(path).size : 0,
        );
      },
    );
  // The callback frontends have their own pinned validation/default order.
  api.readFile = (path: any, options: any, callback?: any) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    options = optionsObject(options);
    validateObject(options, "options");
    const { encoding = null } = options;
    if (
      encoding !== null &&
      encoding !== "buffer" &&
      !Buffer.isEncoding(encoding)
    )
      throw new ERR_INVALID_ARG_VALUE("options.encoding", encoding);
    validateFunction(callback, "callback");
    try {
      const value = api.readFileSync(path, options);
      queueMicrotask(() => callback(null, value));
    } catch (error) {
      queueMicrotask(() => callback(error));
    }
  };
  api.appendFile = (path: any, data: any, options: any, callback?: any) => {
    if (typeof options === "function") {
      callback = options;
      options = { encoding: "utf8", mode: 0o666, flag: "a", flush: false };
    }
    return api.writeFile(path, data, options, callback);
  };
  const open = api.openSync;
  api.openSync = (path: any, flag: any = "r", mode?: any) => {
    let value = flags(flag);
    if (!(value & 3)) value &= ~512;
    return open(path, value, mode);
  };
  api.constants = Object.assign(Object.create(null), api.constants);
  for (const name of [
    "UV_FS_COPYFILE_EXCL",
    "UV_FS_COPYFILE_FICLONE",
    "UV_FS_COPYFILE_FICLONE_FORCE",
  ])
    api.constants[name] = api.constants[name.slice(6)];
  promises.constants = api.constants;
  const rename = api.renameSync;
  install(
    "rename",
    (src: any, dst: any) => [pathOf(src), pathOf(dst)],
    (src: string, dst: string) => {
      if (src === dst) return;
      const stat = api.lstatSync(src);
      const target = api.lstatSync(dst, { throwIfNoEntry: false });
      if (stat.isDirectory()) {
        if (dst.startsWith(src + "/")) fail("EINVAL");
        if (target && !target.isDirectory()) fail("ENOTDIR");
        if (target && api.readdirSync(dst).length) fail("ENOTEMPTY");
      } else if (target?.isDirectory()) fail("EISDIR");
      return rename(src, dst);
    },
  );
  const copy = api.copyFileSync;
  install(
    "copyFile",
    (src: any, dst: any, mode: any = 0) => {
      src = pathOf(src);
      dst = pathOf(dst);
      if (![0, 1, 2, 4].includes(mode))
        throw new ERR_INVALID_ARG_VALUE("mode", mode);
      if (mode === 4)
        fail(
          "ERR_UNSUPPORTED_OPERATION",
          "The requested operation is unsupported",
        );
      return [src, dst, mode];
    },
    copy,
  );
}
