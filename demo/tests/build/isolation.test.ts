import { expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { build as vite, createServer } from "vite";
import { workersCapacitorPlugin as esbuildPlugin } from "cf-workers-native/tooling/esbuild";
import { workersCapacitorPlugin as vitePlugin } from "cf-workers-native/tooling/vite";

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "cloudflare-isolation-"));
  await mkdir(resolve(root, "cloudflare"));
  await writeFile(
    resolve(root, "worker.js"),
    `import { Buffer } from 'node:buffer'; export default {fetch(request,env){return request.headers.get('authorization') === env.TOKEN ? new Response(Buffer.from('cloudflare').toString(),{headers:{'x-server':'original'}}) : new Response('denied',{status:401});}};`,
  );
  await writeFile(
    resolve(root, "wrangler.json"),
    JSON.stringify({
      name: "original-worker",
      main: "worker.js",
      compatibility_date: "2026-10-17",
      compatibility_flags: ["nodejs_compat"],
      vars: { LABEL: "original" },
    }),
  );
  await writeFile(
    resolve(root, "main.js"),
    `import {workersCapacitor} from ${JSON.stringify(fileURLToPath(import.meta.resolve("cf-workers-native/capacitor")))};globalThis.runtime=workersCapacitor({baseURL:'https://worker.example'});`,
  );
  await writeFile(
    resolve(root, "cloudflare/keep.txt"),
    "existing deployment artifact",
  );
  return root;
}
async function snapshot(root: string) {
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  return Object.fromEntries(
    await Promise.all(
      files
        .filter((f) => f.isFile())
        .map(async (f) => {
          const path = resolve(f.parentPath, f.name);
          return [
            path.slice(root.length + 1),
            (await readFile(path)).toString("base64"),
          ];
        }),
    ),
  );
}
async function mobile(
  root: string,
  tool: "vite" | "esbuild",
  outdir: string,
  worker = "worker.js",
  workerConfig = "wrangler.json",
  execution: "network" | "local" = "network",
) {
  const options = { worker, workerConfig, execution };
  if (tool === "vite")
    return vite({
      root,
      configFile: false,
      publicDir: false,
      logLevel: "silent",
      plugins: [vitePlugin(options)],
      build: {
        outDir: outdir,
        emptyOutDir: true,
        rollupOptions: { input: resolve(root, "main.js") },
      },
    });
  return esbuild({
    absWorkingDir: root,
    entryPoints: ["main.js"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outdir,
    logLevel: "silent",
    plugins: [esbuildPlugin(options)],
  });
}
for (const tool of ["vite", "esbuild"] as const) {
  it(`${tool}: local execution cannot erase an imported server dependency`, async () => {
    const root = await fixture();
    try {
      await writeFile(
        resolve(root, "cloudflare/helper.js"),
        "export const value='server dependency';",
      );
      await writeFile(
        resolve(root, "worker.js"),
        "import {value} from './cloudflare/helper.js';export default {fetch(){return new Response(value)}};",
      );
      const before = await snapshot(root);
      await expect(
        mobile(
          root,
          tool,
          resolve(root, "cloudflare"),
          "worker.js",
          "wrangler.json",
          "local",
        ),
      ).rejects.toThrow("output must be separate");
      expect(await snapshot(root)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
  it(`${tool}: output file links cannot overwrite server sources`, async () => {
    const root = await fixture();
    try {
      const output = resolve(root, "mobile");
      await mkdir(output);
      await symlink(resolve(root, "worker.js"), resolve(output, "main.js"));
      await symlink(
        resolve(root, "wrangler.json"),
        resolve(output, "workers-capacitor-server.json"),
      );
      const before = await snapshot(root);
      await expect(mobile(root, tool, output)).rejects.toThrow(
        "output must not contain symlinks",
      );
      expect(await snapshot(root)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
  it(`${tool}: adding a mobile build preserves original server inputs and deployment bytes`, async () => {
    const root = await fixture();
    const out = await mkdtemp(resolve(tmpdir(), "mobile-output-"));
    const cloudflare = () =>
      esbuild({
        absWorkingDir: root,
        entryPoints: ["worker.js"],
        bundle: true,
        format: "esm",
        platform: "neutral",
        external: ["node:buffer"],
        outfile: "cloudflare/worker.js",
        logLevel: "silent",
      });
    try {
      await cloudflare();
      const before = await snapshot(root);
      await mobile(root, tool, out);
      expect(await snapshot(root)).toEqual(before);
      await cloudflare();
      expect(await snapshot(root)).toEqual(before);
      expect(
        await readFile(resolve(out, "workers-capacitor-server.json"), "utf8"),
      ).toContain('"worker"');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  }, 30000);
  it(`${tool}: rejects output overlapping server inputs before deleting or overwriting them`, async () => {
    const root = await fixture();
    try {
      await symlink(root, resolve(root, "alias"));
      // A direct or symlinked output can both empty the original deployment.
      for (const out of [root, resolve(root, "alias")]) {
        const before = await snapshot(root);
        await expect(mobile(root, tool, out)).rejects.toThrow(
          "output must be separate",
        );
        expect(await snapshot(root)).toEqual(before);
      }
      // Protect the discovered deployment configuration even when the entry is elsewhere.
      await writeFile(
        resolve(root, "cloudflare/wrangler.json"),
        await readFile(resolve(root, "wrangler.json")),
      );
      const before = await snapshot(root);
      await expect(
        mobile(
          root,
          tool,
          resolve(root, "cloudflare"),
          "worker.js",
          "cloudflare/wrangler.json",
        ),
      ).rejects.toThrow("output must be separate");
      expect(await snapshot(root)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
}
it("Vite browser development can start but cannot load its server environment", async () => {
  const root = await fixture();
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    server = await createServer({
      root,
      configFile: false,
      publicDir: false,
      logLevel: "silent",
      plugins: [vitePlugin({ worker: "worker.js" })],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    await expect(server.ssrLoadModule("/worker.js")).rejects.toThrow(
      "cannot build a server environment",
    );
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
for (const target of ["SSR", "Cloudflare", "server environment"] as const) {
  it(`rejects Vite ${target} integration before touching existing output`, async () => {
    const root = await fixture();
    try {
      const before = await snapshot(root);
      await expect(
        vite({
          root,
          configFile: false,
          ...(target === "server environment"
            ? { environments: { worker: { consumer: "server" as const } } }
            : {}),
          publicDir: false,
          logLevel: "silent",
          plugins: [
            ...(target === "Cloudflare"
              ? [{ name: "vite-plugin-cloudflare:build" }]
              : []),
            vitePlugin({ worker: "worker.js" }),
          ],
          build: {
            ssr: target === "SSR",
            outDir: resolve(root, "cloudflare"),
            emptyOutDir: true,
            rollupOptions: { input: resolve(root, "worker.js") },
          },
        }),
      ).rejects.toThrow("separate Capacitor/browser build");
      expect(await snapshot(root)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
