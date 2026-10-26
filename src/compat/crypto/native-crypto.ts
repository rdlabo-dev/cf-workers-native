import binary from "./native-crypto.wasm";
import { aliases } from "./digests.js";
import { viewBytes } from "../../shared/buffer-source.js";
type API = Record<string, (...args: any[]) => any> & {
  memory: WebAssembly.Memory;
};
let instance: API | undefined;
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
function library(): API {
  if (instance) return instance;
  let api: API;
  const wasi = {
    random_get(pointer: number, length: number) {
      const bytes = new Uint8Array(api.memory.buffer, pointer, length);
      for (let offset = 0; offset < length; offset += 65536)
        globalThis.crypto.getRandomValues(
          bytes.subarray(offset, Math.min(length, offset + 65536)),
        );
      return 0;
    },
    clock_time_get(clock: number, _precision: bigint, pointer: number) {
      const milliseconds = clock === 1 ? performance.now() : Date.now();
      new DataView(api.memory.buffer).setBigUint64(
        pointer,
        BigInt(Math.floor(milliseconds * 1e6)),
        true,
      );
      return 0;
    },
    environ_sizes_get(count: number, size: number) {
      const view = new DataView(api.memory.buffer);
      view.setUint32(count, 0, true);
      view.setUint32(size, 0, true);
      return 0;
    },
    environ_get() {
      return 0;
    },
    fd_read() {
      return 8;
    },
    fd_write() {
      return 8;
    },
    fd_seek() {
      return 8;
    },
    fd_close() {
      return 8;
    },
  };
  api = new WebAssembly.Instance(
    new WebAssembly.Module(binary as BufferSource),
    {
      env: {
        emscripten_notify_memory_growth() {},
        __syscall_getdents64() {
          return -52;
        },
      },
      wasi_snapshot_preview1: wasi,
    },
  ).exports as API;
  api._initialize();
  if (!api.wk_init()) throw new Error("Crypto backend initialization failed");
  instance = api;
  return api;
}
function text(pointer: number): string {
  const data = new Uint8Array(library().memory.buffer);
  let end = pointer;
  while (data[end]) end++;
  return decoder.decode(data.subarray(pointer, end));
}
function error(): Error {
  const api = library(),
    code = api.wk_error();
  return Object.assign(
    new Error(
      code ? text(api.wk_error_reason(code)) : "Cryptographic operation failed",
    ),
    { code: "ERR_CRYPTO_OPERATION_FAILED" },
  );
}
function inputs<T>(
  values: (string | Uint8Array | null | undefined)[],
  operation: (api: API, pointers: number[]) => T,
): T {
  const api = library(),
    allocated: { pointer: number; length: number }[] = [];
  try {
    const pointers = values.map((value) => {
      if (value == null) return 0;
      const data =
        typeof value === "string"
          ? encoder.encode(value + "\0")
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const pointer = api.malloc(Math.max(1, data.length));
      if (!pointer) throw new RangeError("Memory limit exceeded");
      allocated.push({ pointer, length: data.length });
      new Uint8Array(api.memory.buffer).set(data, pointer);
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
function result(api: API): Uint8Array {
  try {
    return new Uint8Array(
      api.memory.buffer,
      api.wk_output(),
      api.wk_output_length(),
    ).slice();
  } finally {
    api.wk_output_clear();
  }
}
const released = new FinalizationRegistry<number>((pointer) =>
  library().wk_key_free(pointer),
);
export class NativeKey {
  ecEncoding = -1;
  checkCertificate(cert: number, operation: number) {
    return library().wk_x509_compare(cert, this.handle(), operation) === 1;
  }
  rsa(operation: number, data: Uint8Array, options: any): Uint8Array {
    if (this.type !== "rsa")
      throw new Error("publicEncrypt() currently only supports RSA keys");
    const label = options.oaepLabel;
    return inputs(
      [
        data,
        operation < 2
          ? (aliases[options.oaepHash.split("\0")[0].toLowerCase()] ?? "")
          : options.oaepHash,
        label instanceof ArrayBuffer ? new Uint8Array(label) : label,
      ],
      (api, [p, h, l]) => {
        const status = api.wk_rsa(
          this.pointer,
          operation,
          p,
          data.byteLength,
          options.padding,
          h,
          l,
          label?.byteLength ?? 0,
          +(label !== undefined),
        );
        if (status !== 1)
          throw new Error(
            (
              {
                [-1]:
                  operation === 0 || operation === 2
                    ? "Failed to init for encryption"
                    : "Failed to init for decryption",
                [-2]: "Unsupported hash digest",
                [-3]: "Failed to set the padding",
                [-4]: "Failed to set the digest",
                [-5]: "Failed to set the mgf1 digest",
                [-6]: "Failed to set the OAEP label",
                [-7]: "Failed to determine output size",
                [-8]: "Failed to cipher/decipher",
              } as Record<number, string>
            )[status],
          );
        return result(api);
      },
    );
  }
  constructor(private pointer: number) {
    if (!pointer) throw error();
    released.register(this, pointer, this);
  }
  dispose() {
    if (this.pointer) {
      released.unregister(this);
      library().wk_key_free(this.pointer);
      this.pointer = 0;
    }
  }
  private handle() {
    if (!this.pointer) throw new Error("Key has been disposed");
    return this.pointer;
  }
  static parse(
    data: Uint8Array,
    pem: boolean,
    privateKey: boolean,
    password?: Uint8Array,
  ) {
    return inputs(
      [data, password],
      (api, [p, pass]) =>
        new NativeKey(
          api.wk_key_parse(
            p,
            data.length,
            +pem,
            +privateKey,
            pass,
            password?.length ?? 0,
          ),
        ),
    );
  }
  static generateDh(
    prime: Uint8Array,
    generator: number,
    components: Uint8Array,
  ) {
    return inputs([prime, components], (api, [p, c]) => {
      const pointer = api.wk_key_generate_dh(p, prime.byteLength, generator, c);
      if (!pointer) throw new Error("Failed to generate key");
      return new NativeKey(pointer);
    });
  }
  static generate(type: string, bits = 0, curve?: string, exponent = 65537) {
    return inputs(
      [type, curve],
      (api, [t, c]) => new NativeKey(api.wk_key_generate(t, bits, c, exponent)),
    );
  }
  get type() {
    return text(library().wk_key_type(this.handle())).toLowerCase();
  }
  get bits() {
    return library().wk_key_bits(this.handle()) as number;
  }
  equals(other: NativeKey) {
    return library().wk_key_equal(this.handle(), other.handle()) === 1;
  }
  export(
    privateKey: boolean,
    pem: boolean,
    type: "pkcs8" | "pkcs1" | "sec1" | "spki",
    cipher?: string,
    password?: Uint8Array,
  ) {
    return inputs([cipher, password], (api, [c, p]) => {
      if (
        !api.wk_key_export(
          this.handle(),
          +privateKey,
          +pem,
          type === "pkcs1" ? 1 : type === "sec1" ? 2 : 0,
          c,
          p,
          password?.length ?? 0,
          this.ecEncoding,
        )
      )
        throw error();
      return result(api);
    });
  }
  parameter(name: string) {
    return inputs([name], (api, [p]) => {
      if (!api.wk_key_parameter(this.handle(), p)) throw error();
      return result(api);
    });
  }
  raw(privateKey: boolean) {
    const api = library();
    if (!api.wk_key_raw(this.handle(), +privateKey)) throw error();
    return result(api);
  }
  get group() {
    const api = library();
    if (!api.wk_key_group(this.handle())) throw error();
    return decoder.decode(result(api));
  }
  sign(
    digest: string | null,
    data: Uint8Array,
    padding = 0,
    saltLength = -1,
    p1363 = false,
  ) {
    return inputs([digest, data], (api, [d, p]) => {
      if (
        !api.wk_sign(
          this.handle(),
          d,
          p,
          data.length,
          padding,
          saltLength,
          +p1363,
        )
      )
        throw error();
      return result(api);
    });
  }
  verify(
    digest: string | null,
    data: Uint8Array,
    signature: Uint8Array,
    padding = 0,
    saltLength = -1,
    p1363 = false,
  ) {
    return inputs([digest, data, signature], (api, [d, p, s]) => {
      const value = api.wk_verify(
        this.handle(),
        d,
        p,
        data.length,
        s,
        signature.length,
        padding,
        saltLength,
        +p1363,
      );
      if (value < 0) throw error();
      return value === 1;
    });
  }
  signHash(digest: string, data: Uint8Array, padding = 0, saltLength = -1) {
    return inputs([digest, data], (api, [d, p]) => {
      if (
        !api.wk_sign_hash(this.handle(), d, p, data.length, padding, saltLength)
      )
        throw error();
      return result(api);
    });
  }
  verifyHash(
    digest: string,
    data: Uint8Array,
    signature: Uint8Array,
    padding = 0,
    saltLength = -1,
  ) {
    return inputs([digest, data, signature], (api, [d, p, s]) => {
      const valid = api.wk_verify_hash(
        this.handle(),
        d,
        p,
        data.length,
        s,
        signature.length,
        padding,
        saltLength,
      );
      if (valid < 0) throw error();
      return valid === 1;
    });
  }
  derive(peer: NativeKey) {
    const api = library();
    if (!api.wk_derive(this.handle(), peer.handle())) throw error();
    return result(api);
  }
}
export function nativeTimingEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length)
    throw new RangeError("Input buffers must have the same byte length");
  return inputs(
    [a, b],
    (api, [ap, bp]) => api.wk_equal(ap, bp, a.length) === 1,
  );
}
export function nativePrimeCheck(data: Uint8Array, checks: number): boolean {
  return inputs([data], (api, [p]) => {
    const result = api.wk_prime_check(p, data.length, checks);
    if (result < 0) throw new Error("Error while checking prime");
    return result === 1;
  });
}
export function nativePrimeGenerate(
  bits: number,
  safe: boolean,
  add?: Uint8Array,
  rem?: Uint8Array,
): Uint8Array {
  return inputs([add, rem], (api, [a, r]) => {
    if (
      !api.wk_prime_generate(
        bits,
        +safe,
        a,
        add?.length ?? 0,
        r,
        rem?.length ?? 0,
      )
    )
      throw new Error("Error while generating prime");
    return result(api);
  });
}

const digestReleased = new FinalizationRegistry<number>((pointer) =>
  library().wk_digest_free(pointer),
);
export class NativeDigest {
  private pointer: number;
  constructor(
    algorithm: string,
    private context = "Signing",
    pointer?: number,
  ) {
    this.pointer =
      pointer ?? inputs([algorithm], (api, [p]) => api.wk_digest_new(p));
    if (!this.pointer) throw new Error(`Unknown digest: ${algorithm}`);
    digestReleased.register(this, this.pointer, this);
  }
  dispose() {
    if (this.pointer) {
      library().wk_digest_free(this.pointer);
      this.pointer = 0;
      digestReleased.unregister(this);
    }
  }
  get size() {
    return library().wk_digest_size(this.pointer);
  }
  copy() {
    if (!this.pointer)
      throw new DOMException(
        "Hash context has already been finalized.",
        "OperationError",
      );
    const pointer = library().wk_digest_copy(this.pointer);
    if (!pointer) throw error();
    return new NativeDigest("", this.context, pointer);
  }

  assertActive() {
    if (!this.pointer)
      throw new Error(`${this.context} context has already been finalized`);
  }
  update(data: Uint8Array) {
    if (!this.pointer)
      throw new Error(`${this.context} context has already been finalized`);
    inputs([data], (api, [p]) => {
      if (!api.wk_digest_update(this.pointer, p, data.length)) throw error();
    });
  }
  final() {
    if (!this.pointer)
      throw new Error(`${this.context} context has already been finalized`);
    const api = library();
    try {
      if (!api.wk_digest_final(this.pointer)) throw error();
      return result(api);
    } finally {
      api.wk_digest_free(this.pointer);
      this.pointer = 0;
      digestReleased.unregister(this);
    }
  }
}

const ecReleased = new FinalizationRegistry<number>((pointer) =>
  library().wk_ec_free(pointer),
);
export class NativeECDH {
  private pointer: number;
  constructor(curve: string) {
    curve = curve.split("\0")[0]!;
    if (!["secp224r1", "prime256v1", "secp384r1", "secp521r1"].includes(curve))
      throw new Error("Invalid curve");
    this.pointer = inputs([curve], (api, [p]) => api.wk_ec_new(p));
    if (!this.pointer)
      throw new Error("Failed to create key using named curve");
    ecReleased.register(this, this.pointer, this);
  }
  generateKeys() {
    if (!library().wk_ec_generate(this.pointer))
      throw new Error("Failed to generate keys");
  }
  getPrivateKey() {
    const api = library();
    if (!api.wk_ec_private(this.pointer))
      throw new Error("Failed to get ECDH private key");
    return result(api);
  }
  getPublicKey(format: string) {
    const api = library();
    if (!api.wk_ec_public(this.pointer, ecFormat(format)))
      throw new Error("Failed to get ECDH public key");
    return result(api);
  }
  setPrivateKey(data: Uint8Array) {
    data = viewBytes(data);
    inputs([data], (api, [p]) => {
      if (!api.wk_ec_set_private(this.pointer, p, data.byteLength))
        throw new Error("Private key is not valid for specified curve.");
    });
  }
  computeSecret(data: Uint8Array) {
    data = viewBytes(data);
    return inputs([data], (api, [p]) => {
      const status = api.wk_ec_secret(this.pointer, p, data.byteLength);
      if (status !== 1)
        throw new Error(
          status === -2
            ? "Invalid keypair"
            : status === -3
              ? "Failed to set point"
              : "Failed to compute ECDH key",
        );
      return result(api);
    });
  }
  static convertKey(data: Uint8Array, curve: string, format: string) {
    data = viewBytes(data);
    if (!data.byteLength) return new Uint8Array();
    const key = new NativeECDH(curve);
    try {
      return inputs([data], (api, [p]) => {
        if (
          !api.wk_ec_convert(key.pointer, p, data.byteLength, ecFormat(format))
        )
          throw new Error("Failed to set point");
        return result(api);
      });
    } finally {
      library().wk_ec_free(key.pointer);
      ecReleased.unregister(key);
    }
  }
}
function ecFormat(format: string) {
  if (format === "hybrid") throw new Error("Failed to get public key length");
  return format === "compressed" ? 2 : 4;
}

export function nativeSpkac(
  data: Uint8Array,
  operation: number,
): boolean | Uint8Array {
  return inputs([data], (api, [p]) => {
    const ok = api.wk_spkac(p, data.byteLength, operation);
    return operation === 0 ? !!ok : ok ? result(api) : new Uint8Array();
  });
}

const x509Released = new FinalizationRegistry<number>((pointer) =>
  library().wk_x509_free(pointer),
);
export class NativeX509 {
  private constructor(private pointer: number) {
    x509Released.register(this, pointer);
  }
  static parse(data: Uint8Array) {
    return inputs([data], (api, [p]) => {
      const pointer = api.wk_x509_parse(p, data.byteLength);
      return pointer ? new NativeX509(pointer) : undefined;
    });
  }
  field(field: number): Uint8Array | undefined {
    const api = library();
    return api.wk_x509_field(this.pointer, field) ? result(api) : undefined;
  }
  string(field: number): string | undefined {
    const value = this.field(field);
    return value === undefined ? undefined : decoder.decode(value);
  }
  get isCA() {
    return library().wk_x509_ca(this.pointer) === 1;
  }
  get publicKey() {
    const pointer = library().wk_x509_key(this.pointer);
    return pointer ? new NativeKey(pointer) : undefined;
  }
  check(name: string, flags: number, operation: number) {
    return inputs([name], (api, [p]) => {
      const status = api.wk_x509_check(
        this.pointer,
        p,
        encoder.encode(name).length,
        flags,
        operation,
      );
      if (status < 0)
        throw new Error(
          status === -2
            ? operation === 2
              ? "Invalid IP"
              : "Invalid name"
            : "Operation failed",
        );
      return status === 1 ? decoder.decode(result(api)) : undefined;
    });
  }
  checkIssued(other: NativeX509) {
    return library().wk_x509_compare(this.pointer, other.pointer, 0) === 1;
  }
  checkKey(key: NativeKey, operation: number) {
    return key.checkCertificate(this.pointer, operation);
  }
}

const tlsReleased = new FinalizationRegistry<number>((pointer) =>
  library().wk_tls_free(pointer),
);
export class NativeTLS {
  private pointer: number;
  constructor(host: string) {
    this.pointer = inputs([host], (api, [p]) => api.wk_tls_new(p));
    if (!this.pointer) throw error();
    tlsReleased.register(this, this.pointer, this);
  }
  private handle() {
    if (!this.pointer) throw new Error("TLS session closed");
    return this.pointer;
  }
  dispose() {
    if (this.pointer) {
      library().wk_tls_free(this.pointer);
      this.pointer = 0;
      tlsReleased.unregister(this);
    }
  }
  feed(data: Uint8Array) {
    inputs([data], (api, [p]) => {
      if (!api.wk_tls_feed(this.handle(), p, data.byteLength)) throw error();
    });
  }
  handshake(): number {
    return library().wk_tls_handshake(this.handle());
  }
  read(): number | Uint8Array {
    const api = library(),
      status = api.wk_tls_read(this.handle());
    return status > 0 ? result(api) : status;
  }
  write(data: Uint8Array): number {
    return inputs([data], (api, [p]) =>
      api.wk_tls_write(this.handle(), p, data.byteLength),
    );
  }
  shutdown(): number {
    return library().wk_tls_shutdown(this.handle());
  }
  drain(): Uint8Array[] {
    const api = library(),
      chunks: Uint8Array[] = [];
    for (;;) {
      const status = api.wk_tls_drain(this.handle());
      if (status === 0) return chunks;
      if (status < 0) throw error();
      chunks.push(result(api));
    }
  }
  certificates(): Uint8Array[] {
    const api = library(),
      certs: Uint8Array[] = [];
    for (let i = 0; api.wk_tls_certificate(this.handle(), i); i++)
      certs.push(result(api));
    return certs;
  }
}

const hmacReleased = new FinalizationRegistry<number>((pointer) =>
  library().wk_hmac_free(pointer),
);
export class NativeHmac {
  private pointer: number;
  constructor(algorithm: string, key: Uint8Array) {
    this.pointer = inputs([algorithm, key], (api, [a, k]) =>
      api.wk_hmac_new(a, k, key.byteLength),
    );
    if (!this.pointer) throw new Error("Failed to initalize HMAC");
    hmacReleased.register(this, this.pointer, this);
  }
  update(data: Uint8Array) {
    inputs([data], (api, [p]) => {
      if (!api.wk_hmac_update(this.pointer, p, data.byteLength)) throw error();
    });
  }
  final() {
    const api = library();
    try {
      if (!api.wk_hmac_final(this.pointer))
        throw new Error("Failed to finalize HMAC");
      return result(api);
    } finally {
      api.wk_hmac_free(this.pointer);
      this.pointer = 0;
      hmacReleased.unregister(this);
    }
  }
}

export function nativePbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
  digest: string,
) {
  return inputs([password, salt, digest], (api, [p, s, d]) => {
    if (
      !api.wk_pbkdf2(
        p,
        password.byteLength,
        s,
        salt.byteLength,
        iterations,
        length,
        d,
      )
    )
      throw new Error("Pbkdf2 failed");
    return result(api);
  });
}
