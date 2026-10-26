import { expect, test } from "vitest";
import * as fs from "./index.js";
import { runWithTemporaryFiles } from "./writable.js";

test("FileHandle owns its events, methods and readonly descriptor", async () => {
  await runWithTemporaryFiles(async () => {
    fs.writeFileSync("/tmp/handle-one", "one");
    fs.writeFileSync("/tmp/handle-two", "second");
    const a = await fs.promises.open("/tmp/handle-one", "r"),
      b = await fs.promises.open("/tmp/handle-two", "r");
    try {
      expect(a.read).toBe(a.read);
      expect(a.read).toBe(Object.getPrototypeOf(a).read);
      expect(
        a.on("sample", function (this: unknown) {
          expect(this).toBe(a);
        }),
      ).toBe(a);
      a.emit("sample");
      expect((await a.stat.call(b)).size).toBe(6);
      await expect(a.stat.call({})).rejects.toBeInstanceOf(TypeError);
      const detached = a.stat;
      await expect(detached()).rejects.toBeInstanceOf(TypeError);
      expect(() => {
        // @ts-expect-error The descriptor is readonly in the public API.
        a.fd = 12345;
      }).toThrow(TypeError);
      expect(() => Reflect.construct(a.constructor, [])).toThrow(
        "Illegal constructor",
      );
      expect(() => a.readLines.call({ fd: a.fd })).toThrow(TypeError);
      for (const key of ["fd", "fs", "refs", "closePromise", "read", "stat"])
        expect(Object.hasOwn(a, key)).toBe(false);
      expect(Reflect.get(a, "ref")).toBeUndefined();
      expect(Reflect.get(a, "unref")).toBeUndefined();
      await a.close();
      expect(a.fd).toBeUndefined();
      await expect(a.stat()).rejects.toMatchObject({
        code: "EBADF",
        message: "Bad file descriptor",
      });
      let count = 0;
      a.on("close", () => count++);
      await a.close();
      expect(count).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
test("FileHandle operations retain the originating volume and result object contract", async () => {
  const handle = await runWithTemporaryFiles(async () => {
    fs.writeFileSync("/tmp/owned", "abc");
    return fs.promises.open("/tmp/owned", "r+");
  });
  try {
    const bytes = new Uint8Array(3),
      read = await handle.read(bytes, 0, 3, 0);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(read.buffer).toBe(bytes);
    expect(Array.from(bytes)).toEqual([97, 98, 99]);
    const written = await handle.writeFile("xy");
    expect(written.bytesWritten).toBe(2);
    expect(Buffer.from(written.buffer).toString()).toBe("xy");
    expect(await handle.readFile("utf8")).toBe("xy");
  } finally {
    await handle.close();
  }
});

test("external close cannot let an old handle close a new descriptor", async () => {
  await runWithTemporaryFiles(async () => {
    fs.writeFileSync("/tmp/lease", "abc");
    const old = await fs.promises.open("/tmp/lease", "r+"),
      fd = old.fd;
    fs.closeSync(fd);
    const current = await fs.promises.open("/tmp/lease", "r+");
    expect(current.fd).not.toBe(fd);
    expect(current.constructor).toBe(fs.promises.FileHandle);
    await expect(old.stat()).rejects.toMatchObject({ code: "EBADF" });
    await old.close();
    expect((await current.stat()).size).toBe(3);
    await current.close();
  });
});
