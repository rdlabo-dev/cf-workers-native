import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { nativeBackend } from "../../native/backend.mjs";
import { runNativeAcceptance } from "../../native/acceptance.mjs";
import { root, startWorker } from "./backend.mjs";

async function seedUser(db) {
  const { hashPassword } = await import(
    createRequire(join(root, "package.json")).resolve("better-auth/crypto")
  );
  await db
    .prepare(
      "INSERT INTO user(id,name,email,email_verified,updated_at) VALUES ('reader','Reader','reader@example.com',1,0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES ('credential','reader','credential','reader',?,0)",
    )
    .bind(await hashPassword("local-fixture-password"))
    .run();
}
async function sessionFixture(expireOnStop = false) {
  let worker;
  let authenticatedHeaders;
  let relaunch = false;
  const driver = await build({
    stdin: {
      contents: await readFile(
        new URL("session-driver.js", import.meta.url),
        "utf8",
      ),
      resolveDir: root,
    },
    bundle: true,
    format: "iife",
    write: false,
  });
  const backend = await nativeBackend({
    driver: driver.outputFiles[0].text,
    dispose: async () => worker?.dispose(),
    dispatch: async (url, init) => {
      const { pathname, origin } = new URL(url);
      if (!pathname.startsWith("/session-test")) {
        const response = await worker.dispatchFetch(url, init);
        // Only expose the anonymous, read-only CORS control in this fixture.
        if (
          init.method === "GET" &&
          pathname === "/api/auth/get-session" &&
          new URL(url).searchParams.get("cors") === "allow" &&
          ["capacitor://localhost", "https://localhost"].includes(
            init.headers.origin,
          ) &&
          !init.headers.cookie &&
          !init.headers.authorization
        ) {
          const headers = new Headers(response.headers);
          headers.set("access-control-allow-origin", init.headers.origin);
          headers.set("access-control-allow-credentials", "true");
          headers.append("vary", "Origin");
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        }
        return response;
      }
      let heading = "Sign in";
      if (pathname === "/session-test/account") {
        const response = await worker.dispatchFetch(
          new URL("/api/auth/get-session?disableCookieCache=true", url).href,
          { headers: init.headers },
        );
        const session = await response.json();
        if (session?.user?.email !== "reader@example.com")
          return new Response(null, { status: 401 });
        authenticatedHeaders = { cookie: init.headers.cookie };
        heading = "reader@example.com";
      }
      return new Response(
        `<html><body data-auth-origin="${origin}" data-relaunch="${relaunch}" data-expiry-scenario="${expireOnStop}"><h1>${heading}</h1></body></html>`,
        {
          headers: { "content-type": "text/html", "cache-control": "no-store" },
        },
      );
    },
  });
  try {
    const initialized = await startWorker(backend.url.origin);
    worker = initialized.worker;
    await seedUser(initialized.db);
    return {
      ...backend,
      db: initialized.db,
      async afterStop() {
        if (expireOnStop) {
          const result = await initialized.db
            .prepare("UPDATE session SET expires_at=1 WHERE user_id='reader'")
            .run();
          assert.equal(result.meta.changes, 1);
        }
        relaunch = true;
      },
      async checkRevocation() {
        assert.ok(
          authenticatedHeaders?.cookie,
          "Expected the signed-in test session",
        );
        const response = await worker.dispatchFetch(
          new URL("/api/auth/get-session?disableCookieCache=true", backend.url)
            .href,
          { headers: authenticatedHeaders },
        );
        assert.equal(response.status, 200);
        assert.equal(await response.json(), null);
      },
    };
  } catch (error) {
    await backend.close();
    throw error;
  }
}
test(
  "configured Better Auth native session survives reload and process restart, then is revoked on logout",
  { timeout: 600000 },
  async () => {
    const backend = await sessionFixture();
    await runNativeAcceptance({
      backend,
      worker: join(
        root,
        ".cloudflare/output/v0/workers/default/bundle/index.js",
      ),
      workerConfig: fileURLToPath(new URL("worker.jsonc", import.meta.url)),
      kvExecution: { KV: "remote" },
      render: "/session-test",
      restart: { stage: "ready-for-restart", afterStop: backend.afterStop },
      artifacts: join(root, "../session-native"),
      validate: async (backend, platform) => {
        assert.equal(
          backend.reports.find((r) => r.stage === "complete").platform,
          platform,
        );
        assert.equal(
          backend.reports.find((r) => r.stage === "cors-diagnostic-error")
            ?.error,
          undefined,
        );
        assert.ok(
          backend.reports.some(
            (r) => r.stage === "cors-control" && r.platform === platform,
          ),
        );
        for (const variant of ["omit", "allow"]) {
          const record = backend.requests.find(
            (r) => r.path === "/api/auth/get-session?cors=" + variant,
          );
          assert.equal(record?.status, 200);
          assert.equal(
            record.origin,
            platform === "ios" ? "capacitor://localhost" : "https://localhost",
          );
        }
        assert.deepEqual(
          backend.requests
            .filter((r) => r.path === "/session-test/account")
            .map((r) => r.status),
          [200, 200, 200, 401],
        );
        for (const path of ["/api/auth/sign-in/email", "/api/auth/sign-out"]) {
          const posts = backend.requests.filter(
            (r) => r.path === path && r.method === "POST",
          );
          assert.equal(posts.length, 1);
          assert.equal(posts[0].origin, backend.url.origin);
          assert.equal(posts[0].status, 200);
        }
        await backend.checkRevocation();
        assert.equal(
          await backend.db
            .prepare("SELECT count(*) AS n FROM session WHERE user_id='reader'")
            .first("n"),
          0,
        );
      },
    });
  },
);

test(
  "an expired Better Auth session denies access after native process restart",
  { timeout: 600000 },
  async () => {
    const backend = await sessionFixture(true);
    await runNativeAcceptance({
      backend,
      worker: join(
        root,
        ".cloudflare/output/v0/workers/default/bundle/index.js",
      ),
      workerConfig: fileURLToPath(new URL("worker.jsonc", import.meta.url)),
      kvExecution: { KV: "remote" },
      render: "/session-test",
      restart: { stage: "ready-for-restart", afterStop: backend.afterStop },
      artifacts: join(root, "../expired-session-native"),
      validate: async (backend, platform) => {
        assert.equal(
          backend.reports.find((r) => r.stage === "complete").platform,
          platform,
        );
        assert.deepEqual(
          backend.requests
            .filter((r) => r.path === "/session-test/account")
            .map((r) => r.status),
          [200, 200, 401],
        );
        assert.deepEqual(
          backend.requests
            .filter(
              (r) =>
                r.path === "/api/auth/sign-in/email" && r.method === "POST",
            )
            .map((r) => r.status),
          [200],
        );
        assert.equal(
          backend.requests.filter((r) => r.path === "/api/auth/sign-out")
            .length,
          0,
        );
        await backend.checkRevocation();
      },
    });
  },
);
