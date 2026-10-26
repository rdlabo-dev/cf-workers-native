// Copyright (c) 2017-2022 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
//
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

/* TODO: the following is adopted code, enabling linting one day */
/* eslint-disable */

import { viewBytes } from "../../shared/buffer-source.js";
import { NativeX509 } from "./native-crypto.js";
import {
  validateString,
  validateObject,
  validateBoolean,
} from "../net/validators.js";
import { Buffer } from "buffer";
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from "../net/errors.js";
import { PublicKeyObject, PrivateKeyObject, create } from "./keys.js";
import { keyStates } from "./key-state.js";
const isArrayBufferView = ArrayBuffer.isView;
const certificateKeys = new WeakSet<object>();
function flags(options: any) {
  // BoringSSL always forbids partial-label wildcards. The ALWAYS_CHECK_SUBJECT,
  // MULTI_LABEL_WILDCARDS and SINGLE_LABEL_SUBDOMAINS flags are zero there.
  // https://boringssl.googlesource.com/boringssl/+/refs/heads/fips-20240407/include/openssl/x509.h
  let flags = 4;
  if (options == null) return flags;
  if (options.wildcards === false) flags |= 2;
  if (options.subject === "never") flags |= 32;
  else if (
    options.subject !== undefined &&
    options.subject !== "default" &&
    options.subject !== "always"
  )
    throw new Error("Invalid subject option");
  return flags;
}

function translatePeerCertificate(c: any) {
  if (!c) return null;

  if (c.issuerCertificate != null && c.issuerCertificate !== c) {
    c.issuerCertificate = translatePeerCertificate(c.issuerCertificate);
  }
  if (c.infoAccess != null) {
    const info = c.infoAccess;
    c.infoAccess = {};

    // XXX: More key validation?
    const regex = /([^\n:]*):([^\n]*)(?:\n|$)/g;
    regex[Symbol.replace](info, (_: any, key: any, val: any): any => {
      if (val.charCodeAt(0) === 0x22) {
        // The translatePeerCertificate function is only
        // used on internally created legacy certificate
        // objects, and any value that contains a quote
        // will always be a valid JSON string literal,
        // so this should never throw.
        val = JSON.parse(val);
      }
      if (key in c.infoAccess) c.infoAccess[key].push(val);
      else c.infoAccess[key] = [val];
    });
  }
  return c;
}

function checkOptions(options?: any) {
  if (options == null) return;
  validateObject(options, "options");
  if (options.multiLabelWildcards !== undefined)
    validateBoolean(options.multiLabelWildcards, "options.multiLabelWildcards");
  if (options.partialWildcards !== undefined)
    validateBoolean(options.partialWildcards, "options.partialWildcards");
  if (options.singleLabelSubdomains !== undefined)
    validateBoolean(
      options.singleLabelSubdomains,
      "options.singleLabelSubdomains",
    );
  if (options.wildcards !== undefined)
    validateBoolean(options.wildcards, "options.wildcards");
  if (options.subject !== undefined)
    validateString(options.subject, "options.subject");
}

export class X509Certificate {
  #handle: NativeX509;
  #state = new Map();

  constructor(buffer: ArrayBufferView | ArrayBuffer | NativeX509 | string) {
    if (buffer instanceof NativeX509) {
      this.#handle = buffer;
      return;
    }
    if (typeof buffer === "string") {
      buffer = Buffer.from(buffer);
    }
    if (!isArrayBufferView(buffer)) {
      throw new ERR_INVALID_ARG_TYPE(
        "buffer",
        ["string", "Buffer", "TypedArray", "DataView"],
        buffer,
      );
    }
    const handle = NativeX509.parse(viewBytes(buffer));
    if (handle == null) {
      throw new ERR_INVALID_ARG_VALUE(
        "buffer",
        buffer,
        "is not a valid certificate",
      );
    }
    this.#handle = handle;
  }

  get subject() {
    let value = this.#state.get("subject");
    if (value === undefined) {
      value = this.#handle.string(0);
      this.#state.set("subject", value);
    }
    return value ?? undefined;
  }

  get subjectAltName() {
    let value = this.#state.get("subjectAltName");
    if (value === undefined) {
      value = this.#handle.string(2);
      this.#state.set("subjectAltName", value);
    }
    return value ?? undefined;
  }

