import { build as viteBuild } from "vite";
import { workersCapacitorPlugin as viteWorkers } from "../../../../dist/tooling/vite.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, webkit } from "@playwright/test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workersCapacitorPlugin } from "../../../../dist/tooling/esbuild.js";
import { eventCases as allEventCases } from "../../../../src/compat/expansion/index.spec.mjs";

import {
  localBoundaryCases as allBoundaryCases,
  localBoundaryExpected,
} from "../../../../src/compat/expansion/boundaries.spec.mjs";
const requestedCases = process.env.NODE_COMPAT_CASES?.split(",");
if (requestedCases)
  for (const name of requestedCases)
    assert.ok(
      Object.hasOwn(allEventCases, name) ||
        Object.hasOwn(allBoundaryCases, name),
      `Unknown compatibility case: ${name}`,
    );
const eventCases = requestedCases
  ? Object.fromEntries(
      requestedCases
        .filter((name) => Object.hasOwn(allEventCases, name))
        .map((name) => [name, allEventCases[name]]),
    )
  : allEventCases;

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const boundaryCases = requestedCases
  ? Object.fromEntries(
      requestedCases
        .filter((name) => Object.hasOwn(allBoundaryCases, name))
        .map((name) => [name, allBoundaryCases[name]]),
    )
  : allBoundaryCases;
