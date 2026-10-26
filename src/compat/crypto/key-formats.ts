import { Buffer } from "node:buffer";
import { NativeKey } from "./native-crypto.js";
import { curveName, validateEcPrivate } from "./native-cipher.js";
// DER encodings follow RFC 5208/5915/8410; JWK members follow RFC 7518/8037.
const curves: Record<string, { oid: string; size: number; native: string }> = {
  "P-256": { oid: "2a8648ce3d030107", size: 32, native: "prime256v1" },
  "P-384": { oid: "2b81040022", size: 48, native: "secp384r1" },
  "P-521": { oid: "2b81040023", size: 66, native: "secp521r1" },
  "": { oid: "2b81040021", size: 28, native: "secp224r1" },
};
export function der(tag: number, ...parts: Uint8Array[]): Buffer {
  const data = Buffer.concat(parts);
  let length: number[] = [];
  if (data.length < 128) length = [data.length];
  else {
    let size = data.length;
    while (size) {
      length.unshift(size & 255);
      size = Math.floor(size / 256);
    }
    length.unshift(128 + length.length);
  }
  return Buffer.concat([Buffer.from([tag, ...length]), data]);
}
export function integer(bytes: Uint8Array): Buffer {
  let offset = 0;
  while (offset < bytes.length - 1 && bytes[offset] === 0) offset++;
  const data = bytes.length ? bytes.subarray(offset) : Buffer.from([0]);
  return der(2, ...(data[0] & 128 ? [Buffer.from([0]), data] : [data]));
}
function required(jwk: any, name: string): string {
  if (jwk[name] === undefined)
    throw new Error(`${jwk.kty} JWK missing ${name} parameter`);
  return `${jwk[name]}`;
}
function field(jwk: any, name: string): Buffer {
  const value = required(jwk, name).replace(/[\t\n\f\r ]/g, "");
  if (
    !/^[A-Za-z0-9_-]*={0,2}$/.test(value) ||
    value.replace(/=+$/, "").length % 4 === 1 ||
    (value.includes("=") && value.length % 4 !== 0)
  )
    throw new Error(`${jwk.kty} JWK invalid ${name} parameter`);
  return Buffer.from(value, "base64url");
}
function fixed(bytes: Buffer, length: number): Buffer {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start++;
  bytes = bytes.subarray(start);
  if (bytes.length > length) throw new Error("EC JWK invalid public key");
  return Buffer.concat([Buffer.alloc(length - bytes.length), bytes]);
}
export function dictionaryString(value: any): string {
  const object = (item: any) =>
    item !== null && (typeof item === "object" || typeof item === "function");
  if (object(value)) {
    const primitive = value[Symbol.toPrimitive];
    if (primitive != null) {
      value = Reflect.apply(primitive, value, ["string"]);
      if (object(value))
        throw new TypeError("Cannot convert object to primitive value");
    } else {
      const original = value;
      for (const name of ["toString", "valueOf"]) {
        const method = original[name];
        if (typeof method !== "function") continue;
        value = Reflect.apply(method, original, []);
        if (!object(value)) break;
      }
      if (object(value))
        throw new TypeError("Cannot convert object to primitive value");
    }
  }
  if (typeof value === "symbol")
    throw new TypeError("Cannot convert a Symbol value to a string");
  return String(value).replace(
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
    "\ufffd",
  );
}
function dictionary(value: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const name of [
    "kty",
    "use",
    "key_ops",
    "alg",
    "ext",
    "crv",
    "x",
    "y",
    "d",
    "n",
    "e",
    "p",
    "q",
    "dp",
    "dq",
    "qi",
    "oth",
    "k",
    "pub",
    "priv",
  ]) {
    const field = value[name];
    if (field === undefined && name !== "kty") continue;
    if (name === "key_ops" || name === "oth") {
      if (!Array.isArray(field))
        throw new TypeError(
          `Incorrect type for the '${name}' field on 'JsonWebKey': the provided value is not of type 'Array'.`,
        );
      result[name] = [];
      const length = field.length;
      for (let i = 0; i < length; i++) {
        const item = field[i];
        if (name === "key_ops") result[name].push(dictionaryString(item));
        else {
          if (
            item != null &&
            typeof item !== "object" &&
            typeof item !== "function"
          )
            throw new TypeError(
              `Incorrect type for array element ${i}: the provided value is not of type 'RsaOtherPrimesInfo'.`,
            );
          const prime: Record<string, string> = {};
          for (const member of ["r", "d", "t"]) {
            const part = item?.[member];
            if (part !== undefined) prime[member] = dictionaryString(part);
          }
          result[name].push(prime);
        }
      }
    } else
      result[name] = name === "ext" ? Boolean(field) : dictionaryString(field);
  }
  return result;
}
export function importJwk(value: any, privateKey: boolean): NativeKey {
  const jwk = dictionary(value);
  const unsupported = () =>
    new Error(
      `JWK ${privateKey ? "private" : "public"} key import is not implemented for this key type`,
    );
  if (jwk?.kty === "RSA") {
    required(jwk, "n");
    required(jwk, "e");
    const values = [field(jwk, "n"), field(jwk, "e")];
    if (privateKey) {
      const names = ["d", "p", "q", "dp", "dq", "qi"];
      for (const name of names) required(jwk, name);
      values.push(...names.map((name) => field(jwk, name)));
    }
    return NativeKey.parse(
      der(
        48,
        ...(privateKey ? [integer(Buffer.from([0]))] : []),
        ...values.map(integer),
      ),
      false,
      privateKey,
    );
  }
  if (jwk?.kty === "EC") {
    const crv = required(jwk, "crv");
    let native: string;
    try {
      native = curveName(crv);
    } catch (error) {
      throw new Error(
        (error as Error).message === "Failed to initialize key"
          ? "EC JWK unsupported curve"
          : "EC JWK unsupported crv parameter",
      );
    }
    const curve = Object.values(curves).find(
      (value) => value.native === native,
    )!;
    required(jwk, "x");
    required(jwk, "y");
    const x = field(jwk, "x"),
      y = field(jwk, "y");
    const oid = der(6, Buffer.from(curve.oid, "hex"));
    const point = Buffer.concat([
      Buffer.from([4]),
      fixed(x, curve.size),
      fixed(y, curve.size),
    ]);
    const bits = der(3, Buffer.from([0]), point);
    const publicData = der(
      48,
      der(48, der(6, Buffer.from("2a8648ce3d0201", "hex")), oid),
      bits,
    );
    let publicKey: NativeKey;
    try {
      publicKey = NativeKey.parse(publicData, false, false);
    } catch {
      throw new Error("EC JWK invalid public key");
    }
    if (!privateKey) return publicKey;
    publicKey.dispose();
    const d = field(jwk, "d");
    validateEcPrivate(native, d);
    return NativeKey.parse(
      der(
        48,
        integer(Buffer.from([1])),
        der(4, d),
        der(160, oid),
        der(161, bits),
      ),
      false,
      true,
    );
  }
  if (jwk?.kty === "OKP") {
    const crv = required(jwk, "crv");
    if (!["Ed25519", "X25519"].includes(crv))
      throw new Error("OKP JWK unsupported crv parameter");
    const value = field(jwk, privateKey ? "d" : "x");
    if (value.length !== 32) throw unsupported();
    const algorithm = der(
      48,
      der(6, Buffer.from([43, 101, crv === "Ed25519" ? 112 : 110])),
    );
    const data = privateKey
      ? der(48, integer(Buffer.from([0])), algorithm, der(4, der(4, value)))
      : der(48, algorithm, der(3, Buffer.from([0]), value));
    return NativeKey.parse(data, false, privateKey);
  }
  throw unsupported();
}
function encode(bytes: Uint8Array, size?: number): string {
  if (size !== undefined && bytes.length < size)
    bytes = Buffer.concat([Buffer.alloc(size - bytes.length), bytes]);
  return Buffer.from(bytes).toString("base64url");
}
export function exportJwk(key: NativeKey, privateKey: boolean): any {
  if (key.type === "rsa") {
    const result: any = {
      kty: "RSA",
      n: encode(key.parameter("n")),
      e: encode(key.parameter("e")),
    };
    if (privateKey)
      for (const [name, param] of [
        ["d", "d"],
        ["p", "rsa-factor1"],
        ["q", "rsa-factor2"],
        ["dp", "rsa-exponent1"],
        ["dq", "rsa-exponent2"],
        ["qi", "rsa-coefficient1"],
      ])
        result[name] = encode(key.parameter(param));
    return result;
  }
  if (key.type === "ec") {
    const found = Object.entries(curves).find(
      ([, value]) => value.native === key.group,
    );
    if (!found) throw new TypeError("Unsupported JWK curve");
    const [crv, curve] = found;
    return {
      kty: "EC",
      crv,
      x: encode(key.parameter("qx"), curve.size),
      y: encode(key.parameter("qy"), curve.size),
      ...(privateKey ? { d: encode(key.parameter("priv"), curve.size) } : {}),
    };
  }
  if (["ed25519", "x25519"].includes(key.type))
    return {
      kty: "OKP",
      ...(key.type === "ed25519" ? { alg: "EdDSA" } : {}),
      crv: key.type === "ed25519" ? "Ed25519" : "X25519",
      x: encode(key.raw(false)),
      ...(privateKey ? { d: encode(key.raw(true)) } : {}),
    };
  throw new Error("Key type is invalid for JWK export");
}
