import { resolve } from "node:path";
import { createServer as tcpServer } from "node:net";
import { TLSSocket, createSecureContext } from "node:tls";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

import { eventCases as allEventCases } from "../../../../src/compat/expansion/index.spec.mjs";
import {
  localBoundaryCases,
  localBoundaryExpected,
} from "../../../../src/compat/expansion/boundaries.spec.mjs";
import { nativeBackend } from "../../native/backend.mjs";
import { runNativeAcceptance } from "../../native/acceptance.mjs";
import { createLifecycleFixture } from "./network-lifecycle-fixture.mjs";
import { networkLifecycleBaseline } from "./network-lifecycle-baseline.mjs";
const requestedCases = process.env.NODE_COMPAT_CASES?.split(",");
if (requestedCases)
  for (const name of requestedCases)
    assert.ok(Object.hasOwn(allEventCases, name), `Unknown case: ${name}`);
const eventCases = requestedCases
  ? Object.fromEntries(
      requestedCases.map((name) => [name, allEventCases[name]]),
    )
  : allEventCases;
const [platform, device] = process.argv.slice(2);
assert.ok(
  ["ios", "android"].includes(platform) && device,
  "Usage: node expansion-native.mjs ios|android <device>",
);
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const baseline = JSON.parse(
  await readFile(
    new URL(
      "../../../artifacts/node-inventory/expansion-contracts-workerd.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const profile = JSON.parse(
  await readFile(new URL("exports.json", import.meta.url), "utf8"),
).profile;
if (requestedCases)
  for (const name of requestedCases)
    assert.ok(
      Object.hasOwn(baseline.results, name),
      `Missing baseline case: ${name}`,
    );
if (requestedCases)
  baseline.results = Object.fromEntries(
    requestedCases.map((name) => [name, baseline.results[name]]),
  );
assert.deepEqual(baseline.profile, profile);
assert.deepEqual(Object.keys(baseline.results), Object.keys(eventCases));
const artifacts = fileURLToPath(
  new URL(
    `../../../artifacts/node-inventory/native-expansion/${platform}/`,
    import.meta.url,
  ),
);
await mkdir(artifacts, { recursive: true });
await mkdir(`${artifacts}/public`, { recursive: true });
await writeFile(
  `${artifacts}/public/index.html`,
  "<!doctype html><title>Compatibility expansion fixture</title>",
);
await writeFile(
  `${artifacts}/worker.ts`,
  'export default {fetch() {return new Response("Compatibility fixture");}};',
);
await writeFile(
  `${artifacts}/wrangler.json`,
  JSON.stringify({
    name: "events-native-fixture",
    main: "worker.ts",
    compatibility_date: profile.compatibilityDate,
    assets: { directory: "./public", binding: "ASSETS" },
  }),
);
await mkdir(`${artifacts}/local`, { recursive: true });
await writeFile(
  `${artifacts}/local/worker.ts`,
  'export default {fetch() {return new Response("Events local fixture");}};',
);
await writeFile(
  `${artifacts}/local/wrangler.json`,
  JSON.stringify({
    name: "events-local-fixture",
    main: "worker.ts",
    compatibility_date: profile.compatibilityDate,
  }),
);
const consumerEvidence = JSON.parse(
  await readFile(
    new URL(
      "../../../artifacts/node-inventory/events-consumer.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const { consumer, tarball, tarballSha256 } = consumerEvidence;
assert.equal(
  createHash("sha256")
    .update(await readFile(tarball))
    .digest("hex"),
  tarballSha256,
);
const { workersCapacitorPlugin: installedVitePlugin } = await import(
  pathToFileURL(
    `${consumer}/node_modules/cf-workers-native/dist/tooling/vite.js`,
  ).href
);
const { workersCapacitorPlugin } = await import(
  pathToFileURL(
    `${consumer}/node_modules/cf-workers-native/dist/tooling/esbuild.js`,
  ).href
);
const compiled = await build({
  absWorkingDir: consumer,
  stdin: {
    resolveDir: consumer,
    contents: `import * as https from 'node:https'; import * as net from 'node:net'; import * as tls from 'node:tls'; import * as classicStreams from 'node:stream'; import * as streams from 'node:stream/web'; import * as module from 'node:module'; import * as httpCommon from 'node:_http_common'; import * as httpOutgoing from 'node:_http_outgoing'; import * as httpServer from 'node:_http_server'; import * as http from 'node:http'; import * as cloudflareNode from 'cloudflare:node'; import * as fs from 'node:fs'; import * as zlib from 'node:zlib'; import * as sys from 'node:sys'; import * as util from 'node:util'; import * as types from 'node:util/types'; import * as console from 'node:console'; import * as crypto from 'node:crypto';
import { eventCases } from ${JSON.stringify(root + "/src/compat/expansion/index.spec.mjs")};
import {runNetworkLifecycle} from ${JSON.stringify(root + "/src/compat/http/network.spec.mjs")};
import {runTlsLifecycle} from ${JSON.stringify(root + "/src/compat/tls/network.spec.mjs")};
import {runWebSocketLifecycle} from ${JSON.stringify(root + "/src/compat/http/websocket-network.spec.mjs")};
import {createFsLifetimeContract} from ${JSON.stringify(root + "/src/compat/fs/request-lifetime.spec.mjs")};
const runFsLifetime = async () => {const step=createFsLifetimeContract(fs),out={};for(const kind of ["direct","handle"]){await withRequestScope(()=>step("first",kind));out[kind]=await withRequestScope(()=>step("second",kind));}return out};
import {runWebSocketSurface} from ${JSON.stringify(root + "/src/compat/http/websocket-surface.spec.mjs")};
// Exercise the new transport independently while public-global wiring remains
// incomplete. The existing public WebSocket checks remain in the same run.
import {WebSocket as CandidateWebSocket} from ${JSON.stringify(consumer + "/node_modules/cf-workers-native/dist/browser/websocket/endpoint.js")};
import {workersCapacitor} from ${JSON.stringify(consumer + "/node_modules/cf-workers-native/dist/index.js")};
import {observeAttachments} from ${JSON.stringify(root + "/src/browser/websocket/attachment.observations.spec.mjs")};
const runNativeNetwork = async ports => {const runtime=workersCapacitor({baseURL:"https://network-lifecycle.invalid",worker:{fetch(){return new Response("unused")}}});try{await runtime.ready;return {http:await runNetworkLifecycle({http,https},ports),tls:await runTlsLifecycle({net,tls},ports),websocket:await runWebSocketLifecycle(http.WebSocket,ports),websocketCandidate:await runWebSocketLifecycle(CandidateWebSocket,ports),fsLifetime:await runFsLifetime(),websocketSurface:runWebSocketSurface(),websocketAttachments:await observeAttachments({WebSocketPair,Blob,Headers,Request,Response,wasmModule:new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0))})}}finally{await runtime.dispose()}};
import {localBoundaryCases} from ${JSON.stringify(root + "/src/compat/expansion/boundaries.spec.mjs")};
import { AsyncLocalStorage } from 'node:async_hooks';
import process from 'node:process';
fs.registerVirtualFiles({'/bundle/readonly.txt':'abcdef','/bundle/nested/child.txt':'child'});
import {measureOperation,measurements} from ${JSON.stringify(root + "/demo/tests/experiments/node-compat/native-measurements.mjs")};
export {measurements};
import { runWithRequestScope as withRequestScope } from ${JSON.stringify(consumer + "/node_modules/cf-workers-native/dist/shared/request-scope.js")};
export const run = name => measureOperation(name,()=>(eventCases[name] ?? localBoundaryCases[name])({withRequestScope,process, tls, classicStreams, streams, sys, util, types, console, crypto, fs, zlib, module, httpCommon, httpOutgoing, httpServer, http, cloudflareNode}),name==='classicCodecs'?()=>zlib.gzipSync('x'.repeat(1024)):undefined);
export {createNetworkRelay, initializeWorkerNetwork} from ${JSON.stringify(consumer + "/node_modules/cf-workers-native/dist/browser/fetch/relay.js")};
export const runTls = async ({port,upgradePort,networkPorts}) => {
 const attempt = (servername,halfClose=false) => new Promise((resolve,reject)=> {
  let secureConnect=false, body='';
  const socket=tls.connect({host:'127.0.0.1',port,servername});
  const timer=setTimeout(()=>{socket.destroy();reject(new Error('TLS timeout: '+servername));},8000);
  socket.on('secureConnect',()=>{secureConnect=socket.authorized && socket.encrypted;socket[halfClose?'end':'write']('GET /tls-native HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n');});
  socket.on('data',chunk=>{body+=chunk.toString();});
  socket.on('error',()=>{clearTimeout(timer);resolve({secureConnect,received:false});});
  socket.on('end',()=>{clearTimeout(timer);resolve({secureConnect,received:body.includes('404') && body.includes('Not found')});});
 });
 const valid=await attempt('localhost'), directEnd=await attempt('localhost',true), invalid=await attempt('wrong.invalid');

 const upgrade = (servername,halfClose=false,legacy=false) => new Promise((resolve,reject)=>{
  const plain=net.connect({host:'127.0.0.1',port:upgradePort});
  let socket=plain, secureConnect=false, body='', greeting='';
  const timer=setTimeout(()=>{socket.destroy();plain.destroy();reject(new Error('Upgrade timeout: '+servername));},8000);
  plain.on('error',()=>{});
  plain.on('connect',()=>plain.write(legacy==='untrusted'?'UNTRUSTED\\r\\n':legacy?'UPGRADE12\\r\\n':'UPGRADE\\r\\n'));
  const onGreeting=chunk=>{
   greeting+=chunk.toString();if(!greeting.endsWith('\\r\\n'))return;
   plain.off('data',onGreeting);
   if(greeting!=='READY\\r\\n'){clearTimeout(timer);plain.destroy();reject(new Error('Invalid upgrade greeting'));return;}
   socket=tls.connect({socket:plain,servername});
   socket.on('secureConnect',()=>{secureConnect=socket.authorized&&socket.encrypted;});
   socket.on('data',chunk=>{body+=chunk.toString();});
   socket.on('end',()=>{clearTimeout(timer);socket.destroy();plain.destroy();resolve({secureConnect,received:body==='encrypted-response'});});
   socket.on('error',()=>{clearTimeout(timer);plain.destroy();resolve({secureConnect,received:false});});
   if(halfClose)socket.end('encrypted-request');else socket.write('encrypted-request');
  };
  plain.on('data',onGreeting);
 });
 const upgradeEnd=[];for(let i=0;i<3;i++)upgradeEnd.push(await upgrade('localhost',true));
 return {valid,directEnd,invalid,upgrade:await upgrade('localhost'),upgradeEnd,upgradeTls12:await upgrade('localhost',true,true),upgradeUntrusted:await upgrade('localhost',false,'untrusted'),upgradeInvalid:await upgrade('wrong.invalid'),network:await runNativeNetwork(networkPorts)};
};`,
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
  outfile: `${artifacts}/candidate.js`,
  plugins: [
    workersCapacitorPlugin({
      execution: "local",
      worker: `${artifacts}/local/worker.ts`,
      workerConfig: `${artifacts}/local/wrangler.json`,
    }),
  ],
});
const entryOutput = compiled.outputFiles.find(
  (file) => file.path === resolve(artifacts, "candidate.js"),
);
assert.ok(entryOutput, "Missing native contract entry output");
const source = entryOutput.text;
const hash = createHash("sha256").update(source).digest("hex");
await writeFile(`${artifacts}/candidate.js`, source);
const harnessSource = await readFile(fileURLToPath(import.meta.url));
const harnessSha256 = createHash("sha256").update(harnessSource).digest("hex");
await writeFile(`${artifacts}/harness.mjs`, harnessSource);
await writeFile(
  `${artifacts}/inputs.json`,
  JSON.stringify(
    {
      profile,
      hash,
      platform,
      device,
      tarball,
      tarballSha256,
      harnessSha256,
      consumerEvidence,
      cases: Object.keys(eventCases),
      localBoundaryCases: Object.keys(localBoundaryCases),
    },
    null,
    2,
  ),
);
// Allow emulator clock drift without disabling TLS verification.
const tlsDirectory = `${artifacts}/tls`;
await mkdir(tlsDirectory, { recursive: true });
await writeFile(`${tlsDirectory}/index`, "");
await writeFile(`${tlsDirectory}/serial`, "01\n");
await writeFile(
  `${tlsDirectory}/ca.cnf`,
  `[ca]
default_ca=local
[local]
database=${tlsDirectory}/index
new_certs_dir=${tlsDirectory}
serial=${tlsDirectory}/serial
private_key=${tlsDirectory}/key.pem
default_md=sha256
policy=policy
x509_extensions=extensions
[policy]
commonName=supplied
[extensions]
subjectAltName=DNS:localhost,IP:127.0.0.1
basicConstraints=critical,CA:TRUE
`,
);
execFileSync(
  "openssl",
  [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${tlsDirectory}/key.pem`,
    "-out",
    `${tlsDirectory}/request.pem`,
    "-subj",
    "/CN=Compatibility expansion acceptance",
  ],
  { stdio: "pipe" },
);
const certificateTime = (time) =>
  new Date(time)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/T/, "")
    .slice(0, 14) + "Z";
execFileSync(
  "openssl",
  [
    "ca",
    "-batch",
    "-selfsign",
    "-config",
    `${tlsDirectory}/ca.cnf`,
    "-in",
    `${tlsDirectory}/request.pem`,
    "-out",
    `${tlsDirectory}/ca.pem`,
    "-startdate",
    certificateTime(Date.now() - 86400000),
    "-enddate",
    certificateTime(Date.now() + 172800000),
  ],
  { stdio: "pipe" },
);
// A separate, currently valid self-signed chain is deliberately not installed
// in either OS trust store. Hostname-only validation must not accept it.
await writeFile(
  `${tlsDirectory}/untrusted.cnf`,
  (await readFile(`${tlsDirectory}/ca.cnf`, "utf8")).replace(
    `${tlsDirectory}/key.pem`,
    `${tlsDirectory}/untrusted-key.pem`,
  ),
);
execFileSync(
  "openssl",
  [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${tlsDirectory}/untrusted-key.pem`,
    "-out",
    `${tlsDirectory}/untrusted-request.pem`,
    "-subj",
    "/CN=Untrusted compatibility fixture",
  ],
  { stdio: "pipe" },
);
execFileSync(
  "openssl",
  [
    "ca",
    "-batch",
    "-selfsign",
    "-config",
    `${tlsDirectory}/untrusted.cnf`,
    "-in",
    `${tlsDirectory}/untrusted-request.pem`,
    "-out",
    `${tlsDirectory}/untrusted.pem`,
    "-startdate",
    certificateTime(Date.now() - 86400000),
    "-enddate",
    certificateTime(Date.now() + 172800000),
  ],
  { stdio: "pipe" },
);
const untrustedContext = createSecureContext({
  key: await readFile(`${tlsDirectory}/untrusted-key.pem`),
  cert: await readFile(`${tlsDirectory}/untrusted.pem`),
});
const upgradeStats = { connections: 0, requests: 0, unexpected: 0 };
const upgradeProtocols = [];
const upgradeSockets = new Set();
const context = createSecureContext({
  key: await readFile(`${tlsDirectory}/key.pem`),
  cert: await readFile(`${tlsDirectory}/ca.pem`),
});
const context12 = createSecureContext({
  key: await readFile(`${tlsDirectory}/key.pem`),
  cert: await readFile(`${tlsDirectory}/ca.pem`),
  maxVersion: "TLSv1.2",
});
const upgradeServer = tcpServer((socket) => {
  upgradeStats.connections++;
  upgradeSockets.add(socket);
  socket.on("close", () => upgradeSockets.delete(socket));
  socket.on("error", () => {});
  let greeting = "";
  const begin = (chunk) => {
    greeting += chunk.toString();
    if (!greeting.endsWith("\r\n")) return;
    socket.off("data", begin);
    if (!["UPGRADE\r\n", "UPGRADE12\r\n", "UNTRUSTED\r\n"].includes(greeting)) {
      upgradeStats.unexpected++;
      socket.destroy();
      return;
    }
    socket.write("READY\r\n", () => {
      const secure = new TLSSocket(socket, {
        isServer: true,
        secureContext:
          greeting === "UNTRUSTED\r\n"
            ? untrustedContext
            : greeting === "UPGRADE12\r\n"
              ? context12
              : context,
      });
      secure.on("error", () => {});
      let body = "";
      secure.on("data", (chunk) => {
        body += chunk.toString();
        if (body === "encrypted-request") {
          upgradeStats.requests++;
          upgradeProtocols.push(secure.getProtocol());
          secure.end("encrypted-response");
        } else if (!"encrypted-request".startsWith(body)) {
          upgradeStats.unexpected++;
          secure.destroy();
        }
      });
    });
  };
  socket.on("data", begin);
});
await new Promise((resolve) => upgradeServer.listen(0, "127.0.0.1", resolve));
// A valid chain with the wrong hostname isolates endpoint-name rejection.
await writeFile(
  `${tlsDirectory}/wrong.cnf`,
  (await readFile(`${tlsDirectory}/ca.cnf`, "utf8")) +
    "\n[wrong]\nsubjectAltName=DNS:wrong.invalid\nbasicConstraints=CA:FALSE\n",
);
execFileSync(
  "openssl",
  [
    "req",
    "-new",
    "-key",
    `${tlsDirectory}/key.pem`,
    "-out",
    `${tlsDirectory}/wrong-request.pem`,
    "-subj",
    "/CN=wrong.invalid",
  ],
  { stdio: "pipe" },
);
execFileSync(
  "openssl",
  [
    "ca",
    "-batch",
    "-config",
    `${tlsDirectory}/wrong.cnf`,
    "-cert",
    `${tlsDirectory}/ca.pem`,
    "-extensions",
    "wrong",
    "-in",
    `${tlsDirectory}/wrong-request.pem`,
    "-out",
    `${tlsDirectory}/wrong.pem`,
    "-startdate",
    certificateTime(Date.now() - 86400000),
    "-enddate",
    certificateTime(Date.now() + 172800000),
  ],
  { stdio: "pipe" },
);
const networkFixture = await createLifecycleFixture({
  mismatchCert: await readFile(`${tlsDirectory}/wrong.pem`),
  key: await readFile(`${tlsDirectory}/key.pem`),
  cert: await readFile(`${tlsDirectory}/ca.pem`),
});
let networkExpected;
try {
  networkExpected = await networkLifecycleBaseline(
    networkFixture.ports,
    `${tlsDirectory}/ca.pem`,
    `${artifacts}/network-baseline`,
  );
  networkExpected.websocketCandidate = networkExpected.websocket;
} catch (error) {
  await networkFixture.close();
  for (const socket of upgradeSockets) socket.destroy();
  await new Promise((resolve) => upgradeServer.close(resolve));
  throw error;
}
const tlsPorts = {
  port: 0,
  upgradePort: upgradeServer.address().port,
  networkPorts: networkFixture.ports,
};
if (platform === "android")
  for (const port of Object.values(networkFixture.ports))
    execFileSync("adb", [
      "-s",
      device,
      "reverse",
      `tcp:${port}`,
      `tcp:${port}`,
    ]);
if (platform === "android")
  execFileSync("adb", [
    "-s",
    device,
    "reverse",
    `tcp:${tlsPorts.upgradePort}`,
    `tcp:${tlsPorts.upgradePort}`,
  ]);
const backend = await nativeBackend({
  tlsDirectory,
  dispatch: async () => new Response("Not found", { status: 404 }),
  driver: "",
  dispose: async () => {
    if (platform === "android")
      execFileSync("adb", [
        "-s",
        device,
        "reverse",
        "--remove",
        `tcp:${tlsPorts.upgradePort}`,
      ]);
    if (platform === "android")
      for (const port of Object.values(networkFixture.ports))
        execFileSync("adb", [
          "-s",
          device,
          "reverse",
          "--remove",
          `tcp:${port}`,
        ]);
    await networkFixture.close();
    for (const socket of upgradeSockets) socket.destroy();
    await new Promise((resolve) => upgradeServer.close(resolve));
  },
  instrument: () => false,
});
tlsPorts.port = networkFixture.ports.gracefulHttp;
const bootstrapCode = `
async function main() {
const source = ${JSON.stringify(source)};
const names = ${JSON.stringify([...Object.keys(eventCases), ...Object.keys(localBoundaryCases)])};
const boundaryNames = ${JSON.stringify(Object.keys(localBoundaryCases))};
const report = async value => {await fetch(${JSON.stringify(backend.url.origin + "/__acceptance/report")}, {method:'POST', mode:'no-cors', headers:{'content-type':'text/plain'}, body:JSON.stringify(value)});};
const results = {}, measurements = {}, localBoundaries = {};
// One immutable Blob avoids accumulating copies of the large fixture payload.
// URL fragments retain separate module identities for cold per-case measurements.
let moduleURL, activeCase;
try {
 moduleURL = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
 for (const mode of ['page', 'worker']) {
  results[mode] = {}; measurements[mode] = {};
  for (const name of names) {
   activeCase = {mode,name};
   document.body.textContent=mode+"/"+name;
   globalThis.__compatActiveCase=activeCase;
   if(Object.keys(results[mode]).length % 10 === 0)await report({stage:"progress",activeCase});
   const url = moduleURL+'#'+mode+'-'+name;
    if (mode === 'page') {
      // Discard the realm after each cold case; module URL fragments alone keep
      // every Wasm instance alive in the parent page's module map.
      const frame=document.createElement('iframe');frame.hidden=true;
      const token='case-'+name;
      try {
        const outcome=await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('Page case timeout: '+name));},30000);
          const receive=event=>{
            if(event.source!==frame.contentWindow || event.data?.token!==token)return;
            clearTimeout(timer);window.removeEventListener('message',receive);
            event.data.error?reject(new Error(event.data.error)):resolve(event.data);
          };
          window.addEventListener('message',receive);
          const code='globalThis.Capacitor=parent.Capacitor;try {const api=await import('+JSON.stringify(url)+');parent.postMessage({token:'+JSON.stringify(token)+',value:JSON.parse(JSON.stringify(await api.run('+JSON.stringify(name)+'))),measurements:api.measurements['+JSON.stringify(name)+']},"*");}catch(error){parent.postMessage({token:'+JSON.stringify(token)+',error:String(error)},"*");}';
          frame.srcdoc='<script type="module">'+code+'<'+ '/script>';
          document.body.append(frame);
        });
        results[mode][name]=outcome.value;measurements[mode][name]=outcome.measurements;
      } finally {frame.remove();}
    }
    else {
     const workerURL = URL.createObjectURL(new Blob(['import {run,measurements} from ' + JSON.stringify(url) + '; self.onmessage = async ({data}) => {try {self.postMessage({value:JSON.parse(JSON.stringify(await run(data))),measurements:measurements[data]});} catch(error) {self.postMessage({error:String(error)});}};'], {type:'text/javascript'}));
     const worker = new Worker(workerURL, {type:'module'});
     try {
      results[mode][name] = await new Promise((resolve,reject) => {
       const timer = setTimeout(() => reject(new Error('Worker timeout: '+name)), 8000);
       worker.onmessage = ({data}) => {clearTimeout(timer); if(data.error)reject(new Error(data.error));else {measurements[mode][name]=data.measurements;resolve(data.value);}};
       worker.onerror = event => {clearTimeout(timer);reject(new Error('Worker error in '+name+': '+JSON.stringify({message:event.message,filename:event.filename,line:event.lineno,column:event.colno,type:event.type})));};
       worker.postMessage(name);
      });
     } finally {worker.terminate(); URL.revokeObjectURL(workerURL);}
    }
  }
 }
 for(const mode of ['page','worker']) {
   localBoundaries[mode] = {};
   for(const name of boundaryNames){localBoundaries[mode][name]=results[mode][name];delete results[mode][name];}
 }
 activeCase={mode:'page',name:'nativeTls'};
 const tlsURL=moduleURL+'#native-tls';
 const tlsApi=await import(/* @vite-ignore */ tlsURL);
 const nativeTls={page:await tlsApi.runTls(${JSON.stringify(tlsPorts)})};
 activeCase={mode:'worker',name:'nativeTls'};
 const workerURL=URL.createObjectURL(new Blob(['import {runTls, initializeWorkerNetwork} from '+JSON.stringify(tlsURL)+'; self.onmessage=async ({data})=>{try {await initializeWorkerNetwork();self.postMessage({tls:await runTls(data)});}catch(e){self.postMessage({error:String(e)});}};'],{type:'text/javascript'}));
 const tlsWorker=new Worker(workerURL,{type:'module'});
 const relay=tlsApi.createNetworkRelay(tlsWorker);
 tlsWorker.addEventListener('message',relay.receive);
 try {nativeTls.worker=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Worker TLS timeout')),20000);
  tlsWorker.onmessage=({data})=>{if(data.tls || data.error){clearTimeout(timer);data.error?reject(new Error(data.error)):resolve(data.tls);}};
  tlsWorker.postMessage(${JSON.stringify(tlsPorts)});
 });} finally {tlsWorker.terminate();await relay.dispose();URL.revokeObjectURL(workerURL);}
 await report({stage:'complete', measurements, localBoundaries, nativeTls, hash:${JSON.stringify(hash)}, results});
 document.body.textContent = 'Compatibility contracts complete';
} catch(error) {globalThis.__compatFailure={activeCase,message:String(error),stack:error.stack};document.body.textContent=String(error);await report({stage:'failure', activeCase, completed:{page:Object.keys(results.page??{}),worker:Object.keys(results.worker??{})}, message:String(error), stack:error.stack});document.body.textContent=String(error);}
finally {if(moduleURL) URL.revokeObjectURL(moduleURL);}
}
main();
`;
await writeFile(`${artifacts}/bootstrap.js`, bootstrapCode);
await runNativeAcceptance({
  // The expansion suite includes key derivation/encoding on both execution modes.
  // Keep its overall budget separate from the individual Worker/socket deadlines.
  // 104 cold module instances per mode now take over 180s on Android.
  // Individual Worker/socket deadlines remain unchanged.
  timeout: 300_000,
  backend,
  artifacts,
  platform,
  device,
  bootstrapCode,
  buildPlugin: installedVitePlugin,
  bootstrapDirectory: `${consumer}/expansion-bootstrap`,
  forbiddenModuleRoots: [`${root}/src`, `${root}/dist`],
  shell: consumer,
  appId: "jp.rdlabo.workerscapacitor.events",
  worker: `${artifacts}/worker.ts`,
  workerConfig: `${artifacts}/wrangler.json`,
  validate: async (backend) => {
    const completed = backend.reports.find(
      (report) => report.stage === "complete",
    );
    assert.equal(completed.hash, hash);
    for (const mode of ["page", "worker"])
      assert.deepEqual(completed.localBoundaries[mode], localBoundaryExpected);
    for (const mode of ["page", "worker"])
      assert.deepEqual(completed.nativeTls[mode], {
        network: networkExpected,
        valid: { secureConnect: true, received: true },
        directEnd: { secureConnect: true, received: true },
        invalid: { secureConnect: false, received: false },
        upgrade: { secureConnect: true, received: true },
        upgradeEnd: Array.from({ length: 3 }, () => ({
          secureConnect: true,
          received: true,
        })),
        upgradeTls12: { secureConnect: true, received: true },
        upgradeUntrusted: { secureConnect: true, received: false },
        upgradeInvalid: { secureConnect: true, received: false },
      });
    // Fragmented module URLs must still instantiate a fresh backend per case.
    for (const mode of ["page", "worker"])
      for (const name of [
        "cryptoCipherAlgorithms",
        "cryptoCipherStates",
        "cryptoPbkdfContracts",
        "cryptoDigestContracts",
      ].filter((name) => Object.hasOwn(eventCases, name)))
        for (const kind of ["Module", "Instance"])
          assert.ok(
            completed.measurements[mode][name].wasm.some(
              (entry) => entry.kind === kind,
            ),
            `${mode}/${name}: missing cold Wasm ${kind}`,
          );
    assert.deepEqual(upgradeStats, {
      connections: 14,
      requests: 10,
      unexpected: 0,
    });
    assert.deepEqual(Object.keys(completed.results).sort(), ["page", "worker"]);
    for (const mode of ["page", "worker"])
      assert.deepEqual(completed.results[mode], baseline.results);
    assert.equal(
      upgradeProtocols.filter((protocol) => protocol === "TLSv1.3").length,
      8,
    );
    assert.equal(
      upgradeProtocols.filter((protocol) => protocol === "TLSv1.2").length,
      2,
    );
    await writeFile(
      `${artifacts}/tls-upgrade-evidence.json`,
      JSON.stringify(
        {
          hash,
          platform,
          stats: upgradeStats,
          protocols: upgradeProtocols,
          results: completed.nativeTls,
        },
        null,
        2,
      ) + "\n",
    );
  },
});
console.log(
  `${platform}: ${Object.keys(eventCases).length} operation groups and ${Object.keys(localBoundaryCases).length} local boundary groups passed in page and Dedicated Worker (${hash})`,
);
