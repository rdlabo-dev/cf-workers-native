import { library, message } from "../../compat/zlib/native-zlib.js";
import { MAX_MESSAGE_BYTES } from "./frames.js";

/** RFC 7692 raw deflate stream. Context survives message boundaries unless the
 * negotiated endpoint explicitly disables takeover. */
class MessageCodec {
  private api = library();
  private context: number;
  constructor(
    private encode: boolean,
    bits: number,
    private noTakeover: boolean,
  ) {
    this.context = this.api.cz_create(encode ? 5 : 6, bits, -1, 8, 0, 0, 0);
    if (!this.context)
      throw new Error("Unable to initialize WebSocket compression.");
  }
  run(input: Uint8Array): Uint8Array {
    if (!this.context) throw new Error("WebSocket compression is closed.");
    // An empty message is an empty stored block. Repeating Z_SYNC_FLUSH on
    // an idle deflater produces no bytes and cannot supply a message boundary.
    if (this.encode && input.length === 0) return Uint8Array.of(0);
    const api = this.api;
    const bytes = this.encode ? input : new Uint8Array(input.length + 4);
    if (!this.encode) {
      bytes.set(input);
      bytes.set([0, 0, 255, 255], input.length);
    }
    const capacity = 16384;
    const allocation = api.malloc(Math.max(1, bytes.length) + capacity + 8);
    if (!allocation) throw new RangeError("Memory limit exceeded");
    const output = allocation + Math.max(1, bytes.length),
      state = output + capacity;
    const chunks: Uint8Array[] = [];
    let remaining = bytes.length,
      offset = 0,
      length = 0;
    try {
      new Uint8Array(api.memory.buffer).set(bytes, allocation);
      for (;;) {
        const result = api.cz_process(
          this.context,
          allocation + offset,
          remaining,
          output,
          capacity,
          2,
          state,
        );
        const view = new DataView(api.memory.buffer);
        const available = view.getUint32(state, true),
          left = view.getUint32(state + 4, true);
        if (result !== 0 && result !== -5)
          throw new Error(message(api, api.cz_message(this.context)));
        const written = capacity - available;
        length += written;
        if (!this.encode && length > MAX_MESSAGE_BYTES)
          throw new Error("WebSocket message is too large.");
        if (written)
          chunks.push(
            new Uint8Array(api.memory.buffer, output, written).slice(),
          );
        offset += remaining - left;
        remaining = left;
        if (remaining === 0 && available > 0) break;
        if (!written && result === -5)
          throw new Error("Invalid WebSocket compressed message.");
      }
      const merged = new Uint8Array(length);
      let position = 0;
      for (const chunk of chunks) {
        merged.set(chunk, position);
        position += chunk.length;
      }
      if (this.noTakeover && api.cz_reset(this.context) !== 0)
        throw new Error("Unable to reset WebSocket compression.");
      if (this.encode) {
        if (
          length < 4 ||
          ![0, 0, 255, 255].every((byte, i) => merged[length - 4 + i] === byte)
        )
          throw new Error("Invalid WebSocket compression boundary.");
        return merged.subarray(0, length - 4);
      }
      return merged;
    } finally {
      api.free(allocation);
    }
  }
  dispose() {
    if (this.context) {
      this.api.cz_free(this.context);
      this.context = 0;
    }
  }
}
export function negotiateCompression(header: string) {
  const parts = header.split(";").map((part) => part.trim());
  if (parts.shift() !== "permessage-deflate")
    throw new Error("Unexpected WebSocket extension.");
  const parameters = new Map<string, string | undefined>();
  for (const part of parts) {
    const match = /^([a-z_]+)(?:=(\d+))?$/.exec(part);
    if (!match || parameters.has(match[1]!))
      throw new Error("Invalid WebSocket extension parameters.");
    const [, name, value] = match;
    if (
      ![
        "server_no_context_takeover",
        "client_no_context_takeover",
        "server_max_window_bits",
      ].includes(name!)
    )
      throw new Error("Unexpected WebSocket extension parameter.");
    if (
      name!.endsWith("no_context_takeover")
        ? value !== undefined
        : value === undefined || +value < 8 || +value > 15
    )
      throw new Error("Invalid WebSocket extension parameters.");
    parameters.set(name!, value);
  }
  const encoder = new MessageCodec(
    true,
    15,
    parameters.has("client_no_context_takeover"),
  );
  let decoder: MessageCodec;
  try {
    decoder = new MessageCodec(
      false,
      Number(parameters.get("server_max_window_bits") ?? 15),
      parameters.has("server_no_context_takeover"),
    );
  } catch (error) {
    encoder.dispose();
    throw error;
  }
  return {
    encode: (bytes: Uint8Array) => encoder.run(bytes),
    decode: (bytes: Uint8Array) => decoder.run(bytes),
    dispose() {
      encoder.dispose();
      decoder.dispose();
    },
  };
}
