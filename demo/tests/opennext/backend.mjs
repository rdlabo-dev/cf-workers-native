import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fileURLToPath } from "node:url";
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function startBackend({ native = false, driver, appRoot } = {}) {
  const pluginDriver =
    native && !driver
      ? (
          await build({
            entryPoints: [
              fileURLToPath(new URL("plugin-driver.ts", import.meta.url)),
            ],
            bundle: true,
            format: "iife",
            platform: "browser",
            write: false,
          })
        ).outputFiles[0].text
      : "";
  const reports = [];
  const requests = [];
  const config = { mode: "flow", id: crypto.randomUUID() };
  const root =
    appRoot ?? fileURLToPath(new URL("../../opennext/", import.meta.url));
  const compiled = await build({
    entryPoints: [join(root, ".open-next/worker.js")],
    bundle: true,
    format: "esm",
    platform: "node",
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire('file:///worker.js');",
    },
    external: ["node:*", "cloudflare:*"],
    loader: { ".wasm": "binary" },
    write: false,
  });
  const server = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: compiled.outputFiles[0].text,
      compatibilityDate: "2026-10-17",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      images: { binding: "IMAGES" },
      assets: {
        directory: join(root, ".open-next/assets"),
        binding: "ASSETS",
        routerConfig: { has_user_worker: true },
      },
    }),
  );
  const certDir = await mkdtemp(join(tmpdir(), "opennext-https-"));
  let https;
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        "key.pem",
        "-out",
        "ca.pem",
        "-days",
        "2",
        "-subj",
        "/CN=OpenNext Test",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ],
      { cwd: certDir, stdio: "pipe" },
    );
    await server.ready;
    https = createServer(
      {
        key: await readFile(join(certDir, "key.pem")),
        cert: await readFile(join(certDir, "ca.pem")),
      },
      async (req, res) => {
        try {
          if (native) {
            res.setHeader("access-control-allow-origin", "*");
            res.setHeader("access-control-allow-headers", "content-type");
          }
          if (native && req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
          }
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          if (native && req.url === "/__acceptance/config") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(config));
            return;
          }
          if (native && req.url === "/__acceptance/report") {
            const report = JSON.parse(Buffer.concat(chunks).toString());
            report.notes = await DB.prepare("SELECT * FROM notes").all();
            reports.push(report);
            res.end("ok");
            return;
          }
          if (native && req.url === "/__acceptance/plugin.js") {
            res.setHeader("content-type", "text/javascript");
            res.end(pluginDriver);
            return;
          }
          if (native && req.url === "/__acceptance/driver.js") {
            res.setHeader("content-type", "text/javascript");
            res.end(
              driver ??
                (await readFile(new URL("native-driver.js", import.meta.url))),
            );
            return;
          }
          requests.push({
            method: req.method,
            path: req.url,
            ...(req.headers.rsc ? { rsc: req.headers.rsc } : {}),
          });
          const headers = {
            ...req.headers,
            "x-forwarded-host": req.headers.host,
            "x-forwarded-proto": "https",
          };

          delete headers["content-length"];
          delete headers["transfer-encoding"];
          const response = await dispatch(
            `https://${req.headers.host}${req.url}`,
            {
              method: req.method,
              headers,
              body: ["GET", "HEAD"].includes(req.method)
                ? undefined
                : Buffer.concat(chunks),
              redirect: "manual",
            },
          );
          let bytes = Buffer.from(await response.arrayBuffer());
          if (
            native &&
            response.headers.get("content-type")?.includes("text/html")
          )
            bytes = Buffer.from(
              bytes
                .toString()
                .replace(
                  "</body>",
                  '<script src="/__acceptance/plugin.js"></script><script src="/__acceptance/driver.js"></script></body>',
                ),
            );
          const out = Object.fromEntries(response.headers);
          delete out["transfer-encoding"];
          delete out["content-encoding"];
          out["content-length"] = String(bytes.length);
          if (response.headers.getSetCookie().length)
            out["set-cookie"] = response.headers.getSetCookie();
          res.writeHead(response.status, out);
          res.end(bytes);
        } catch (error) {
          res.writeHead(500);
          res.end(String(error));
        }
      },
    );
    await new Promise((resolve) => https.listen(0, "127.0.0.1", resolve));
    const url = new URL(`https://localhost:${https.address().port}/`);
    const DB = await server.getD1Database("DB");
    const sql = await readFile(join(root, "migrations/0001.sql"), "utf8");
    await DB.exec(sql);
    const entry = await server.getWorker();
    const { ASSETS } = await server.getBindings();
    async function dispatch(url, init) {
      if (!init?.method || init.method === "GET" || init.method === "HEAD") {
        const asset = await ASSETS.fetch(url, init);
        if (asset.status !== 404) return asset;
      }
      return entry.fetch(url, init);
    }
    return {
      url,
      reports,
      requests,
      config,
      db: DB,
      ca: join(certDir, "ca.pem"),
      key: join(certDir, "key.pem"),
      fetch: (path, init) => dispatch(new URL(path, url).href, init),
      close: async () => {
        await new Promise((resolve) => https.close(resolve));
        await server.dispose();
        await rm(certDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (https) await new Promise((resolve) => https.close(resolve));
    await server.dispose();
    await rm(certDir, { recursive: true, force: true });
    throw error;
  }
}
