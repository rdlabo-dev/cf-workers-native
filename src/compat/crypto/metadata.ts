import { hashNames } from "./hash-handle.js";
export function getHashes() {
  return [...hashNames];
}
// Copyright (c) 2017-2022 Cloudflare, Inc.
// Licensed under Apache-2.0: https://opensource.org/licenses/Apache-2.0
// Adapted from workerd@5358e3d337336eaf696a48bc1563d808b10feba5.
export function getCurves(): string[] {
  return ["secp224r1", "prime256v1", "secp384r1", "secp521r1"];
}
export function secureHeapUsed(): Record<string, number> {
  return { total: 0, used: 0, utilization: 0, min: 0 };
}
function unavailable(method: string): never {
  throw Object.assign(new Error(`The ${method} method is not implemented`), {
    code: "ERR_METHOD_NOT_IMPLEMENTED",
  });
}
export function setEngine(_engine: string, _flags?: number): never {
  return unavailable("setEngine");
}
export function setFips(_enabled: boolean): never {
  return unavailable("setFips");
}
// The owned backends do not run in a validated FIPS mode. Report the actual
// capability rather than copying Workers' true value.
export const fips = false;
export function getFips(): boolean {
  return fips;
}

export { getCipherInfo } from "./cipher-info.js";

// Includes the duplicate GCM aliases exposed by the pinned backend.
const cipherNames = [
  "AES-128-CBC",
  "AES-192-CBC",
  "AES-256-CBC",
  "AES-128-CTR",
  "AES-192-CTR",
  "AES-256-CTR",
  "AES-128-ECB",
  "AES-192-ECB",
  "AES-256-ECB",
  "AES-128-OFB",
  "AES-192-OFB",
  "AES-256-OFB",
  "AES-128-GCM",
  "AES-192-GCM",
  "AES-256-GCM",
  "DES-CBC",
  "DES-ECB",
  "DES-EDE",
  "DES-EDE-CBC",
  "DES-EDE3-CBC",
  "RC2-CBC",
  "RC4",
  "aes-128-cbc",
  "aes-192-cbc",
  "aes-256-cbc",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
  "aes-128-ecb",
  "aes-192-ecb",
  "aes-256-ecb",
  "aes-128-ofb",
  "aes-192-ofb",
  "aes-256-ofb",
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "des-cbc",
  "des-ecb",
  "des-ede",
  "des-ede-cbc",
  "des-ede3-cbc",
  "rc2-cbc",
  "rc4",
  "aes-256-eax",
  "aes-128-ccm-matter",
  "aes-128-ccm-bluetooth-8",
  "aes-128-gcm-randnonce",
  "aes-256-gcm-randnonce",
  "aes-128-gcm-siv",
  "aes-128-ccm-bluetooth",
  "aes-256-ctr-hmac-sha256",
  "aes-128-ctr-hmac-sha256",
  "xchacha20-poly1305",
  "aes-256-gcm-siv",
  "aes-128-eax",
  "chacha20-poly1305",
  "aes-192-gcm",
  "aes-256-gcm",
  "aes-128-gcm",
];
export function getCiphers(): string[] {
  return [...cipherNames];
}

export function Cipher(): never {
  return unavailable("Cipher");
}
export function Decipher(): never {
  return unavailable("Decipher");
}
export function createCipher(): never {
  return unavailable("createCipher");
}
export function createDecipher(): never {
  return unavailable("createDecipher");
}