  get issuer() {
    let value = this.#state.get("issuer");
    if (value === undefined) {
      value = this.#handle.string(1);
      this.#state.set("issuer", value);
    }
    return value ?? undefined;
  }

  get issuerCertificate() {
    let value = this.#state.get("issuerCertificate");
    if (value === undefined) {
      this.#state.set("issuerCertificate", value);
    }
    return value ?? undefined;
  }

  get infoAccess() {
    let value = this.#state.get("infoAccess");
    if (value === undefined) {
      value = this.#handle.string(3);
      this.#state.set("infoAccess", value);
    }
    return value ?? undefined;
  }

  get validFrom() {
    let value = this.#state.get("validFrom");
    if (value === undefined) {
      value = this.#handle.string(4);
      this.#state.set("validFrom", value);
    }
    return value ?? undefined;
  }

  get validTo() {
    let value = this.#state.get("validTo");
    if (value === undefined) {
      value = this.#handle.string(5);
      this.#state.set("validTo", value);
    }
    return value ?? undefined;
  }

  get fingerprint() {
    let value = this.#state.get("fingerprint");
    if (value === undefined) {
      value = this.#handle.string(6);
      this.#state.set("fingerprint", value);
    }
    return value ?? undefined;
  }

  get fingerprint256() {
    let value = this.#state.get("fingerprint256");
    if (value === undefined) {
      value = this.#handle.string(7);
      this.#state.set("fingerprint256", value);
    }
    return value ?? undefined;
  }

  get fingerprint512() {
    let value = this.#state.get("fingerprint512");
    if (value === undefined) {
      value = this.#handle.string(8);
      this.#state.set("fingerprint512", value);
    }
    return value ?? undefined;
  }

  get keyUsage() {
    let value = this.#state.get("keyUsage");
    if (value === undefined) {
      value = this.#handle.string(12)?.split("\n");
      this.#state.set("keyUsage", value);
    }
    return value ?? undefined;
  }

  get serialNumber() {
    let value = this.#state.get("serialNumber");
    if (value === undefined) {
      value = this.#handle.string(9);
      if (value != null) value = value.toUpperCase();
      this.#state.set("serialNumber", value);
    }
    return value ?? undefined;
  }

  get raw() {
    let value = this.#state.get("raw");
    if (value === undefined) {
      value = this.#handle.field(10);
      if (value != null) value = Buffer.from(value);
      this.#state.set("raw", value);
    }
    return value ?? undefined;
  }

  get publicKey() {
    let value = this.#state.get("publicKey");
    if (value === undefined) {
      const inner = this.#handle!.publicKey;
      if (inner !== undefined) {
        value = create("public", { asymmetric: inner });
        certificateKeys.add(value);
        this.#state.set("publicKey", value);
      }
    }
    return value ?? undefined;
  }

  toString() {
    let value = this.#state.get("pem");
    if (value === undefined) {
      value = this.#handle.string(11);
      this.#state.set("pem", value);
    }
    return value ?? undefined;
  }

  // There's no standardized JSON encoding for X509 certs so we
  // fallback to providing the PEM encoding as a string.
  toJSON() {
    return this.toString();
  }

  get ca() {
    let value = this.#state.get("ca");
    if (value === undefined) {
      value = this.#handle!.isCA;
      this.#state.set("ca", value);
    }
    return value ?? false;
  }

  checkHost(name: string, options?: any) {
    validateString(name, "name");
    checkOptions(options);
    return this.#handle.check(name, flags(options), 0) ?? undefined;
  }

  checkEmail(email: string, options?: any) {
    validateString(email, "email");
    checkOptions(options);
    return this.#handle.check(email, flags(options), 1) ?? undefined;
  }

  checkIP(ip: string, options?: any) {
    validateString(ip, "ip");
    checkOptions(options);
    // The options argument is currently undocumented since none of the options
    // have any effect on the behavior of this function. However, we still parse
    // the options argument in case OpenSSL adds flags in the future that do
    // affect the behavior of X509_check_ip. This ensures that no invalid values
    // are passed as the second argument in the meantime.
    return this.#handle.check(ip, flags(options), 2) ?? undefined;
  }

  checkIssued(otherCert: X509Certificate) {
    if (!(otherCert instanceof X509Certificate))
      throw new ERR_INVALID_ARG_TYPE("otherCert", "X509Certificate", otherCert);
    return this.#handle!.checkIssued(otherCert.#handle!) ?? undefined;
  }

