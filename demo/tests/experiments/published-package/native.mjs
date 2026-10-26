import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, copyFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { nativeBackend } from "../../native/backend.mjs";
import { runNativeAcceptance } from "../../native/acceptance.mjs";

const [platform, device] = process.argv.slice(2);
assert.ok(
  ["ios", "android"].includes(platform) && device,
  "Usage: native.mjs ios|android <device>",
);
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const evidence = JSON.parse(
  await readFile(
    new URL(
      "../../../artifacts/node-inventory/events-consumer.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.ok(
  evidence.source === "npm" || process.env.ACCEPTANCE_CHECKOUT === "1",
  "Prepare with CONSUMER_VERSION=<exact release>, or explicitly set ACCEPTANCE_CHECKOUT=1 for a local candidate",
);
assert.equal(
  createHash("sha256")
    .update(await readFile(evidence.tarball))
    .digest("hex"),
  evidence.tarballSha256,
);
const { consumer } = evidence;
const version =
  evidence.version ??
  JSON.parse(
    await readFile(
      `${consumer}/node_modules/cf-workers-native/package.json`,
      "utf8",
    ),
  ).version;
const installed = `${consumer}/node_modules/cf-workers-native`;
assert.equal(
  JSON.parse(await readFile(`${installed}/package.json`, "utf8")).version,
  version,
);
const { workersCapacitorPlugin } = await import(
  pathToFileURL(`${installed}/dist/tooling/vite.js`).href
);
const label =
  evidence.source === "npm"
    ? `published-${version}`
    : `candidate-${evidence.tarballSha256.slice(0, 12)}`;
const run = process.env.ACCEPTANCE_RUN;
assert.ok(!run || /^[a-zA-Z0-9_-]+$/.test(run));
const artifacts = `${root}/artifacts/validation/${label}/onboarding/${platform}${run ? "/" + run : ""}`;
const fixture = `${consumer}/onboarding`;
await mkdir(artifacts, { recursive: true });
await mkdir(fixture, { recursive: true });
await copyFile(new URL("worker.mjs", import.meta.url), `${fixture}/worker.mjs`);
await writeFile(
  `${fixture}/wrangler.json`,
  JSON.stringify({
    name: "published-onboarding",
    main: "worker.mjs",
    compatibility_date: "2026-10-17",
  }),
);
const harness = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: await readFile(`${fixture}/worker.mjs`, "utf8"),
    compatibilityDate: "2026-10-17",
  }),
);
await harness.ready;
let startupAt;
const backend = await nativeBackend({
  onReport: (report) => {
    if (report.stage === "startup") startupAt = Date.now();
  },
  dispatch: (...args) => harness.dispatchFetch(...args),
  dispose: () => harness.dispose(),
  driver: `(async()=>{
    const report=async value=>fetch('/__acceptance/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
    try {
      const path=location.pathname;
      if(path==='/') {
        if(document.querySelector('h1')?.textContent!=='My Workers app') throw Error('Initial page did not render');
        await report({stage:'startup',documentReadyMs:performance.now()});
        document.querySelector('a').click();
      } else if(path==='/details') {
        const form=document.querySelector('form');
        form.elements.message.value='From the mobile app';
        form.requestSubmit();
      } else if(path==='/saved') {
        if(document.querySelector('output')?.textContent!=='1') throw Error('Mutation did not execute exactly once');
        await report({stage:'complete',navigation:true,form:true,submissions:1});
      } else throw Error('Unexpected page '+path);
    } catch(error) {await report({stage:'failure',message:String(error)});}
  })();`,
});
await runNativeAcceptance({
  backend,
  measurements: (launched) => ({ launchToFirstPageMs: startupAt - launched }),
  artifacts,
  platform,
  device,
  shell: consumer,
  appId: "jp.rdlabo.workerscapacitor.events",
  buildPlugin: workersCapacitorPlugin,
  assetsExecution: null,
  bootstrapDirectory: `${fixture}/bootstrap`,
  forbiddenModuleRoots: [`${root}/src`, `${root}/dist`],
  worker: `${fixture}/worker.mjs`,
  workerConfig: `${fixture}/wrangler.json`,
  validate: async (backend) => {
    assert.ok(
      backend.reports.some(
        (r) => r.stage === "startup" && Number.isFinite(r.documentReadyMs),
      ),
    );
    const mutations = backend.requests.filter(
      (r) => r.path === "/save" && r.method === "POST",
    );
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].status, 303);
    for (const path of ["/", "/details", "/saved"])
      assert.ok(
        backend.requests.some((r) => r.path === path && r.status === 200),
        path,
      );
  },
});
await writeFile(
  `${artifacts}/package.json`,
  JSON.stringify(
    {
      ...evidence,
      packageBytes: (await stat(evidence.tarball)).size,
      workerSha256: createHash("sha256")
        .update(await readFile(`${fixture}/worker.mjs`))
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(`${platform}: ${label} page, link, form and redirect passed`);
