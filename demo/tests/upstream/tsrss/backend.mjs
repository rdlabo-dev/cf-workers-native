import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeBackend } from "../../native/backend.mjs";
export const root = fileURLToPath(
  new URL("../../../artifacts/upstream/tsrss/clone/", import.meta.url),
);
export async function startBackend() {
  const compiled = await build({
    entryPoints: [join(root, "src/index.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire("/worker.js");',
    },
    external: ["node:*", "cloudflare:*"],
    write: false,
  });
  const feedRequests = [];
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: compiled.outputFiles[0].text,
      compatibilityDate: "2026-05-01",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        TSRSS_AUTH_MODE: "password",
        TSRSS_PASSWORD: "acceptance-password",
        TSRSS_PURGE_DAYS: "30",
        TSRSS_VERSION: "acceptance",
      },
      outboundService(request) {
        feedRequests.push({ method: request.method, url: request.url });
        if (
          request.method !== "GET" ||
          request.url !== "https://feeds.example.invalid/design.xml"
        )
          return new Response("Unknown fixture feed", { status: 404 });
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0"><channel><title>設計 &amp; café</title><link>https://feeds.example.invalid/design</link>
            <description>Offline feed</description><item><guid>imported-article</guid><title>日本語の記事</title>
            <link>https://feeds.example.invalid/design/article</link></item></channel></rss>`,
          {
            headers: { "content-type": "application/rss+xml; charset=utf-8" },
          },
        );
      },
      d1Databases: ["DB"],
      kvNamespaces: ["SESSIONS"],
      assets: {
        directory: join(root, "src/public"),
        binding: "ASSETS",
        routerConfig: { has_user_worker: true },
      },
    }),
  );
  try {
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
    await db.prepare("INSERT INTO users (id) VALUES ('anonymous')").run();
    await db
      .prepare(
        "INSERT INTO feeds (id,user_id,url,title) VALUES (1,'anonymous','https://example.com/feed.xml','Acceptance feed')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO articles (id,feed_id,guid,title,content,published_at) VALUES (1,1,'acceptance','Capacitor acceptance article','<p>Full article content</p>',CURRENT_TIMESTAMP)",
      )
      .run();
    const sessions = await worker.getKVNamespace("SESSIONS");
    const backend = await nativeBackend({
      dispatch: (url, init) => worker.dispatchFetch(url, init),
      driver: await readFile(new URL("driver.js", import.meta.url), "utf8"),
      dispose: () => worker.dispose(),
    });
    return { ...backend, db, sessions, feedRequests };
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}
export async function validate(backend, platform) {
  assert.equal(
    backend.reports.find((r) => r.stage === "complete")?.platform,
    platform,
  );
  assert.ok(backend.reports.some((r) => r.stage === "invalid-password"));
  assert.deepEqual(backend.feedRequests, [
    { method: "GET", url: "https://feeds.example.invalid/design.xml" },
  ]);
  const imported = await backend.db
    .prepare(
      "SELECT f.title AS feed, c.title AS category, a.title AS article FROM feeds f JOIN categories c ON c.id = f.category_id JOIN articles a ON a.feed_id = f.id WHERE f.url = ? AND f.user_id = 'anonymous'",
    )
    .bind("https://feeds.example.invalid/design.xml")
    .all();
  assert.deepEqual(imported.results, [
    { feed: "設計 & café", category: "購読 & テスト", article: "日本語の記事" },
  ]);
  const state = await backend.db
    .prepare(
      "SELECT is_read,is_starred FROM article_states WHERE user_id='anonymous' AND article_id=1",
    )
    .first();
  assert.deepEqual(state, { is_read: 1, is_starred: 1 });
  assert.equal(
    (await backend.sessions.list()).keys.length,
    0,
    "Logout must revoke the KV session",
  );
  assert.deepEqual(
    backend.requests
      .filter((r) => r.method === "POST" && r.path === "/login")
      .map((r) => r.status),
    [200, 302],
  );
  assert.ok(
    backend.requests.some((r) => r.path === "/logout" && r.status === 302),
  );
}
