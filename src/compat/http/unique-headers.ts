// Copyright (c) 2017-2022 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

export function parseUniqueHeadersOption(
  headers?: (string | string[])[],
): Set<string> | null {
  if (!Array.isArray(headers)) {
    return null;
  }

  const unique = new Set<string>();
  for (const header of headers) {
    if (Array.isArray(header)) {
      for (const h of header) {
        unique.add(h.toLowerCase());
      }
    } else {
      unique.add(header.toLowerCase());
    }
  }
  return unique;
}
