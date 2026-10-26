import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const [platform, device, count = "3"] = process.argv.slice(2);
assert.ok(
  ["ios", "android"].includes(platform) &&
    device &&
    /^\d+$/.test(count) &&
    Number(count) >= 3 &&
    Number(count) <= 20,
  "Usage: benchmark.mjs ios|android <device> [3..20 samples]",
);
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const evidence = JSON.parse(
  await readFile(
    `${root}/demo/artifacts/node-inventory/events-consumer.json`,
    "utf8",
  ),
);
const label =
  evidence.source === "npm"
    ? `published-${evidence.version}`
    : `candidate-${evidence.tarballSha256.slice(0, 12)}`;
const artifacts = `${root}/artifacts/validation/${label}/onboarding/${platform}`;
await mkdir(artifacts, { recursive: true });
const samples = [];
for (let n = 0; n < Number(count); n++) {
  const run = `sample-${n + 1}`;
  console.log(`${platform}: process-cold launch sample ${n + 1}/${count}`);
  const { stdout, stderr } = await exec(
    process.execPath,
    [fileURLToPath(new URL("native.mjs", import.meta.url)), platform, device],
    {
      cwd: root,
      env: { ...process.env, ACCEPTANCE_RUN: run },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  await writeFile(`${artifacts}/${run}/build.log`, stdout + "\n" + stderr);
  samples.push(
    JSON.parse(
      await readFile(`${artifacts}/${run}/${platform}-summary.json`, "utf8"),
    ),
  );
}
const stats = (key) => {
  const values = samples.map((s) => s[key]).sort((a, b) => a - b);
  assert.ok(
    values.every((value) => Number.isFinite(value) && value >= 0),
    `Missing or invalid ${key} measurement`,
  );
  const middle = Math.floor(values.length / 2);
  return {
    min: values[0],
    median:
      values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2,
    max: values.at(-1),
  };
};
const report = {
  platform,
  device,
  source: evidence.source,
  tarballSha256: evidence.tarballSha256,
  samples,
  launchToFirstPageMs: stats("launchToFirstPageMs"),
  elapsedFlowMs: stats("elapsedFlowMs"),
  limits:
    "Application data cleared and process relaunched for each sample. Native build, installation and server startup excluded. OS/compiler caches are not reset. Local HTTPS backend, no production network. Not a platform performance comparison or p95 estimate.",
};
await writeFile(
  `${artifacts}/benchmark.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
