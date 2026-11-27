import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeBackend } from "../../native/backend.mjs";
export const root = fileURLToPath(
  new URL("../../../artifacts/upstream/inkstone/clone/", import.meta.url),
);
export async function startBackend() {
  const compiled = await build({
    entryPoints: [join(root, "dist/inkstone/index.js")],
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["node:*", "cloudflare:*"],
    write: false,
  });
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: compiled.outputFiles[0].text,
      compatibilityDate: "2026-08-22",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
      bindings: { APP_NAME: "Inkstone" },
      d1Databases: ["DB"],
      kvNamespaces: ["OAUTH_KV"],
      r2Buckets: ["FILES"],
      durableObjects: {
        SYNC_HUB: { className: "SyncHub", useSQLite: true },
        CREDENTIAL_VAULT: { className: "CredentialVault", useSQLite: true },
      },
      assets: {
        directory: join(root, "dist/client"),
        binding: "ASSETS",
        run_worker_first: true,
        routerConfig: { has_user_worker: true },
      },
    }),
  );
  const db = await worker.getD1Database("DB");
  const backend = await nativeBackend({
    dispatch: (url, init) => worker.dispatchFetch(url, init),
    driver: await readFile(new URL("driver.js", import.meta.url), "utf8"),
    dispose: () => worker.dispose(),
  });
  return { ...backend, db };
}

export async function verifySavedNote(db) {
  const result = await db
    .prepare("SELECT title, content FROM notes WHERE title=?")
    .bind("Capacitor acceptance note")
    .all();
  assert.deepEqual(result.results, [
    {
      title: "Capacitor acceptance note",
      content: "買い物メモ 📝 — café と牛乳",
    },
  ]);
}
