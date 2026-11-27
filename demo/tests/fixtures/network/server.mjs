import { createServer } from "node:http";
import { gzipSync, brotliCompressSync, deflateSync } from "node:zlib";

/** Loopback fixture only. The library itself never starts an HTTP server. */
export function createNetworkFixture() {
  const committedBodies = new Map();
  const active = new Set();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    const id = url.searchParams.get("id");
    if (id) {
      active.add(id);
      response.once("close", () => active.delete(id));
    }
    try {
      switch (url.pathname) {
        case "/commit-before-disconnect": {
          const key = url.searchParams.get("operation");
          if (request.method === "POST") {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const bodies = committedBodies.get(key) ?? [];
            bodies.push(Buffer.concat(chunks).toString());
            committedBodies.set(key, bodies);
            response.destroy();
            return;
          }
          response.end(JSON.stringify(committedBodies.get(key) ?? []));
          committedBodies.delete(key);
          return;
        }
        case "/active":
          response.end(JSON.stringify([...active]));
          return;
        case "/never":
          return;
        case "/brotli":
          response.writeHead(200, { "content-encoding": "br" });
          response.end(brotliCompressSync("compressed body"));
          return;
        case "/deflate":
          response.writeHead(200, { "content-encoding": "deflate" });
          response.end(deflateSync("compressed body"));
          return;
        case "/uppercase-gzip":
          response.writeHead(200, { "content-encoding": "GZIP" });
          response.end(gzipSync("compressed body"));
          return;
        case "/gzip":
          response.writeHead(200, { "content-encoding": "gzip" });
          response.end(gzipSync("compressed body"));
          return;
        case "/cookies":
          response.writeHead(200, {
            "set-cookie": [
              "a=1; Path=/",
              "b=2; Expires=Wed, 21 Oct 2030 07:28:00 GMT",
            ],
          });
          response.end("cookies");
          return;
        case "/redirect":
          response.writeHead(Number(url.searchParams.get("status") ?? 302), {
            location: url.searchParams.get("to") ?? "/get",
          });
          response.end();
          return;
        case "/loop":
          response.writeHead(302, { location: "/loop" });
          response.end();
          return;
        case "/inspect": {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          response.end(
            JSON.stringify({
              method: request.method,
              headers: request.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
          return;
        }
        case "/slow":
          response.writeHead(200);
          response.flushHeaders();
          return;
        case "/early":
          response.writeHead(200);
          response.flushHeaders();
          response.write("early");
          return;
        case "/empty":
          response.writeHead(204);
          response.end();
          return;
        case "/continue":
          response.writeContinue();
          response.end("continued");
          return;
        case "/tcp-data-fin":
        case "/tcp-data-reset": {
          const socket = request.socket;
          socket.write("received");
          setTimeout(() => {
            if (url.pathname === "/tcp-data-reset") socket.resetAndDestroy();
            else socket.end();
          }, 250);
          return;
        }
        case "/tcp-reset":
          setTimeout(() => request.socket.resetAndDestroy(), 50);
          return;
        case "/large":
          response.end(Buffer.alloc(512 * 1024, 97));
          return;
        case "/echo": {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          response.end(Buffer.concat(chunks));
          return;
        }
        default:
          response.end("hello");
      }
    } catch {
      response.destroy();
    }
  });
  return server;
}
