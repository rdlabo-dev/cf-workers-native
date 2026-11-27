import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runNativeAcceptance } from "../../native/acceptance.mjs";
import { startBackend, root, verifyDraft } from "./backend.mjs";
test(
  "unmodified Minvoice login, client and invoice creation",
  { timeout: 600000 },
  async () => {
    const backend = await startBackend();
    await runNativeAcceptance({
      backend,
      worker: join(root, "src/index.tsx"),
      workerConfig: join(root, "wrangler.jsonc"),
      render: "/admin",
      artifacts: fileURLToPath(
        new URL(
          "../../../artifacts/upstream/minvoice/native/",
          import.meta.url,
        ),
      ),
      validate: async (backend, platform) => {
        assert.ok(backend.reports.some((r) => r.stage === "csrf-attempted"));
        // WebKit forwards the opaque-origin request for the Worker to reject.
        // Android can reject sandboxed subframe navigation before transport.
        if (platform === "ios")
          assert.ok(
            backend.requests.some(
              (r) =>
                r.method === "POST" &&
                r.path === "/admin/clients" &&
                r.status === 403,
            ),
            "Cross-origin form must be rejected",
          );
        assert.equal(
          (
            await backend.db
              .prepare(
                "SELECT COUNT(*) AS n FROM clients WHERE name = 'CSRF Intruder'",
              )
              .first()
          ).n,
          0,
        );
        assert.equal(
          backend.reports.find((r) => r.stage === "complete").platform,
          platform,
        );
        assert.equal(
          (
            await backend.db
              .prepare(
                "SELECT COUNT(*) AS n FROM clients WHERE name = 'Capacitor Client'",
              )
              .first()
          ).n,
          1,
        );
        await verifyDraft(backend.db);
      },
    });
  },
);
