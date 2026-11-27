import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeBackend } from "../../native/backend.mjs";
export const root = fileURLToPath(
  new URL("../../../artifacts/upstream/flaredrive/", import.meta.url),
);
export async function startBackend() {
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: join(root, "worker/index.js"),
      compatibilityDate: "2026-08-22",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        WEBDAV_USERNAME: "acceptance",
        WEBDAV_PASSWORD: "test-password",
        WEBDAV_PUBLIC_READ: "1",
      },
      r2Buckets: ["BUCKET"],
      assets: {
        directory: join(root, "clone/build"),
        binding: "ASSETS",
        routerConfig: { has_user_worker: true },
      },
    }),
  );
  const bucket = await worker.getR2Bucket("BUCKET");
  await bucket.put("seed.txt", "Seed file", {
    httpMetadata: { contentType: "text/plain" },
  });
  const backend = await nativeBackend({
    dispatch: (url, init) => worker.dispatchFetch(url, init),
    driver: await readFile(new URL("driver.js", import.meta.url), "utf8"),
    dispose: () => worker.dispose(),
  });
  return { ...backend, bucket };
}

export async function verifyStoredFiles(bucket) {
  assert.equal(
    await (await bucket.get("accepted.txt")).text(),
    "Capacitor WebDAV acceptance",
  );
  assert.equal(await bucket.get("denied.txt"), null);
  const stored = await bucket.get("契約書 01.bin");
  assert.ok(stored, "Missing uploaded binary");
  assert.equal(stored.size, 256 * 1024 + 17);
  assert.equal(stored.httpMetadata.contentType, "application/octet-stream");
  const bytes = new Uint8Array(await stored.arrayBuffer());
  assert.equal(bytes.length, stored.size);
  assert.ok(
    bytes.every((byte, i) => byte === (i * 31 + Math.floor(i / 256)) % 251),
    "Unexpected R2 object content",
  );
}
