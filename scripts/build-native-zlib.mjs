import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const sdk = resolve(process.env.CODEC_EMSDK ?? "artifacts/toolchains/emsdk");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: sdk,
  encoding: "utf8",
}).trim();
if (revision !== "e4fe26ef59168ff44f4c23c466e497bf60b3411e")
  throw Error("Unexpected emsdk revision");
const binding = "src/compat/zlib/native-zlib.c",
  output = "src/compat/zlib/native-zlib.wasm";
execFileSync(
  join(sdk, "upstream/emscripten/emcc"),
  [
    binding,
    "-O3",
    "-sUSE_ZLIB=1",
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
chmodSync(output, 0o644);
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
writeFileSync(
  "src/compat/zlib/native-zlib.build.json",
  JSON.stringify(
    {
      emsdk: revision,
      zlib: "1.3.1",
      portSha256: hash(join(sdk, "upstream/emscripten/tools/ports/zlib.py")),
      bindingSha256: hash(binding),
      sha256: hash(output),
    },
    null,
    2,
  ) + "\n",
);
