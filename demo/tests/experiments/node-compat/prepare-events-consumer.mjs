import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const output = new URL("../../../artifacts/node-inventory/", import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(join(root, "artifacts/npm"), { recursive: true });
const packed = await mkdtemp(join(root, "artifacts/npm/events-"));
const version = process.env.CONSUMER_VERSION;
assert.ok(
  !version || /^\d+\.\d+\.\d+$/.test(version),
  "CONSUMER_VERSION must be an exact release version",
);
const registry = "https://registry.npmjs.org";
const published = version
  ? JSON.parse(
      execFileSync(
        "npm",
        [
          "view",
          `cf-workers-native@${version}`,
          "--json",
          `--registry=${registry}`,
          "--prefer-online",
        ],
        { encoding: "utf8" },
      ),
    )
  : undefined;
if (published) assert.equal(published.version, version);
execFileSync(
  "npm",
  [
    "pack",
    ...(version
      ? [
          `cf-workers-native@${version}`,
          "--ignore-scripts",
          `--registry=${registry}`,
        ]
      : []),
    "--pack-destination",
    packed,
  ],
  {
    cwd: root,
    stdio: "inherit",
  },
);
const archives = (await readdir(packed)).filter((name) =>
  name.endsWith(".tgz"),
);
assert.equal(archives.length, 1);
const tarball = join(packed, archives[0]);
if (published)
  assert.equal(
    published.dist.integrity,
    "sha512-" +
      createHash("sha512")
        .update(await readFile(tarball))
        .digest("base64"),
  );
const tarballSha256 = createHash("sha256")
  .update(await readFile(tarball))
  .digest("hex");
// A real installed package prevents Xcode recursively traversing the checkout
// through a local npm link and also tests the distributable's runtime files.
const consumer = await mkdtemp(join(tmpdir(), "cf-events-consumer-"));
const dependencies = { "cf-workers-native": "file:" + tarball };
for (const name of [
  "@capacitor/core",
  "@capacitor/ios",
  "@capacitor/android",
  "@capacitor/cli",
  "typescript",
]) {
  dependencies[name] = JSON.parse(
    await readFile(
      join(root, "demo/node_modules", name, "package.json"),
      "utf8",
    ),
  ).version;
}
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify(
    { name: "events-acceptance", private: true, type: "module", dependencies },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(consumer, "capacitor.config.ts"),
  'export default {appId:"jp.rdlabo.workerscapacitor.events",appName:"Events acceptance",webDir:"www"};\n',
);
await mkdir(join(consumer, "www"));
await writeFile(
  join(consumer, "www/index.html"),
  "<!doctype html><title>Events acceptance</title>",
);
execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
  cwd: consumer,
  stdio: "inherit",
});
await writeFile(
  new URL("events-consumer.json", output),
  JSON.stringify(
    {
      consumer,
      tarball,
      tarballSha256,
      ...(published
        ? {
            source: "npm",
            version,
            registry,
            integrity: published.dist.integrity,
          }
        : { source: "checkout" }),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Prepared independent events consumer: ${consumer}`);
