import { describe, it, expect } from "vitest";
import { installDigest } from "./subtle-digest.js";

describe("Workers digest BufferSource brands", () => {
  it("rejects bare shared memory while accepting its actual view extent", async () => {
    const subtle = globalThis.crypto.subtle;
    installDigest(subtle);
    const shared = new SharedArrayBuffer(3);
    new Uint8Array(shared).set([8, 1, 9]);
    await expect(
      subtle.digest("MD5", shared as unknown as ArrayBuffer),
    ).rejects.toThrow("parameter 2 is not of type 'BufferSource'");
    const view = new Uint8Array(shared, 1, 1);
    Object.defineProperty(view, "byteLength", {
      get() {
        throw new Error("shadow");
      },
    });
    const actual = new Uint8Array(
      await subtle.digest("MD5", view as unknown as Uint8Array<ArrayBuffer>),
    );
    expect(Array.from(actual)).toEqual([
      85, 165, 64, 8, 173, 27, 165, 137, 170, 33, 13, 38, 41, 193, 223, 65,
    ]);
  });
});
