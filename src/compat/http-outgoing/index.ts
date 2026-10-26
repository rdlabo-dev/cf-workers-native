// Copyright (c) 2017-2022 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

import {
  OutgoingMessage,
  validateHeaderName,
  validateHeaderValue,
} from "../http/index.js";
import { kUniqueHeaders, kHighWaterMark } from "../http/symbols.js";
export {
  OutgoingMessage,
  validateHeaderName,
  validateHeaderValue,
  kUniqueHeaders,
  kHighWaterMark,
};
import { parseUniqueHeadersOption } from "../http/unique-headers.js";
export { parseUniqueHeadersOption };

export default {
  OutgoingMessage,
  validateHeaderName,
  validateHeaderValue,
  kUniqueHeaders,
  kHighWaterMark,
  parseUniqueHeadersOption,
};
