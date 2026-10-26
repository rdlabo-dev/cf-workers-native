// Shared pinned-Workers comparisons; functions must remain self-contained.
export const zlibCoverageCases = {
  zlibFactoryCoverage: async function ({ zlib: z }) {
    const out = {
      constants: z.constants,
      codes: z.codes,
      numericExports: Object.fromEntries(
        Object.entries(z).filter(([, value]) => typeof value === "number"),
      ),
    };
    for (const name of [
      "Deflate",
      "DeflateRaw",
      "Gzip",
      "Inflate",
      "InflateRaw",
      "Gunzip",
      "Unzip",
      "BrotliCompress",
      "BrotliDecompress",
      "ZstdCompress",
      "ZstdDecompress",
    ]) {
      const stream = z["create" + name]();
      try {
        out[name] = {
          instance: stream instanceof z[name],
          readable: stream.readable,
          writable: stream.writable,
          bytesWritten: stream.bytesWritten,
        };
      } finally {
        stream.destroy();
      }
    }
    return out;
  },
  zlibOutputLimitCoverage: async function ({ zlib: z }) {
    const input = Uint8Array.from({ length: 65 }, (_, i) => i),
      out = {};
    for (const [encode, decode] of [
      ["gzip", "gunzip"],
      ["deflate", "inflate"],
      ["deflateRaw", "inflateRaw"],
      ["gzip", "unzip"],
      ["brotliCompress", "brotliDecompress"],
      ["zstdCompress", "zstdDecompress"],
    ]) {
      const packed = z[encode + "Sync"](input);
      for (const limit of [64, 65, 66])
        for (const mode of ["sync", "info", "callback", "callbackInfo"]) {
          const options = {
            maxOutputLength: limit,
            chunkSize: 64,
            info: mode === "info" || mode === "callbackInfo",
          };
          const capture = (value) =>
            options.info
              ? {
                  bytes: Array.from(value.buffer),
                  closed: value.engine._closed,
                }
              : { bytes: Array.from(value) };
          let result,
            calls = 0;
          try {
            if (mode.startsWith("callback")) {
              result = await new Promise((resolve) =>
                z[decode](packed, options, (e, value) => {
                  calls++;
                  resolve(
                    e
                      ? {
                          error: { name: e.name, code: e.code ?? null },
                          valuePresent: value !== undefined,
                        }
                      : capture(value),
                  );
                }),
              );
              await new Promise((resolve) => setTimeout(resolve, 0));
            } else result = capture(z[decode + "Sync"](packed, options));
          } catch (e) {
            result = { error: { name: e.name, code: e.code ?? null } };
          }
          out[[decode, limit, mode].join("/")] = {
            ...result,
            calls,
            recovered: Array.from(z[decode + "Sync"](packed)),
          };
        }
    }
    return out;
  },
  zlibStrategyCoverage: async function ({ zlib: z }) {
    const out = {};
    for (const name of ["Deflate", "DeflateRaw"]) {
      const stream = new z[name]({ chunkSize: 64 }),
        chunks = [],
        order = [];
      const done = new Promise((resolve, reject) => {
        stream.on("data", (c) => chunks.push(c));
        stream.on("error", reject);
        stream.on("end", resolve);
      });
      done.catch(() => {});
      const callbackErrors = [];
      try {
        const a = Uint8Array.from(
            { length: 4096 },
            (_, i) => (i * i + Math.floor(i / 37)) % 256,
          ),
          b = new Uint8Array(2048).fill(65),
          c = Uint8Array.from({ length: 1024 }, (_, i) => i % 17);
        stream.write(a, (e) => {
          order.push("writeA");
          if (e) callbackErrors.push({ name: e.name, code: e.code ?? null });
        });
        await new Promise((resolve, reject) =>
          stream.params(1, z.constants.Z_HUFFMAN_ONLY, (e) => {
            order.push("paramsA");
            e ? reject(e) : resolve();
          }),
        );
        stream.write(b, (e) => {
          order.push("writeB");
          if (e) callbackErrors.push({ name: e.name, code: e.code ?? null });
        });
        await new Promise((resolve, reject) =>
          stream.params(9, z.constants.Z_RLE, (e) => {
            order.push("paramsB");
            e ? reject(e) : resolve();
          }),
        );
        let invalid;
        try {
          stream.params(1, -1, () => order.push("invalidCallback"));
        } catch (e) {
          invalid = { name: e.name, code: e.code ?? null };
        }
        stream.end(c, (e) => {
          order.push("endCallback");
          if (e) callbackErrors.push({ name: e.name, code: e.code ?? null });
        });
        await done;
        const packed = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          packed.set(chunk, offset);
          offset += chunk.length;
        }
        const decoded =
          z[name === "Deflate" ? "inflateSync" : "inflateRawSync"](packed);
        const expected = [...a, ...b, ...c];
        out[name] = {
          order,
          callbackErrors,
          invalid,
          bytesWritten: stream.bytesWritten,
          length: decoded.length,
          equal:
            decoded.length === expected.length &&
            Array.from(decoded).every((v, i) => v === expected[i]),
        };
      } finally {
        stream.destroy();
      }
    }
    return out;
  },
  zlibResetCoverage: async function ({ zlib: z }) {
    const out = {},
      dictionary = new TextEncoder().encode("shared dictionary repeated words");
    for (const [encode, decode, options, flush] of [
      ["Deflate", "Inflate", { dictionary }, z.constants.Z_FINISH],
      [
        "BrotliCompress",
        "BrotliDecompress",
        { params: { [z.constants.BROTLI_PARAM_QUALITY]: 2 } },
        z.constants.BROTLI_OPERATION_FINISH,
      ],
      [
        "ZstdCompress",
        "ZstdDecompress",
        { params: { [z.constants.ZSTD_c_compressionLevel]: 2 } },
        z.constants.ZSTD_e_end,
      ],
    ]) {
      const input = new TextEncoder().encode(
        "shared dictionary repeated words + payload",
      );
      for (const direction of ["encode", "decode", "partial"]) {
        const name = direction === "encode" ? encode : decode;
        const opts =
          direction === "encode" || decode === "Inflate" ? options : {};
        const stream = new z[name](opts),
          chunks = [];
        let failure,
          firstPhase,
          phase = "firstWrite",
          reachedReset = false;
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", (e) => {
          failure = e;
        });
        const write = (bytes) =>
          new Promise((resolve, reject) =>
            stream.write(bytes, (e) => (e ? reject(e) : resolve())),
          );
        const packed = z[encode[0].toLowerCase() + encode.slice(1) + "Sync"](
          input,
          options,
        );
        const collect = () => {
          const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let offset = 0;
          for (const c of chunks) {
            all.set(c, offset);
            offset += c.length;
          }
          return all;
        };
        try {
          await write(
            direction === "encode"
              ? input
              : direction === "partial"
                ? packed.subarray(0, 2)
                : packed,
          );
          if (direction === "encode")
            await new Promise((resolve, reject) =>
              stream.flush(flush, (e) => (e ? reject(e) : resolve())),
            );
          firstPhase = Array.from(
            direction === "encode"
              ? z[decode[0].toLowerCase() + decode.slice(1) + "Sync"](
                  collect(),
                  decode === "Inflate" ? options : {},
                )
              : collect(),
          );
          phase = "reset";
          stream.reset();
          reachedReset = true;
          phase = "secondWrite";
          chunks.length = 0;
          await new Promise((resolve, reject) => {
            stream.once("end", resolve);
            stream.once("error", reject);
            stream.end(direction === "encode" ? input : packed);
          });
          const bytes =
            direction === "encode"
              ? z[decode[0].toLowerCase() + decode.slice(1) + "Sync"](
                  collect(),
                  decode === "Inflate" ? options : {},
                )
              : collect();
          out[name + "/" + direction] = {
            firstPhase,
            reachedReset,
            bytes: Array.from(bytes),
            bytesWritten: stream.bytesWritten,
            error: failure
              ? { name: failure.name, code: failure.code ?? null }
              : null,
          };
        } catch (e) {
          out[name + "/" + direction] = {
            phase,
            reachedReset,
            firstPhase,
            error: { name: e.name, code: e.code ?? null, message: e.message },
          };
        } finally {
          stream.destroy();
        }
      }
    }
    return out;
  },
};
