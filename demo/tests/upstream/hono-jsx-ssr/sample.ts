import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const metadata = JSON.parse(
  readFileSync(new URL("./upstream.json", import.meta.url), "utf8"),
) as {
  commit: string;
  subdirectory: string;
  entry: string;
  compatibilityDate: string;
  dependencies: { hono: string };
};
const clone = fileURLToPath(
  new URL("../../../artifacts/upstream/hono-jsx-ssr/clone/", import.meta.url),
);
// Tests and builds must use the pinned, untouched source, including when run
// separately from prepare. Missing clones fail here instead of being skipped.
assert.equal(
  execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  metadata.commit,
  "Run test:upstream:prepare -- hono-jsx-ssr --clone-only",
);
assert.equal(
  execFileSync("git", ["-C", clone, "status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  "",
  "Upstream clone must be unchanged",
);
const hono = JSON.parse(
  readFileSync(
    new URL("../../../node_modules/hono/package.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(
  hono.version,
  metadata.dependencies.hono,
  "Update the sample pin and demo dependency together",
);
export const workerEntry = join(clone, metadata.subdirectory, metadata.entry);
