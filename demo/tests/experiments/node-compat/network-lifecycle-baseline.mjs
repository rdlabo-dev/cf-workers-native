import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNetworkLifecycle } from "../../../../src/compat/http/network.spec.mjs";
import { runTlsLifecycle } from "../../../../src/compat/tls/network.spec.mjs";
import { runWebSocketLifecycle } from "../../../../src/compat/http/websocket-network.spec.mjs";
import { createFsLifetimeContract } from "../../../../src/compat/fs/request-lifetime.spec.mjs";
import { runWebSocketSurface } from "../../../../src/compat/http/websocket-surface.spec.mjs";
import { observeAttachments } from "../../../../src/browser/websocket/attachment.observations.spec.mjs";
const root = fileURLToPath(new URL("../../../..", import.meta.url));
export async function networkLifecycleBaseline(ports, caPath, directory) {
  const profile = JSON.parse(
    await readFile(new URL("exports.json", import.meta.url), "utf8"),
  ).profile;
  const installed = JSON.parse(
    await readFile(
      join(root, "demo/node_modules/workerd/package.json"),
      "utf8",
    ),
  );
  assert.equal(installed.version, profile.workerd, "Pinned workerd version");
  await mkdir(directory, { recursive: true });
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  await writeFile(
    join(directory, "worker.mjs"),
    `import wasmModule from './attachment.wasm';import * as http from 'node:http';import * as https from 'node:https';import * as net from 'node:net';import * as tls from 'node:tls';import * as fs from 'node:fs';${createFsLifetimeContract.toString()};const fsStep=createFsLifetimeContract(fs);${runNetworkLifecycle.toString()};${runTlsLifecycle.toString()};${runWebSocketLifecycle.toString()};${runWebSocketSurface.toString()};${observeAttachments.toString()};export default{async fetch(request){if(new URL(request.url).pathname.startsWith('/fs-'))return Response.json(await fsStep(new URL(request.url).pathname.slice(4),new URL(request.url).searchParams.get('kind')));if(new URL(request.url).pathname==='/ready')return new Response('ready');return Response.json({http:await runNetworkLifecycle({http,https},${JSON.stringify(ports)}),tls:await runTlsLifecycle({net,tls},${JSON.stringify(ports)}),websocket:await runWebSocketLifecycle(http.WebSocket,${JSON.stringify(ports)}),websocketSurface:runWebSocketSurface(),websocketAttachments:await observeAttachments({WebSocketPair,Blob,Headers,Request,Response,wasmModule})})}}`,
  );
  await writeFile(
    join(directory, "attachment.wasm"),
    Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0),
  );
  await writeFile(
    join(directory, "config.capnp"),
    `using Workerd = import "/workerd.capnp";const config :Workerd.Config = (services=[(name="main",worker=(modules=[(name="worker.mjs",esModule=embed "worker.mjs"),(name="attachment.wasm",wasm=embed "attachment.wasm")],compatibilityDate="${profile.compatibilityDate}",compatibilityFlags=["nodejs_compat"],globalOutbound="network")),(name="network",network=(allow=["local"],tlsOptions=(trustBrowserCas=false,trustedCertificates=[${JSON.stringify(await readFile(caPath, "utf8"))}])) )],sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);`,
  );
  const child = spawn(
    join(root, "demo/node_modules/workerd/bin/workerd"),
    [
      "serve",
      "-I",
      join(root, "demo/node_modules/workerd"),
      join(directory, "config.capnp"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (data) => (logs += data));
  child.stderr.on("data", (data) => (logs += data));
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/ready`)).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (!ready) throw new Error("workerd readiness timeout: " + logs);
    const response = await fetch(`http://127.0.0.1:${port}/run`, {
      signal: AbortSignal.timeout(60000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(body + logs);
    const result = JSON.parse(body);
    result.fsLifetime = {};
    for (const kind of ["direct", "handle"]) {
      const first = await fetch(
        `http://127.0.0.1:${port}/fs-first?kind=${kind}`,
      );
      assert.equal(await first.json(), "ready");
      const second = await fetch(
        `http://127.0.0.1:${port}/fs-second?kind=${kind}`,
      );
      assert.ok(second.ok);
      result.fsLifetime[kind] = await second.json();
    }
    await writeFile(
      join(directory, "baseline.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  } finally {
    child.kill();
    await writeFile(join(directory, "workerd.log"), logs);
  }
}
