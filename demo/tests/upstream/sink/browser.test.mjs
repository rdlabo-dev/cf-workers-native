import { waitForAcceptance } from "../../native/reports.mjs";
import { test } from "node:test";
import { chromium, webkit } from "@playwright/test";
import { verifyLink, startBackend } from "./backend.mjs";
for (const engine of [chromium, webkit])
  test(
    `Sink original Worker in ${engine.name()}`,
    { timeout: 60000 },
    async () => {
      const backend = await startBackend();
      let browser;
      try {
        browser = await engine.launch();
        const page = await browser.newPage({ ignoreHTTPSErrors: true });
        await page.goto(new URL("/dashboard/login", backend.url).href);
        await waitForAcceptance(backend, 40000);
        await verifyLink(backend);
      } finally {
        try {
          await browser?.close();
        } finally {
          await backend.close();
        }
      }
    },
  );
