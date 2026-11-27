import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeBackend } from "../../native/backend.mjs";
export const root = fileURLToPath(
  new URL("../../../artifacts/upstream/minvoice/clone/", import.meta.url),
);
export async function startBackend() {
  const compiled = await build({
    entryPoints: [join(root, "src/index.tsx")],
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["node:*", "cloudflare:*"],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire('file:///worker.js');",
    },
    write: false,
  });
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: compiled.outputFiles[0].text,
      compatibilityDate: "2026-06-01",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { ADMIN_PASSWORD: "native-test-only-password" },
      d1Databases: ["DB"],
      assets: {
        directory: join(root, "public"),
        binding: "ASSETS",
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
  await db
    .prepare(
      "UPDATE settings SET setup_complete = 1, business_name = 'Native Acceptance', email_provider = 'disabled', stripe_enabled = 0, paypal_enabled = 0 WHERE id = 1",
    )
    .run();
  const backend = await nativeBackend({
    dispatch: (url, init) => worker.dispatchFetch(url, init),
    driver: await readFile(new URL("driver.js", import.meta.url), "utf8"),
    dispose: () => worker.dispose(),
  });
  return { ...backend, db };
}

export async function verifyDraft(db) {
  const { results: invoices } = await db
    .prepare(
      "SELECT id, status, subtotal_cents, total_cents FROM invoices WHERE subject = 'Native invoice'",
    )
    .all();
  assert.equal(invoices.length, 1);
  const [{ id, ...draft }] = invoices;
  assert.deepEqual(draft, {
    status: "draft",
    subtotal_cents: 2980,
    total_cents: 2980,
  });
  const { results: items } = await db
    .prepare(
      "SELECT description, quantity, unit_price_cents, amount_cents FROM invoice_items WHERE invoice_id = ? ORDER BY position, id",
    )
    .bind(id)
    .all();
  assert.deepEqual(items, [
    {
      description: "Native line item",
      quantity: 2,
      unit_price_cents: 1250,
      amount_cents: 2500,
    },
    {
      description: "設計 & café + 仕上げ",
      quantity: 1.5,
      unit_price_cents: 320,
      amount_cents: 480,
    },
  ]);
}
