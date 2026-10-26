import assert from "node:assert/strict";
import expectedCases from "../demo/tests/validation/expected-cases.json" with { type: "json" };
const expectedNodeCases = Object.entries(expectedCases)
  .filter(([feature]) => feature.startsWith("node."))
  .sort();
function checkNodeCases(reports) {
  assert.deepEqual(
    reports.map((r) => [r.feature, r.cases.map((c) => c.id)]).sort(),
    expectedNodeCases,
  );
  assert.deepEqual(
    reports.flatMap((r) => r.errors),
    [],
  );
}
import {
  cp,
  mkdtemp,
  writeFile,
  mkdir,
  readdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";

const root = process.cwd();
const previewPort = Number(process.env.CONSUMER_PREVIEW_PORT ?? 4189);
const previewURL = `http://127.0.0.1:${previewPort}`;
const temp = await mkdtemp(join(tmpdir(), "capacitor-workers-consumer-"));
const pack = JSON.parse(
  execFileSync(
    "npm",
    [
      "pack",
      ...(process.env.CONSUMER_PACKAGE ? [process.env.CONSUMER_PACKAGE] : []),
      "--json",
      "--pack-destination",
      temp,
    ],
    {
      encoding: "utf8",
    },
  ),
)[0];
console.log(`Consumer package: ${pack.name}@${pack.version} (${temp})`);
for (const required of [
  "dist/ios.js",
  "dist/android.js",
  "dist/compat/zlib/classic-base.cjs",
  "dist/compat/zlib/classic-base.d.cts",
  "dist/compat/zlib/native-zlib.js",
  "native/ios-host/WorkersView.swift",
  "native/android/consumer-rules.pro",
  "native/android/src/main/java/jp/rdlabo/workerscapacitor/WorkersNative.java",
  "native/android/src/main/java/jp/rdlabo/workerscapacitor/WorkersNativeActivity.java",
]) {
  assert.ok(
    pack.files.some((file) => file.path === required),
    `Native embedding consumer requires packed file ${required}`,
  );
}
for (const module of [
  "path",
  "querystring",
  "string-decoder",
  "buffer",
  "timers",
  "url",
  "os",
  "tty",
  "wasi",
  "punycode",
  "constants",
  "v8",
  "http2",
  "vm",
  "child-process",
  "cluster",
  "dgram",
  "inspector",
  "domain",
  "readline",
  "repl",
  "sqlite",
  "test",
  "stream-consumers",
  "dns",
  "assert",
  "perf-hooks",
  "trace-events",
  "https",
  "worker-threads",
  "http-agent",
  "http-client",
  "http-incoming",
  "tls-common",
  "util",
  "diagnostics-channel",
  "stream",
  "stream-readable",
  "stream-writable",
  "stream-duplex",
  "stream-transform",
  "stream-passthrough",
  "stream-promises",
]) {
  for (const name of ["LICENSE-3RD-PARTY.md", "LICENSE-APACHE"]) {
    const notice = `dist/compat/${module}/${name}`;
    if (!pack.files.some((file) => file.path === notice))
      throw new Error(`Missing upstream license notice in tarball: ${notice}`);
  }
}
for (const notice of [
  "dist/compat/stream-web/LICENSE",
  ...["openssl", "emscripten", "musl"].map(
    (name) => `dist/compat/crypto/LICENSE.${name}`,
  ),
  "dist/compat/crypto/LICENSE-APACHE",
  "dist/compat/crypto/LICENSE.boringssl",
  "dist/compat/crypto/LICENSE-3RD-PARTY.md",
  "dist/compat/zlib/LICENSE-APACHE",
  "dist/compat/zlib/LICENSE-3RD-PARTY.md",
  ...["brotli", "zstd", "zlib", "emscripten", "musl"].map(
    (name) => `dist/compat/zlib/LICENSE.${name}`,
  ),
]) {
  assert.ok(
    pack.files.some((file) => file.path === notice),
    `Missing bundled implementation license: ${notice}`,
  );
}
for (const name of ["NOTICE.md", "LICENSE-APACHE"]) {
  const notice = `dist/compat/async-hooks/${name}`;
  if (!pack.files.some((file) => file.path === notice))
    throw new Error(`Missing async hook license notice in tarball: ${notice}`);
}
for (const name of ["NOTICE.md", "LICENSE-MIT"]) {
  const notice = `dist/compat/stream-web/${name}`;
  if (!pack.files.some((file) => file.path === notice))
    throw new Error(`Missing stream ponyfill notice in tarball: ${notice}`);
}
for (const name of ["NOTICE", "LICENSE-APACHE", "LICENSE-MIT"]) {
  const notice = `dist/shared/brotli/${name}`;
  if (!pack.files.some((file) => file.path === notice))
    throw new Error(
      `Missing bundled codec license notice in tarball: ${notice}`,
    );
}
await writeFile(
  join(temp, "package.json"),
  JSON.stringify({ name: "fresh-consumer", private: true, type: "module" }),
);
execFileSync(
  "npm",
  [
    "install",
    join(temp, pack.filename),
    "vite@7.3.7",
    "esbuild@0.28.2",
    "hono@4.13.13",
    "express@5.3.0",
    "@capacitor/core@8.5.3",
    "typescript@7.0.2",
    "@types/node@26.6.5",
  ],
  { cwd: temp, stdio: "pipe" },
);
// The consumer test needs web sources only, not native projects/build outputs.
for (const entry of [
  "tests/scripts/build-tools.mjs",
  "src",
  "tests/validation",
  "tests/fixtures",
]) {
  await cp(join("demo", entry), join(temp, "demo", entry), { recursive: true });
}
// Candidate Web API contracts use internal modules from the installed tarball.
// Never copy library implementation sources from the checkout.
for (const domain of ["compat", "browser", "cloudflare", "shared"]) {
  await cp(
    join(temp, "node_modules/cf-workers-native/dist", domain),
    join(temp, "src", domain),
    { recursive: true },
  );
}
await cp(
  join(temp, "node_modules/cf-workers-native/dist/environment.js"),
  join(temp, "src/environment.js"),
);
// Discover module-owned specs by convention. Only test sources come from the
// checkout; every implementation above still comes from the installed tarball.
for (const domain of ["compat", "browser", "cloudflare", "shared"]) {
  const directory = join("src", domain);
  for (const file of await readdir(directory, { recursive: true })) {
    if (!file.endsWith(".spec.ts")) continue;
    const target = join(temp, directory, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(directory, file), target);
  }
}
await writeFile(
  join(temp, "vite.config.mjs"),
  `import { readFile } from 'node:fs/promises';
import { workersCapacitorPlugin } from 'cf-workers-native/tooling/vite';
export default {root:'demo/tests/validation',plugins:[{name:'brotli-wasm-binary',async load(id){if(!id.includes('brotli_dec_wasm_bg.wasm'))return;const data=(await readFile(id.split('?')[0])).toString('base64');return \`export default Uint8Array.from(atob(\${JSON.stringify(data)}), c => c.charCodeAt(0));\`;}},workersCapacitorPlugin()],build:{outDir:'../../../build',target:'es2022'}};`,
);
execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  cwd: temp,
  stdio: "pipe",
});
await writeFile(
  join(temp, "consumer.ts"),
  `/// <reference types="cf-workers-native/cloudflare/apis/types" />
import worker from "./demo/src/workers/hono/standard";
import { httpServerHandler } from "cloudflare:node";
const handler = httpServerHandler({ port: 3000 });
const response: Promise<Response> = handler.fetch(new Request("https://worker.invalid/api"));
// @ts-expect-error Logical ports must be numeric.
httpServerHandler({ port: "3000" });
import { workersCapacitor, FetchRuntime, type WorkerContext } from "cf-workers-native/capacitor";
import { workersIOS } from "cf-workers-native/ios";
import { workersAndroid } from "cf-workers-native/android";
const nativeEntries: Array<typeof workersIOS> = [workersIOS, workersAndroid];
for (const entry of nativeEntries) {
  const runtime = entry({ baseURL: "https://worker.invalid", render: "/" });
  const ready: Promise<void> = runtime.ready;
  void runtime.dispose();
}
class ExampleRuntime extends FetchRuntime<{ label: string }> {
  protected dispatch(request: Request, env: { label: string }, ctx: WorkerContext) {
    ctx.waitUntil(Promise.resolve());
    return new Response(env.label + request.method);
  }
}
import { defineFeature, FeatureImplementation, openFeature } from "cf-workers-native/shared/contracts";
import { runContract, type ContractSuite } from "cf-workers-native/shared/contracts/testing";
import { kvContract } from "cf-workers-native/cloudflare/bindings/kv/testing";
import { fetchContract, fetchContractWorker } from "cf-workers-native/cloudflare/workers/testing";
import { LocalStorageKV } from "cf-workers-native/cloudflare/bindings/kv";
import { workersCapacitorPlugin as buildPlugin } from "cf-workers-native/tooling/vite";
buildPlugin({ worker: "worker.ts", execution: "local" });
buildPlugin({ worker: "worker.ts", execution: [{ method: "*", path: "/app/*" }] });
// @ts-expect-error Automatic distribution is not part of the execution contract.
buildPlugin({ worker: "worker.ts", execution: "auto" });
buildPlugin({ worker: "worker.ts", remoteBindings: ["SECRET"], assetsExecution: "remote" });
// @ts-expect-error Local ASSETS is not a completed compatibility unit.
buildPlugin({ worker: "worker.ts", assetsExecution: "local" });
import { FetchImplementation } from "cf-workers-native/cloudflare/workers";
void runContract(new LocalStorageKV("consumer-test"), kvContract);
const kv = new LocalStorageKV("consumer-test").create();
const bytes: Promise<ArrayBuffer | null> = kv.get("key", "arrayBuffer");
const json: Promise<{ value: number } | null> = kv.get<{ value: number }>("key", "json");
const metadata: Promise<{ value: string | null; metadata: { tag: string } | null }> = kv.getWithMetadata<{ tag: string }>("key");
// @ts-expect-error Workers bulk reads cannot return streams.
void kv.get(["key"], "stream");
// @ts-expect-error Write options are checked statically as well as at runtime.
void kv.put("key", "value", { expirationTtl: "60" });

void runContract(new FetchImplementation({ worker: fetchContractWorker, baseURL: "https://worker.invalid/api" }), fetchContract);
// @ts-expect-error A KV implementation cannot use the HTTP contract.
void runContract(new LocalStorageKV("consumer-test"), fetchContract);
const feature = defineFeature<{ value(): number }>()("consumer", ["value"]);
const incompatibleFeature = defineFeature<{ value(): string }>()("consumer", ["value"]);
// @ts-expect-error Published declarations must preserve API invariance.
const invalidFeature: typeof feature = incompatibleFeature;
class InvalidImplementation extends FeatureImplementation<typeof feature> {
  // @ts-expect-error Wrong API result must fail against published declarations.
  create() { return { value: () => "wrong" }; }
}
class Implementation extends FeatureImplementation<typeof feature> {
  constructor() { super(feature, { value: { status: "supported" } }); }
  create() { return { value: () => 1 }; }
}
const suite: ContractSuite<typeof feature> = { feature, cases: { value(api) { const value: number = api.value(); } } };
void runContract(new Implementation(), suite);
void openFeature(new Implementation()).then(session => {
  const value: number = session.api.value();
  // @ts-expect-error Public API inference must not degrade to any.
  session.api.missing();
  return session.dispose();
});
const example = new ExampleRuntime({ baseURL: "https://worker.invalid/api", env: { label: "local" } });
const fetcher: typeof fetch = example.fetch;
example.dispose();
const runtime = workersCapacitor({worker, baseURL:"https://worker.invalid/api"});
const ready: Promise<void> = runtime.ready;
// @ts-expect-error Worker handlers must not degrade to any.
const invalid: number = worker;
runtime.dispose();
`,
);
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--moduleResolution",
    "bundler",
    "--module",
    "esnext",
    "--target",
    "es2022",
    "consumer.ts",
  ],
  { cwd: temp, stdio: "pipe" },
);
// Compile the installed adapter declarations, rather than resolving node:fs
// to @types/node. Library checking must remain enabled to catch broken .d.ts.
for (const fixture of ["fs-consumer.mts", "zlib-consumer.mts"]) {
  await writeFile(
    join(temp, fixture),
    (await readFile(join(root, "tests/types", fixture), "utf8")).replaceAll(
      "../../src/",
      "./node_modules/cf-workers-native/dist/",
    ),
  );
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "false",
      "--types",
      "node",
      "--lib",
      "esnext,dom",
      "--moduleResolution",
      "nodenext",
      "--module",
      "nodenext",
      "--target",
      "es2022",
      fixture,
    ],
    { cwd: temp, stdio: "pipe" },
  );
}
// Readiness must identify this consumer, not an unrelated preview on the
// same port. Otherwise a stale server can supply passing historical results.
const previewIdentity = randomUUID();
await writeFile(join(temp, "build", "consumer-identity.txt"), previewIdentity);
const child = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(previewPort),
    "--strictPort",
  ],
  { cwd: temp, stdio: "pipe" },
);
let browser;
try {
  const deadline = Date.now() + 20000;
  while (true) {
    try {
      const response = await fetch(`${previewURL}/consumer-identity.txt`);
      if (
        response.ok &&
        (await response.text()) === previewIdentity &&
        child.exitCode === null
      )
        break;
    } catch {}
    if (child.exitCode !== null || Date.now() > deadline)
      throw new Error("Consumer preview failed to start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("Consumer page error:", error));
  await page.goto(`${previewURL}/`);
  await page.waitForFunction(() => window.pocDone);
  const results = await page.evaluate(() => window.pocResults);
  if (results?.length !== 26 || results.some((r) => !r.ok))
    throw new Error(await page.locator("pre").innerText());
  // Rebuild the same installed tarball consumer using the public isolated import.
  await writeFile(
    join(temp, "vite.config.mjs"),
    `import { workersCapacitorPlugin } from 'cf-workers-native/tooling/vite';
export default {root:'demo/tests/fixtures/apps/runtime',plugins:[workersCapacitorPlugin({execution:'local',worker:'../../workers/runtime/isolation.ts'})],build:{outDir:'../../../../../build',emptyOutDir:true,target:'es2022'}};`,
  );
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    cwd: temp,
    stdio: "pipe",
  });
  await page.goto(previewURL);
  await page.waitForFunction(
    () => typeof window.startExperiment === "function",
  );
  const isolated = [];
  for (const framework of ["hono", "express"]) {
    await page.evaluate(async (framework) => {
      window.experiment = window.startExperiment(
        location.origin,
        "https://worker.invalid/api",
        framework,
      );
      await window.experiment.ready;
    }, framework);
    await page.context().setOffline(true);
    try {
      const checks = await page.evaluate(async (framework) => {
        const results = await window.runFrameworkContract(framework);
        await window.experiment.drain();
        if (window.experiment.errors.length)
          throw new Error("Background errors");
        return results;
      }, framework);
      if (checks.length !== 11 || checks.some((r) => !r.ok))
        throw new Error(JSON.stringify(checks));
      isolated.push(...checks);
    } finally {
      await page.evaluate(() => window.experiment.dispose());
      await page.context().setOffline(false);
    }
  }
  for (const prefer of ["worker", "direct"]) {
    const result = await page.evaluate(async (prefer) => {
      const runtime = window.startPreferred(prefer);
      try {
        await runtime.ready;
        const response = await fetch("/api/echo", {
          method: "POST",
          body: "packed preference",
        });
        return { execution: runtime.execution, text: await response.text() };
      } finally {
        runtime.dispose();
      }
    }, prefer);
    if (result.execution !== prefer || result.text !== "packed preference")
      throw new Error(JSON.stringify(result));
  }
  const features = await page.evaluate(() => window.runFeatures());
  const expectedFeatures = Object.entries(expectedCases).flatMap(
    ([feature, cases]) =>
      (feature.startsWith("node.") || feature === "fetch.basic"
        ? ["direct", "isolated"]
        : ["webview"]
      ).map((environment) => [environment, feature, cases]),
  );
  assert.deepEqual(
    features
      .map((r) => [r.environment, r.feature, r.cases.map((c) => c.id)])
      .sort(),
    expectedFeatures.sort(),
  );
  if (
    features.some(
      (report) =>
        report.errors.length ||
        report.cases.some((test) => test.status !== "passed"),
    )
  )
    throw new Error(JSON.stringify(features));
  execFileSync(process.execPath, ["demo/tests/scripts/build-tools.mjs"], {
    cwd: temp,
    stdio: "pipe",
  });
  await cp(
    join(temp, "demo/artifacts/build-tools"),
    join(temp, "build/build-tools"),
    { recursive: true },
  );
  for (const build of [
    "vite-hono",
    "vite-express",
    "esbuild-hono",
    "esbuild-express",
    "raw",
  ]) {
    for (const prefer of ["worker", "direct"]) {
      await page.goto(`${previewURL}/build-tools/${build}/`);
      await page.waitForFunction(
        () => typeof window.runBuildTool === "function",
      );
      const report = await page.evaluate(
        (prefer) => window.runBuildTool(prefer),
        prefer,
      );
      if (build !== "raw")
        assert.deepEqual(
          report.resolved,
          Array(11).fill(true),
          `${build}/${prefer}: import aliases`,
        );
      if (
        report.execution !== prefer ||
        report.cases.length !== (build === "raw" ? 4 : 9) ||
        report.cases.some((result) => !result.ok)
      )
        throw new Error(`${build}/${prefer}: ${JSON.stringify(report)}`);
    }
  }
  console.log("Packed consumer: Vite/esbuild/browser ESM 10/10 passed");
  for (const build of ["vite-node", "esbuild-node"]) {
    for (const prefer of ["worker", "direct"]) {
      await page.goto(
        `${previewURL}/build-tools/${build}/${build === "vite-node" ? "node.html" : ""}`,
      );
      await page.waitForFunction(
        () => typeof window.runNodeBuild === "function",
      );
      const report = await page.evaluate(
        (prefer) => window.runNodeBuild(prefer),
        prefer,
      );
      checkNodeCases(report.contracts);
      const cases = report.contracts.flatMap((result) => result.cases);
      if (
        report.execution !== prefer ||
        cases.some((result) => result.status !== "passed") ||
        JSON.stringify(report.commonJsAssertions) !==
          JSON.stringify({ callable: true, sameDefault: true }) ||
        JSON.stringify(report.commonJsStreams) !==
          JSON.stringify(Array(7).fill(true))
      )
        throw new Error(`${build}/${prefer}: ${JSON.stringify(report)}`);
    }
  }
  console.log("Packed consumer: configured Node/CommonJS entries 4/4 passed");
  // Installed package, cold Vite dev optimization, subpath-only application.
  const dev = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--config",
      "demo/tests/fixtures/apps/build-tools/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      "4187",
      "--strictPort",
      "--force",
    ],
    { cwd: temp, stdio: "pipe" },
  );
  let devOutput = "";
  dev.stdout.on("data", (chunk) => {
    devOutput += chunk;
  });
  dev.stderr.on("data", (chunk) => {
    devOutput += chunk;
  });
  try {
    const deadline = Date.now() + 60000;
    let readiness = "No response";
    while (true) {
      try {
        const response = await fetch("http://127.0.0.1:4187/features.html", {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) break;
        readiness = `${response.status}: ${await response.text()}`;
      } catch (error) {
        readiness = String(error);
      }
      if (dev.exitCode !== null || Date.now() > deadline)
        throw new Error(
          `Consumer dev server failed to start: ${readiness}\n${devOutput}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    page.on("requestfailed", (request) =>
      console.error("Consumer request:", request.url(), request.failure()),
    );
    page.on("pageerror", (error) => console.error("Consumer page:", error));
    page.on("console", (message) => {
      if (message.type() === "error")
        console.error("Consumer console:", message.text());
    });
    await page.goto("http://127.0.0.1:4187/features.html");
    await page.waitForFunction(
      () => typeof window.runConfiguredFeature === "function",
    );
    for (const prefer of ["worker", "direct"]) {
      const report = await page.evaluate(
        (prefer) => window.runConfiguredFeature(prefer),
        prefer,
      );
      if (
        !report.unchanged ||
        report.cases.length !== 9 ||
        report.cases.some((result) => !result.ok)
      )
        throw new Error(JSON.stringify(report));
    }
    console.log(
      "Packed consumer: configured Fetch subpath in Vite dev 2/2 passed",
    );
  } catch (error) {
    console.error(devOutput);
    throw error;
  } finally {
    dev.kill("SIGTERM");
  }
  await mkdir(resolve(root, "artifacts"), { recursive: true });
  await writeFile(
    resolve(root, "artifacts/package-results.json"),
    JSON.stringify(
      {
        consumer: temp,
        package: { name: pack.name, version: pack.version },
        direct: results,
        isolated,
        features,
      },
      null,
      2,
    ),
  );
  console.log(
    `Packed consumer: direct ${results.length}/26, isolated ${isolated.length}/22, common features ${features.flatMap((report) => report.cases).filter((c) => c.status === "passed").length} passed, ${features.flatMap((report) => report.cases).filter((c) => c.status === "unsupported").length} declared unsupported, preferences 2/2 passed (${temp})`,
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
}
