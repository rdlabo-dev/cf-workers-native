import { signatureDigest } from "./digests.js";
import { curveName, generateDh, deriveDh, decodeKey } from "./native-cipher.js";
import { validateExportOptions } from "./key-options.js";
import {
  ERR_INCOMPATIBLE_OPTION_PAIR,
  ERR_MISSING_OPTION,
} from "./key-errors.js";
import { Buffer } from "node:buffer";
import { NativeKey, nativeTimingEqual } from "./native-crypto.js";
import { importJwk } from "./key-formats.js";
import {
  create,
  KeyObject,
  PrivateKeyObject,
  PublicKeyObject,
} from "./keys.js";
import { keyStates } from "./key-state.js";
import { bytes, validateInteger, isAnyBuffer } from "./validation.js";
import {
  validateObject,
  validateString,
  validateOneOf,
  validateFunction,
  validateUint32,
  validateInt32,
} from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from "../net/errors.js";
function handle(key: KeyObject): NativeKey {
  const value = keyStates.get(key)?.asymmetric;
  if (!value)
    throw Object.assign(
      new Error(
        "Synchronous access to opaque host key material is unavailable",
      ),
      { code: "ERR_METHOD_NOT_IMPLEMENTED" },
    );
  return value;
}
function input(value: any, privateKey: boolean): NativeKey {
  if (value == null)
    throw new ERR_INVALID_ARG_TYPE(
      "key",
      ["ArrayBuffer", "Buffer", "TypedArray", "DataView", "string", "object"],
      value,
    );
  const options =
    typeof value === "string" || isAnyBuffer(value) || ArrayBuffer.isView(value)
      ? { key: value }
      : value;
  const {
    key: data,
    encoding = "utf8",
    format = "pem",
    type,
    passphrase,
  } = options;
  if (
    data == null ||
    data instanceof KeyObject ||
    data instanceof globalThis.CryptoKey
  )
    throw new ERR_INVALID_ARG_TYPE(
      "options.key",
      ["ArrayBuffer", "Buffer", "TypedArray", "DataView", "string", "object"],
      data,
    );
  if (
    typeof data === "object" &&
    !isAnyBuffer(data) &&
    !ArrayBuffer.isView(data)
  )
    return importJwk(data, privateKey);
  if (
    typeof data !== "string" &&
    !isAnyBuffer(data) &&
    !ArrayBuffer.isView(data)
  )
    throw new ERR_INVALID_ARG_TYPE(
      "key",
      ["ArrayBuffer", "Buffer", "TypedArray", "DataView", "string", "object"],
      value,
    );
  validateOneOf(format, "format", ["pem", "der"]);
  if (type !== undefined)
    validateOneOf(
      type,
      "type",
      privateKey ? ["pkcs1", "pkcs8", "sec1"] : ["pkcs1", "spki"],
    );
  const raw =
    typeof data === "string" ? Buffer.from(data, encoding) : bytes(data, "key");
  const password =
    passphrase == null
      ? undefined
      : typeof passphrase === "string"
        ? Buffer.from(passphrase, encoding)
        : bytes(passphrase, "passphrase");
  const decoded = decodeKey(raw, format === "pem", privateKey, type, password);
  try {
    return NativeKey.parse(decoded.data, false, decoded.privateKey);
  } finally {
    decoded.data.fill(0);
  }
}
export function createPrivateKey(value: unknown): PrivateKeyObject {
  return create("private", {
    asymmetric: input(value, true),
  }) as PrivateKeyObject;
}
export function createPublicKey(value: any): PublicKeyObject {
  if (keyStates.has(value)) {
    if (value.type !== "private")
      throw new ERR_INVALID_ARG_TYPE("key", "PrivateKeyObject", value);
    return create("public", {
      asymmetric: handle(value),
    }) as PublicKeyObject;
  }
  return create("public", {
    asymmetric: input(value, false),
  }) as PublicKeyObject;
}
export function generateKeyPairSync(type: string, options: any = {}) {
  validateOneOf(type, "type", ["rsa", "ec", "ed25519", "x25519", "dh"]);
  validateObject(options, "options");
  const {
    modulusLength,
    publicExponent = 65537,
    namedCurve,
    prime,
    primeLength,
    generator,
    group,
    groupName,
    paramEncoding = "named",
    publicKeyEncoding,
    privateKeyEncoding,
  } = options;
  if (publicKeyEncoding !== undefined)
    validateExportOptions(
      publicKeyEncoding,
      "public",
      "options.publicKeyEncoding",
    );
  if (privateKeyEncoding !== undefined)
    validateExportOptions(
      privateKeyEncoding,
      "private",
      "options.privateKeyEncoding",
      type,
    );
  let key: NativeKey;
  if (type === "rsa") {
    validateUint32(modulusLength, "options.modulusLength");
    validateUint32(publicExponent, "options.publicExponent");
    if (modulusLength > 16384)
      throw new RangeError("RSA modulusLength exceeds maximum (16384)");
    if (modulusLength < 256) throw new Error("Failed to set modulus length");
    if (modulusLength < 512 || publicExponent < 3 || publicExponent % 2 === 0)
      throw new Error("Failed to generate key");
    try {
      key = NativeKey.generate(
        "RSA",
        modulusLength & ~127,
        undefined,
        publicExponent,
      );
    } catch {
      throw new Error("Failed to generate key");
    }
  } else if (type === "ec") {
    validateString(namedCurve, "options.namedCurve");
    validateOneOf(paramEncoding, "options.paramEncoding", [
      "named",
      "explicit",
    ]);
    key = NativeKey.generate("EC", 0, curveName(namedCurve));
    key.ecEncoding = paramEncoding === "named" ? 1 : 0;
  } else if (type === "dh") {
    if (generator != null) validateInt32(generator, "options.generator", 0);
    if (group != null || groupName != null) {
      for (const [name, value] of [
        ["prime", prime],
        ["primeLength", primeLength],
        ["generator", generator],
      ])
        if (value != null)
          throw new ERR_INCOMPATIBLE_OPTION_PAIR("group", name);
      const selected = group || groupName;
      validateString(selected, "options.group");
      const groups: Record<string, string> = Object.assign(
        Object.create(null),
        {
          modp5: "modp_1536",
          modp14: "modp_2048",
          modp15: "modp_3072",
          modp16: "modp_4096",
          modp17: "modp_6144",
          modp18: "modp_8192",
        },
      );
      const nativeGroup = groups[selected.toLowerCase()];
      if (!nativeGroup) throw new Error("Invalid or unsupported group");
      key = NativeKey.generate("DH", 0, nativeGroup);
    } else {
      if (prime != null) {
        if (primeLength != null)
          throw new ERR_INCOMPATIBLE_OPTION_PAIR("prime", "primeLength");
        if (!ArrayBuffer.isView(prime) && !isAnyBuffer(prime))
          throw new ERR_INVALID_ARG_TYPE(
            "options.prime",
            ["Buffer", "TypedArray", "ArrayBuffer"],
            prime,
          );
      } else if (primeLength != null)
        validateInt32(primeLength, "options.primeLength", 0);
      else
        throw new ERR_MISSING_OPTION(
          "At least one of the group, prime, or primeLength options",
        );
      if (prime) {
        const data = bytes(prime, "options.prime");
        if (data.byteLength > 1024)
          throw new RangeError("DH prime exceeds maximum size");
        const components = generateDh(data, generator ?? 2);
        try {
          key = NativeKey.generateDh(data, generator ?? 2, components);
        } finally {
          components.fill(0);
        }
      } else
        throw new Error(
          "Generating DH keys from a prime length is not yet implemented",
        );
    }
  } else key = NativeKey.generate(type.toUpperCase());
  const privateKey = create("private", { asymmetric: key }) as PrivateKeyObject;
  // Workers constructs a separate public-only EC key. Other generated pairs
  // retain the same key material under their public and private wrappers.
  const publicKey = create("public", {
    asymmetric:
      type === "ec"
        ? NativeKey.parse(key.export(false, false, "spki"), false, false)
        : key,
  }) as PublicKeyObject;
  return {
    publicKey:
      publicKeyEncoding !== undefined
        ? publicKey.export(publicKeyEncoding)
        : publicKey,
    privateKey:
      privateKeyEncoding !== undefined
        ? privateKey.export(privateKeyEncoding)
        : privateKey,
  };
}
export function generateKeyPair(
  type: string,
  options: any,
  callback: any,
): void {
  validateFunction(callback, "callback");
  let result: ReturnType<typeof generateKeyPairSync> | undefined,
    failure: unknown;
  try {
    result = generateKeyPairSync(type, options);
  } catch (error) {
    failure = error;
  }
  queueMicrotask(() =>
    failure
      ? callback(failure)
      : callback(null, result!.publicKey, result!.privateKey),
  );
}
Object.defineProperty(
  generateKeyPair,
  Symbol.for("nodejs.util.promisify.custom.args"),
  { value: ["publicKey", "privateKey"], enumerable: false },
);
function optionsOf(value: any) {
  return value &&
    typeof value === "object" &&
    !keyStates.has(value) &&
    "key" in value
    ? value
    : { key: value };
}
function operationKey(value: any, privateKey: boolean): KeyObject {
  const key = optionsOf(value).key;
  if (keyStates.has(key)) {
    if (key.type === "secret" || (privateKey && key.type !== "private"))
      throw new TypeError("Invalid key type");
    return key;
  }
  return privateKey ? createPrivateKey(value) : createPublicKey(value);
}
function digestName(algorithm: any): string | null {
  if (algorithm == null) return null;
  validateString(algorithm, "algorithm");
  return algorithm;
}
export function sign(
  algorithm: any,
  data: unknown,
  key: any,
  callback?: any,
): any {
  if (callback !== undefined) validateFunction(callback, "callback");
  const digest = digestName(algorithm),
    raw = bytes(data, "data");
  const execute = () => {
    const options = optionsOf(key),
      native = handle(operationKey(key, true));
    if (native.type === "dsa")
      throw new Error("Signing with DSA keys is not currently supported");
    const normalized = digest === null ? null : signatureDigest(digest);
    if (
      native.type === "x25519" ||
      (native.type === "ed25519" && normalized !== null) ||
      (native.type !== "ed25519" && normalized === null)
    )
      throw new Error("Failed to initialize signing context");
    return Buffer.from(
      native.sign(normalized, raw, 0, -1, options.dsaEncoding === "ieee-p1363"),
    );
  };
  if (callback === undefined) return execute();
  let result: Buffer | undefined, failure: unknown;
  try {
    result = execute();
  } catch (error) {
    failure = error;
  }
  queueMicrotask(() => callback(failure ?? null, result));
}
export function verify(
  algorithm: any,
  data: unknown,
  key: any,
  signature: unknown,
  callback?: any,
): any {
  if (callback !== undefined) validateFunction(callback, "callback");
  const digest = digestName(algorithm),
    raw = bytes(data, "data"),
    sig = bytes(signature, "signature");
  const execute = () => {
    const options = optionsOf(key),
      native = handle(operationKey(key, false));
    if (native.type === "dsa")
      throw new Error("Verifying with DSA keys is not currently supported");
    const normalized = digest === null ? null : signatureDigest(digest);
    if (
      native.type === "x25519" ||
      (native.type === "ed25519" && normalized !== null) ||
      (native.type !== "ed25519" && normalized === null)
    )
      throw new Error("Failed to initialize verification context");
    return native.verify(
      normalized,
      raw,
      sig,
      0,
      -1,
      options.dsaEncoding === "ieee-p1363",
    );
  };
  if (callback === undefined) return execute();
  let result: boolean | undefined, failure: unknown;
  try {
    result = execute();
  } catch (error) {
    failure = error;
  }
  queueMicrotask(() => callback(failure ?? null, result));
}
export function diffieHellman(options: any): Buffer {
  validateObject(options, "options");
  const { publicKey, privateKey } = options;
  if (!keyStates.has(publicKey))
    throw new ERR_INVALID_ARG_TYPE("options.publicKey", "KeyObject", publicKey);
  if (!keyStates.has(privateKey))
    throw new ERR_INVALID_ARG_TYPE(
      "options.privateKey",
      "KeyObject",
      privateKey,
    );
  if (publicKey.type !== "public")
    throw new ERR_INVALID_ARG_TYPE(
      "options.publicKey",
      "public key",
      publicKey,
    );
  if (privateKey.type !== "private")
    throw new ERR_INVALID_ARG_TYPE(
      "options.privateKey",
      "private key",
      privateKey,
    );
  if (publicKey.asymmetricKeyType !== privateKey.asymmetricKeyType)
    throw new ERR_INVALID_ARG_VALUE(
      "options.publicKey.asymmetricKeyType",
      publicKey.asymmetricKeyType,
      "must equal privateKey.asymmetricKeyType",
    );
  const publicHandle = handle(publicKey),
    privateHandle = handle(privateKey);

  // The pinned workerd crypto-keys.c++ passes the public key as the first
  // DHPointer::stateless argument. Preserve its observable failure rather than
  // silently substituting standalone Node behavior.
  try {
    if (publicHandle.type === "dh") {
      for (const name of ["p", "g"])
        if (
          !Buffer.from(publicHandle.parameter(name)).equals(
            Buffer.from(privateHandle.parameter(name)),
          )
        )
          throw new Error("Failed to derive shared diffie-hellman secret");
      const secret = publicHandle.parameter("priv");
      try {
        return Buffer.from(
          deriveDh(
            publicHandle.parameter("p"),
            publicHandle.parameter("g"),
            secret,
            privateHandle.parameter("pub"),
          ),
        );
      } finally {
        secret.fill(0);
      }
    }
    return Buffer.from(publicHandle.derive(privateHandle));
  } catch {
    throw new Error("Failed to derive shared diffie-hellman secret");
  }
}
export function timingSafeEqual(a: unknown, b: unknown): boolean {
  if (!(a instanceof ArrayBuffer) && !ArrayBuffer.isView(a))
    throw new ERR_INVALID_ARG_TYPE(
      "buf1",
      ["ArrayBuffer", "Buffer", "TypedArray", "DataView"],
      a,
    );
  if (!(b instanceof ArrayBuffer) && !ArrayBuffer.isView(b))
    throw new ERR_INVALID_ARG_TYPE(
      "buf2",
      ["ArrayBuffer", "Buffer", "TypedArray", "DataView"],
      b,
    );
  const left = bytes(a, "buf1"),
    right = bytes(b, "buf2");
  if (left.length !== right.length)
    throw Object.assign(
      new RangeError("Input buffers must have the same byte length"),
      { code: "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH" },
    );
  return nativeTimingEqual(left, right);
}
