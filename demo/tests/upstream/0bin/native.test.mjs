import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runNativeAcceptance } from "../../native/acceptance.mjs";
import { verifyPastes, startBackend, root } from "./backend.mjs";
test(
  "0bin encrypt, save and decrypt through native navigation",
  { timeout: 600000 },
  async () => {
    const backend = await startBackend();
    await runNativeAcceptance({
      backend,
      worker: join(root, "dist/server/index.js"),
      workerConfig: join(root, "dist/server/wrangler.json"),
      artifacts: fileURLToPath(
        new URL("../../../artifacts/upstream/0bin/native/", import.meta.url),
      ),
      validate: async (backend, platform) => {
        const result = backend.reports.find((r) => r.stage === "complete");
        assert.equal(result.platform, platform);
        await verifyPastes(backend, result);
      },
    });
  },
);
