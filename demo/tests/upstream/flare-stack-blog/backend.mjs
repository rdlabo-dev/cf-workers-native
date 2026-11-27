import { unstable_splitSqlQuery } from "wrangler";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeBackend } from "../../native/backend.mjs";
export const root = fileURLToPath(
  new URL(
    "../../../artifacts/upstream/flare-stack-blog/clone/",
    import.meta.url,
  ),
);
export async function startWorker(authOrigin = "https://worker.invalid") {
  const compiled = await build({
    entryPoints: [
      join(root, ".cloudflare/output/v0/workers/default/bundle/index.js"),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire("/worker.js");',
    },
    external: ["node:*", "cloudflare:*"],
    loader: { ".css": "text" },
    write: false,
  });
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: compiled.outputFiles[0].text,
      compatibilityDate: "2026-02-17",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
      bindings: {
        BETTER_AUTH_SECRET: "local-acceptance-secret-at-least-32-characters",
        BETTER_AUTH_URL: authOrigin,
        DOMAIN: "worker.invalid",
        LOCALE: "en",
        GITHUB_CLIENT_ID: "unused",
        GITHUB_CLIENT_SECRET: "unused",
        ENVIRONMENT: "test",
      },
      d1Databases: ["DB"],
      r2Buckets: ["R2"],
      kvNamespaces: ["KV"],
      queueProducers: { QUEUE: "acceptance-queue" },
      durableObjects: {
        RateLimiter: { className: "RateLimiter", useSQLite: true },
        PostPublisher: { className: "PostPublisher", useSQLite: true },
      },
      assets: {
        directory: join(root, ".cloudflare/output/v0/workers/default/assets"),
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
      for (const statement of unstable_splitSqlQuery(sql))
        await db.prepare(statement).run();
    }
    return { worker, db };
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}
export async function startBackend() {
  const { worker, db } = await startWorker();
  try {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Native blog article body" }],
        },
      ],
    };
    const snapshot = {
      title: "Capacitor acceptance story",
      summary: "A test article",
      slug: "acceptance",
      contentJson: content,
      tagIds: [],
      publishedAt: new Date().toISOString(),
      pinnedAt: null,
    };
    await db
      .prepare(
        "INSERT INTO posts (title,slug,status,published_at,content_json,public_slug,public_snapshot_json) VALUES (?,?,'published',unixepoch(),?,?,?)",
      )
      .bind(
        snapshot.title,
        snapshot.slug,
        JSON.stringify(content),
        snapshot.slug,
        JSON.stringify(snapshot),
      )
      .run();
    const backend = await nativeBackend({
      dispatch: (url, init) => worker.dispatchFetch(url, init),
      driver: await readFile(new URL("driver.js", import.meta.url), "utf8"),
      dispose: () => worker.dispose(),
    });
    return { ...backend, db };
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}
