import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeBackend } from "../../native/backend.mjs";
export const root = fileURLToPath(
  new URL("../../../artifacts/upstream/sink/clone/", import.meta.url),
);
const landing = "/__acceptance/landing?label=caf%C3%A9#saved";

export async function startBackend() {
  const compiled = await build({
    entryPoints: [join(root, ".output/server/index.mjs")],
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
      bindings: { NUXT_SITE_TOKEN: "native-sink-test-token" },
      d1Databases: ["DB"],
      kvNamespaces: ["KV"],
      r2Buckets: ["R2"],
      assets: {
        directory: join(root, ".output/public"),
        binding: "ASSETS",
        routerConfig: { has_user_worker: true },
      },
    }),
  );
  const db = await worker.getD1Database("DB");
  for (const file of (await readdir(join(root, "drizzle")))
    .filter((p) => p.endsWith(".sql"))
    .sort())
    for (const sql of (await readFile(join(root, "drizzle", file), "utf8"))
      .split("--> statement-breakpoint")
      .filter((s) => s.trim()))
      await db.prepare(sql.trim().replace(/;\s*$/, "")).run();
  const backend = await nativeBackend({
    dispatch: async (url, init) => {
      const path = new URL(url);
      if (path.pathname === "/__acceptance/destination")
        return Response.json(new URL(landing, path.origin).href);
      if (path.pathname === "/__acceptance/landing")
        return new Response(
          "<html><body><h1>Short link destination</h1></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      const response = await worker.dispatchFetch(url, init);
      if (path.pathname === "/capacitor-acceptance") {
        const location = response.headers.get("location");
        const expected = new URL(landing, path.origin).href;
        if (response.status !== 301 || location !== expected) {
          backend.reports.push({
            stage: "failure",
            error: "Unexpected Sink redirect",
            status: response.status,
            location,
            expectedLocation: expected,
          });
          return new Response("Unexpected Sink redirect", { status: 500 });
        }
      }
      return response;
    },
    driver: await readFile(new URL("driver.js", import.meta.url), "utf8"),
    dispose: () => worker.dispose(),
  });
  return { ...backend, db };
}

export async function verifyLink(backend) {
  const row = await backend.db
    .prepare("SELECT url FROM links WHERE slug = ?")
    .bind("capacitor-acceptance")
    .first();
  assert.equal(row?.url, new URL(landing, backend.url).href);
  assert.deepEqual(
    backend.requests
      .filter((request) => {
        const pathname = new URL(request.path, backend.url).pathname;
        return (
          pathname === "/capacitor-acceptance" ||
          pathname === "/__acceptance/landing"
        );
      })
      .map((r) => [r.method, r.path, r.status]),
    [
      ["GET", "/capacitor-acceptance", 301],
      ["GET", "/__acceptance/landing?label=caf%C3%A9", 200],
    ],
  );
}
