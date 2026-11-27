import { expect, test, vi } from "vitest";
import * as embedded from "./embedded.js";
import * as fs from "./index.js";
import { runWithTemporaryFiles, retainTemporaryFiles } from "./writable.js";

test("access uses Workers permissions for temporary and embedded files", async () => {
  fs.registerVirtualFiles({ "/bundle/access-data": "read only" });
  await runWithTemporaryFiles(async () => {
    fs.writeFileSync("/tmp/access-data", "writable");
    for (let mode = 0; mode < 8; mode++) {
      for (const path of [
        "/tmp/access-data",
        "/bundle/access-data",
        "/tmp/missing",
      ]) {
        const fails =
          !!(mode & fs.X_OK) ||
          (path.startsWith("/bundle") && !!(mode & fs.W_OK)) ||
          path.endsWith("missing");
        if (fails) {
          expect(() => fs.accessSync(path, mode)).toThrow(
            expect.objectContaining({ code: "ENOENT" }),
          );
          await expect(fs.promises.access(path, mode)).rejects.toMatchObject({
            code: "ENOENT",
          });
        } else {
          expect(fs.accessSync(path, mode)).toBeUndefined();
          await expect(fs.promises.access(path, mode)).resolves.toBeUndefined();
        }
        let returned = false;
        const done = new Promise<void>((resolve, reject) => {
          fs.access(path, mode, (error: any) => {
            try {
              expect(returned).toBe(true);
              expect(error?.code ?? null).toBe(fails ? "ENOENT" : null);
              resolve();
            } catch (failure) {
              reject(failure);
            }
          });
        });
        returned = true;
        await done;
      }
    }
    expect(() => fs.access("/tmp/access-data", 8, () => {})).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    await expect(
      // @ts-expect-error Exercise runtime rejection of a nonnumeric mode.
      fs.promises.access("/tmp/access-data", "4"),
    ).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
  });
});

test("temporary files are isolated between requests and from the fallback volume", () => {
  fs.clearVirtualFiles();
  runWithTemporaryFiles(() => {
    fs.mkdirSync("/tmp/request");
    fs.writeFileSync("/tmp/request/data", "one");
    expect(fs.readFileSync("/tmp/request/data", "utf8")).toBe("one");
    runWithTemporaryFiles(() => {
      expect(fs.existsSync("/tmp/request/data")).toBe(false);
      fs.writeFileSync("/tmp/data", "two");
    });
    expect(fs.existsSync("/tmp/data")).toBe(false);
    expect(fs.readFileSync("/tmp/request/data", "utf8")).toBe("one");
  });
  expect(fs.existsSync("/tmp/request/data")).toBe(false);
});

test("concurrent asynchronous requests retain separate temporary files", () => {
  const operation = (value: string) =>
    runWithTemporaryFiles(() => {
      fs.writeFileSync("/tmp/data", value);
      return fs.promises.readFile("/tmp/data", "utf8").then((read: string) => {
        expect(read).toBe(value);
        expect(fs.readFileSync("/tmp/data", "utf8")).toBe(value);
      });
    });
  return Promise.all([operation("first"), operation("second")]);
});

test("a temporary symlink can read but cannot mutate embedded assets", async () => {
  fs.registerVirtualFiles({ "/bundle/secret": "original" });
  fs.symlinkSync("/bundle/secret", "/tmp/link");
  expect(fs.readFileSync("/tmp/link", "utf8")).toBe("original");
  expect(() => fs.writeFileSync("/tmp/link", "changed")).toThrow(
    expect.objectContaining({ code: "EPERM" }),
  );
  await expect(
    fs.promises.writeFile("/tmp/link", "changed"),
  ).rejects.toMatchObject({ code: "EPERM" });
  expect(() => fs.accessSync("/tmp/link", fs.W_OK)).toThrow(
    expect.objectContaining({ code: "ENOENT" }),
  );
  expect(fs.statSync("/tmp/link").mode & 0o777).toBe(0o444);
  expect(() => fs.writeFileSync("/bundle/secret", "changed")).toThrow();
  expect(fs.readFileSync("/bundle/secret", "utf8")).toBe("original");
});

