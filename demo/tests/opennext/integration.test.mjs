import { build, preview } from "vite";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, webkit, expect } from "@playwright/test";
import { assertInitialRendering } from "../rendering/assertions.ts";
import { startBackend } from "./backend.mjs";

test(
  "unchanged OpenNext app renders, hydrates, navigates and persists D1 sessions in workerd",
  { timeout: 180000 },
  async () => {
    // Build metadata distinguishes prerendering from HTML produced on request.
    const prerender = JSON.parse(
      await readFile(
        new URL(
          "../../opennext/.next/prerender-manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.ok(
      prerender.routes["/about"],
      "About must exercise real prerendering",
    );
    assert.equal(prerender.routes["/details"], undefined);
    const backend = await startBackend();
    let server;
    try {
      await build({
        configFile: fileURLToPath(
          new URL("../../opennext/capacitor/vite.config.ts", import.meta.url),
        ),
        define: {
          "import.meta.env.VITE_WORKER_ORIGIN": JSON.stringify(
            backend.url.origin,
          ),
        },
      });
      const output = new URL("../../opennext/www/", import.meta.url);
      assert.equal(
        JSON.parse(
          await readFile(
            new URL("workers-capacitor-server.json", output),
            "utf8",
          ),
        ).mode,
        "worker",
      );
      for (const path of await readdir(output, { recursive: true })) {
        if (!path.endsWith(".js")) continue;
        const code = await readFile(new URL(path, output), "utf8");
        assert.equal(
          code.includes("INSERT INTO sessions"),
          false,
          "Server SQL must not be shipped to Capacitor",
        );
        assert.equal(
          code.includes("server-functions/default/"),
          false,
          "Remote builds must not embed OpenNext server files",
        );
      }
      const assets = JSON.parse(
        await readFile(
          new URL("workers-capacitor-assets.json", output),
          "utf8",
        ),
      );
      assert.ok(
        assets.some(
          (path) => path.startsWith("/_next/static/") && path.endsWith(".js"),
        ),
      );
      server = await preview({
        configFile: false,
        root: fileURLToPath(new URL("../../opennext/", import.meta.url)),
        build: { outDir: "www" },
        preview: { host: "127.0.0.1", port: 0 },
      });
      const localAssets = new Set();
      // Browser baseline models native asset delivery; the native test exercises
      // the real document host and asserts no asset requests reach this backend.
      const useBundledAssets = (context) =>
        context.route(backend.url.origin + "/**", async (route) => {
          const url = new URL(route.request().url());
          if (!assets.includes(url.pathname)) return route.continue();
          const response = await fetch(
            new URL(url.pathname + url.search, server.resolvedUrls.local[0]),
          );
          assert.equal(response.status, 200);
          localAssets.add(url.pathname);
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          });
        });
      const response = await backend.fetch("/details");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-sample-middleware"), "ran");
      for (const engine of [chromium, webkit]) {
        const browser = await engine.launch();
        try {
          const context = await browser.newContext({ ignoreHTTPSErrors: true });
          await useBundledAssets(context);
          const page = await context.newPage();
          const about = await backend.fetch("/about");
          assert.equal(about.status, 200);
          await assertInitialRendering(browser, await about.text(), {
            initial: { h1: "About this example" },
            clientOnly: [],
          });
          for (const value of [crypto.randomUUID(), crypto.randomUUID()]) {
            const response = await backend.fetch(`/details?q=${value}`);
            assert.equal(response.status, 200);
            await assertInitialRendering(browser, await response.text(), {
              initial: { "#query": value },
              clientOnly: [],
            });
          }
          const initial = await backend.fetch("/");
          assert.equal(initial.status, 200);
          await assertInitialRendering(browser, await initial.text(), {
            initial: {
              h1: "OpenNext in Capacitor",
              "#server-rendered": "Rendered by Next.js",
              "#counter": "Count: 0",
            },
            clientOnly: ["#client-only"],
          });
          const apiResponse = page.waitForResponse(
            (response) => new URL(response.url()).pathname === "/api/message",
          );
          await page.goto(backend.url.href);
          assert.deepEqual(await (await apiResponse).json(), {
            message: "Next.js API ready",
          });
          await expect(page.locator("#client-only")).toHaveText(
            "Next.js API ready",
          );
          await expect(page.locator("h1")).toHaveText("OpenNext in Capacitor");
          await page.locator("#counter").click();
          await expect(page.locator("#counter")).toHaveText("Count: 1");
          assert.equal(
            await page
              .locator("main")
              .evaluate((e) => getComputedStyle(e).maxWidth),
            "640px",
          );
          assert.equal(
            await page
              .locator("img")
              .evaluate((e) => e.complete && e.naturalWidth > 0),
            true,
          );
          await page
            .getByRole("link", { name: "Details", exact: true })
            .click();
          await expect(page.locator("h1")).toHaveText("Details");
          await page.goBack();
          await expect(page.locator("h1")).toHaveText("OpenNext in Capacitor");
          await page
            .getByRole("link", { name: "Account", exact: true })
            .click();
          await expect(page.locator("h1")).toHaveText("Sign in");
          await page.getByLabel("Password").fill("demo");
          await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
          await expect(page.locator("#owner")).toHaveText("alice");
          assert.equal(
            await page.evaluate(() => document.cookie.includes("demo_session")),
            false,
          );
          const previous = await backend.db
            .prepare("SELECT writes FROM notes WHERE owner = 'alice'")
            .first();
          const rejected = await page.request.post(
            new URL("/api/notes", backend.url).href,
            {
              form: { value: "Forged note", csrf: "invalid" },
            },
          );
          assert.equal(rejected.status(), 403);
          assert.equal(
            (
              await backend.db
                .prepare("SELECT writes FROM notes WHERE owner = 'alice'")
                .first()
            ).writes,
            previous.writes,
          );
          // The engines share this database. A previous engine's saved value
          // must not satisfy the completion assertion before this POST finishes.
          const updatedNote = `Updated note ${engine.name()}`;
          await page.getByLabel("Note", { exact: true }).fill(updatedNote);
          const saved = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/notes" &&
              response.request().method() === "POST",
          );
          await page.getByRole("button", { name: "Save", exact: true }).click();
          assert.equal((await saved).status(), 303);
          await expect(page.locator("#saved-note")).toHaveText(updatedNote);
          const row = await backend.db
            .prepare("SELECT value, writes FROM notes WHERE owner = 'alice'")
            .first();
          assert.equal(row.value, updatedNote);
          assert.equal(row.writes, previous.writes + 1);
          const state = await context.storageState();
          await context.close();
          const restarted = await browser.newContext({
            storageState: state,
            ignoreHTTPSErrors: true,
          });
          await useBundledAssets(restarted);
          const restored = await restarted.newPage();
          await restored.goto(new URL("/account", backend.url).href);
          await expect(restored.locator("#owner")).toHaveText("alice");
          await restored
            .getByRole("button", { name: "Sign out", exact: true })
            .click();
          await expect(restored.locator("h1")).toHaveText("Sign in");
          await restored.reload();
          await expect(restored.locator("h1")).toHaveText("Sign in");
          assert.equal(
            (
              await backend.db
                .prepare("SELECT count(*) AS count FROM sessions")
                .first()
            ).count,
            0,
          );
          await restarted.close();
        } finally {
          await browser.close();
        }
      }
      assert.ok([...localAssets].some((path) => path.endsWith(".js")));
      assert.ok([...localAssets].some((path) => path.endsWith(".css")));
      assert.ok(localAssets.has("/mark.svg"));
      assert.deepEqual(
        backend.requests.filter((request) =>
          assets.includes(new URL(request.path, backend.url).pathname),
        ),
        [],
        "Bundled assets must not reach the remote Worker",
      );
    } finally {
      if (server)
        await new Promise((resolve) => server.httpServer.close(resolve));
      await backend.close();
    }
  },
);
