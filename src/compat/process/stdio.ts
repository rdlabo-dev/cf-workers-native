// Copyright (c) 2017-2026 Cloudflare, Inc. Apache-2.0.
// Adapted from workerd 5358e3d337336eaf696a48bc1563d808b10feba5 public_process.ts.
import { Writable as WritableImplementation } from "../stream/writable.js";
import type { Writable as DeclaredWritable } from "node:stream";
const Writable = WritableImplementation as unknown as typeof DeclaredWritable;
import { Buffer } from "node:buffer";
import { ReadStream, writeSync } from "../fs/index.js";
class SyncWriteStream extends Writable {
  readonly fd: number;
  readable = false;
  _type = "fs";
  _isStdio = true;
  constructor(fd: number) {
    super({ autoDestroy: true });
    this.fd = fd;
  }
  override _write(
    chunk: Buffer | string | ArrayBufferView,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    try {
      writeSync(
        this.fd,
        Buffer.isBuffer(chunk)
          ? chunk
          : typeof chunk === "string"
            ? Buffer.from(chunk, encoding)
            : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      );
    } catch (error) {
      callback(error as Error);
      return;
    }
    callback();
  }
}
export let stdin: InstanceType<typeof ReadStream>;
export let stdout: SyncWriteStream;
export let stderr: SyncWriteStream;
export function openStdin() {
  return stdin;
}
export function installStdio() {
  if (stdin) return;
  stdin = new ReadStream(null, { fd: 0, autoClose: false });
  Object.assign(stdin, {
    fd: 0,
    allowHalfOpen: false,
    bufferSize: 0,
    connecting: false,
    readyState: "open",
  });
  stdout = new SyncWriteStream(1);
  stderr = new SyncWriteStream(2);
  for (const stream of [stdout, stderr])
    Object.assign(stream, {
      allowHalfOpen: false,
      bufferSize: 0,
      bytesRead: 0,
      bytesWritten: 0,
      connecting: false,
      pending: false,
      readableAborted: false,
      readableDidRead: false,
      readableEnded: false,
      readableHighWaterMark: 16384,
      readableLength: 0,
      readableObjectMode: false,
      readyState: "open",
    });
}