test("relative temporary symlinks resolve from the Workers bundle cwd", async () => {
  await runWithTemporaryFiles(async () => {
    fs.mkdirSync("/tmp/nested");
    fs.writeFileSync("/tmp/nested/data", "local");
    fs.registerVirtualFiles({ "/bundle/data": "bundled" });
    fs.symlinkSync("data", "/tmp/nested/link");
    expect(fs.readFileSync("/tmp/nested/link", "utf8")).toBe("bundled");
    await fs.promises.symlink("../tmp/nested/data", "/tmp/nested/async-link");
    expect(await fs.promises.readFile("/tmp/nested/async-link", "utf8")).toBe(
      "local",
    );
    fs.symlinkSync("../../bundle/secret", "/tmp/nested/escape");
    expect(fs.readlinkSync("/tmp/nested/escape")).toBe("/bundle/secret");
    expect(() => fs.writeFileSync("/tmp/nested/escape", "changed")).toThrow(
      expect.objectContaining({ code: "EPERM" }),
    );
  });
});

test("callback writes report read-only paths asynchronously", async () => {
  let returned = false;
  const done = new Promise<void>((resolve, reject) => {
    fs.writeFile("/bundle/secret", "changed", (error: any) => {
      try {
        expect(returned).toBe(true);
        expect(error.code).toBe("EPERM");
        resolve();
      } catch (failure) {
        reject(failure);
      }
    });
  });
  returned = true;
  await done;
});

test("direct stream constructors use the active request volume", async () => {
  fs.clearVirtualFiles();
  const read = (value: string) =>
    runWithTemporaryFiles(() => {
      fs.writeFileSync("/tmp/stream", value);
      const stream = new fs.ReadStream("/tmp/stream");
      return new Promise<string>((resolve, reject) => {
        let text = "";
        stream.on("data", (chunk: any) => {
          text += chunk.toString();
        });
        stream.on("end", () => resolve(text));
        stream.on("error", reject);
      });
    });
  expect(await Promise.all([read("first"), read("second")])).toEqual([
    "first",
    "second",
  ]);
  expect(fs.existsSync("/tmp/stream")).toBe(false);
});

