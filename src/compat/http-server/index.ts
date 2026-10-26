import { storeHTTPOptions } from "../http/server-options.js";
// Copyright (c) 2017-2022 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

import {
  Server,
  ServerResponse,
  STATUS_CODES,
  _connectionListener,
} from "../http/index.js";
import {
  kServerResponse,
  kConnectionsCheckingInterval,
} from "../http/symbols.js";
export {
  Server,
  ServerResponse,
  STATUS_CODES,
  kServerResponse,
  kConnectionsCheckingInterval,
  _connectionListener,
};
export function setupConnectionsTracking(): never {
  throw Object.assign(
    new Error("The setupConnectionsTracking method is not implemented"),
    { code: "ERR_METHOD_NOT_IMPLEMENTED" },
  );
}
export { storeHTTPOptions };

export function httpServerPreClose(server: any) {
  server.closeIdleConnections();
  clearInterval(server[kConnectionsCheckingInterval]);
}
export default {
  Server,
  ServerResponse,
  STATUS_CODES,
  kServerResponse,
  kConnectionsCheckingInterval,
  _connectionListener,
  setupConnectionsTracking,
  httpServerPreClose,
};
