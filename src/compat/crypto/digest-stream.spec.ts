import { expect, test } from "vitest";
import { DigestStream } from "./digest-stream.js";
import { dispose } from "../../shared/globals/symbols.js";
const hex = (value: ArrayBuffer) => Buffer.from(value).toString("hex");
for (const [algorithm, expected] of Object.entries({
  "SHA-256": "15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225",
  crc32: "cbf43926",
  crc32c: "e3069283",
  crc64nvme: "ae8b14860a799888",
}))
  test(`DigestStream ${algorithm} split input`, async () => {
    const stream = new DigestStream(algorithm);
    expect(stream.digest).toBe(stream.digest);
    const writer = stream.getWriter();
    await writer.write("1234");
    await writer.write(new TextEncoder().encode("56789"));
    await writer.close();
    expect(stream.bytesWritten).toBe(9n);
    expect(hex(await stream.digest)).toBe(expected);
  });
test("WTF-8 chunks preserve independent lone surrogates", async () => {
  const stream = new DigestStream("SHA-256");
  const writer = stream.getWriter();
  await writer.write("\ud800");
  expect(stream.bytesWritten).toBe(3n);
  await writer.write("\udc00");
  await writer.close();
  expect(hex(await stream.digest)).toBe(
    "b67d2ab17d9e4a31bfb0c9e3bf5acbbce5f3df109c4afde0c3fef9c16f712b37",
  );
});
test("well-formed encoding carries a high surrogate until the next string", async () => {
  const stream = new DigestStream("SHA-256", { toWellFormed: true });
  const writer = stream.getWriter();
  await writer.write("\ud800");
  expect(stream.bytesWritten).toBe(0n);
  await writer.write("\udc00");
  expect(stream.bytesWritten).toBe(4n);
  await writer.close();
  const expected = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("\ud800\udc00"),
  );
  expect(hex(await stream.digest)).toBe(hex(expected));
});
test("dispose rejects digest while an empty write still succeeds", async () => {
  const stream = new DigestStream("SHA-256");
  const writer = stream.getWriter();
  const digest = stream.digest.catch((error) => error);
  stream[dispose]();
  stream[dispose]();
  await writer.write("");
  await expect(writer.write("a")).rejects.toThrow(
    "The DigestStream was disposed.",
  );
  expect((await digest).message).toBe("The DigestStream was disposed.");
  expect(stream.bytesWritten).toBe(0n);
});
test("abort keeps the exact reason", async () => {
  const stream = new DigestStream("SHA-256");
  const reason = { cancel: true };
  const digest = stream.digest.catch((error) => error);
  await stream.abort(reason);
  expect(await digest).toBe(reason);
});
test("empty string preserves a pending surrogate and close flushes a lone lead", async () => {
  const stream = new DigestStream("SHA-256", { toWellFormed: true }),
    writer = stream.getWriter();
  await writer.write("\ud800");
  await writer.write("");
  expect(stream.bytesWritten).toBe(0n);
  await writer.close();
  expect(stream.bytesWritten).toBe(3n);
  const expected = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("\ufffd"),
  );
  expect(hex(await stream.digest)).toBe(hex(expected));
  stream[dispose]();
  writer.releaseLock();
  await stream.abort("ignored");
  expect(hex(await stream.digest)).toBe(hex(expected));
});
test("invalid writes error the writer but leave digest pending until disposal", async () => {
  const stream = new DigestStream("SHA-256"),
    writer = stream.getWriter();
  let settled = false;
  void stream.digest.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await expect(writer.write({} as never)).rejects.toThrow(
    "non-ArrayBuffer/ArrayBufferView/string",
  );
  await writer.abort("ignored because writer is already errored");
  await Promise.resolve();
  expect(settled).toBe(false);
  stream[dispose]();
  await Promise.resolve();
  expect(settled).toBe(true);
});
test("SAB views are bytes while a bare SAB is rejected", async () => {
  const buffer = new SharedArrayBuffer(2);
  new Uint8Array(buffer).set([1, 2]);
  const stream = new DigestStream("crc32"),
    writer = stream.getWriter();
  await writer.write(new Uint8Array(buffer, 2, 0));
  await writer.write(new DataView(buffer));
  await writer.close();
  expect(stream.bytesWritten).toBe(2n);
  const invalid = new DigestStream("crc32");
  await expect(invalid.getWriter().write(buffer as never)).rejects.toThrow(
    "non-ArrayBuffer/ArrayBufferView/string",
  );
  invalid[dispose]();
});
