// Local safety contracts for documented engine differences, not Workers parity.
export const localBoundaryExpected = {
  codecDetachedFixedBuffer: { rejected: 32, conversionErrors: 6 },
};
export const localBoundaryCases = {
  codecDetachedFixedBuffer: async function ({ zlib: z }) {
    let rejected = 0,
      conversionErrors = 0;
    for (const method of ["deflate", "brotliCompress", "zstdCompress"])
      for (const field of method === "deflate"
        ? ["input", "dictionary"]
        : ["input"])
        for (const length of [0, 3])
          for (const callback of [false, true])
            for (const asView of [false, true]) {
              const buffer = new ArrayBuffer(length),
                view = new Uint8Array(buffer);
              const value = asView ? view : buffer;
              const options = {
                dictionary: field === "dictionary" ? value : undefined,
                get maxOutputLength() {
                  if (length) view[0] = 120;
                  structuredClone(buffer, { transfer: [buffer] });
                  return 1000;
                },
              };
              let calls = 0,
                returned = false;
              try {
                const input = field === "input" ? value : "abc";
                if (callback)
                  await new Promise((resolve, reject) => {
                    z[method](input, options, (error, result) => {
                      calls++;
                      if (!returned)
                        reject(new Error("Callback ran synchronously"));
                      else error ? reject(error) : resolve(result);
                    });
                    returned = true;
                  });
                else z[method + "Sync"](input, options);
                throw new Error("Detached input was processed");
              } catch (error) {
                if (
                  error.name !== "TypeError" ||
                  error.message !==
                    "Codec input was detached during option conversion" ||
                  calls !== (callback ? 1 : 0)
                )
                  throw error;
                rejected++;
              }
            }
    for (const method of ["deflate", "brotliCompress", "zstdCompress"])
      for (const callback of [false, true]) {
        const input = new Uint8Array(3);
        let calls = 0;
        try {
          const options = {
            get maxOutputLength() {
              structuredClone(input.buffer, { transfer: [input.buffer] });
              return -1;
            },
          };
          if (callback)
            z[method](input, options, () => {
              calls++;
            });
          else z[method + "Sync"](input, options);
          throw new Error("Invalid option was accepted");
        } catch (error) {
          if (
            error.name !== "TypeError" ||
            error.message !==
              "The value cannot be converted because it is negative and this API expects a positive number." ||
            calls !== 0
          )
            throw error;
          conversionErrors++;
        }
      }
    return { rejected, conversionErrors };
  },
};
