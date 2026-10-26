// Implements pinned workerd dh.c++ using its BoringSSL backend.
import { Buffer } from "node:buffer";
import { inputs, library, output } from "./native-cipher.js";
import { bytes } from "./validation.js";
import { hasActiveRequest } from "../../shared/request-context.js";
const released = new FinalizationRegistry<number>((pointer) =>
  library().dh_free(pointer),
);
function integer(data: Uint8Array): bigint {
  const hex = Buffer.from(data).toString("hex");
  return hex ? BigInt("0x" + hex) : 0n;
}
function numeric(value: number): Uint8Array {
  let hex = value.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Buffer.from(hex, "hex");
}
function peerError(code: number, operation: string): void {
  if (code === 0) return;
  const compute = operation === "computeSecret";
  const prefix = `DiffieHellman ${operation}() failed: `;
  if (code === -1)
    throw new Error(
      prefix +
        (compute
          ? "could not validate peer public key"
          : "could not validate public key"),
    );
  if (code & 1)
    throw new RangeError(
      prefix + (compute ? "Supplied key is too small" : "key is too small"),
    );
  if (code & 2)
    throw new RangeError(
      prefix + (compute ? "Supplied key is too large" : "key is too large"),
    );
  throw new Error(
    prefix + (compute ? "invalid peer public key" : "invalid public key"),
  );
}
export class NativeDH {
  private pointer: number;
  private verifyError: number;
  constructor(
    prime: number | ArrayBuffer | ArrayBufferView,
    generator: number | ArrayBuffer | ArrayBufferView,
    group = false,
  ) {
    const api = library();
    let pointer = 0;
    if (group) pointer = api.dh_group(prime);
    else if (typeof prime === "number") {
      if (typeof generator !== "number")
        throw new Error("DiffieHellman init failed: invalid parameters");
      if (!hasActiveRequest())
        throw new Error(
          "DiffieHellman key generation requires an active request",
        );
      if (prime > 10000)
        throw new RangeError(
          "DiffieHellman init failed: requested prime size too large",
        );
      pointer = api.dh_parameters(prime, generator);
      if (!pointer)
        throw new Error(
          "DiffieHellman init failed: could not generate parameters",
        );
    } else {
      const p = bytes(prime, "prime");
      if (p.length > 1250)
        throw new RangeError("DiffieHellman init failed: key is too large");
      if (!p.length) throw new Error("DiffieHellman init failed: invalid key");
      let g: Uint8Array;
      if (typeof generator === "number") {
        if (generator < 2)
          throw new RangeError(
            "DiffieHellman init failed: generator too small",
          );
        g = numeric(generator);
      } else {
        g = bytes(generator, "generator");
        if (g.length > 1250)
          throw new RangeError(
            "DiffieHellman init failed: generator is too large",
          );
        if (!g.length || integer(g) < 2n)
          throw new Error("DiffieHellman init failed: invalid generator");
      }
      if (!(integer(p) & 1n) || integer(g) >= integer(p))
        throw new Error(
          "DiffieHellman init failed: Invalid DH prime generated",
        );
      pointer = inputs([p, g], (api, [pp, gg]) =>
        api.dh_create(pp, p.length, gg, g.length),
      );
      if (!pointer)
        throw new Error("DiffieHellman init failed: could not set keys");
    }
    if (!pointer)
      throw new Error("DiffieHellmanGroup init failed: could not set keys");
    try {
      if (!api.dh_valid(pointer))
        throw new Error(
          "DiffieHellman init failed: Invalid DH prime generated",
        );
      // RFC 3526 primes are fixed safe primes. Preserve BoringSSL's generator
      // suitability flag (including its p mod 24 rule) without re-testing primality.
      const verify = group
        ? api.dh_group_check(pointer)
        : api.dh_check(pointer);
      if (verify < 0) throw new Error("DiffieHellman init failed");
      this.pointer = pointer;
      this.verifyError = verify;
      released.register(this, pointer, this);
    } catch (error) {
      api.dh_free(pointer);
      throw error;
    }
  }

  static group(name: unknown): NativeDH {
    const groups: Record<string, number> = {
      modp14: 2048,
      modp15: 3072,
      modp16: 4096,
      modp17: 6144,
      modp18: 8192,
    };
    const normalized = `${name}`.split("\0")[0]!.toLowerCase();
    const bits = Object.hasOwn(groups, normalized)
      ? groups[normalized]
      : undefined;
    if (!bits)
      throw new Error(
        "Failed to init DiffieHellmanGroup: invalid group. Only groups {modp14, modp15, modp16, modp17, modp18} are supported.",
      );
    return new NativeDH(bits, 2, true);
  }
  getVerifyError() {
    return this.verifyError;
  }
  private get(kind: number): Uint8Array {
    const api = library(),
      length = api.dh_get(this.pointer, kind, 0);
    if (length < 0)
      throw new Error(
        kind === 2
          ? "No public key"
          : kind === 3
            ? "No private key"
            : kind === 0
              ? "No DiffieHellman prime"
              : "No DiffieHellman generator",
      );
    return inputs([length], (api, [out]) => {
      if (api.dh_get(this.pointer, kind, out) < 0)
        throw new Error("Error while retrieving DiffieHellman key");
      return output(api, out, length);
    });
  }
  getPrime() {
    return this.get(0);
  }
  getGenerator() {
    return this.get(1);
  }
  getPublicKey() {
    return this.get(2);
  }
  getPrivateKey() {
    return this.get(3);
  }
  generateKeys() {
    if (!library().dh_generate(this.pointer)) throw new Error("internal error");
    return this.getPublicKey();
  }
  setPrivateKey(value: ArrayBuffer | ArrayBufferView) {
    this.set(value, true);
  }
  setPublicKey(value: ArrayBuffer | ArrayBufferView) {
    this.set(value, false);
  }
  private set(value: ArrayBuffer | ArrayBufferView, privateKey: boolean) {
    const data = bytes(value, "key");
    inputs([data], (api, [p]) => {
      const code = api.dh_set(this.pointer, +privateKey, p, data.length);
      if (!privateKey) peerError(code, "setPublicKey");
      else if (code !== 0) throw new Error("internal error");
    });
  }
  computeSecret(value: ArrayBuffer | ArrayBufferView): Uint8Array {
    const data = bytes(value, "key");
    if (data.length > 0x7fffffff)
      throw new RangeError(
        "DiffieHellman computeSecret() failed: key is too large",
      );
    if (!data.length)
      throw new Error("DiffieHellman computeSecret() failed: invalid key");
    return inputs([data, this.getPrime().length], (api, [p, out]) => {
      peerError(
        api.dh_peer_check(this.pointer, p, data.length),
        "computeSecret",
      );
      const length = api.dh_compute(this.pointer, p, data.length, out);
      if (length < 0)
        throw new Error(
          "DiffieHellman computeSecret() failed: error computing shared secret",
        );
      return output(api, out, length);
    });
  }
}
