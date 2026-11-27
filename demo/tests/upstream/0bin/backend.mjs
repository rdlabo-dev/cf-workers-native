import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeBackend } from "../../native/backend.mjs";
export const root = fileURLToPath(
  new URL("../../../artifacts/upstream/0bin/clone/", import.meta.url),
);
export async function startBackend() {
  const compiled = await build({
    entryPoints: [join(root, "dist/server/index.js")],
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
      compatibilityFlags: ["nodejs_compat"],
      bindings: { CREATE_MODE: "open", TURNSTILE_SITE_KEY: "" },
      ratelimits: {
        CREATE_LIMITER: {
          namespace_id: "5001",
          simple: { limit: 10, period: 60 },
        },
      },
      d1Databases: ["DB"],
      assets: {
        directory: join(root, "dist/client"),
        binding: "ASSETS",
        run_worker_first: [
          "/*",
          "!/assets/*",
          "!/favicon.svg",
          "!/favicon.ico",
          "!/apple-touch-icon.png",
        ],
        routerConfig: { has_user_worker: true },
      },
    }),
  );
  const db = await worker.getD1Database("DB");
  for (const file of (await readdir(join(root, "migrations")))
    .filter((p) => p.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(join(root, "migrations", file), "utf8");
    for (const statement of sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .filter((s) => s.trim()))
      await db.prepare(statement).run();
  }
  const backend = await nativeBackend({
    dispatch: (url, init) => worker.dispatchFetch(url, init),
    driver: await readFile(new URL("driver.js", import.meta.url), "utf8"),
    dispose: () => worker.dispose(),
  });
  return { ...backend, db };
}

export async function verifyPastes(backend, report) {
  const { results } = await backend.db
    .prepare("SELECT id,ciphertext,kind FROM pastes ORDER BY kind")
    .all();
  assert.deepEqual(
    results.map((row) => [row.kind, row.id]),
    [
      ["file", report.fileId],
      ["text", report.id],
    ],
  );
  for (const row of results) {
    const envelope = Buffer.from(row.ciphertext, "base64url");
    assert.equal(envelope[0], 1);
    assert.ok(
      envelope.length > 1 + 12 + 16,
      "Expected IV, encrypted payload and authentication tag",
    );
    assert.ok(
      !envelope.includes(Buffer.from("Capacitor encrypted acceptance")),
    );
    assert.ok(!envelope.includes(Buffer.from("色見本.png")));
  }
}