test("copyFile validates the source path before checking destination permissions", () => {
  for (const source of [null, {}, 42]) {
    expect(() => fs.copyFileSync(source, "/bundle/readonly")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  }
});

test("copyFile replaces the destination entry and leaves other references intact", () => {
  fs.registerVirtualFiles({ "/bundle/new-file": "new" });
  for (const source of ["/tmp/source", "/bundle/new-file"]) {
    runWithTemporaryFiles(() => {
      fs.writeFileSync("/tmp/source", "new");
      fs.writeFileSync("/tmp/target", "old");
      fs.linkSync("/tmp/target", "/tmp/alias");
      fs.symlinkSync("/tmp/target", "/tmp/symlink");
      const fd = fs.openSync("/tmp/target", "r");
      try {
        fs.copyFileSync(source, "/tmp/symlink");
        expect(fs.lstatSync("/tmp/symlink").isFile()).toBe(true);
        expect(fs.readFileSync("/tmp/symlink", "utf8")).toBe("new");
        expect(fs.readFileSync("/tmp/target", "utf8")).toBe("old");
        fs.copyFileSync(source, "/tmp/target", fs.constants.COPYFILE_FICLONE);
        expect(fs.readFileSync("/tmp/target", "utf8")).toBe("new");
        expect(fs.readFileSync("/tmp/alias", "utf8")).toBe("old");
        expect(fs.readFileSync(fd, "utf8")).toBe("old");
        fs.symlinkSync("/tmp/alias", "/tmp/dangling");
        fs.unlinkSync("/tmp/alias");
        fs.copyFileSync(source, "/tmp/dangling", fs.constants.COPYFILE_EXCL);
        expect(fs.lstatSync("/tmp/dangling").isFile()).toBe(true);
        expect(fs.existsSync("/tmp/alias")).toBe(false);
      } finally {
        fs.closeSync(fd);
      }
    });
  }
});

test("embedded files can be copied into temporary files without exposing mutable storage", async () => {
  fs.registerVirtualFiles({ "/bundle/copy-source": "original" });
  const bytes = fs.readFileSync("/bundle/copy-source") as Uint8Array;
  bytes.fill(0);
  expect(fs.readFileSync("/bundle/copy-source", "utf8")).toBe("original");
  await runWithTemporaryFiles(async () => {
    await fs.promises.copyFile("/bundle/copy-source", "/tmp/copy");
    expect(fs.readFileSync("/tmp/copy", "utf8")).toBe("original");
    fs.writeFileSync("/tmp/copy", "changed");
    expect(fs.readFileSync("/bundle/copy-source", "utf8")).toBe("original");
  });
});

test("a failed copy preserves the destination file and any link to it", async () => {
  await runWithTemporaryFiles(async () => {
    fs.mkdirSync("/tmp/source-directory");
    fs.writeFileSync("/tmp/keep", "original");
    fs.symlinkSync("/tmp/keep", "/tmp/link-to-keep");
    for (const dest of ["/tmp/keep", "/tmp/link-to-keep"]) {
      for (const mode of [0, fs.constants.COPYFILE_FICLONE]) {
        expect(() =>
          fs.copyFileSync("/tmp/source-directory", dest, mode),
        ).toThrow(expect.objectContaining({ code: "EISDIR" }));
        expect(fs.readFileSync("/tmp/keep", "utf8")).toBe("original");
        expect(fs.lstatSync("/tmp/link-to-keep").isSymbolicLink()).toBe(true);
      }
      await expect(
        fs.promises.copyFile(
          "/tmp/missing-source",
          dest,
          fs.constants.COPYFILE_EXCL,
        ),
      ).rejects.toMatchObject({ code: "EEXIST" });
    }
  });
});

test("copying a directory preserves a dangling destination link", () => {
  runWithTemporaryFiles(() => {
    fs.mkdirSync("/tmp/source-directory");
    fs.writeFileSync("/tmp/removed", "old");
    fs.symlinkSync("/tmp/removed", "/tmp/dangling");
    fs.unlinkSync("/tmp/removed");
    for (const mode of [
      0,
      fs.constants.COPYFILE_EXCL,
      fs.constants.COPYFILE_FICLONE,
    ]) {
      expect(() =>
        fs.copyFileSync("/tmp/source-directory", "/tmp/dangling", mode),
      ).toThrow(expect.objectContaining({ code: "EISDIR" }));
      expect(fs.readlinkSync("/tmp/dangling")).toBe("/tmp/removed");
      expect(fs.existsSync("/tmp/removed")).toBe(false);
    }
  });
});

test("permission operations preserve file metadata and statfs is a Workers stub", async () => {
  await runWithTemporaryFiles(async () => {
    fs.writeFileSync("/tmp/data", "content");
    const before = fs.statSync("/tmp/data");
    fs.chmodSync("/tmp/data", 0);
    await fs.promises.chown("/tmp/data", 123, 456);
    const handle = await fs.promises.open("/tmp/data", "r+");
    await handle.chmod(0);
    await handle.chown(123, 456);
    await handle.close();
    const after = fs.statSync("/tmp/data");
    expect([after.mode, after.uid, after.gid]).toEqual([
      before.mode,
      before.uid,
      before.gid,
    ]);
    expect(fs.readFileSync("/tmp/data", "utf8")).toBe("content");
    expect(
      Object.values(await fs.promises.statfs("/missing", { bigint: true })),
    ).toEqual(Array(7).fill(0n));
  });
});

test("embedded descriptors, FileHandles and streams preserve read-only data", async () => {
  fs.registerVirtualFiles({ "/bundle/readonly": "abcdef" });
  await runWithTemporaryFiles(async () => {
    const fd = fs.openSync("/bundle/readonly", "r");
    const buffer = Buffer.alloc(3);
    expect(fs.readSync(fd, buffer, 0, 3, 1)).toBe(3);
    expect(buffer.toString()).toBe("bcd");
    expect(fs.fstatSync(fd).mode & 0o777).toBe(0o444);
    expect(() => fs.writeSync(fd, "x")).toThrow(
      expect.objectContaining({ code: "EPERM" }),
    );
    expect(() => fs.ftruncateSync(fd, 0)).toThrow(
      expect.objectContaining({ code: "EPERM" }),
    );
    fs.closeSync(fd);
    expect(() => fs.openSync("/bundle/readonly", "r+")).toThrow(
      expect.objectContaining({ code: "EPERM" }),
    );
    const handle = await fs.promises.open("/bundle/readonly", "r");
    expect(await handle.readFile("utf8")).toBe("abcdef");
    await expect(handle.writeFile("changed")).rejects.toMatchObject({
      code: "EPERM",
    });
    await expect(handle.truncate(0)).rejects.toMatchObject({ code: "EPERM" });
    await handle.close();
    for (const stream of [
      fs.createReadStream("/bundle/readonly"),
      new fs.ReadStream("/bundle/readonly"),
    ]) {
      let text = "";
      for await (const chunk of stream) text += chunk.toString();
      expect(text).toBe("abcdef");
    }
    expect(fs.readFileSync("/bundle/readonly", "hex")).toBe("616263646566");
    expect(Buffer.isBuffer(fs.readFileSync("/bundle/readonly"))).toBe(true);
  });
});

test("copy and hard links preserve embedded inode write restrictions", async () => {
  fs.registerVirtualFiles({
    "/bundle/tree/a": "alpha",
    "/bundle/tree/sub/b": "beta",
  });
  await runWithTemporaryFiles(async () => {
    await fs.promises.cp("/bundle/tree", "/tmp/tree", { recursive: true });
    expect(fs.readFileSync("/tmp/tree/sub/b", "utf8")).toBe("beta");
    fs.writeFileSync("/tmp/tree/a", "copy changed");
    await fs.promises.link("/bundle/tree/a", "/tmp/hard");
    expect(fs.readFileSync("/tmp/hard", "utf8")).toBe("alpha");
    expect(() => fs.writeFileSync("/tmp/hard", "change")).toThrow(
      expect.objectContaining({ code: "EPERM" }),
    );
    await expect(fs.promises.open("/tmp/hard", "r+")).rejects.toMatchObject({
      code: "EPERM",
    });
    expect(fs.statSync("/tmp/hard").mode & 0o777).toBe(0o444);
    fs.unlinkSync("/tmp/hard");
    expect(fs.readFileSync("/bundle/tree/a", "utf8")).toBe("alpha");
    expect(() =>
      fs.cpSync("/bundle/tree/a", "/tmp/filter", { filter: () => true }),
    ).toThrow(expect.objectContaining({ code: "ERR_UNSUPPORTED_OPERATION" }));
  });
});

test("FileHandle metadata retains its originating volume after request scope exits", async () => {
  fs.registerVirtualFiles({ "/bundle/handle-origin": "original" });
  const handles = await runWithTemporaryFiles(async () => {
    fs.writeFileSync("/tmp/handle-origin", "temporary");
    return [
      await fs.promises.open("/bundle/handle-origin", "r"),
      await fs.promises.open("/tmp/handle-origin", "r"),
    ];
  });
  try {
    for (const handle of handles) await handle.utimes(1000, 2000);
    expect((await handles[0].stat()).mtimeMs).toBe(0);
    expect((await handles[0].stat()).mode & 0o777).toBe(0o444);
    expect((await handles[1].stat()).mtimeMs).toBe(2000);
    expect((await handles[1].stat()).mode & 0o777).toBe(0o666);
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
});

test("streams created in an ended request retain their volume when consumed in another request", async () => {
  // Pinned workerd two-request probe: the first stream reads A and writes A;
  // request B retains its independent B contents (fs-cross-request.json).
  for (const kind of ["direct", "handle"]) {
    const held = await runWithTemporaryFiles(async () => {
      fs.writeFileSync("/tmp/lifetime-read", "A");
      fs.writeFileSync("/tmp/lifetime-write", "A");
      const run = retainTemporaryFiles();
      const read =
        kind === "direct"
          ? fs.createReadStream("/tmp/lifetime-read")
          : (
              await fs.promises.open("/tmp/lifetime-read", "r")
            ).createReadStream();
      const write =
        kind === "direct"
          ? fs.createWriteStream("/tmp/lifetime-write")
          : (
              await fs.promises.open("/tmp/lifetime-write", "w")
            ).createWriteStream();
      return { read, write, run };
    });
    await runWithTemporaryFiles(async () => {
      fs.writeFileSync("/tmp/lifetime-read", "B");
      fs.writeFileSync("/tmp/lifetime-write", "B");
      const written = new Promise<void>((resolve, reject) => {
        held.write.once("error", reject);
        held.write.end("changed", () => resolve());
      });
      let text = "";
      for await (const chunk of held.read) text += chunk.toString();
      await written;
      expect(text).toBe("A");
      expect(fs.readFileSync("/tmp/lifetime-read", "utf8")).toBe("B");
      expect(fs.readFileSync("/tmp/lifetime-write", "utf8")).toBe("B");
      expect(
        held.run(() => fs.readFileSync("/tmp/lifetime-write", "utf8")),
      ).toBe("changed");
    });
  }
});

test("callback reads allocate a default Buffer or retain the caller's view", async () => {
  const read = (...args: unknown[]) =>
    runWithTemporaryFiles(async () => {
      fs.writeFileSync("/tmp/callback-read", "abcdef");
      const fd = fs.openSync("/tmp/callback-read", "r");
      const run = retainTemporaryFiles();
      try {
        return await new Promise<{ count: number; buffer: Uint8Array }>(
          (resolve, reject) => {
            fs.read(
              fd,
              ...args,
              (error: Error | null, count: number, buffer: Uint8Array) =>
                error ? reject(error) : resolve({ count, buffer }),
            );
          },
        );
      } finally {
        run(() => fs.closeSync(fd));
      }
    });
  for (const { args, text } of [
    { args: [], text: "abcdef" },
    { args: [{}], text: "abcdef" },
    { args: [{ length: 3, position: 1 }], text: "bcd" },
  ]) {
    const { count, buffer } = await read(...args);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBe(16384);
    expect(new TextDecoder().decode(buffer.subarray(0, count))).toBe(text);
  }
  const storage = new Uint8Array(6).fill(42);
  const view = storage.subarray(1, 5);
  const { count, buffer } = await read({
    buffer: view,
    offset: 1,
    length: 2,
    position: 2,
  });
  expect(buffer).toBe(view);
  expect(count).toBe(2);
  expect(Array.from(storage)).toEqual([42, 42, 99, 100, 42, 42]);
});

test("callback options validate the destination range before reading", async () => {
  await runWithTemporaryFiles(async () => {
    fs.writeFileSync("/tmp/read-range", "a");
    const fd = fs.openSync("/tmp/read-range", "r");
    const run = retainTemporaryFiles();
    const buffer = new Uint8Array(1);
    try {
      for (const [offset, length] of [
        [0, 2],
        [1, 1],
      ]) {
        expect(() => fs.read(fd, { buffer, offset, length }, () => {})).toThrow(
          expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
        );
      }
      const result = await new Promise((resolve, reject) =>
        fs.read(
          fd,
          { buffer, offset: 2, length: 0 },
          (error: Error | null, count: number, actual: Uint8Array) =>
            error ? reject(error) : resolve([count, actual === buffer]),
        ),
      );
      expect(result).toEqual([0, true]);
    } finally {
      run(() => fs.closeSync(fd));
    }
  });
});
test("whole-file writers retain unresolved link entries and never create their targets", async () => {
  await runWithTemporaryFiles(async () => {
    fs.writeFileSync("/tmp/file", "original");
    fs.symlinkSync("/tmp/missing", "/tmp/dangling");
    fs.symlinkSync("/tmp/dangling", "/tmp/chain");
    fs.symlinkSync("/tmp/file/child", "/tmp/invalid-parent");
    for (const path of ["/tmp/dangling", "/tmp/chain", "/tmp/invalid-parent"]) {
      const target = fs.readlinkSync(path);
      for (const flag of ["w", "wx", "r+", "a", "ax"]) {
        for (const write of [fs.writeFileSync, fs.appendFileSync]) {
          expect(() => write(path, "data", { flag })).toThrow(
            expect.objectContaining({ code: "EEXIST", syscall: "writeAll" }),
          );
        }
      }
      expect(fs.readlinkSync(path)).toBe(target);
      expect(fs.existsSync("/tmp/missing")).toBe(false);
    }
    await new Promise<void>((resolve, reject) => {
      fs.writeFile(
        "/tmp/dangling",
        "data",
        (error: NodeJS.ErrnoException | null) => {
          try {
            expect(error?.code).toBe("EEXIST");
            expect(fs.existsSync("/tmp/missing")).toBe(false);
            resolve();
          } catch (cause) {
            reject(cause);
          }
        },
      );
    });
    fs.symlinkSync("/tmp/self", "/tmp/self");
    fs.symlinkSync("/tmp/right", "/tmp/left");
    fs.symlinkSync("/tmp/left", "/tmp/right");
    for (const path of ["/tmp/self", "/tmp/left"]) {
      for (const write of [fs.writeFileSync, fs.appendFileSync]) {
        for (const flag of ["w", "a", "wx", "ax"]) {
          expect(() => write(path, "data", { flag })).toThrow(
            expect.objectContaining({
              code: flag.includes("x") ? "EEXIST" : "ELOOP",
              syscall: "writeAll",
            }),
          );
        }
      }
    }
    fs.symlinkSync("/tmp/file", "/tmp/valid");
    fs.appendFileSync("/tmp/valid", "!");
    expect(fs.readFileSync("/tmp/file", "utf8")).toBe("original!");
  });
});

test("rejecting writes to embedded directories does not read their contents", () => {
  fs.registerVirtualFiles({ "/bundle/write-guard/child": "read only" });
  runWithTemporaryFiles(() => {
    const read = vi.spyOn(embedded, "readFileSync");
    try {
      expect(() => fs.writeFileSync("/bundle/write-guard", "ignored")).toThrow(
        expect.objectContaining({ code: "EPERM" }),
      );
      expect(() =>
        fs.appendFileSync("/bundle/write-guard", "ignored", { flag: "ax" }),
      ).toThrow(expect.objectContaining({ code: "EEXIST" }));
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
});
