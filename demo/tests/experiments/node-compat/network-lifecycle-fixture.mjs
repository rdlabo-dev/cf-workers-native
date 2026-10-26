import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as tcpServer } from "node:net";
import {
  createServer as tlsServer,
  TLSSocket,
  createSecureContext,
} from "node:tls";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
export async function createLifecycleFixture({ key, cert, mismatchCert }) {
  const temporary = await mkdtemp(join(tmpdir(), "tls-graceful-"));
  await writeFile(join(temporary, "key.pem"), key);
  await writeFile(join(temporary, "cert.pem"), cert);
  const graceful = spawn(
    "python3",
    [
      fileURLToPath(new URL("tls-graceful-fixture.py", import.meta.url)),
      join(temporary, "cert.pem"),
      join(temporary, "key.pem"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const gracefulPorts = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      graceful.kill();
      reject(new Error("Graceful TLS fixture startup timeout"));
    }, 5000);
    graceful.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    graceful.stdout.on("data", (data) => {
      output += data;
      if (output.includes("\n")) {
        clearTimeout(timer);
        resolve(JSON.parse(output.split("\n")[0]));
      }
    });
    graceful.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Graceful TLS fixture exited: " + code));
    });
  });
  const sockets = new Set();
  const handler = async (request, response) => {
    const kind = request.url.slice(1);
    if (kind === "pending-upload") return;
    if (kind === "pending-response") {
      response.writeHead(200);
      response.flushHeaders();
      return;
    }
    const status =
      kind === "204"
        ? 204
        : kind === "304"
          ? 304
          : kind === "redirect"
            ? 302
            : 200;
    const headers = { "set-cookie": ["a=1", "b=2"] };
    if (kind === "redirect") headers.location = "/head";
    if (kind === "premature") headers["content-length"] = "100";
    response.writeHead(status, headers);
    if (kind === "premature") {
      response.write("partial");
      setTimeout(() => response.destroy(), 30);
      return;
    }
    if (kind.startsWith("upload")) {
      try {
        for await (const chunk of request) response.write(chunk);
        response.end();
      } catch {
        response.destroy();
      }
    } else response.end(kind === "head" ? "hidden" : "");
  };
  const http = createServer(handler),
    https = createTlsServer({ key, cert }, handler);
  const silentTcp = tcpServer(() => {}),
    eofTcp = tcpServer((socket) => socket.end()),
    badTcp = tcpServer((socket) => socket.end("invalid TLS"));
  const dataTls = tlsServer({ key, cert }, (socket) => socket.end("data"));
  const bulkTls = tlsServer({ key, cert }, (socket) => {
    socket.once("data", () => socket.end(Buffer.alloc(8192, 65)));
  });
  const idleTls = tlsServer({ key, cert }, () => {});
  const secureContext = createSecureContext({ key, cert });
  const resetTls = tcpServer((socket) => {
    const secure = new TLSSocket(socket, { isServer: true, secureContext });
    secure.on("error", () => {});
    secure.on("secure", () =>
      secure.write("data", () =>
        setTimeout(() => socket.resetAndDestroy(), 30),
      ),
    );
  });
  const lifecycleUpgrade = tcpServer((socket) => {
    let command = "";
    const read = (chunk) => {
      command += chunk.toString();
      if (!command.endsWith("\n")) return;
      socket.off("data", read);
      socket.write("READY\n", () => {
        const kind = command.trim();
        if (kind === "abort-handshake") return;
        if (kind === "close-before") {
          socket.once("data", () => socket.end());
          return;
        }
        if (kind === "close-mid") {
          socket.once("data", () => socket.end("invalid TLS"));
          return;
        }
        const secure = new TLSSocket(socket, { isServer: true, secureContext });
        secure.on("error", () => {});
        secure.on("secure", () => {
          if (kind === "truncated-after-data") secure.end("data");
          if (kind === "reset-after-data")
            secure.write("data", () =>
              setTimeout(() => socket.resetAndDestroy(), 30),
            );
        });
      });
    };
    socket.on("data", read);
  });
  const mismatchHttps = createTlsServer(
    { key, cert: mismatchCert ?? cert },
    handler,
  );
  const websocketServers = [http, https].flatMap((server) => {
    const variants = new Map(
      [
        ["/websocket", false],
        ["/websocket/compressed", {}],
        [
          "/websocket/reset",
          {
            serverNoContextTakeover: true,
            clientNoContextTakeover: true,
            serverMaxWindowBits: 10,
          },
        ],
      ].map(([path, perMessageDeflate]) => {
        const websocket = new WebSocketServer({
          noServer: true,
          perMessageDeflate,
        });
        websocket.on("connection", (peer) =>
          peer.on("message", (data, isBinary) => {
            if (!isBinary && data.toString() === "close-me")
              peer.close(1001, "server");
            else peer.send(data, { binary: isBinary });
          }),
        );
        return [path, websocket];
      }),
    );
    server.on("upgrade", (request, socket, head) => {
      const websocket = variants.get(
        new URL(request.url, "http://localhost").pathname,
      );
      if (!websocket) {
        socket.destroy();
        return;
      }
      websocket.handleUpgrade(request, socket, head, (peer) =>
        websocket.emit("connection", peer, request),
      );
    });
    return [...variants.values()];
  });
  const servers = {
    mismatchHttps,
    http,
    https,
    silentTcp,
    eofTcp,
    badTcp,
    dataTls,
    idleTls,
    bulkTls,
    resetTls,
    lifecycleUpgrade,
  };
  for (const server of Object.values(servers)) {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  }
  return {
    ports: {
      ...gracefulPorts,
      ...Object.fromEntries(
        Object.entries(servers).map(([name, server]) => [
          name,
          server.address().port,
        ]),
      ),
    },
    async close() {
      graceful.kill();
      for (const server of websocketServers) {
        for (const client of server.clients) client.terminate();
        server.close();
      }
      await rm(temporary, { recursive: true, force: true });
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        Object.values(servers).map(
          (server) => new Promise((resolve) => server.close(resolve)),
        ),
      );
    },
  };
}
