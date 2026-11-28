import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import {
  compileServerWorker,
  serverBindings,
} from "../../src/tooling/server.js";
import { serverModules } from "../../src/tooling/server-modules.js";
let root: string;
beforeAll(async () => {
  await mkdir("demo/artifacts", { recursive: true });
  root = await mkdtemp(resolve("demo/artifacts/hyperdrive-compiler-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function select(source: string) {
  const result = await build({
    stdin: { contents: source, resolveDir: root },
    bundle: true,
    format: "esm",
    write: false,
  });
  return (await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  )) as { needsRemote(request: Request): Promise<boolean> };
}
it("discovers JSON/JSONC/TOML Hyperdrive, named environments and mixed D1 without exporting credentials", async () => {
  const contents = {
    "worker.json": JSON.stringify({
      hyperdrive: [
        {
          binding: "SQL",
          id: "private-id",
          localConnectionString:
            "mysql://private-user:private-password@db/private-name",
        },
      ],
      env: {
        production: {
          hyperdrive: [{ binding: "PROD" }],
          d1_databases: [{ binding: "DB" }],
        },
      },
    }),
    "worker.jsonc":
      '{ // named environment\n "env": {"preview": {"hyperdrive": [{"binding":"SQL"}],}},}',
    "worker.toml":
      '[[hyperdrive]]\nbinding="SQL"\nid="private-id"\n[[env.production.hyperdrive]]\nbinding="PROD"\n[[env.production.d1_databases]]\nbinding="DB"',
  };
  for (const [name, content] of Object.entries(contents)) {
    await writeFile(resolve(root, name), content);
    const result = await serverBindings(root, { workerConfig: name });
    expect(result.names).toEqual(
      name === "worker.jsonc" ? ["SQL"] : ["DB", "SQL", "PROD"],
    );
    expect(result.reportFile).toBe("workers-capacitor-server.json");
    expect(JSON.stringify(result)).not.toMatch(
      /private-id|private-user|private-password|private-name/,
    );
  }
  expect(
    (
      await serverBindings(root, {
        workerConfig: "worker.json",
        d1Bindings: ["EXPLICIT"],
      })
    ).names,
  ).toEqual(["EXPLICIT", "SQL", "PROD"]);
  expect(
    (
      await serverBindings(root, {
        workerConfig: "worker.toml",
        hyperdriveBindings: ["OVERRIDE", "OVERRIDE"],
      })
    ).names,
  ).toEqual(["DB", "OVERRIDE"]);
  expect(
    (
      await serverBindings(root, {
        d1Bindings: ["DB"],
        hyperdriveBindings: ["SQL"],
      })
    ).names,
  ).toEqual(["DB", "SQL"]);
});
it("rejects malformed bindings and explicit settings instead of silently shipping the Worker", async () => {
  for (const value of [
    null,
    {},
    [null],
    [{}],
    [{ binding: 42 }],
    [{ binding: " " }],
  ]) {
    await writeFile(
      resolve(root, "invalid.json"),
      JSON.stringify({ hyperdrive: value }),
    );
    await expect(
      serverBindings(root, { workerConfig: "invalid.json" }),
    ).rejects.toThrow("Invalid hyperdrive");
  }
  for (const value of ["SQL", [42], [""]]) {
    await expect(
      serverBindings(root, { hyperdriveBindings: value as string[] }),
    ).rejects.toThrow("hyperdriveBindings");
  }
});
it("discovers bindings next to a nested Worker even with an explicit D1 list", async () => {
  const directory = resolve(root, "nested");
  await mkdir(directory);
  await writeFile(
    resolve(directory, "wrangler.json"),
    '{"hyperdrive":[{"binding":"SQL"}]}',
  );
  const entry = resolve(directory, "index.ts");
  await writeFile(
    entry,
    `export default { fetch(req, env) { return new Response(env.SQL.connectionString); } };`,
  );
  const graph = serverModules(entry, root, {
    execution: [{ method: "*", path: "*" }],
    d1Bindings: [],
  });
  const result = await graph.get();
  expect(result?.mode).toBe("worker");
  expect(result?.local).not.toContain("connectionString");
  await expect(graph.guard(entry)).rejects.toThrow(
    "bypass server code removal",
  );
});
it("removes database drivers, ORM helpers and SQL while preserving independent local routes", async () => {
  for (const driver of [
    "pg",
    "postgres",
    "mysql2/promise",
    "drizzle-orm/mysql2",
  ]) {
    const entry = resolve(root, "worker.ts");
    await writeFile(
      entry,
      `import { Hono } from 'hono'; import { query } from './repository';
      const app = new Hono(); app.get('/health', c => c.json({ok:true}));
      app.post('/orders', async c => c.json(await query(c.env.SQL))); export default app;`,
    );
    await writeFile(
      resolve(root, "repository.ts"),
      `import driver from '${driver}';
      export async function query(binding) { const {connectionString,host,user,password,port,database} = binding;
      const client = driver({connectionString,host,user,password,port,database}); return client.query('SELECT private_hyperdrive_marker'); }`,
    );
    const result = await compileServerWorker(entry, ["SQL"], {
      execution: [{ method: "*", path: "*" }],
    });
    expect(result.mode).toBe("routes");
    expect(result.local + result.selector).not.toMatch(
      /private_hyperdrive_marker|connectionString|password|mysql2|drizzle-orm|from "pg"|from "postgres"/,
    );
    const { needsRemote } = await select(result.selector);
    expect(await needsRemote(new Request("https://local.invalid/health"))).toBe(
      false,
    );
    expect(
      await needsRemote(
        new Request("https://local.invalid/orders", { method: "POST" }),
      ),
    ).toBe(true);
    await expect(
      compileServerWorker(entry, ["SQL"], { localBindings: ["SQL"] }),
    ).rejects.toThrow("cannot also be a local binding");
  }
});
it("keeps top-level pools and shared database state wholly server-side", async () => {
  const entry = resolve(root, "pool.ts");
  await writeFile(
    entry,
    `import { Hono } from 'hono'; import { env } from 'cloudflare:workers'; import { Pool } from 'pg';
    const pool = new Pool({connectionString:env.SQL.connectionString}); const app = new Hono();
    app.get('/health', c => c.text('ok')); app.get('/rows', async c => c.json(await pool.query('SELECT private_pool_marker'))); export default app;`,
  );
  const result = await compileServerWorker(entry, ["SQL"], {
    execution: [{ method: "*", path: "*" }],
  });
  expect(result.mode).toBe("worker");
  expect(result.local + result.selector).not.toMatch(
    /Pool|connectionString|private_pool_marker/,
  );
  expect(
    await (
      await select(result.selector)
    ).needsRemote(new Request("https://local.invalid/health")),
  ).toBe(true);
});
it("analyzes Workers even without configured server bindings", async () => {
  const directory = resolve(root, "plain");
  await mkdir(directory);
  const entry = resolve(directory, "index.ts");
  const original = 'export default {fetch(){return new Response("ok")}}';
  await writeFile(entry, original);
  const result = await serverModules(entry, directory, {
    d1Bindings: [],
    hyperdriveBindings: [],
  }).get();
  expect(result?.mode).toBe("worker");
  const { needsRemote } = await select(result!.selector);
  for (const method of ["GET", "POST"])
    expect(
      await needsRemote(new Request("https://worker.invalid/", { method })),
    ).toBe(true);
  expect(await readFile(entry, "utf8")).toBe(original);
});
