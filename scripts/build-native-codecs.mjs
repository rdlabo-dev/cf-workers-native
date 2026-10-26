import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
// One-time/reproducibility build. Normal npm builds embed the checked-in Wasm
// and do not download a compiler or compile native sources.
const sdk = resolve(process.env.CODEC_EMSDK ?? "artifacts/toolchains/emsdk");
const zstd = resolve("artifacts/upstream/zstd");
const brotli = resolve("artifacts/upstream/brotli");
const revision = (path) =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path,
    encoding: "utf8",
  }).trim();
const expected = {
  emsdk: "e4fe26ef59168ff44f4c23c466e497bf60b3411e",
  zstd: "f8745da6ff1ad1e7bab384bd1f9d742439278e99",
  brotli: "ed738e842d2fbdf2d6459e39267a633c4a9b2f5d",
};
const revisions = {
  emsdk: revision(sdk),
  zstd: revision(zstd),
  brotli: revision(brotli),
};
for (const name of Object.keys(expected))
  if (revisions[name] !== expected[name])
    throw new Error(`Unexpected ${name} revision: ${revisions[name]}`);
const sources = [
  ...["common", "compress", "decompress"].flatMap((dir) =>
    readdirSync(join(zstd, "lib", dir))
      .filter((n) => n.endsWith(".c"))
      .sort()
      .map((n) => join(zstd, "lib", dir, n)),
  ),
  ...["common", "enc", "dec"].flatMap((dir) =>
    readdirSync(join(brotli, "c", dir))
      .filter((n) => n.endsWith(".c"))
      .sort()
      .map((n) => join(brotli, "c", dir, n)),
  ),
];
const output = "src/compat/zlib/native-codecs.wasm";
execFileSync(
  join(sdk, "upstream/emscripten/emcc"),
  [
    "src/compat/zlib/native-codecs.c",
    ...sources,
    "-I" + join(zstd, "lib"),
    "-I" + join(brotli, "c/include"),
    "-O3",
    "-DNDEBUG",
    "-DZSTD_DISABLE_ASM",
    "-DBROTLI_BUILD_PORTABLE",
    "-sSTANDALONE_WASM=1",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sFILESYSTEM=0",
    "-sASSERTIONS=0",
    "-sMALLOC=emmalloc",
    "-sABORTING_MALLOC=0",
    "--no-entry",
    '-sEXPORTED_FUNCTIONS=["_malloc","_free"]',
    "-o",
    output,
  ],
  { stdio: "inherit" },
);
writeFileSync(
  "src/compat/zlib/native-codecs.build.json",
  JSON.stringify(
    {
      revisions,
      bindingSha256: createHash("sha256")
        .update(readFileSync("src/compat/zlib/native-codecs.c"))
        .digest("hex"),
      sha256: createHash("sha256").update(readFileSync(output)).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
