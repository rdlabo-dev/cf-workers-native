import binary from "./native-cipher.wasm";
type API = Record<string, (...args: any[]) => any> & {
  memory: WebAssembly.Memory;
};
let instance: API | undefined;
export function library(): API {
  if (instance) return instance;
  let api: API;
  api = new WebAssembly.Instance(
    new WebAssembly.Module(binary as BufferSource),
    {
      env: { emscripten_notify_memory_growth() {} },
      wasi_snapshot_preview1: {
        random_get(pointer: number, length: number) {
          for (let offset = 0; offset < length; offset += 65536)
            globalThis.crypto.getRandomValues(
              new Uint8Array(
                api.memory.buffer,
                pointer + offset,
                Math.min(65536, length - offset),
              ),
            );
          return 0;
        },
        fd_close() {
          return 8;
        },
        fd_write() {
          return 8;
        },
        fd_seek() {
          return 8;
        },
      },
    },
  ).exports as API;
  api._initialize();
  instance = api;
  return api;
}
export function inputs<T>(
  values: (string | Uint8Array | number)[],
  operation: (api: API, pointers: number[]) => T,
): T {
  const api = library(),
    allocated: { pointer: number; length: number }[] = [];
  try {
    const pointers = values.map((value) => {
      const data =
        typeof value === "string"
          ? new TextEncoder().encode(value + "\0")
          : typeof value === "number"
            ? undefined
            : value;
      const length = typeof value === "number" ? value : data!.byteLength;
      const pointer = api.malloc(Math.max(1, length));
      if (!pointer) throw new RangeError("Memory limit exceeded");
      allocated.push({ pointer, length });
      const memory = new Uint8Array(api.memory.buffer, pointer, length);
      if (data) memory.set(data);
      else memory.fill(0);
      return pointer;
    });
    return operation(api, pointers);
  } finally {
    for (const { pointer, length } of allocated) {
      new Uint8Array(api.memory.buffer, pointer, length).fill(0);
      api.free(pointer);
    }
  }
}
export function output(api: API, pointer: number, length: number): Uint8Array {
  return new Uint8Array(api.memory.buffer, pointer, length).slice();
}
export function size(api: API, pointer: number): number {
  return new DataView(api.memory.buffer).getUint32(pointer, true);
}

export function validateEcPrivate(name: string, value: Uint8Array): void {
  inputs([name, value], (api, [curve, data]) => {
    if (!api.cipher_ec_private_valid(curve, data, value.byteLength))
      throw new Error("EW JWK invalid private key");
  });
}

export function decodeKey(
  data: Uint8Array,
  pem: boolean,
  privateKey: boolean,
  type: string | undefined,
  password?: Uint8Array,
): { data: Uint8Array; privateKey: boolean } {
  return inputs([data, password ?? 0], (api, [p, pass]) => {
    try {
      const result = api.cipher_key_parse(
        p,
        data.byteLength,
        +pem,
        +privateKey,
        type === undefined
          ? -1
          : ["pkcs8", "pkcs1", "sec1", "spki"].indexOf(type),
        pass,
        password?.byteLength ?? 0,
        +(password !== undefined),
      );
      if (!result)
        throw new Error(
          `Failed to parse ${privateKey ? "private" : "public"} key`,
        );
      return {
        data: output(api, api.cipher_key_data(), api.cipher_key_der_size()),
        privateKey: result === 2,
      };
    } finally {
      api.cipher_key_clear();
    }
  });
}

// Match Workers' curve lookup before handing generation to the owned key backend.
export function curveName(name: string): string {
  return inputs([name], (api, [p]) => {
    const pointer = api.cipher_curve_name(p);
    if (pointer === 0) throw new Error("Invalid or unsupported curve");
    if (pointer === -1) throw new Error("Failed to initialize key");
    const memory = new Uint8Array(api.memory.buffer);
    let end = pointer;
    while (memory[end]) end++;
    return new TextDecoder().decode(memory.subarray(pointer, end));
  });
}

export function generateDh(prime: Uint8Array, generator: number): Uint8Array {
  return inputs([prime, prime.length * 2], (api, [p, out]) => {
    if (!api.cipher_dh_generate(p, prime.length, generator, out))
      throw new Error("Failed to generate key");
    return output(api, out, prime.length * 2);
  });
}
export function deriveDh(
  prime: Uint8Array,
  generator: Uint8Array,
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  return inputs(
    [prime, generator, privateKey, publicKey, prime.length],
    (api, [p, g, x, y, out]) => {
      const length = api.cipher_dh_derive(
        p,
        prime.length,
        g,
        generator.length,
        x,
        privateKey.length,
        y,
        publicKey.length,
        out,
      );
      if (length < 0)
        throw new Error("Failed to derive shared diffie-hellman secret");
      return output(api, out, length);
    },
  );
}

export function encodeKey(
  data: Uint8Array,
  privateKey: boolean,
  pem: boolean,
  type: string,
  cipher?: string,
  password?: Uint8Array,
  ecEncoding = -1,
): Uint8Array {
  return inputs([data, cipher ?? 0, password ?? 0], (api, [p, c, pass]) => {
    try {
      const result = api.cipher_key_export(
        p,
        data.byteLength,
        +privateKey,
        +pem,
        type === "pkcs8" ? 0 : type === "pkcs1" ? 1 : type === "sec1" ? 2 : 3,
        c,
        +(cipher !== undefined),
        pass,
        password?.byteLength ?? 0,
        +(password !== undefined),
        ecEncoding,
      );
      if (result === -1) throw new Error("Unknown cipher: " + cipher);
      if (result !== 1) throw new Error("Failed to export key");
      return output(api, api.cipher_key_data(), api.cipher_key_der_size());
    } finally {
      api.cipher_key_clear();
    }
  });
}
