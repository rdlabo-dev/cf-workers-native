import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, join, relative, sep } from "node:path";
import assert from "node:assert/strict";

const checkout = fileURLToPath(new URL("../../../", import.meta.url));
const checkoutDist = resolve(checkout, "dist");
const consumer = process.argv[2];
const dist = consumer
  ? join(consumer, "node_modules/cf-workers-native/dist")
  : checkoutDist;
const { workersCapacitorPlugin } = await import(
  pathToFileURL(join(dist, "tooling/esbuild.js")).href
);
const installedRuntime = {
  name: "network-contract-installed-runtime",
  setup(build) {
    // The probes use private transport APIs and share contract definitions
    // with workerd. Load the implementation from the consumer package.
    build.onResolve(
      { filter: /^(?:\.\.\/)+dist\// },
      ({ path, resolveDir, kind }) =>
        build.resolve(
          join(dist, relative(checkoutDist, resolve(resolveDir, path))),
          { kind, resolveDir: consumer },
        ),
    );
    build.onResolve(
      { filter: /^cf-workers-native\// },
      ({ path, resolveDir, kind }) =>
        resolveDir === consumer
          ? undefined
          : build.resolve(path, { kind, resolveDir: consumer }),
    );
  },
};
const output = new URL("../../artifacts/native-network/", import.meta.url);
await mkdir(output, { recursive: true });
const result = await build({
  entryPoints: ["main", "worker"].map((name) =>
    fileURLToPath(new URL(`../native/network/${name}.ts`, import.meta.url)),
  ),
  outdir: fileURLToPath(output),
  bundle: true,
  metafile: Boolean(consumer),
  define: {
    __NETWORK_TLS__: process.env.NETWORK_TLS === "1" ? "true" : "false",
  },
  plugins: [
    ...(consumer ? [installedRuntime] : []),
    workersCapacitorPlugin({
      execution: "local",
      worker: fileURLToPath(
        new URL("../../src/workers/hono/standard.ts", import.meta.url),
      ),
    }),
  ],
  loader: { ".wasm": "binary" },
  format: "esm",
  target: "es2022",
});
if (consumer) {
  const inputs = Object.keys(result.metafile.inputs).map((path) =>
    resolve(path),
  );
  assert.ok(
    inputs.some((path) => path.startsWith(dist + sep)),
    "Installed runtime is missing from the native network bundle",
  );
  assert.ok(
    !inputs.some(
      (path) =>
        path.startsWith(checkoutDist + sep) ||
        (path.startsWith(join(checkout, "src") + sep) &&
          !path.endsWith(".spec.ts")),
    ),
    "Checkout runtime entered the packaged network bundle",
  );
}
await writeFile(
  new URL("index.html", output),
  '<!doctype html><meta charset="utf-8"><title>Native network contract</title><body><pre>Running native network contract</pre><script type="module" src="./main.js"></script>',
);
