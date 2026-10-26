import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { format, resolveConfig } from "prettier";
const source = resolve("artifacts/upstream/boringssl"),
  sdk = resolve(process.env.CODEC_EMSDK ?? "artifacts/toolchains/emsdk"),
  build = resolve("artifacts/upstream/boringssl-build");
const revision = (directory) =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
const revisions = { emsdk: revision(sdk), boringssl: revision(source) };
assert.equal(revisions.emsdk, "e4fe26ef59168ff44f4c23c466e497bf60b3411e");
assert.equal(revisions.boringssl, "427ec40cc8edc545253289232e885708c409e5ea");
assert.equal(
  execFileSync("git", ["diff", "HEAD", "--name-only"], {
    cwd: source,
    encoding: "utf8",
  }).trim(),
  "",
);
const compiler = join(sdk, "upstream/emscripten");
assert.equal(
  execFileSync("git", ["diff", "HEAD", "--name-only"], {
    cwd: sdk,
    encoding: "utf8",
  }).trim(),
  "",
);
const emccVersion = execFileSync(join(compiler, "emcc"), ["--version"], {
  encoding: "utf8",
}).split("\n")[0];
assert.equal(
  emccVersion,
  "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 4.0.20 (6913738ec5371a88c4af5a80db0ab42bad3de681)",
);

const cmake = resolve("artifacts/toolchains/boringssl-build/bin/cmake"),
  ninja = resolve("artifacts/toolchains/boringssl-build/bin/ninja");
const definitions =
  "-DOPENSSL_NO_THREADS_CORRUPT_MEMORY_AND_LEAK_SECRETS_IF_THREADED -DOPENSSL_NO_FILESYSTEM -DOPENSSL_NO_POSIX_IO -DOPENSSL_NO_SOCK";
const configure = [
  "-S",
  source,
  "-B",
  build,
  "-G",
  "Ninja",
  "-DCMAKE_MAKE_PROGRAM=" + ninja,
  "-DCMAKE_TOOLCHAIN_FILE=" +
    join(compiler, "cmake/Modules/Platform/Emscripten.cmake"),
  "-DCMAKE_BUILD_TYPE=Release",
  "-DBUILD_TESTING=OFF",
  "-DOPENSSL_NO_ASM=1",
  "-DCMAKE_C_FLAGS=" + definitions,
  "-DCMAKE_CXX_FLAGS=" + definitions,
];
if (!process.argv.includes("--link-only")) {
  assert.match(
    execFileSync(cmake, ["--version"], { encoding: "utf8" }),
    /^cmake version 4\.2\.0\b/,
  );
  assert.equal(
    execFileSync(ninja, ["--version"], { encoding: "utf8" }).trim(),
    "1.13.0",
  );
  execFileSync(cmake, configure, { stdio: "inherit" });
  execFileSync(
    cmake,
    ["--build", build, "--target", "crypto", "decrepit", "-j4"],
    { stdio: "inherit" },
  );
}
const binding = "src/compat/crypto/native-cipher.c",
  output = "src/compat/crypto/native-cipher.wasm";
const flags = [
  "-O3",
  "-sSTANDALONE_WASM=1",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sFILESYSTEM=0",
  "-sASSERTIONS=0",
  "-sMALLOC=emmalloc",
  "-sABORTING_MALLOC=0",
  "--no-entry",
  '-sEXPORTED_FUNCTIONS=["_malloc","_free"]',
];
const libraries = ["libdecrepit.a", "libcrypto.a"];
execFileSync(
  join(compiler, "emcc"),
  [
    binding,
    "-I" + join(source, "include"),
    ...libraries.map((n) => join(build, n)),
    ...flags,
    "-o",
    output,
  ],
  { stdio: "inherit" },
);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const manifest = "src/compat/crypto/native-cipher.build.json";
writeFileSync(
  manifest,
  await format(
    JSON.stringify({
      revisions,
      toolVersions: { cmake: "4.2.0", ninja: "1.13.0", emcc: emccVersion },
      definitions,
      flags,
      libraries,
      bindingSha256: sha(binding),
      sha256: sha(output),
    }),
    { ...(await resolveConfig(manifest)), filepath: manifest },
  ),
);
