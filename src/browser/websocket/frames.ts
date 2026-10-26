// RFC 6455 client framing shared by native WebSocket transports.
export type Frame = {
  opcode: number;
  final: boolean;
  payload: Uint8Array;
  compressed?: boolean;
};
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

export function encodeFrame(
  opcode: number,
  payload: Uint8Array,
  compressed = false,
): Uint8Array {
  const length = payload.byteLength;
  const extra = length < 126 ? 0 : length <= 65535 ? 2 : 8;
  const frame = new Uint8Array(6 + extra + length);
  frame[0] = 0x80 | opcode | (compressed ? 0x40 : 0);
  frame[1] = 0x80 | (extra === 0 ? length : extra === 2 ? 126 : 127);
  const view = new DataView(frame.buffer);
  if (extra === 2) view.setUint16(2, length);
  if (extra === 8) view.setBigUint64(2, BigInt(length));
  const mask = crypto.getRandomValues(new Uint8Array(4));
  frame.set(mask, 2 + extra);
  for (let i = 0; i < length; i++)
    frame[6 + extra + i] = payload[i]! ^ mask[i % 4]!;
  return frame;
}

/** Incremental parser: validate advertised lengths before allocating payloads. */
export class FrameReader {
  #header = new Uint8Array(10);
  #headerBytes = 0;
  #headerLength = 2;
  #payload: Uint8Array | undefined;
  #payloadBytes = 0;
  #opcode = 0;
  #final = false;
  #compressed = false;
  constructor(private allowCompression = false) {}

  push(input: Uint8Array, consume: (frame: Frame) => void): void {
    let offset = 0;
    while (offset < input.length) {
      if (!this.#payload) {
        const take = Math.min(
          this.#headerLength - this.#headerBytes,
          input.length - offset,
        );
        this.#header.set(
          input.subarray(offset, offset + take),
          this.#headerBytes,
        );
        this.#headerBytes += take;
        offset += take;
        if (this.#headerBytes < this.#headerLength) continue;
        const first = this.#header[0]!,
          second = this.#header[1]!;
        const code = second & 127;
        if (this.#headerLength === 2) {
          if (
            first & 0x30 ||
            (first & 0x40 &&
              (!this.allowCompression ||
                (first & 15) === 0 ||
                (first & 15) >= 8))
          )
            throw new Error("Unexpected WebSocket reserved bits.");
          if (second & 0x80)
            throw new Error("Server WebSocket frames must not be masked.");
          this.#compressed = !!(first & 0x40);
          this.#opcode = first & 15;
          this.#final = !!(first & 128);
          if (![0, 1, 2, 8, 9, 10].includes(this.#opcode))
            throw new Error("Invalid WebSocket opcode.");
          if (this.#opcode >= 8 && (!this.#final || code > 125))
            throw new Error("Invalid WebSocket control frame.");
          this.#headerLength = code === 126 ? 4 : code === 127 ? 10 : 2;
          if (this.#headerBytes < this.#headerLength) continue;
        }
        const view = new DataView(this.#header.buffer);
        const length =
          code < 126
            ? code
            : code === 126
              ? view.getUint16(2)
              : Number(view.getBigUint64(2));
        if ((code === 126 && length < 126) || (code === 127 && length <= 65535))
          throw new Error("Non-minimal WebSocket payload length.");
        if (!Number.isSafeInteger(length) || length > MAX_MESSAGE_BYTES)
          throw new Error("WebSocket message is too large.");
        this.#payload = new Uint8Array(length);
        this.#payloadBytes = 0;
      }
      const take = Math.min(
        this.#payload.length - this.#payloadBytes,
        input.length - offset,
      );
      this.#payload.set(
        input.subarray(offset, offset + take),
        this.#payloadBytes,
      );
      offset += take;
      this.#payloadBytes += take;
      if (this.#payloadBytes === this.#payload.length) {
        const frame = {
          opcode: this.#opcode,
          final: this.#final,
          payload: this.#payload,
          ...(this.#compressed ? { compressed: true } : {}),
        };
        this.#payload = undefined;
        this.#headerBytes = 0;
        this.#headerLength = 2;
        consume(frame);
      }
    }
  }

  get incomplete(): boolean {
    return this.#headerBytes !== 0;
  }
}

export function decodeClose(payload: Uint8Array): {
  code: number;
  reason: string;
} {
  if (payload.length === 1) throw new Error("Invalid WebSocket close payload.");
  if (payload.length === 0) return { code: 1005, reason: "" };
  const code = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  ).getUint16(0);
  if (code < 1000 || code >= 5000 || [1004, 1005, 1006, 1015].includes(code))
    throw new Error("Invalid WebSocket close code.");
  return {
    code,
    reason: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      payload.subarray(2),
    ),
  };
}

export function closePayload(code: number, reason: string): Uint8Array {
  if (code === 1005) return new Uint8Array();
  const text = new TextEncoder().encode(reason);
  const payload = new Uint8Array(2 + text.length);
  new DataView(payload.buffer).setUint16(0, code);
  payload.set(text, 2);
  return payload;
}
