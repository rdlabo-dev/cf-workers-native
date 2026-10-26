import { dictionaryString } from "./key-formats.js";
import { encodeKey } from "./native-cipher.js";
import type { NativeKey } from "./native-crypto.js";
import {
  bufferBytes,
  isAnyBuffer,
  viewBytes,
} from "../../shared/buffer-source.js";

// JSG KeyExportOptions is converted after the JavaScript frontend validation.
export function exportOptions(value: any) {
  const result: {
    type?: string;
    format?: string;
    cipher?: string;
    passphrase?: Uint8Array;
  } = {};
  for (const name of ["type", "format", "cipher"] as const) {
    const field = value[name];
    if (field !== undefined) result[name] = dictionaryString(field);
  }
  const passphrase = value.passphrase;
  if (passphrase !== undefined) {
    if (!isAnyBuffer(passphrase) && !ArrayBuffer.isView(passphrase))
      throw new TypeError(
        "Incorrect type for the 'passphrase' field on 'KeyExportOptions': the provided value is not of type 'BufferSource'.",
      );
    result.passphrase = isAnyBuffer(passphrase)
      ? bufferBytes(passphrase)
      : viewBytes(passphrase);
  }
  return result;
}

export function exportAsymmetric(
  key: NativeKey,
  privateKey: boolean,
  options: ReturnType<typeof exportOptions>,
) {
  const { format, type, cipher, passphrase } = options;
  if (type === undefined) throw new TypeError("Missing type option");
  if (format !== "pem" && format !== "der")
    throw new Error("Invalid key format");
  if (!["pkcs1", "pkcs8", "sec1", "spki"].includes(type))
    throw new Error("Invalid key encoding");
  if (type === "pkcs1" && key.type !== "rsa" && key.type !== "rsa-pss")
    throw new Error("PKCS1 can only be used for RSA keys");
  if (type === "sec1" && key.type !== "ec")
    throw new Error("SEC1 can only be used for EC keys");
  if (key.type === "dh") throw new Error("Failed to export key");
  let canonical: Uint8Array;
  try {
    canonical = key.export(privateKey, false, privateKey ? "pkcs8" : "spki");
  } catch {
    throw new Error("Failed to export key");
  }
  try {
    return encodeKey(
      canonical,
      privateKey,
      format === "pem",
      type,
      cipher,
      passphrase,
      key.ecEncoding,
    );
  } finally {
    canonical.fill(0);
  }
}
