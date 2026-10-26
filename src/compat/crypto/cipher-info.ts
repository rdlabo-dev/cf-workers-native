// Cipher metadata from workerd@5358e3d337336eaf696a48bc1563d808b10feba5.
// Metadata lookup does not imply that the local backend implements the cipher.
import { validateObject } from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE } from "../net/errors.js";
export interface CipherInfo {
  name: string;
  nid: number;
  blockSize: number;
  ivLength: number;
  keyLength: number;
  mode: string;
}
const ciphers: Record<string, CipherInfo> = {
  "aes-128-cbc": {
    name: "AES-128-CBC",
    nid: 419,
    blockSize: 16,
    ivLength: 16,
    keyLength: 16,
    mode: "cbc",
  },
  "aes-192-cbc": {
    name: "AES-192-CBC",
    nid: 423,
    blockSize: 16,
    ivLength: 16,
    keyLength: 24,
    mode: "cbc",
  },
  "aes-256-cbc": {
    name: "AES-256-CBC",
    nid: 427,
    blockSize: 16,
    ivLength: 16,
    keyLength: 32,
    mode: "cbc",
  },
  "aes-128-ctr": {
    name: "AES-128-CTR",
    nid: 904,
    blockSize: 1,
    ivLength: 16,
    keyLength: 16,
    mode: "ctr",
  },
  "aes-192-ctr": {
    name: "AES-192-CTR",
    nid: 905,
    blockSize: 1,
    ivLength: 16,
    keyLength: 24,
    mode: "ctr",
  },
  "aes-256-ctr": {
    name: "AES-256-CTR",
    nid: 906,
    blockSize: 1,
    ivLength: 16,
    keyLength: 32,
    mode: "ctr",
  },
  "aes-128-ecb": {
    name: "AES-128-ECB",
    nid: 418,
    blockSize: 16,
    ivLength: 0,
    keyLength: 16,
    mode: "ecb",
  },
  "aes-192-ecb": {
    name: "AES-192-ECB",
    nid: 422,
    blockSize: 16,
    ivLength: 0,
    keyLength: 24,
    mode: "ecb",
  },
  "aes-256-ecb": {
    name: "AES-256-ECB",
    nid: 426,
    blockSize: 16,
    ivLength: 0,
    keyLength: 32,
    mode: "ecb",
  },
  "aes-128-ofb": {
    name: "AES-128-OFB",
    nid: 420,
    blockSize: 1,
    ivLength: 16,
    keyLength: 16,
    mode: "ofb",
  },
  "aes-192-ofb": {
    name: "AES-192-OFB",
    nid: 424,
    blockSize: 1,
    ivLength: 16,
    keyLength: 24,
    mode: "ofb",
  },
  "aes-256-ofb": {
    name: "AES-256-OFB",
    nid: 428,
    blockSize: 1,
    ivLength: 16,
    keyLength: 32,
    mode: "ofb",
  },
  "aes-128-gcm": {
    name: "id-aes128-GCM",
    nid: 895,
    blockSize: 1,
    ivLength: 12,
    keyLength: 16,
    mode: "gcm",
  },
  "aes-192-gcm": {
    name: "id-aes192-GCM",
    nid: 898,
    blockSize: 1,
    ivLength: 12,
    keyLength: 24,
    mode: "gcm",
  },
  "aes-256-gcm": {
    name: "id-aes256-GCM",
    nid: 901,
    blockSize: 1,
    ivLength: 12,
    keyLength: 32,
    mode: "gcm",
  },
  "des-cbc": {
    name: "DES-CBC",
    nid: 31,
    blockSize: 8,
    ivLength: 8,
    keyLength: 8,
    mode: "cbc",
  },
  "des-ecb": {
    name: "DES-ECB",
    nid: 29,
    blockSize: 8,
    ivLength: 0,
    keyLength: 8,
    mode: "ecb",
  },
  "des-ede": {
    name: "DES-EDE",
    nid: 32,
    blockSize: 8,
    ivLength: 0,
    keyLength: 16,
    mode: "ecb",
  },
  "des-ede-cbc": {
    name: "DES-EDE-CBC",
    nid: 43,
    blockSize: 8,
    ivLength: 8,
    keyLength: 16,
    mode: "cbc",
  },
  "des-ede3-cbc": {
    name: "DES-EDE3-CBC",
    nid: 44,
    blockSize: 8,
    ivLength: 8,
    keyLength: 24,
    mode: "cbc",
  },
  "rc2-cbc": {
    name: "RC2-CBC",
    nid: 37,
    blockSize: 8,
    ivLength: 8,
    keyLength: 16,
    mode: "cbc",
  },
  rc4: {
    name: "RC4",
    nid: 5,
    blockSize: 1,
    ivLength: 0,
    keyLength: 16,
    mode: "stream",
  },
  "aes-256-eax": {
    name: "aes-256-eax",
    nid: 0,
    blockSize: 1,
    ivLength: 16,
    keyLength: 32,
    mode: "stream",
  },
  "aes-128-ccm-matter": {
    name: "aes-128-ccm-matter",
    nid: 0,
    blockSize: 1,
    ivLength: 13,
    keyLength: 16,
    mode: "ccm",
  },
  "aes-128-ccm-bluetooth-8": {
    name: "aes-128-ccm-bluetooth-8",
    nid: 0,
    blockSize: 1,
    ivLength: 13,
    keyLength: 16,
    mode: "ccm",
  },
  "aes-128-gcm-randnonce": {
    name: "aes-128-gcm-randnonce",
    nid: 0,
    blockSize: 1,
    ivLength: 0,
    keyLength: 16,
    mode: "gcm",
  },
  "aes-256-gcm-randnonce": {
    name: "aes-256-gcm-randnonce",
    nid: 0,
    blockSize: 1,
    ivLength: 0,
    keyLength: 32,
    mode: "gcm",
  },
  "aes-128-gcm-siv": {
    name: "aes-128-gcm-siv",
    nid: 0,
    blockSize: 1,
    ivLength: 12,
    keyLength: 16,
    mode: "gcm",
  },
  "aes-128-ccm-bluetooth": {
    name: "aes-128-ccm-bluetooth",
    nid: 0,
    blockSize: 1,
    ivLength: 13,
    keyLength: 16,
    mode: "ccm",
  },
  "aes-256-ctr-hmac-sha256": {
    name: "aes-256-ctr-hmac-sha256",
    nid: 0,
    blockSize: 1,
    ivLength: 12,
    keyLength: 64,
    mode: "ctr",
  },
  "aes-128-ctr-hmac-sha256": {
    name: "aes-128-ctr-hmac-sha256",
    nid: 0,
    blockSize: 1,
    ivLength: 12,
    keyLength: 48,
    mode: "ctr",
  },
  "xchacha20-poly1305": {
    name: "xchacha20-poly1305",
    nid: 0,
    blockSize: 1,
    ivLength: 24,
    keyLength: 32,
    mode: "stream",
  },
  "aes-256-gcm-siv": {
    name: "aes-256-gcm-siv",
    nid: 0,
    blockSize: 1,
    ivLength: 12,
    keyLength: 32,
    mode: "gcm",
  },
  "aes-128-eax": {
    name: "aes-128-eax",
    nid: 0,
    blockSize: 1,
    ivLength: 16,
    keyLength: 16,
    mode: "stream",
  },
  "chacha20-poly1305": {
    name: "chacha20-poly1305",
    nid: 950,
    blockSize: 1,
    ivLength: 12,
    keyLength: 32,
    mode: "stream",
  },
};
export function getCipherInfo(
  nameOrId: string | number,
  options: { keyLength?: number; ivLength?: number } = {},
): CipherInfo | undefined {
  if (typeof nameOrId !== "string" && typeof nameOrId !== "number")
    throw new ERR_INVALID_ARG_TYPE("nameOrId", ["string", "number"], nameOrId);
  validateObject(options, "options");
  // The native binding converts both optional lengths before looking up a cipher.
  const keyLength =
    options.keyLength === undefined ? undefined : Number(options.keyLength) | 0;
  const ivLength =
    options.ivLength === undefined ? undefined : Number(options.ivLength) | 0;
  const found =
    typeof nameOrId === "string"
      ? ciphers[nameOrId.toLowerCase()]
      : Object.values(ciphers).find(
          (c) => c.nid !== 0 && c.nid !== 950 && c.nid === (nameOrId | 0),
        );
  if (!found) return;
  const result = { ...found };
  // BoringSSL AEAD metadata uses a separate lookup, without length overrides.
  if (found.nid === 0 || found.nid === 950) {
    result.name = String(nameOrId);
    return result;
  }
  if (keyLength !== undefined) {
    if (found.nid === 5 || found.nid === 37) {
      if (keyLength <= 0) return;
    } else if (keyLength !== found.keyLength) return;
    result.keyLength = keyLength;
  }
  if (ivLength !== undefined) {
    if (found.mode === "gcm") {
      if (ivLength <= 0) return;
    } else if (ivLength !== found.ivLength) return;
    result.ivLength = ivLength;
  }
  return result;
}
