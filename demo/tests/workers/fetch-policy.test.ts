import { afterAll, beforeAll, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fetchPolicyFeature } from "../../../src/browser/fetch/policy.spec";
import { createNetworkFixture } from "../fixtures/network/server.mjs";
const server = createNetworkFixture();
let harness: Miniflare;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  const bundle = await build({
    entryPoints: ["tests/fixtures/workers/compatibility/fetch-policy.ts"],
    external: ["brotli-dec-wasm/web/bg.wasm", "node:*", "cloudflare:node"],
    // This fixture bundles implementation sources instead of the prebuilt npm
    // package, so embed the native codec/TLS assets just as the package build does.
    loader: { ".wasm": "binary" },
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
  });
  // Use workerd's own outbound HTTP. Wrangler's harness forwards through
  // Node fetch, which follows redirects and decompresses before workerd sees it.
  harness = new Miniflare({
    workers: [
      {
        config: {
          name: "fetch-policy-compat",
          compatibilityDate: "2026-10-17",
          compatibilityFlags: ["nodejs_compat"],
          manifest: {
            mainModule: "worker.js",
            modules: {
              "brotli-dec-wasm/web/bg.wasm": {
                type: "wasm",
                contents: new Uint8Array(
                  await readFile(
                    new URL(import.meta.resolve("brotli-dec-wasm/web/bg.wasm")),
                  ),
                ),
              },
              "worker.js": {
                type: "esm",
                contents: bundle.outputFiles[0].text,
              },
            },
          },
          env: {
            UPSTREAM: {
              type: "text",
              value: `http://127.0.0.1:${address.port}`,
            },
          },
        },
      },
    ],
  });
  await harness.ready;
});
afterAll(async () => {
  await harness?.dispose();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it.each(fetchPolicyFeature.cases)(
  "compares Workers Fetch %s against a real loopback upstream",
  async (name) => {
    const reports = await (
      await harness.dispatchFetch(`http://localhost/?case=${name}`)
    ).json();
    expect(reports).toEqual({ reference: "passed", candidate: "passed" });
  },
  10000,
);

it.each(["get", "post", "redirect", "cookies", "compression", "abort"])(
  "compares node:http %s against a real upstream",
  async (name) => {
    const reports = await (
      await harness.dispatchFetch(`http://localhost/node-http?case=${name}`)
    ).json();
    expect(reports).toEqual({ reference: "passed", candidate: "passed" });
  },
  10000,
);
