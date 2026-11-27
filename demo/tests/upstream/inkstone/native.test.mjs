import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runNativeAcceptance } from "../../native/acceptance.mjs";
import { verifySavedNote, startBackend, root } from "./backend.mjs";
test(
  "Inkstone registration and note creation in native WebView",
  { timeout: 600000 },
  async () => {
    const backend = await startBackend();
    await runNativeAcceptance({
      backend,
      worker: join(root, "dist/inkstone/index.js"),
      workerConfig: join(root, "dist/inkstone/wrangler.json"),
      kvExecution: { OAUTH_KV: "remote" },
      render: "/",
      artifacts: fileURLToPath(
        new URL(
          "../../../artifacts/upstream/inkstone/native/",
          import.meta.url,
        ),
      ),
      validate: async (backend, platform) => {
        assert.equal(
          backend.reports.find((r) => r.stage === "complete").platform,
          platform,
        );
        await verifySavedNote(backend.db);
      },
    });
  },
);