const localCases = { ...eventCases, ...boundaryCases };
const profile = JSON.parse(
  await readFile(new URL("exports.json", import.meta.url), "utf8"),
).profile;
const require = createRequire(import.meta.url);
const mfRequire = createRequire(require.resolve("miniflare/package.json"));
assert.equal(
  JSON.parse(await readFile(mfRequire.resolve("workerd/package.json"), "utf8"))
    .version,
  profile.workerd,
);
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    compatibilityDate: profile.compatibilityDate,
    modulesRoot: "/fixture",
    modules: [
      {
        type: "ESModule",
        path: "/fixture/main.mjs",
        contents: `import * as tls from 'node:tls'; import * as classicStreams from 'node:stream'; import * as streams from 'node:stream/web'; import * as module from 'node:module'; import * as httpCommon from 'node:_http_common'; import * as httpOutgoing from 'node:_http_outgoing'; import * as httpServer from 'node:_http_server'; import * as http from 'node:http'; import * as cloudflareNode from 'cloudflare:node'; import * as fs from 'node:fs'; import * as zlib from 'node:zlib'; import * as sys from 'node:sys'; import * as util from 'node:util'; import * as types from 'node:util/types'; import * as console from 'node:console'; import * as crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import process from 'node:process';
const cases = {${Object.entries(eventCases)
          .map(([name, fn]) => `${JSON.stringify(name)}: (${fn.toString()})`)
          .join(",")}};
export default {async fetch(request) {
 const name = new URL(request.url).pathname.slice(1);
 return Response.json(await cases[name]({process, tls, classicStreams, streams, sys, util, types, console, crypto, fs, zlib, module, httpCommon, httpOutgoing, httpServer, http, cloudflareNode}));
}};`,
      },
      { type: "Text", path: "/fixture/readonly.txt", contents: "abcdef" },
      { type: "Text", path: "/fixture/nested/child.txt", contents: "child" },
    ],
  }),
);
const baseline = {};
try {
  for (const name of Object.keys(eventCases)) {
    console.log(`Workers baseline: ${name}`);
    const response = await runtime.dispatchFetch(
      `https://events.invalid/${name}`,
      // Crypto contracts can occupy workerd longer than the transport's idle
      // keep-alive window. Each independent oracle request uses a fresh
      // connection; never retry or substitute a failed contract result.
      { headers: { Connection: "close" } },
    );
    assert.equal(
      response.status,
      200,
      response.status === 200 ? name : `${name}: ${await response.text()}`,
    );
    baseline[name] = await response.json();
  }
} finally {
  await runtime.dispose();
}
const output = new URL(
  requestedCases
    ? "../../../artifacts/node-inventory/targeted/"
    : "../../../artifacts/node-inventory/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
await writeFile(
  new URL("expansion-contracts-workerd.json", output),
  JSON.stringify(
    {
      profile,
      sources: Object.fromEntries(
        Object.entries(eventCases).map(([name, fn]) => [
          name,
          createHash("sha256").update(fn.toString()).digest("hex"),
        ]),
      ),
      results: baseline,
    },
    null,
    2,
  ) + "\n",
);
const compiled = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    contents: `import * as tls from 'node:tls'; import * as classicStreams from 'node:stream'; import * as streams from 'node:stream/web'; import * as module from 'node:module'; import * as httpCommon from 'node:_http_common'; import * as httpOutgoing from 'node:_http_outgoing'; import * as httpServer from 'node:_http_server'; import * as http from 'node:http'; import * as cloudflareNode from 'cloudflare:node'; import * as fs from 'node:fs'; import * as zlib from 'node:zlib'; import * as sys from 'node:sys'; import * as util from 'node:util'; import * as types from 'node:util/types'; import * as console from 'node:console'; import * as crypto from 'node:crypto';
import { eventCases } from './src/compat/expansion/index.spec.mjs'; import {localBoundaryCases} from './src/compat/expansion/boundaries.spec.mjs';
import { runWithRequestScope as withRequestScope } from './dist/shared/request-scope.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import process from 'node:process';
fs.registerVirtualFiles({'/bundle/readonly.txt':'abcdef','/bundle/nested/child.txt':'child'});
export const run = name => (eventCases[name] ?? localBoundaryCases[name])({withRequestScope,process, tls, classicStreams, streams, sys, util, types, console, crypto, fs, zlib, module, httpCommon, httpOutgoing, httpServer, http, cloudflareNode});`,
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
  outfile: "demo/artifacts/node-inventory/expansion-contracts.js",
  plugins: [
    workersCapacitorPlugin({
      execution: "local",
      worker: "demo/src/workers/hono/standard.ts",
    }),
  ],
});
const entry = fileURLToPath(new URL("expansion-vite-entry.mjs", output));
await writeFile(
  entry,
  `import * as tls from 'node:tls'; import * as classicStreams from 'node:stream'; import * as streams from 'node:stream/web'; import * as module from 'node:module'; import * as httpCommon from 'node:_http_common'; import * as httpOutgoing from 'node:_http_outgoing'; import * as httpServer from 'node:_http_server'; import * as http from 'node:http'; import * as cloudflareNode from 'cloudflare:node'; import * as fs from 'node:fs'; import * as zlib from 'node:zlib'; import * as sys from 'node:sys'; import * as util from 'node:util'; import * as types from 'node:util/types'; import * as console from 'node:console'; import * as crypto from 'node:crypto';
import { eventCases } from ${JSON.stringify(fileURLToPath(new URL("../../../../src/compat/expansion/index.spec.mjs", import.meta.url)))};
import {localBoundaryCases} from ${JSON.stringify(fileURLToPath(new URL("../../../../src/compat/expansion/boundaries.spec.mjs", import.meta.url)))};
import { runWithRequestScope as withRequestScope } from ${JSON.stringify(fileURLToPath(new URL("../../../../dist/shared/request-scope.js", import.meta.url)))};
import { AsyncLocalStorage } from 'node:async_hooks';
import process from 'node:process';
fs.registerVirtualFiles({'/bundle/readonly.txt':'abcdef','/bundle/nested/child.txt':'child'});
export const run = name => (eventCases[name] ?? localBoundaryCases[name])({withRequestScope,process, tls, classicStreams, streams, sys, util, types, console, crypto, fs, zlib, module, httpCommon, httpOutgoing, httpServer, http, cloudflareNode});`,
);
const viteResult = await viteBuild({
  configFile: false,
  root,
  logLevel: "error",
  plugins: [
    viteWorkers({
      execution: "local",
      worker: "demo/src/workers/hono/standard.ts",
    }),
  ],
  build: {
    write: false,
    minify: false,
    rollupOptions: {
      input: entry,
      preserveEntrySignatures: "strict",
      output: { inlineDynamicImports: true },
    },
  },
});
const viteChunk = viteResult.output.find(
  (item) => item.type === "chunk" && item.isEntry,
);
assert.ok(viteChunk);
await writeFile(new URL("expansion-vite.js", output), viteChunk.code);
for (const [builder, source] of Object.entries({
  esbuild: compiled.outputFiles[0].text,
  vite: viteChunk.code,
})) {
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    for (const mode of ["page", "worker"]) {
      test(`${builder}/${engine}/${mode}: events contracts through public imports`, async (t) => {
        const browser = await launcher.launch();
        const results = {};
        try {
          for (const name of Object.keys(localCases)) {
            await t.test(name, { timeout: 15000 }, async () => {
              const page = await browser.newPage();
              await page.route("http://localhost/", (route) =>
                route.fulfill({
                  contentType: "text/html",
                  body: "<!doctype html><title>Events contracts</title>",
                }),
              );
              await page.goto("http://localhost/");
              try {
                const result = await page.evaluate(
                  async ({ source, name, mode }) => {
                    const url = URL.createObjectURL(
                      new Blob([source], { type: "text/javascript" }),
                    );
                    try {
                      if (mode === "page") {
                        const api = await import(url);
                        return JSON.parse(JSON.stringify(await api.run(name)));
                      }
                      const workerUrl = URL.createObjectURL(
                        new Blob(
                          [
                            `import { run } from ${JSON.stringify(url)};\nself.onmessage = async ({data}) => { try { self.postMessage({value: JSON.parse(JSON.stringify(await run(data)))}); } catch (error) { self.postMessage({error: String(error)}); } };`,
                          ],
                          { type: "text/javascript" },
                        ),
                      );
                      const worker = new Worker(workerUrl, { type: "module" });
                      try {
                        return await new Promise((resolve, reject) => {
                          const timer = setTimeout(
                            () =>
                              reject(new Error("Worker operation timed out")),
                            8000,
                          );
                          worker.onerror = (event) => {
                            clearTimeout(timer);
                            reject(new Error(event.message));
                          };
                          worker.onmessage = ({ data }) => {
                            clearTimeout(timer);
                            data.error
                              ? reject(new Error(data.error))
                              : resolve(data.value);
                          };
                          worker.postMessage(name);
                        });
                      } finally {
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                      }
                    } finally {
                      URL.revokeObjectURL(url);
                    }
                  },
                  { source, name, mode },
                );
                results[name] = result;
                assert.deepEqual(
                  result,
                  Object.hasOwn(boundaryCases, name)
                    ? localBoundaryExpected[name]
                    : baseline[name],
                );
              } finally {
                await page.close();
              }
            });
          }
        } finally {
          await browser.close();
          await writeFile(
            new URL(
              `expansion-contracts-${builder}-${engine}-${mode}.json`,
              output,
            ),
            JSON.stringify(
              {
                profile,
                builder,
                engine,
                mode,
                status: "webview-profile-operation-contracts",
                localBoundaryCases: Object.keys(boundaryCases),
                knownGaps: {
                  process:
                    "existing partial process profile; native stack inspection remains engine-dependent",
                },
                results,
              },
              null,
              2,
            ) + "\n",
          );
        }
      });
    }
  }
}
