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
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT ORs
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

import { Buffer } from "node:buffer";
import { validateObject, validateString } from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE } from "../net/errors.js";
import { ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS } from "./key-errors.js";
import { isUint8Array } from "../util/types/index.js";
export function validateExportOptions(
  options: any,
  type: string,
  name = "options",
  asymmetricKeyType?: string,
) {
  validateObject(options, name);
  // Yes, converting to any is a bit of a cheat, but it allows us to check
  // each option individually without having to do a bunch of type guards.
  const opts = options;
  if (opts.format !== undefined) {
    validateString(opts.format, `${name}.format`);
  } else {
    options.format = "buffer";
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if ("type" in opts && opts.type !== undefined) {
    validateString(opts.type, `${name}.type`);
  }
  if (type === "private") {
    if (
      "type" in opts &&
      opts.type === "pkcs1" &&
      asymmetricKeyType !== undefined &&
      asymmetricKeyType !== "rsa"
    ) {
      throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(
        opts.type,
        "can only be used for RSA keys",
      );
    }
    if (
      "type" in opts &&
      opts.type === "sec1" &&
      asymmetricKeyType !== undefined &&
      asymmetricKeyType !== "ec" &&
      (asymmetricKeyType as string) !== "ecdh"
    ) {
      throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(
        opts.type,
        "can only be used for EC keys",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if ("cipher" in opts && opts.cipher !== undefined) {
      validateString(opts.cipher, `${name}.cipher`);
      if (
        opts.format === "der" &&
        (opts.type === "pkcs1" || opts.type === "sec1")
      ) {
        throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(
          opts.type,
          "does not support encryption",
        );
      }
      if (typeof opts.passphrase === "string") {
        opts.passphrase = Buffer.from(opts.passphrase, opts.encoding);
      }
      if (!isUint8Array(opts.passphrase)) {
        throw new ERR_INVALID_ARG_TYPE(
          `${name}.passphrase`,
          ["string", "Uint8Array"],
          opts.passphrase,
        );
      }
    }
  }
}
