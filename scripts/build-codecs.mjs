import { build } from "esbuild";
import { readFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Fail before packaging if a generated implementation and its provenance drift.
for (const [asset, manifest] of [
  [
    "src/compat/zlib/native-zlib.wasm",
    "src/compat/zlib/native-zlib.build.json",
  ],
  [
    "src/compat/crypto/native-cipher.wasm",
    "src/compat/crypto/native-cipher.build.json",
  ],
  [
    "src/compat/crypto/native-crypto.wasm",
    "src/compat/crypto/native-crypto.build.json",
  ],
  [
    "src/compat/zlib/native-codecs.wasm",
    "src/compat/zlib/native-codecs.build.json",
  ],
  [
    "src/compat/stream-web/workers-ponyfill.js",
    "src/compat/stream-web/workers-ponyfill.build.json",
  ],
]) {
  const provenance = JSON.parse(await readFile(manifest, "utf8"));
  const expected = provenance.sha256;
  if (provenance.bindingSha256) {
    const binding = asset.replace(/\.wasm$/, ".c");
    if (
      createHash("sha256")
        .update(await readFile(binding))
        .digest("hex") !== provenance.bindingSha256
    )
      throw new Error(`Native binding changed without rebuilding: ${binding}`);
  }
  const actual = createHash("sha256")
    .update(await readFile(asset))
    .digest("hex");
  if (actual !== expected)
    throw new Error(`Generated artifact hash mismatch: ${asset}`);
}
// The package owns its codec asset. Consumers need no WASM loader or extra URL.
await build({
  entryPoints: ["src/shared/brotli/index.ts"],
  outfile: "dist/shared/brotli/index.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  loader: { ".wasm": "binary" },
});

// Web Streams must also be loadable by the raw browser-ESM entry.
await build({
  entryPoints: ["src/compat/stream-web/ponyfill.ts"],
  outfile: "dist/compat/stream-web/ponyfill.js",
  bundle: true,
  format: "esm",
  target: "es2022",
});

await build({
  entryPoints: ["src/compat/zlib/native-codecs.ts"],
  outfile: "dist/compat/zlib/native-codecs.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  loader: { ".wasm": "binary" },
});

await build({
  entryPoints: ["src/compat/crypto/native-crypto.ts"],
  outfile: "dist/compat/crypto/native-crypto.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  loader: { ".wasm": "binary" },
});

await build({
  entryPoints: ["src/compat/zlib/native-zlib.ts"],
  outfile: "dist/compat/zlib/native-zlib.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  loader: { ".wasm": "binary" },
});

await copyFile(
  "src/compat/zlib/classic-base.d.cts",
  "dist/compat/zlib/classic-base.d.cts",
);

await build({
  entryPoints: ["src/compat/crypto/native-cipher.ts"],
  outfile: "dist/compat/crypto/native-cipher.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  loader: { ".wasm": "binary" },
});
