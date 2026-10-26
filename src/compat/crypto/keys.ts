import { inspect } from "../util/inspect.js";
import { exportOptions, exportAsymmetric } from "./key-export.js";
import { validateExportOptions } from "./key-options.js";
import { exportJwk } from "./key-formats.js";
// API behavior follows workerd@5358e3d337336eaf696a48bc1563d808b10feba5
// crypto_keys.ts (Apache-2.0 and Node MIT). Host CryptoKey export is an explicit
// synchronous-engine boundary; adapter-created secret keys own copied bytes.
import { Buffer } from "node:buffer";
import { keyStates, type KeyState } from "./key-state.js";
import { isAnyBuffer, validateInteger } from "./validation.js";
import { validateObject, validateOneOf } from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE } from "../net/errors.js";
function state(value: object): KeyState {
  const result = keyStates.get(value);
  if (!result) throw new ERR_INVALID_ARG_TYPE("key", "KeyObject", value);
  return result;
}
function boundary(): never {
  throw Object.assign(
    new Error(
      "Synchronous export of a host CryptoKey is unavailable in this WebView runtime",
    ),
    { code: "ERR_METHOD_NOT_IMPLEMENTED" },
  );
}
const nativeAlgorithm = Object.getOwnPropertyDescriptor(
  globalThis.CryptoKey.prototype,
  "algorithm",
)!.get!;
const nativeType = Object.getOwnPropertyDescriptor(
  globalThis.CryptoKey.prototype,
  "type",
)!.get!;
function cloneAlgorithm(value: any): any {
  if (ArrayBuffer.isView(value))
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice();
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        cloneAlgorithm(entry),
      ]),
    );
  return value;
}
export function create(
  type: KeyState["type"],
  value: Omit<KeyState, "type">,
): KeyObject {
  const Class =
    type === "secret"
      ? SecretKeyObject
      : type === "public"
        ? PublicKeyObject
        : PrivateKeyObject;
  const result = Object.create(Class.prototype) as KeyObject;
  keyStates.set(result, { type, ...value });
  return result;
}
export abstract class KeyObject {
  constructor() {
    throw new Error("Illegal constructor");
  }
  static from(key: CryptoKey): KeyObject {
    if (!(key instanceof globalThis.CryptoKey))
      throw new ERR_INVALID_ARG_TYPE("key", "CryptoKey", key);
    return create(nativeType.call(key), {
      native: key,
      nativeAlgorithm: cloneAlgorithm(nativeAlgorithm.call(key)),
    });
  }
  abstract get type(): KeyState["type"];
  export(options: any = {}): any {
    validateObject(options, "options");
    const current = state(this);
    validateExportOptions(
      options,
      current.type,
      "options",
      current.asymmetric?.type,
    );
    options = exportOptions(options);
    if (options.format === undefined)
      throw new TypeError("Missing format option");
    if (current.asymmetric) {
      if (options.format === "jwk")
        return exportJwk(current.asymmetric, current.type === "private");
      const result = exportAsymmetric(
        current.asymmetric,
        current.type === "private",
        options,
      );
      return options.format === "pem"
        ? new TextDecoder().decode(result)
        : Buffer.from(result);
    }
    const data = current.bytes;
    if (!data) return boundary();
    if (options.format === "buffer") return Buffer.from(data);
    if (options.format === "jwk")
      return {
        kty: "oct",
        ext: true,
        k: Buffer.from(data)
          .toString("base64")
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_"),
      };
    throw new TypeError(
      `Invalid format for secret key export: ${options.format}`,
    );
  }
  equals(other: KeyObject): boolean {
    if (other == null)
      throw new TypeError("Cannot read properties of null or undefined");
    const a = state(this),
      b = keyStates.get(other);
    if (this === other || (a.native && a.native === b?.native)) return true;
    if (a.type !== other?.type) return false;
    if (!b)
      throw new ERR_INVALID_ARG_TYPE("otherKeyObject", "KeyObject", other);
    if (a.asymmetric && b.asymmetric) return a.asymmetric.equals(b.asymmetric);
    if (!a.bytes || !b.bytes) return boundary();
    if (a.bytes.length !== b.bytes.length) return false;
    let difference = 0;
    for (let i = 0; i < a.bytes.length; i++)
      difference |= a.bytes[i] ^ b.bytes[i];
    return difference === 0;
  }
  get [Symbol.toStringTag]() {
    return "KeyObject";
  }
}
export class SecretKeyObject extends KeyObject {
  get symmetricKeySize() {
    const key = state(this);
    return (
      (key.bytes?.length ?? (key.native?.algorithm as any)?.length ?? 0) | 0
    );
  }
  override export(options?: any) {
    return super.export(options);
  }
  get type(): "secret" {
    return "secret";
  }
  [Symbol.for("nodejs.util.inspect.custom")](
    depth: number,
    options: { depth?: number },
  ) {
    if (depth < 0) return this;
    const opts = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    return `${this.constructor.name} ${inspect({ size: this.symmetricKeySize }, opts)}`;
  }
}
abstract class AsymmetricKeyObject extends KeyObject {
  get asymmetricKeyDetails() {
    const details = (() => {
      const current = state(this),
        key = current.asymmetric;
      if (!key) {
        const algorithm = current.nativeAlgorithm as
          | RsaHashedKeyAlgorithm
          | EcKeyAlgorithm
          | undefined;
        if (!algorithm) return boundary();
        if ("modulusLength" in algorithm) {
          let publicExponent = 0n;
          for (const value of algorithm.publicExponent)
            publicExponent = (publicExponent << 8n) | BigInt(value);
          return { modulusLength: algorithm.modulusLength, publicExponent };
        }
        if ("namedCurve" in algorithm)
          return {
            namedCurve:
              (
                {
                  "P-256": "prime256v1",
                  "P-384": "secp384r1",
                  "P-521": "secp521r1",
                } as Record<string, string>
              )[algorithm.namedCurve] ?? algorithm.namedCurve,
          };
        return {};
      }
      if (key.type === "rsa")
        return {
          modulusLength: key.bits,
          publicExponent: BigInt(
            "0x" + Buffer.from(key.parameter("e")).toString("hex"),
          ),
        };
      if (key.type === "ec") return { namedCurve: key.group };
      if (key.type === "dsa") {
        const q = key.parameter("q");
        return {
          modulusLength: key.bits,
          divisorLength: q.length
            ? (q.length - 1) * 8 + 32 - Math.clz32(q[0])
            : 0,
        };
      }
      return {};
    })();
    return {
      modulusLength: undefined,
      publicExponent: undefined,
      divisorLength: undefined,
      namedCurve: undefined,
      ...details,
    };
  }
  get asymmetricKeyType() {
    const current = state(this),
      key = current.asymmetric;
    if (!key) {
      const name = current.nativeAlgorithm?.name;
      if (name === undefined) return boundary();
      return (
        (
          {
            "RSASSA-PKCS1-v1_5": "rsa",
            "RSA-PSS": "rsa",
            "RSA-OAEP": "rsa",
            ECDSA: "ec",
            ECDH: "ecdh",
            Ed25519: "ed25519",
            "NODE-ED25519": "ed25519",
            X25519: "x25519",
          } as Record<string, string>
        )[name] ?? name
      );
    }
    return key.type;
  }
  toCryptoKey() {
    throw Object.assign(
      new Error("The toCryptoKey method is not implemented"),
      { code: "ERR_METHOD_NOT_IMPLEMENTED" },
    );
  }
  [Symbol.for("nodejs.util.inspect.custom")](
    depth: number,
    options: { depth?: number },
  ) {
    if (depth < 0) return this;
    const opts = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    return `${this.constructor.name} ${inspect({ type: this.asymmetricKeyType, details: this.asymmetricKeyDetails }, opts)}`;
  }
}
export class PublicKeyObject extends AsymmetricKeyObject {
  override export(options?: any) {
    return super.export(options);
  }
  get type(): "public" {
    return "public";
  }
}
export class PrivateKeyObject extends AsymmetricKeyObject {
  override export(options?: any) {
    return super.export(options);
  }
  get type(): "private" {
    return "private";
  }
}
export function createSecretKey(
  value: unknown,
  encoding?: BufferEncoding,
): SecretKeyObject {
  if (
    typeof value !== "string" &&
    !isAnyBuffer(value) &&
    !ArrayBuffer.isView(value)
  )
    throw new ERR_INVALID_ARG_TYPE(
      "key",
      ["string", "ArrayBuffer", "TypedArray", "DataView"],
      value,
    );
  const data =
    typeof value === "string"
      ? Buffer.from(value, encoding)
      : isAnyBuffer(value)
        ? new Uint8Array(value)
        : new Uint8Array(
            (value as ArrayBufferView).buffer,
            (value as ArrayBufferView).byteOffset,
            (value as ArrayBufferView).byteLength,
          );
  return create("secret", { bytes: new Uint8Array(data) }) as SecretKeyObject;
}
export function secretMaterial(value: unknown): any {
  if (typeof value !== "object" || value === null || !keyStates.has(value))
    return value;
  const key = state(value);
  if (key.type !== "secret") throw new TypeError("Expected a secret key");
  if (!key.bytes) return boundary();
  return Buffer.from(key.bytes);
}
export function generateKeySync(
  type: string,
  options: { length: number },
): SecretKeyObject {
  validateOneOf(type, "type", ["hmac", "aes"]);
  validateObject(options, "options");
  const { length } = options;
  if (type === "hmac") validateInteger(length, "options.length", 8, 65536);
  else validateOneOf(length, "options.length", [128, 192, 256]);
  const material = new Uint8Array(Math.floor(length / 8));
  globalThis.crypto.getRandomValues(material);
  return createSecretKey(material);
}
export function generateKey(
  type: string,
  options: { length: number },
  callback: (error: unknown, key?: SecretKeyObject) => void,
): void {
  let key: SecretKeyObject | undefined, failure: unknown;
  try {
    key = generateKeySync(type, options);
  } catch (error) {
    failure = error;
  }
  queueMicrotask(() => callback(failure ?? null, key));
}

export { isKeyObject } from "./key-state.js";
export function getKeyObjectHandle(key: KeyObject) {
  return key;
}
