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
    dispatch: async (url, init) => {
      const response = await worker.dispatchFetch(url, init);
      const match = /^\/api\/pastes\/([a-zA-Z0-9_-]{12})$/.exec(
        new URL(url).pathname,
      );
      if (init.method === "GET" && response.ok && match) {
        const stored = await db
          .prepare("SELECT ciphertext FROM pastes WHERE id=?")
          .bind(match[1])
          .first("ciphertext");
        const returned = await response.clone().json();
        assert.ok(
          stored && stored === returned.ciphertext,
          "Expected the ciphertext served to the UI to match D1",
        );
      }
      return response;
    },
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
  const reads = backend.requests.filter(
    (request) =>
      request.method === "GET" &&
      request.path === "/api/pastes/" + report.fileId,
  );
  assert.ok(
    reads.length >= 3,
    "Expected the original, incorrect-key and restored-key reads",
  );
  assert.ok(
    reads.every((request) => request.status === 200),
    "The owner must still be able to retrieve ciphertext with each fragment",
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
    if (row.kind === "file") {
      // Either prefix would expose the uploaded PNG in raw or base64 form.
      const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      assert.ok(!envelope.includes(signature));
      assert.ok(!envelope.includes(Buffer.from("iVBORw0KGgo")));
    }
  }
}
