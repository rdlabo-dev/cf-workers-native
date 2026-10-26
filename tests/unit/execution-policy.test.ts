import { expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { serverModules } from "../../src/tooling/server-modules.js";
import type { ServerBuildOptions } from "../../src/tooling/server.js";

async function fixture(
  options: ServerBuildOptions,
  check: (graph: ReturnType<typeof serverModules>) => Promise<void>,
  source?: string,
  config?: object,
) {
  await mkdir("demo/artifacts", { recursive: true });
  const root = await mkdtemp(resolve("demo/artifacts/execution-"));
  try {
    await writeFile(
      resolve(root, "worker.ts"),
      source ??
        `import {Hono} from 'hono'; const app = new Hono();
      const settings = {title:'public', privateKey:'DISTRIBUTION_PERMISSION_CANARY'};
      app.get('/', c => c.text('public'));
      app.get('/configured', c => c.text(settings.title));
      app.post('/notes', async c => c.text(await c.req.text()));
      app.get('/cloud', c => c.text(c.env.SECRET));
      export default app;`,
    );
    if (config)
      await writeFile(resolve(root, "wrangler.json"), JSON.stringify(config));
    await check(serverModules(resolve(root, "worker.ts"), root, options));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function load(source: string) {
  const result = await build({
    stdin: { contents: source, resolveDir: resolve("demo") },
    bundle: true,
    format: "esm",
    write: false,
  });
  return import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString("base64")}`
  );
}
it.each([undefined, []])(
  "network is the default and empty routes permit no distribution: %j",
  async (execution) => {
    await fixture({ execution }, async (graph) => {
      const result = (await graph.get())!;
      expect(result.local).not.toContain("DISTRIBUTION_PERMISSION_CANARY");
      const { needsRemote } = await load(result.selector);
      for (const path of ["/", "/configured", "/cloud", "/missing"])
        expect(
          await needsRemote(new Request(`https://local.invalid${path}`)),
        ).toBe(true);
      expect(result.requiresRemote).toBe(true);
    });
  },
);
it("network emits no Worker implementation", async () => {
  await fixture(
    { execution: "network" },
    async (graph) => {
      const result = (await graph.get())!;
      expect(result.local + result.selector).not.toContain(
        "DISTRIBUTION_PERMISSION_CANARY",
      );
      expect(
        await (
          await load(result.selector)
        ).needsRemote(new Request("https://local.invalid/")),
      ).toBe(true);
    },
    undefined,
    { kv_namespaces: [{ binding: "KV" }], assets: { directory: "public" } },
  );
});
it.each([undefined, "network"] as const)(
  "remote execution does not resolve or evaluate server-only dependencies: %s",
  async (execution) => {
    await fixture(
      { execution },
      async (graph) => {
        const result = await graph.get();
        expect(result.requiresRemote).toBe(true);
        expect(result.local + result.selector).not.toMatch(
          /missing-server-sdk|SERVER_SECRET_CANARY|node:child_process/,
        );
        const { needsRemote } = await load(result.selector);
        for (const method of ["GET", "POST", "DELETE"])
          expect(
            await needsRemote(
              new Request("https://local.invalid/items", { method }),
            ),
          ).toBe(true);
        await load(result.local);
      },
      `import sdk from 'missing-server-sdk';
       import { spawn } from 'node:child_process';
       throw new Error('SERVER_SECRET_CANARY');
       export default { fetch() { return sdk(spawn); } };`,
    );
  },
);
it("route selection grants dependency distribution only to selected methods and routes", async () => {
  await fixture(
    {
      execution: [
        { method: "GET", path: "/configured" },
        { method: "POST", path: "/notes" },
        { method: "GET", path: "/cloud" },
      ],
    },
    async (graph) => {
      const result = (await graph.get())!;
      expect(result.local).toContain("DISTRIBUTION_PERMISSION_CANARY");
      const { needsRemote } = await load(result.selector);
      expect(await needsRemote(new Request("https://local.invalid/"))).toBe(
        true,
      );
      expect(
        await needsRemote(new Request("https://local.invalid/configured")),
      ).toBe(false);
      expect(
        await needsRemote(new Request("https://local.invalid/missing")),
      ).toBe(true);
      expect(
        await needsRemote(
          new Request("https://local.invalid/configured", { method: "POST" }),
        ),
      ).toBe(true);
      expect(
        await needsRemote(new Request("https://local.invalid/cloud")),
      ).toBe(true);
      const request = new Request("https://local.invalid/notes", {
        method: "POST",
        body: "device note",
      });
      expect(await needsRemote(request.clone())).toBe(false);
      expect(
        await (await (await load(result.local)).default.fetch(request)).text(),
      ).toBe("device note");
    },
  );
});
it("route selection does not bypass authentication middleware", async () => {
  await fixture(
    { execution: [{ method: "GET", path: "/private" }] },
    async (graph) => {
      const result = (await graph.get())!;
      expect(result.local).not.toContain("PROTECTED_CONTENT");
      expect(
        await (
          await load(result.selector)
        ).needsRemote(new Request("https://local.invalid/private")),
      ).toBe(true);
    },
    `import {Hono} from 'hono'; const app=new Hono(); app.use('/private',async(c,next)=>{if(c.req.header('authorization')!==c.env.SECRET)return c.text('denied',401);await next();});app.get('/private',c=>c.text('PROTECTED_CONTENT'));export default app;`,
  );
});
it("route selection selects descendants with a trailing path wildcard, without widening to siblings or unknown URLs", async () => {
  await fixture(
    { execution: [{ method: "*", path: "/app/*" }] },
    async (graph) => {
      const result = (await graph.get())!;
      const { needsRemote } = await load(result.selector);
      for (const [path, method] of [
        ["/app", "GET"],
        ["/app/home", "GET"],
        ["/app/news/123", "GET"],
        ["/app/notes", "POST"],
      ]) {
        expect(
          await needsRemote(
            new Request(`https://local.invalid${path}`, { method }),
          ),
        ).toBe(false);
      }
      for (const path of [
        "/application",
        "/app-private",
        "/app/cloud",
        "/app/missing",
      ]) {
        expect(
          await needsRemote(new Request(`https://local.invalid${path}`)),
        ).toBe(true);
      }
      expect(result.local + result.selector).not.toContain("UNSELECTED_DATA");
      expect(
        await (
          await (
            await load(result.local)
          ).default.fetch(new Request("https://local.invalid/app/news/123"))
        ).text(),
      ).toBe("123");
    },
    `import {Hono} from 'hono'; const app=new Hono();
    app.get('/app/home',c=>c.text('home'));
    app.get('/app/news/:id',c=>c.text(c.req.param('id')));
    app.post('/app/notes',async c=>c.text(await c.req.text()));
    app.get('/app/cloud',c=>c.text(c.env.SECRET));
    app.get('/app',c=>c.text('home'));
    app.get('/application',c=>c.text('UNSELECTED_DATA'));
    app.get('/app-private',c=>c.text('UNSELECTED_DATA'));
    export default app;`,
  );
});
it.each(["/app/*", "/v1.0/*", "/@me/*", "/*", "*"])(
  "route selection wildcard %s agrees with Hono for literal registrations",
  async (path) => {
    const hono = new Hono();
    hono.get(path, (c) => c.text("matched"));
    for (const registration of [
      "/",
      "/app",
      "/app/",
      "/app/news/123",
      "/application",
      "/app-private",
      "/v1.0/page",
      "/@me/profile",
    ]) {
      const expectedLocal = (await hono.request(registration)).status === 200;
      await fixture(
        { execution: [{ method: "GET", path }] },
        async (graph) => {
          const result = (await graph.get())!;
          const { needsRemote } = await load(result.selector);
          expect(
            await needsRemote(
              new Request(`https://local.invalid${registration}`),
            ),
          ).toBe(!expectedLocal);
          expect(result.local.includes("ROUTE_IMPLEMENTATION")).toBe(
            expectedLocal,
          );
        },
        `import {Hono} from 'hono'; const app=new Hono();
        app.get('/app/anchor',c=>c.text('anchor'));
        app.get('/v1.0/anchor',c=>c.text('anchor'));
        app.get('/@me/anchor',c=>c.text('anchor'));
        app.get(${JSON.stringify(registration)},c=>c.text('ROUTE_IMPLEMENTATION'));
        export default app;`,
      );
    }
  },
);
it("route selection preserves Hono's parameter constraints for an explicitly selected registration", async () => {
  const path = "/posts/:id{[0-9]+}";
  const hono = new Hono();
  hono.get(path, (c) => c.text(c.req.param("id")));
  await fixture(
    { execution: [{ method: "GET", path }] },
    async (graph) => {
      const result = (await graph.get())!;
      const { needsRemote } = await load(result.selector);
      for (const url of ["/posts/123", "/posts/abc", "/posts/123/edit"]) {
        expect(
          await needsRemote(new Request(`https://local.invalid${url}`)),
        ).toBe((await hono.request(url)).status !== 200);
      }
      expect(
        await (
          await (
            await load(result.local)
          ).default.fetch(new Request("https://local.invalid/posts/123"))
        ).text(),
      ).toBe("123");
    },
    `import {Hono} from 'hono'; const app=new Hono();
    app.get(${JSON.stringify(path)},c=>c.text(c.req.param('id'))); export default app;`,
  );
});
it("does not infer permission by treating a dynamic registration as a literal URL", async () => {
  await fixture(
    {
      execution: [{ method: "GET", path: "/app/:id/*" }],
    },
    async (graph) => {
      await expect(graph.get()).rejects.toThrow("cannot resolve");
    },
    `import {Hono} from 'hono'; const app=new Hono();
    app.get('/app/:id/admin',c=>c.text('private')); export default app;`,
  );
});
it.each(["/notes", /^\/notes$/])(
  "route selection accepts all methods for path %s without overriding server boundaries",
  async (path) => {
    await fixture(
      {
        execution: [
          { method: "*", path },
          { method: "*", path: "/any" },
        ],
      },
      async (graph) => {
        const result = (await graph.get())!;
        const { needsRemote } = await load(result.selector);
        for (const method of [
          "GET",
          "HEAD",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "OPTIONS",
        ]) {
          expect(
            await needsRemote(
              new Request("https://local.invalid/notes", { method }),
            ),
          ).toBe(method === "DELETE");
          expect(
            await needsRemote(
              new Request("https://local.invalid/any", { method }),
            ),
          ).toBe(false);
        }
        expect(
          await needsRemote(new Request("https://local.invalid/other")),
        ).toBe(true);
        expect(result.local + result.selector).not.toContain("PRIVATE_OTHER");
        const response = await (
          await load(result.local)
        ).default.fetch(
          new Request("https://local.invalid/notes", {
            method: "POST",
            body: "note",
          }),
        );
        expect(await response.text()).toBe("note");
      },
      `import {Hono} from 'hono'; const app=new Hono();
      app.get('/notes',c=>c.text('notes'));
      app.post('/notes',async c=>c.text(await c.req.text()));
      app.put('/notes',c=>c.text('put'));
      app.patch('/notes',c=>c.text('patch'));
      app.options('/notes',c=>c.text('options'));
      app.delete('/notes',c=>c.text(c.env.SECRET));
      app.all('/any',c=>c.text('any'));
      app.get('/other',c=>c.text('PRIVATE_OTHER'));
      export default app;`,
    );
  },
);
it.each(["", "g", "y"])(
  "route selection matches registration paths with RegExp flags=%s without publishing other routes",
  async (flags) => {
    const path = new RegExp("^/pages/", flags);
    path.lastIndex = 4;
    await fixture(
      { execution: [{ method: "GET", path }] },
      async (graph) => {
        const result = (await graph.get())!;
        expect(path.lastIndex).toBe(4);
        expect(result.local + result.selector).not.toContain("PRIVATE_POST");
        expect(result.local + result.selector).not.toContain("PRIVATE_OTHER");
        const { needsRemote } = await load(result.selector);
        for (const url of ["/pages/about", "/pages/news/123?lang=en"]) {
          expect(
            await needsRemote(new Request(`https://local.invalid${url}`)),
          ).toBe(false);
        }
        for (const [url, method] of [
          ["/pages/about", "POST"],
          ["/pages/cloud", "GET"],
          ["/pages/missing", "GET"],
          ["/other", "GET"],
        ]) {
          expect(
            await needsRemote(
              new Request(`https://local.invalid${url}`, { method }),
            ),
          ).toBe(true);
        }
        expect(
          await (
            await (
              await load(result.local)
            ).default.fetch(new Request("https://local.invalid/pages/news/123"))
          ).text(),
        ).toBe("123");
      },
      `import {Hono} from 'hono'; const app=new Hono();
      app.get('/pages/about',c=>c.text('about'));
      app.get('/pages/news/:id',c=>c.text(c.req.param('id')));
      app.post('/pages/about',c=>c.text('PRIVATE_POST'));
      app.get('/pages/cloud',c=>c.text(c.env.SECRET));
      app.get('/other',c=>c.text('PRIVATE_OTHER'));
      export default app;`,
    );
  },
);
it("route selection keeps a separate REST API and unselected private pages on the server", async () => {
  await fixture(
    { execution: [{ method: "GET", path: "/" }] },
    async (graph) => {
      const result = (await graph.get())!;
      expect(result.local + result.selector).not.toContain("PRIVATE_PAGE_DATA");
      expect(result.local + result.selector).not.toContain(
        "SELECT secret FROM accounts",
      );
      const { needsRemote } = await load(result.selector);
      expect(await needsRemote(new Request("https://local.invalid/"))).toBe(
        false,
      );
      for (const [path, method] of [
        ["/api/accounts", "GET"],
        ["/api/accounts", "POST"],
        ["/account", "GET"],
      ]) {
        expect(
          await needsRemote(
            new Request(`https://local.invalid${path}`, { method }),
          ),
        ).toBe(true);
      }
      expect(
        await (
          await (
            await load(result.local)
          ).default.fetch(new Request("https://local.invalid/"))
        ).text(),
      ).toBe("<h1>News</h1>");
    },
    `import {Hono} from 'hono';
      const app=new Hono();
      app.get('/',c=>c.html('<h1>News</h1>'));
      app.get('/api/accounts',async c=>c.json(await c.env.DB.prepare('SELECT secret FROM accounts').all()));
      app.post('/api/accounts',async c=>c.json(await c.env.DB.prepare('INSERT INTO accounts DEFAULT VALUES').run()));
      app.get('/account',c=>c.req.header('authorization')===c.env.SECRET ? c.text('PRIVATE_PAGE_DATA') : c.text('denied',401));
      export default app;`,
    { d1_databases: [{ binding: "DB" }] },
  );
});
it("local explicitly distributes the whole Worker and supports standalone POST", async () => {
  await fixture({ execution: "local" }, async (graph) => {
    const result = (await graph.get())!;
    expect(result.local).toContain("worker.ts");
    expect(result.requiresRemote).toBe(false);
    expect(
      await (
        await load(result.selector)
      ).needsRemote(new Request("https://local.invalid/")),
    ).toBe(false);
    const response = await (
      await load(result.local)
    ).default.fetch(
      new Request("https://local.invalid/notes", {
        method: "POST",
        body: "note",
      }),
    );
    expect(await response.text()).toBe("note");
  });
});
it.each([
  { execution: "local", remoteBindings: ["SECRET"] },
  { execution: [{ method: "GET", path: "/typo" }] },
  { execution: [{ method: "GET", path: /^\/typo\// }] },
  { execution: [{ method: "GET", path: 123 }] },
  { execution: "auto" },
  { execution: "manual" },
] as ServerBuildOptions[])(
  "rejects conflicting or unresolved configuration: %j",
  async (options) => {
    await fixture(options, async (graph) => {
      await expect(graph.get()).rejects.toThrow();
    });
  },
);

it("default network excludes Admin SDK credentials even without Cloudflare configuration", async () => {
  await fixture(
    {},
    async (graph) => {
      const result = (await graph.get())!;
      expect(result.local + result.selector).not.toContain("PRIVATE_ADMIN_KEY");
      expect(result.local + result.selector).not.toContain("firebase-admin");
      expect(
        await (
          await load(result.selector)
        ).needsRemote(new Request("https://local.invalid/")),
      ).toBe(true);
    },
    `import {Hono} from 'hono'; import {initializeApp,cert} from 'firebase-admin/app';
    const admin = initializeApp({credential:cert({privateKey:'PRIVATE_ADMIN_KEY'})});
    const app = new Hono(); app.get('/',c=>c.text('public')); export default app;`,
  );
});

it.each([false, true])(
  "a full local build starts with remote configured=%s",
  async (configured) => {
    await fixture(
      { execution: "local" },
      async (graph) => {
        const result = (await graph.get())!;
        const selector = await load(
          (await graph.load(graph.selectorEntry))!.code,
        );
        const { createFetchRuntime } =
          await import("../../src/cloudflare/workers/worker-runtime.js");
        const runtime = createFetchRuntime({
          baseURL: "https://local.invalid/",
          prefer: "direct",
          ...(configured
            ? { remote: { origin: "https://remote.invalid" } }
            : {}),
          worker: {
            createWorker() {
              throw new Error("must stay direct");
            },
            loadDirect: async () => (await load(result.local)).default,
            needsRemote: selector.needsRemote,
            requiresRemote: selector.requiresRemote,
          },
        });
        try {
          await runtime.ready;
          expect(
            await (await runtime.fetch("https://local.invalid/")).text(),
          ).toBe("public");
        } finally {
          await runtime.dispose();
        }
      },
      `import {Hono} from 'hono'; const app=new Hono();app.get('/',c=>c.text('public'));export default app;`,
    );
  },
);

it("reports a nonempty selection that cannot run locally", async () => {
  await fixture(
    { execution: [{ method: "GET", path: "/cloud" }] },
    async (graph) => {
      expect((await graph.get()).message).toContain(
        "No selected routes can execute locally",
      );
    },
  );
});