  checkPrivateKey(pkey: PrivateKeyObject) {
    if (!(pkey instanceof PrivateKeyObject))
      throw new ERR_INVALID_ARG_TYPE("pkey", "KeyObject", pkey);
    if (pkey.type !== "private") throw new ERR_INVALID_ARG_VALUE("pkey", pkey);
    // Pinned workerd returns false for imported/generated private KeyObjects,
    // even when their public material matches (RSA and EC comparison fixtures).
    return false;
  }

  verify(pkey: PublicKeyObject) {
    if (!(pkey instanceof PublicKeyObject))
      throw new ERR_INVALID_ARG_TYPE("pkey", "KeyObject", pkey);
    if (pkey.type !== "public") throw new ERR_INVALID_ARG_VALUE("pkey", pkey);
    // Keys exposed by X509 retain the certificate backend in the pinned runtime.
    return (
      certificateKeys.has(pkey) &&
      this.#handle.checkKey(keyStates.get(pkey)!.asymmetric!, 2)
    );
  }

  #legacy() {
    const name = (field: number) => {
      const data = this.#handle.field(field) ?? new Uint8Array();
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const decoder = new TextDecoder();
      let offset = 0;
      const next = () => {
        const size = view.getUint32(offset);
        offset += 4;
        const value = decoder.decode(data.subarray(offset, offset + size));
        offset += size;
        return value;
      };
      const out: Record<string, string | string[]> = {};
      while (offset < data.byteLength) {
        const key = next(),
          value = next();
        if (Object.hasOwn(out, key)) {
          const old = out[key]!;
          out[key] = Array.isArray(old) ? [...old, value] : [old, value];
        } else
          Object.defineProperty(out, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
      }
      return out;
    };
    const key = keyStates.get(this.publicKey)?.asymmetric;
    const out: any = {
      subject: name(13),
      issuer: name(14),
      subjectAltName: this.subjectAltName ?? "",
      infoAccess: this.infoAccess ?? "",
      ca: this.ca,
      valid_from: this.validFrom,
      valid_to: this.validTo,
      fingerprint: this.fingerprint,
      fingerprint256: this.fingerprint256,
      fingerprint512: this.fingerprint512,
      serialNumber: this.serialNumber,
      ext_key_usage: this.keyUsage,
      raw: this.raw,
    };
    if (key?.type === "rsa") {
      out.bits = key.bits;
      out.modulus = Buffer.from(key.parameter("n"))
        .toString("hex")
        .replace(/^0+/, "")
        .toUpperCase();
      out.exponent =
        "0x" +
        BigInt("0x" + Buffer.from(key.parameter("e")).toString("hex")).toString(
          16,
        );
      out.pubkey = key.export(false, false, "spki");
    } else if (key?.type === "ec") {
      out.bits = key.bits;
      out.pubkey = this.#handle.field(17);
      out.asn1Curve = this.#handle.string(15);
      out.nistCurve = this.#handle.string(16);
    }
    return out;
  }

  toLegacyObject() {
    let value = this.#state.get("legacy");
    if (value === undefined) {
      let {
        subject,
        subjectAltName,
        infoAccess,
        issuer,
        ca,
        modulus,
        bits,
        exponent,
        pubkey,
        asn1Curve,
        nistCurve,
        valid_from,
        valid_to,
        fingerprint,
        fingerprint256,
        fingerprint512,
        serialNumber,
        ext_key_usage,
        raw,
      } = this.#legacy() as any;
      if (raw != null) raw = Buffer.from(raw);
      if (pubkey != null) pubkey = Buffer.from(pubkey);
      if (modulus != null) modulus = modulus.toUpperCase();
      if (fingerprint != null) fingerprint = fingerprint.toUpperCase();
      if (fingerprint256 != null) fingerprint256 = fingerprint256.toUpperCase();
      if (fingerprint512 != null) fingerprint512 = fingerprint512.toUpperCase();
      if (serialNumber != null) serialNumber = serialNumber.toUpperCase();
      value = translatePeerCertificate({
        subject,
        subjectAltName,
        infoAccess,
        issuer,
        ca,
        modulus,
        bits,
        exponent,
        pubkey,
        asn1Curve,
        nistCurve,
        valid_from,
        valid_to,
        fingerprint,
        fingerprint256,
        fingerprint512,
        serialNumber,
        ext_key_usage,
        raw,
      });
      this.#state.set("legacy", value);
    }
    return value;
  }
}
