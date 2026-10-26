// Copyright (c) 2017-2022 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

// Shared by node:http and node:_http_server; read options in pinned Workers order.
import { IncomingMessage, ServerResponse } from "./index.js";
import { kIncomingMessage, kServerResponse } from "./symbols.js";
import { validateInteger, validateBoolean } from "../net/validators.js";
import { ERR_OUT_OF_RANGE } from "../net/errors.js";
function unsupportedOption(name: string): never {
  throw Object.assign(new Error(`The ${name} option is not implemented`), {
    code: "ERR_OPTION_NOT_IMPLEMENTED",
  });
}
export function storeHTTPOptions(this: any, options: any): void {
  this[kIncomingMessage] = options.IncomingMessage || IncomingMessage;
  this[kServerResponse] = options.ServerResponse || ServerResponse;

  const maxHeaderSize = options.maxHeaderSize;
  if (maxHeaderSize !== undefined) {
    validateInteger(maxHeaderSize, "maxHeaderSize", 0);
    unsupportedOption("maxHeaderSize");
  }

  const insecureHTTPParser = options.insecureHTTPParser;
  if (insecureHTTPParser !== undefined) {
    // If enabled it will use a HTTP parser with leniency flags enabled.
    // Since our implementation does not use any http parser, and uses "fetch" API,
    // it doesn't make sense to support this option.
    validateBoolean(insecureHTTPParser, "options.insecureHTTPParser");
  }

  const requestTimeout = options.requestTimeout;
  if (requestTimeout !== undefined) {
    validateInteger(requestTimeout, "requestTimeout", 0);
    this.requestTimeout = requestTimeout;
  } else {
    this.requestTimeout = 300_000; // 5 minutes
  }

  const headersTimeout = options.headersTimeout;
  if (headersTimeout !== undefined) {
    validateInteger(headersTimeout, "headersTimeout", 0);
    this.headersTimeout = headersTimeout;
  } else {
    this.headersTimeout = Math.min(60_000, this.requestTimeout); // Minimum between 60 seconds or requestTimeout
  }

  if (
    this.requestTimeout > 0 &&
    this.headersTimeout > 0 &&
    this.headersTimeout > this.requestTimeout
  ) {
    throw new ERR_OUT_OF_RANGE(
      "headersTimeout",
      "<= requestTimeout",
      headersTimeout,
    );
  }

  const keepAliveTimeout = options.keepAliveTimeout;
  if (keepAliveTimeout !== undefined) {
    validateInteger(keepAliveTimeout, "keepAliveTimeout", 0);
    unsupportedOption("keepAliveTimeout");
  }

  const keepAliveTimeoutBuffer = options.keepAliveTimeoutBuffer;
  if (keepAliveTimeoutBuffer !== undefined) {
    validateInteger(keepAliveTimeoutBuffer, "keepAliveTimeoutBuffer");
    unsupportedOption("keepAliveTimeoutBuffer");
  }

  const connectionsCheckingInterval = options.connectionsCheckingInterval;
  if (connectionsCheckingInterval !== undefined) {
    validateInteger(
      connectionsCheckingInterval,
      "connectionsCheckingInterval",
      0,
    );
    unsupportedOption("connectionsCheckingInterval");
  }

  const requireHostHeader = options.requireHostHeader;
  if (requireHostHeader !== undefined) {
    validateBoolean(requireHostHeader, "options.requireHostHeader");
    this.requireHostHeader = requireHostHeader;
  } else {
    this.requireHostHeader = true;
  }

  const joinDuplicateHeaders = options.joinDuplicateHeaders;
  if (joinDuplicateHeaders !== undefined) {
    validateBoolean(joinDuplicateHeaders, "options.joinDuplicateHeaders");
  }
  this.joinDuplicateHeaders = joinDuplicateHeaders ?? false;

  const rejectNonStandardBodyWrites = options.rejectNonStandardBodyWrites;
  if (rejectNonStandardBodyWrites !== undefined) {
    validateBoolean(
      rejectNonStandardBodyWrites,
      "options.rejectNonStandardBodyWrites",
    );
    this.rejectNonStandardBodyWrites = rejectNonStandardBodyWrites;
  } else {
    this.rejectNonStandardBodyWrites = false;
  }
}
