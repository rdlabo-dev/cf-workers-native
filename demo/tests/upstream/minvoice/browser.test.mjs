import { waitForAcceptance } from "../../native/reports.mjs";
import { test } from "node:test";
import { chromium, webkit } from "@playwright/test";
import { startBackend, verifyDraft } from "./backend.mjs";
for (const engine of [chromium, webkit])
  test(
    `Minvoice original Worker in ${engine.name()}`,
    { timeout: 60000 },
    async () => {
      const backend = await startBackend();
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({ ignoreHTTPSErrors: true });
        await page.goto(new URL("/admin", backend.url).href);
        await waitForAcceptance(backend, 20000);
        await verifyDraft(backend.db);
      } finally {
        await browser.close();
        await backend.close();
      }
    },
  );
