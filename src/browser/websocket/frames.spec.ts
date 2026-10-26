import { describe, expect, it } from "vitest";
import {
  closePayload,
  decodeClose,
  encodeFrame,
  FrameReader,
} from "./frames.js";

describe("native WebSocket framing", () => {
  it("parses coalesced frames across every byte boundary, including empty control frames", () => {
    const wire = Uint8Array.of(
      0x01,
      3,
      97,
      98,
      99,
      0x89,
      0,
      0x80,
      2,
      100,
      101,
      0x88,
      2,
      3,
      232,
    );
    for (let split = 0; split <= wire.length; split++) {
      const reader = new FrameReader();
      const frames: unknown[] = [];
      const consume = (frame: {
        opcode: number;
        final: boolean;
        payload: Uint8Array;
      }) => frames.push([frame.opcode, frame.final, [...frame.payload]]);
      reader.push(wire.subarray(0, split), consume);
      reader.push(wire.subarray(split), consume);
      expect(frames).toEqual([
        [1, false, [97, 98, 99]],
        [9, true, []],
        [0, true, [100, 101]],
        [8, true, [3, 232]],
      ]);
      expect(reader.incomplete).toBe(false);
    }
  });
  it.each([125, 126, 65535, 65536])(
    "masks client frames of %i bytes with the RFC length encoding",
    (length) => {
      const payload = Uint8Array.from({ length }, (_, i) => i % 251);
      const wire = encodeFrame(2, payload);
      expect(wire[0]).toBe(0x82);
      expect(wire[1]! & 128).toBe(128);
      const extended = length < 126 ? 0 : length < 65536 ? 2 : 8;
      const view = new DataView(wire.buffer);
      expect(
        extended === 0
          ? wire[1]! & 127
          : extended === 2
            ? view.getUint16(2)
            : Number(view.getBigUint64(2)),
      ).toBe(length);
      const mask = wire.subarray(2 + extended, 6 + extended);
      expect(
        Uint8Array.from(
          wire.subarray(6 + extended),
          (v, i) => v ^ mask[i % 4]!,
        ),
      ).toEqual(payload);
    },
  );
  it.each([
    [0xc1, 0], // unnegotiated RSV1
    [0x81, 0x80], // server masking
    [0x83, 0], // unknown opcode
    [0x09, 0], // fragmented ping
    [0x89, 126], // oversized control frame
    [0x82, 126, 0, 1], // nonminimal length
    [0x82, 127, 0, 0, 0, 0, 0, 0, 0, 126],
    [0x82, 127, 0x80, 0, 0, 0, 0, 0, 0, 0], // invalid 64-bit length
    [0x82, 127, 0, 0, 0, 0, 8, 0, 0, 1], // over message limit
  ])(
    "rejects invalid frame header %j before receiving a payload",
    (...wire) => {
      expect(() =>
        new FrameReader().push(Uint8Array.from(wire), () => {}),
      ).toThrow();
    },
  );
  it("validates close codes and UTF-8 and preserves an absent status", () => {
    expect(decodeClose(new Uint8Array())).toEqual({ code: 1005, reason: "" });
    expect(decodeClose(closePayload(1000, "完了"))).toEqual({
      code: 1000,
      reason: "完了",
    });
    for (const wire of [[0], [3, 237], [3, 232, 0xff]])
      expect(() => decodeClose(Uint8Array.from(wire))).toThrow();
  });
});
