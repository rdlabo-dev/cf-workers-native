// Test-only instrumentation. Restore constructors even when a contract fails.
export const measurements = {};
export async function measureOperation(name, operation, warmOperation) {
  const constructors = {},
    wasm = [],
    memories = [];
  for (const kind of ["Module", "Instance"]) {
    const original = WebAssembly[kind];
    constructors[kind] = original;
    WebAssembly[kind] = new Proxy(original, {
      construct(target, args) {
        const started = performance.now();
        const value = Reflect.construct(target, args);
        wasm.push({
          kind,
          elapsedMs: performance.now() - started,
          ...(kind === "Module" ? { bytes: args[0].byteLength } : {}),
        });
        if (kind === "Instance" && value.exports.memory)
          memories.push(value.exports.memory);
        return value;
      },
    });
  }
  const started = performance.now();
  try {
    const value = await operation();
    measurements[name] = {
      hostCapabilities: {
        float16Array: typeof globalThis.Float16Array === "function",
        sharedArrayBuffer: typeof globalThis.SharedArrayBuffer === "function",
      },
      operationMs: performance.now() - started,
      wasm,
      wasmMemoryBytes: memories.reduce((n, m) => n + m.buffer.byteLength, 0),
    };
    if (warmOperation)
      measurements[name].warmBatches = Array.from({ length: 10 }, () => {
        const start = performance.now();
        for (let n = 0; n < 100; n++) warmOperation();
        return { iterations: 100, elapsedMs: performance.now() - start };
      });
    return value;
  } finally {
    for (const [kind, original] of Object.entries(constructors))
      WebAssembly[kind] = original;
  }
}
