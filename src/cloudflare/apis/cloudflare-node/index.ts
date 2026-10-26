import { Headers } from "../../../browser/headers/index.js";
import { Response as WorkersResponse } from "../../../browser/response/index.js";
// Copyright (c) 2024-2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Adapted from workerd v1.20261012.1 cloudflare:node compatibility sources.
import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from "../../../compat/http/index.js";
import {
  getHandler,
  kSetIncomingBody,
  type InboundSocket,
} from "../../../compat/http/registry.js";

export interface ServerDescriptor {
  port?: number | null;
}
export interface NodeStyleServer {
  listen(): unknown;
  address(): { port?: number | null } | string | null;
}

function validatePort(port: unknown): number {
  if (
    typeof port !== "number" ||
    !Number.isFinite(port) ||
    port < 0 ||
    port > 65535
  )
    throw new Error("Failed to determine port for server");
  return port;
}

export function httpServerHandler(
  descriptor: number | ServerDescriptor | NodeStyleServer,
) {
  if (descriptor == null)
    throw new Error("Server descriptor cannot be null or undefined");
  let port: unknown =
    typeof descriptor === "number"
      ? descriptor
      : (descriptor as ServerDescriptor).port;
  if (
    port == null &&
    typeof (descriptor as NodeStyleServer).listen === "function"
  ) {
    const server = descriptor as NodeStyleServer;
    let address = server.address();
    port = typeof address === "object" ? address?.port : undefined;
    if (typeof port !== "number") {
      server.listen();
      address = server.address();
      port = typeof address === "object" ? address?.port : undefined;
    }
  }
  const resolvedPort = validatePort(port);
  return {
    fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response> {
      return handleAsNodeRequest(resolvedPort, request, env, ctx);
    },
  };
}

export async function handleAsNodeRequest(
  descriptor: number | ServerDescriptor,
  request: Request,
  env?: unknown,
  ctx?: unknown,
): Promise<Response> {
  const port = validatePort(
    typeof descriptor === "number" ? descriptor : descriptor?.port,
  );
  const handler = getHandler(port);
  const server = handler?.server as Server | undefined;
  const createRequestResponse = handler?.createRequestResponse;
  if (!server || !createRequestResponse)
    throw Object.assign(
      new Error(
        `Http server with port ${port} not found. This is likely a bug with your code. ` +
          `You should check if server.listen() was called with the same port (${port})`,
      ),
      { code: "ERR_INVALID_ARG_VALUE" },
    );
  const url = new URL(request.url);
  const classes = createRequestResponse() as {
    IncomingMessage: new () => IncomingMessage;
    ServerResponse: new (
      request: IncomingMessage,
      options: { highWaterMark: number; rejectNonStandardBodyWrites: boolean },
    ) => ServerResponse;
  };
  const req = new classes.IncomingMessage();
  req.url = url.pathname + url.search;
  req.method = request.method;
  req.headers = Object.fromEntries(request.headers);
  // Local dispatch has no HTTP stack to supply transport headers. Preserve the
  // logical origin and indicate a streaming entity to Node body parsers.
  req.headers.host ??= url.host;
  if (
    request.body &&
    !req.headers["content-length"] &&
    !req.headers["transfer-encoding"]
  )
    req.headers["transfer-encoding"] = "chunked";
  req.socket.encrypted = url.protocol === "https:";
  req.socket.localPort = port;
  req.rawHeaders = [...request.headers].flat();
  req.cloudflare = { env, ctx };
  if ("cf" in request)
    req.cloudflare.cf = request.cf as Record<string, unknown> | undefined;
  req[kSetIncomingBody](request.body);
  const res = new classes.ServerResponse(req, {
    highWaterMark: server.highWaterMark,
    rejectNonStandardBodyWrites: server.rejectNonStandardBodyWrites,
  });
  if (request.method === "HEAD") res._hasBody = false;
  return new Promise<Response>((resolve, reject) => {
    res.once("error", reject);
    req.once("error", (error) => {
      reject(error);
      res.destroy(error);
    });
    res.once("headers", () => {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.getHeaders())) {
          for (const item of Array.isArray(value)
            ? key.toLowerCase() === "cookie" && value.length >= 2
              ? [value.join("; ")]
              : value
            : [value])
            headers.append(key, String(item));
        }
        // This bridge exposes the standard Fetch contract. Its HTTP body chunks
        // are ArrayBuffer-backed; owned Headers also implements the iterator
        // protocol without depending on a particular TypeScript DOM lib version.
        resolve(
          new WorkersResponse(
            request.method === "HEAD" ||
              [204, 205, 304].includes(res.statusCode)
              ? null
              : res.body,
            {
              status: res.statusCode,
              statusText: res.statusMessage,
              headers,
            },
          ) as unknown as Response,
        );
      } catch (error) {
        reject(error);
        res.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    res.once("close", () => {
      if (!res.finished) reject(new Error("Premature close"));
    });
    try {
      server.emit("connection", server, req);
      server.emit("request", req, res);
    } catch (error) {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
      reject(error);
    }
  });
}

function portFromAuthority(authority: string | null | undefined): number {
  const match =
    typeof authority === "string" ? /:(\d+)$/.exec(authority) : null;
  if (!match)
    throw new Error(
      `Failed to determine port for inbound socket from local address ${String(authority)}`,
    );
  return validatePort(Number(match[1]));
}

export async function handleAsNodeConnection(
  socket: InboundSocket,
  env?: unknown,
  ctx?: unknown,
): Promise<void> {
  const port = portFromAuthority((await socket.opened).localAddress);
  const handler = getHandler(port);
  if (!handler?.connect)
    throw Object.assign(
      new Error(
        `No net.Server is listening on port ${port}. Call server.listen(${port}) to accept ` +
          `connections arriving on that port.`,
      ),
      { code: "ERR_INVALID_ARG_VALUE" },
    );
  await handler.connect(socket, env, ctx);
}

export function connectHandler() {
  return {
    connect(
      socket: InboundSocket,
      env?: unknown,
      ctx?: unknown,
    ): Promise<void> {
      return handleAsNodeConnection(socket, env, ctx);
    },
  };
}
