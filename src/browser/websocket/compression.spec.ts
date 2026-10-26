import { expect, it } from "vitest";
import {
  createDeflateRaw,
  createInflateRaw,
  constants,
  deflateRawSync,
  inflateRawSync,
} from "node:zlib";
import { negotiateCompression } from "./compression.js";
import { FrameReader } from "./frames.js";

it("interoperates with Node zlib over multiple messages with context takeover", async () => {
  const codec = negotiateCompression("permessage-deflate");
  const deflater = createDeflateRaw(),
    inflater = createInflateRaw();
  const exchange = async (
    stream: typeof deflater | typeof inflater,
    bytes: Uint8Array,
  ) => {
    const chunks: Buffer[] = [];
    const collect = (chunk: Buffer) => chunks.push(chunk);
    stream.on("data", collect);
    try {
      stream.write(bytes);
      await new Promise<void>((resolve, reject) => {
        stream.once("error", reject);
        stream.flush(constants.Z_SYNC_FLUSH, () => {
          stream.off("error", reject);
          resolve();
        });
      });
      return Buffer.concat(chunks);
    } finally {
      stream.off("data", collect);
    }
  };
  try {
    for (const text of [
      "repeat-".repeat(10000),
      "repeat-".repeat(9000),
      "",
      "あ😀".repeat(3000),
    ]) {
      const input = new TextEncoder().encode(text);
      const compressed = input.length
        ? await exchange(deflater, input)
        : Buffer.from([0, 0, 0, 255, 255]);
      expect(
        codec.decode(compressed.subarray(0, compressed.length - 4)),
      ).toEqual(input);
      const encoded = codec.encode(input);
      expect(
        new TextDecoder().decode(
          await exchange(
            inflater,
            Buffer.concat([encoded, Buffer.from([0, 0, 255, 255])]),
          ),
        ),
      ).toBe(text);
    }
  } finally {
    codec.dispose();
    deflater.destroy();
    inflater.destroy();
  }
});
it("resets both compression contexts only when negotiated and interoperates with independent streams", () => {
  const codec = negotiateCompression(
    "permessage-deflate; server_no_context_takeover; client_no_context_takeover; server_max_window_bits=10",
  );
  try {
    for (const text of ["repeat-".repeat(100), "repeat-".repeat(100), ""]) {
      const input = Buffer.from(text);
      const compressed = deflateRawSync(input, {
        windowBits: 10,
        finishFlush: constants.Z_SYNC_FLUSH,
      });
      expect(
        Buffer.from(codec.decode(compressed.subarray(0, -4))).toString(),
      ).toBe(text);
      expect(
        inflateRawSync(
          Buffer.concat([codec.encode(input), Buffer.from([0, 0, 255, 255])]),
          { finishFlush: constants.Z_SYNC_FLUSH },
        ).toString(),
      ).toBe(text);
    }
  } finally {
    codec.dispose();
  }
});
it.each([
  "unknown",
  "permessage-deflate, other",
  "permessage-deflate; unknown=1",
  "permessage-deflate; client_max_window_bits=10",
  "permessage-deflate; server_max_window_bits=7",
  "permessage-deflate; server_no_context_takeover=1",
  "permessage-deflate; server_no_context_takeover; server_no_context_takeover",
])("rejects unoffered or malformed extension negotiation: %s", (header) => {
  expect(() => negotiateCompression(header)).toThrow();
});
it("allows RSV1 only on negotiated initial data frames", () => {
  const frames: unknown[] = [];
  new FrameReader(true).push(Uint8Array.of(0xc1, 0), (frame) =>
    frames.push(frame),
  );
  expect(frames).toEqual([
    { opcode: 1, final: true, payload: new Uint8Array(), compressed: true },
  ]);
  for (const byte of [0xc0, 0xc8, 0xc9, 0xe1])
    expect(() =>
      new FrameReader(true).push(Uint8Array.of(byte, 0), () => {}),
    ).toThrow();
  expect(() =>
    new FrameReader().push(Uint8Array.of(0xc1, 0), () => {}),
  ).toThrow();
});
