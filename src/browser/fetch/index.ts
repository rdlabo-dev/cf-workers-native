import {
  DecompressionStream,
  ReadableStream as WorkerReadableStream,
} from "../../compat/stream-web/index.js";
import { readable } from "../../compat/stream-web/interop.js";
import { platform } from "../../shared/globals/platform.js";
import { decompressBrotli } from "../../shared/brotli/index.js";
import { replayBody } from "../body/index.js";
import { Headers } from "../headers/index.js";
import {
  Request,
  requestEncoding,
  type RequestInit,
} from "../request/index.js";
import { Response, networkResponse } from "../response/index.js";
import { FetchTransport } from "./transport.js";

const platformFetch = platform.fetch;
const redirects = new Set([301, 302, 303, 307, 308]);

/** Workers HTTP policy above the native byte transport. No browser cookie jar. */
export function createFetch(transport: Pick<FetchTransport, "fetch">) {
  return async function fetch(
    input: string | URL | Request | globalThis.Request,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);
    if (request.fetcher)
      return (await request.fetcher.fetch(request)) as Response;
    let url = new URL(request.url);
    if (url.protocol === "data:") {
      const decoded = await platformFetch(url);
      return new Response(request.method === "GET" ? decoded.body : null, {
        headers: [...decoded.headers],
      });
    }
    request.signal.throwIfAborted();
    let method = request.method;
    const rewind = request.body ? replayBody(request) : () => null;
    let body = request.body;
    const headers = new Headers(request.headers);
    if (request.cache === "no-store" || request.cache === "no-cache") {
      if (!headers.has("cache-control"))
        headers.set("cache-control", "no-cache");
      if (!headers.has("pragma")) headers.set("pragma", "no-cache");
    }
    for (let hops = 0; ; hops++) {
      if (!["http:", "https:"].includes(url.protocol))
        throw new TypeError("Fetch only supports HTTP(S) and data URLs");
      url.hash = "";
      headers.set("host", url.host);
      const response = await transport.fetch(
        {
          url: url.href,
          method,
          headers: [...headers],
          body,
          signal: request.signal,
          encodeResponseBody: "manual",
        },
        WorkerReadableStream,
      );
      const responseHeaders = new Headers(response.headers);
      const location = responseHeaders.get("location");
      if (
        request.redirect === "follow" &&
        redirects.has(response.status) &&
        location !== null
      ) {
        // The pinned Workers implementation drains a redirect response before
        // following it. Cancellation/abort still reaches the native connection.
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (!(await reader.read()).done) {}
          } finally {
            reader.releaseLock();
          }
        }
        if (hops >= 20) throw new TypeError("Too many redirects.");
        const next = new URL(location, url);
        if (next.origin !== url.origin) headers.delete("authorization");
        if (response.status !== 303 && !rewind)
          throw new TypeError(
            "A request with a one-time-use body encountered a redirect requiring the body to be retransmitted.",
          );
        if (
          ((response.status === 301 || response.status === 302) &&
            method === "POST") ||
          (response.status === 303 && method !== "HEAD")
        ) {
          method = "GET";
          body = null;
        } else body = rewind?.() ?? null;
        url = next;
        continue;
      }
      let responseBody = response.body;
      if (responseBody && requestEncoding(request) !== "manual") {
        const encoding = responseHeaders.get("content-encoding");
        if (encoding === "gzip")
          responseBody = readable(responseBody).pipeThrough(
            new DecompressionStream("gzip"),
          );
        else if (encoding === "br")
          responseBody = decompressBrotli(responseBody);
      }
      return networkResponse(
        responseBody,
        {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          encodeBody: requestEncoding(request),
        },
        url.href,
        hops !== 0,
      );
    }
  };
}
