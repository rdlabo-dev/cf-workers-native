import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  test: {
    include: ["tests/build/**/*.test.ts"],
    allowOnly: false,
    // Every file performs full runtime builds. Serializing files avoids CPU
    // contention between Vite/esbuild instances on small CI runners.
    fileParallelism: false,
  },
});
