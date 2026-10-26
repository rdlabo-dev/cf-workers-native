import * as promises from "../../src/compat/fs/promises/index.js";
import * as fs from "../../src/compat/fs/index.js";
import { Buffer } from "node:buffer";
type IsAny<T> = 0 extends 1 & T ? true : false;
const promisesAreTyped: IsAny<typeof fs.promises> = false;
const openIsTyped: IsAny<typeof promises.open> = false;
const file = await promises.open("/tmp/types", "w+");
const fd: number | undefined = file.fd;
const input = new DataView(new ArrayBuffer(4));
const read = await file.read(input, { position: 0 });
const count: number = read.bytesRead;
const sameView: DataView = read.buffer;
const vector = await file.readv([input]);
const vectorView: DataView = vector.buffers[0];
const raw: Buffer = await file.readFile();
const text: string = await file.readFile("utf8");
const text2: string = await promises.readFile("/tmp/types", {
  encoding: "utf8",
});
const raw2: Buffer = await promises.readFile("/tmp/types");
const result = await file.writeFile(input);
const sameWrittenView: DataView = result.buffer;
const written: number = result.bytesWritten;
const closed: Promise<void> = file.close();
// @ts-expect-error Unsupported path type.
promises.readFile(Symbol("path"));
// @ts-expect-error Encoding must be a BufferEncoding or buffer selection.
promises.readFile("/tmp/types", "not-an-encoding");
// @ts-expect-error Read buffer must be an ArrayBuffer view.
file.read("not-a-buffer");
void [
  promisesAreTyped,
  openIsTyped,
  fd,
  count,
  sameView,
  vectorView,
  raw,
  text,
  text2,
  raw2,
  sameWrittenView,
  written,
  closed,
];

const stringWrite: Buffer = (await file.write("hello")).buffer;
const stringWriteFile: Buffer = (await file.writeFile("hello")).buffer;
const tuple = [input, new Uint8Array(2)] as const;
const readTuple: typeof tuple = (await file.readv(tuple)).buffers;
const writeTuple: typeof tuple = (await file.writev(tuple)).buffers;
const bigintSize: bigint = (await file.stat({ bigint: true })).size;
const numberSize: number = (await promises.stat("/tmp/types")).size;
const entryNames: string[] = await promises.readdir("/tmp");
const bufferNames: Buffer[] = await promises.readdir("/tmp", "buffer");
const entries = await promises.readdir("/tmp", { withFileTypes: true });
const directory: boolean = entries[0].isDirectory();
for await (const entry of promises.glob("*", { withFileTypes: true })) {
  const isFile: boolean = entry.isFile();
  void isFile;
}
// @ts-expect-error File descriptors are read only.
file.fd = 1;
// @ts-expect-error Workers does not implement Node-only promise operations.
promises.openAsBlob("/tmp/types");
// @ts-expect-error Numeric mode required by access.
promises.access("/tmp/types", "4");
void [
  stringWrite,
  stringWriteFile,
  readTuple,
  writeTuple,
  bigintSize,
  numberSize,
  entryNames,
  bufferNames,
  directory,
];

import defaultFs from "../../src/compat/fs/index.js";
const defaultPromisesAreTyped: IsAny<typeof defaultFs.promises> = false;
const defaultBuffer: Buffer = (await file.read()).buffer;
const optionBuffer: Buffer = (await file.read({ length: 1 })).buffer;
const optionView: DataView = (await file.read({ buffer: input })).buffer;
// @ts-expect-error A selected generic view type requires an actual buffer.
file.read<DataView>();
// @ts-expect-error Omitting the buffer cannot promise a DataView.
file.read<DataView>({ length: 1 });
const mixedInput: string | Uint8Array = Math.random()
  ? "hello"
  : new Uint8Array(3);
const mixedWrite: Buffer | Uint8Array = (await file.write(mixedInput)).buffer;
const mixedWriteFile: Buffer | Uint8Array = (await file.writeFile(mixedInput))
  .buffer;
void [
  defaultPromisesAreTyped,
  defaultBuffer,
  optionBuffer,
  optionView,
  mixedWrite,
  mixedWriteFile,
];

const temporaryName: string = await promises.mkdtemp("/tmp/type-", "buffer");
void temporaryName;

// @ts-expect-error View writes interpret the second argument as a numeric offset.
file.write(new Uint8Array(1), 1n);
file.write("text", 1n);
