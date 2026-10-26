// @ts-nocheck
// Copyright (c) 2017-2022 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

import { urlToHttpOptions } from "node:url";
const isURL = (value: unknown): value is URL => value instanceof URL;
import { ClientRequest as NodeClientRequest } from "node:http";
const ClientRequest =
  NodeClientRequest as unknown as typeof import("../http/index.js").ClientRequest;
type ClientRequest = InstanceType<typeof ClientRequest>;
import { Agent, globalAgent } from "./agent.js";
import { ERR_METHOD_NOT_IMPLEMENTED } from "./errors.js";
import { Server } from "./server.js";
import type { IncomingMessage } from "node:http";
type IncomingMessageCallback = (message: IncomingMessage) => void;
import type { RequestOptions, RequestListener } from "node:http";
import type { ServerOptions } from "node:https";

const enableNodejsHttpServerModules = true;

export function request(
  url: string | URL | RequestOptions,
  options?: RequestOptions | IncomingMessageCallback,
  cb?: IncomingMessageCallback,
): ClientRequest;
export function request(...args: unknown[]): ClientRequest {
  let options: RequestOptions = {};

  if (typeof args[0] === "string") {
    const urlStr = args.shift() as string;
    options = urlToHttpOptions(new URL(urlStr));
  } else if (isURL(args[0])) {
    options = urlToHttpOptions(args.shift() as URL);
  }

  if (args.length > 0 && typeof args[0] !== "function") {
    Object.assign(options, args.shift());
  }

  options._defaultAgent = globalAgent;
  args.unshift(options);

  // @ts-expect-error TS2556 This is OK.
  return new ClientRequest(...args);
}

export function get(
  input: string | URL | RequestOptions,
  options?: RequestOptions | IncomingMessageCallback,
  cb?: IncomingMessageCallback,
): ClientRequest {
  const req = request(input, options, cb);
  req.end();
  return req;
}

export function createServer(handler?: RequestListener): Server;
export function createServer(
  options: ServerOptions,
  handler?: RequestListener,
): Server;
export function createServer(
  options?: ServerOptions | RequestListener,
  handler?: RequestListener,
): Server {
  if (!enableNodejsHttpServerModules) {
    throw new ERR_METHOD_NOT_IMPLEMENTED("createServer");
  }

  return new Server(options, handler);
}

export { Agent, globalAgent, Server };

export default {
  get,
  request,
  Agent,
  globalAgent,
  createServer,
  Server,
};
