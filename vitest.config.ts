import { transform as transformFixture } from "esbuild";
import { lowerAsync } from "./src/tooling/async.js";
import { readFile } from "node:fs/promises";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    {
      name: "test-upstream-resource-management",
      enforce: "pre",
      async transform(code, id) {
        if (
          !id.includes("/compat/fs/upstream-") ||
          !id.endsWith(".fixture.mjs")
        )
          return;
        // Lower await-using before the request-context async transform, as the
        // production ES2022 build does. Keep upstream disposal assertions intact.
        return (
          await transformFixture(code, {
            loader: "js",
            target: "es2022",
            format: "esm",
          })
        ).code;
      },
    },
    {
      name: "test-async-context",
      enforce: "post",
      transform(code, id) {
        if (/\.[cm]?[jt]sx?$/.test(id)) return lowerAsync(code, id);
      },
    },
    {
      name: "test-wasm-binary",
      async load(id) {
        if (
          !/\/(?:brotli_dec_wasm_bg|native-crypto|native-cipher|native-zlib)\.wasm$/.test(
            id,
          )
        )
          return;
        const data = (await readFile(id)).toString("base64");
        return `export default Uint8Array.from(atob(${JSON.stringify(data)}), c => c.charCodeAt(0));`;
      },
    },
  ],
  test: {
    setupFiles: ["tests/setup/node-host.ts"],
    server: { deps: { inline: [/brotli-dec-wasm/] } },
    // Node module contract specs run via demo tests in workerd and WebViews.
    include: [
      "tests/unit/**/*.test.ts",
      "src/cloudflare/apis/cloudflare-node/index.spec.ts",
      "src/shared/globals/index.spec.ts",
      "src/shared/request-context.spec.ts",
      "src/shared/globals/web.spec.ts",
      "src/browser/abort/installation.spec.ts",
      "src/compat/buffer/installation.spec.ts",
      "src/compat/timers/installation.spec.ts",
      "src/compat/url/installation.spec.ts",
      "src/compat/url/interop.spec.ts",
      "src/compat/timers/host.spec.ts",
      "src/compat/async-hooks/callbacks.spec.ts",
      "src/browser/response/installation.spec.ts",
      "src/compat/perf-hooks/installation.spec.ts",
      "src/compat/stream-web/installation.spec.ts",
      "src/compat/stream-web/context.spec.ts",
      "src/compat/stream-web/interop.spec.ts",
      "src/shared/brotli/index.spec.ts",
      "src/browser/fetch/index.spec.ts",
      "src/browser/fetch/interop.spec.ts",
      "src/browser/fetch/native-network.spec.ts",
      "src/browser/fetch/scope.spec.ts",
      "src/compat/net/sockets.spec.ts",
      "src/compat/tls/upgrade.spec.ts",
      "src/compat/crypto/kdf-limits.spec.ts",
      "src/compat/crypto/random.spec.ts",
      "src/compat/crypto/dh.spec.ts",
      "src/compat/crypto/cipher.spec.ts",
      "src/compat/crypto/hash.spec.ts",
      "src/compat/crypto/hash-types.spec.ts",
      "src/compat/crypto/signatures.spec.ts",
      "src/compat/crypto/keys.spec.ts",
      "src/compat/crypto/subtle-digest.spec.ts",
      "src/compat/crypto/kdf-input.spec.ts",
      "src/shared/buffer-source.spec.ts",
      "src/compat/zlib/input.spec.ts",
      "src/compat/crypto/digest-stream.spec.ts",
      "src/compat/fs/writable.spec.ts",
      "src/compat/fs/file-handle.spec.ts",
      "src/compat/fs/glob.spec.ts",
      "src/compat/fs/directory.spec.ts",
      "src/shared/http-wire/index.spec.ts",
      "src/browser/websocket/frames.spec.ts",
      "src/browser/websocket/native.spec.ts",
      "src/browser/websocket/endpoint.spec.ts",
      "src/browser/websocket/attachment-size.spec.ts",
      "src/browser/websocket/compression.spec.ts",
    ],
  },
});
