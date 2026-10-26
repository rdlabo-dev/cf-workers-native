export const nativeBlobConstructor = Symbol.for(
  "workers-capacitor/native-blob",
);
export const nativeFileConstructor = Symbol.for(
  "workers-capacitor/native-file",
);

function original<T>(value: T, key: symbol): T {
  return (value as Record<symbol, T>)[key] ?? value;
}

// One capture point, evaluated before either direct or Worker installation.
// Codecs and browser fallbacks must never read replacement globals lazily.
export const platform = {
  Blob: original(globalThis.Blob, nativeBlobConstructor),
  File: original(globalThis.File, nativeFileConstructor),
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
  WebSocket: globalThis.WebSocket,
  fetch: globalThis.fetch.bind(globalThis),
  structuredClone: globalThis.structuredClone.bind(globalThis),
};

export const nativeStreamsSymbol = Symbol.for(
  "workers-capacitor/native-streams",
);
const streamConstructors = {
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
  ByteLengthQueuingStrategy: globalThis.ByteLengthQueuingStrategy,
  CountQueuingStrategy: globalThis.CountQueuingStrategy,
  ReadableByteStreamController: globalThis.ReadableByteStreamController,
  ReadableStreamBYOBReader: globalThis.ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest: globalThis.ReadableStreamBYOBRequest,
  ReadableStreamDefaultController: globalThis.ReadableStreamDefaultController,
  ReadableStreamDefaultReader: globalThis.ReadableStreamDefaultReader,
  TransformStreamDefaultController: globalThis.TransformStreamDefaultController,
  WritableStreamDefaultController: globalThis.WritableStreamDefaultController,
  WritableStreamDefaultWriter: globalThis.WritableStreamDefaultWriter,
  CompressionStream: globalThis.CompressionStream,
  DecompressionStream: globalThis.DecompressionStream,
  TextEncoderStream: globalThis.TextEncoderStream,
  TextDecoderStream: globalThis.TextDecoderStream,
};
export const nativeStreams =
  (
    globalThis.ReadableStream as unknown as Record<
      symbol,
      typeof streamConstructors
    >
  )[nativeStreamsSymbol] ?? streamConstructors;
