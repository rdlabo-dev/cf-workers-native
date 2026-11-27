import { waitForAcceptance } from "../../native/reports.mjs";
import { test } from "node:test";
import { chromium, webkit } from "@playwright/test";
import { verifyPastes, startBackend } from "./backend.mjs";
for (const engine of [chromium, webkit])
  test(
    `0bin original Worker in ${engine.name()}`,
    { timeout: 60000 },
    async () => {
      const backend = await startBackend();
      let browser;
      try {
        browser = await engine.launch();
        const page = await browser.newPage({ ignoreHTTPSErrors: true });
        await page.goto(backend.url.href);
        const report = await waitForAcceptance(backend, 40000);
        await verifyPastes(backend, report);
      } finally {
        try {
          await browser?.close();
        } finally {
          await backend.close();
        }
      }
    },
  );
