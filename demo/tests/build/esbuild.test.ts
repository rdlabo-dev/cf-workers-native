import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { context, type BuildResult } from "esbuild";
import { expect, it } from "vitest";
import { workersCapacitorPlugin } from "cf-workers-native/tooling/esbuild";

it("watches Worker dependencies and emits a new asset without writing output", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "workers-capacitor-watch-"));
  const results: BuildResult[] = [];
  await writeFile(resolve(dir, "value.js"), 'export default "before-change";');
  await writeFile(
    resolve(dir, "worker.js"),
    'import value from "./value.js"; export default {fetch() {return new Response(value)}};',
  );
  await writeFile(
    resolve(dir, "main.js"),
    `import {workersCapacitor} from ${JSON.stringify(fileURLToPath(import.meta.resolve("cf-workers-native/capacitor")))}; globalThis.runtime = workersCapacitor({baseURL:"https://worker.invalid/api"});`,
  );
  const build = await context({
    absWorkingDir: dir,
    entryPoints: ["main.js"],
    outdir: "out",
    bundle: true,
    format: "esm",
    write: false,
    plugins: [
      workersCapacitorPlugin({ execution: "local", worker: "worker.js" }),
      {
        name: "capture",
        setup(build) {
          build.onEnd((result) => {
            results.push(result);
          });
        },
      },
    ],
  });
  try {
    await build.watch();
    await expect
      .poll(() => results.length, { timeout: 30000 })
      .toBeGreaterThan(0);
    const asset = (result: BuildResult) =>
      result.outputFiles?.find((file) => !file.path.endsWith("/main.js"));
    expect(results[0].errors).toEqual([]);
    expect(asset(results[0])?.text).toContain("before-change");
    await writeFile(resolve(dir, "value.js"), 'export default "after-change";');
    await expect
      .poll(() => asset(results.at(-1)!)?.text, { timeout: 30000 })
      .toContain("after-change");
    expect(asset(results.at(-1)!)?.path).not.toBe(asset(results[0])?.path);
  } finally {
    await build.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);

it.each([true, false])(
  "preserves an explicit JSX loader (async=%s)",
  async (asyncFunction) => {
    const { build } = await import("esbuild");
    const dir = await mkdtemp(resolve(tmpdir(), "workers-capacitor-jsx-"));
    try {
      await writeFile(
        resolve(dir, "main.js"),
        `export ${asyncFunction ? "async" : ""} function App() { ${asyncFunction ? "await Promise.resolve();" : ""} return <div/>; }`,
      );
      const result = await build({
        absWorkingDir: dir,
        entryPoints: ["main.js"],
        outdir: "out",
        bundle: true,
        format: "esm",
        platform: "browser",
        write: false,
        loader: { ".js": "jsx" },
        plugins: [
          workersCapacitorPlugin({ execution: "local", worker: "unused.js" }),
        ],
      });
      expect(result.errors).toEqual([]);
      expect(result.outputFiles[0].text).toContain("createElement");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it("does not transform source files explicitly loaded as text", async () => {
  const { build } = await import("esbuild");
  const dir = await mkdtemp(resolve(tmpdir(), "workers-capacitor-text-"));
  try {
    await writeFile(
      resolve(dir, "main.js"),
      'import content from "./payload.ts"; export default content;',
    );
    await writeFile(
      resolve(dir, "payload.ts"),
      "async <this is not JavaScript>",
    );
    const result = await build({
      absWorkingDir: dir,
      entryPoints: ["main.js"],
      outdir: "out",
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      loader: { ".ts": "text" },
      plugins: [
        workersCapacitorPlugin({ execution: "local", worker: "unused.js" }),
      ],
    });
    expect(result.outputFiles[0].text).toContain(
      "async <this is not JavaScript>",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each([true, false])(
  "preserves TypeScript decorators (legacy=%s)",
  async (legacy) => {
    const { build } = await import("esbuild");
    const dir = await mkdtemp(
      resolve(tmpdir(), "workers-capacitor-decorator-"),
    );
    try {
      await writeFile(
        resolve(dir, "main.ts"),
        `function Service(...args: any[]) {}\n${legacy ? "@Service export" : "export @Service"} class App { ${legacy ? "constructor(@Service value: unknown) {}" : "@Service accessor value = 1;"} async run() { await Promise.resolve(); return 1; } }`,
      );
      const result = await build({
        absWorkingDir: dir,
        entryPoints: ["main.ts"],
        outdir: "out",
        bundle: true,
        format: "esm",
        platform: "browser",
        write: false,
        tsconfigRaw: { compilerOptions: { experimentalDecorators: legacy } },
        plugins: [
          workersCapacitorPlugin({ execution: "local", worker: "unused.js" }),
        ],
      });
      expect(result.errors).toEqual([]);
      expect(result.outputFiles[0].text).toContain("Service");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
