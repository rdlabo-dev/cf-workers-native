import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const distribution = process.env.WORKERS_NPM_PACKAGE_DIR
  ? pathToFileURL(
      path.resolve(process.env.WORKERS_NPM_PACKAGE_DIR, "dist") + "/",
    )
  : new URL("../../../dist/", import.meta.url);
const { workersCapacitorPlugin } = await import(
  new URL("tooling/esbuild.js", distribution)
);

const platform = process.argv[2];
const scenario = process.argv[3] ?? "normal";
if (!["ios", "android"].includes(platform))
  throw new Error("Usage: node build-web.mjs ios|android");
if (
  !["normal", "startup-failure", "broken-entry", "session-recovery"].includes(
    scenario,
  )
)
  throw new Error("Unknown native embedding scenario");
const sessionOrigin =
  scenario === "session-recovery"
    ? new URL(process.env.WORKERS_SESSION_ORIGIN)
    : null;
if (
  sessionOrigin &&
  (sessionOrigin.protocol !== "https:" ||
    sessionOrigin.hostname !== "localhost" ||
    !sessionOrigin.port)
)
  throw Error("Use the local recovery fixture HTTPS origin");
const root = new URL("./", import.meta.url);
const output = new URL(
  platform === "ios"
    ? "ios/Sources/Consumer/PrivateWeb/"
    : `android/app/src/main/assets/sdk-web${scenario === "normal" || sessionOrigin ? "" : scenario === "startup-failure" ? "-failure" : "-broken"}/`,
  root,
);
const entry = new URL(`${platform}.js`, distribution);
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: fileURLToPath(root),
  stdin: {
    contents: `import { ${platform === "ios" ? "workersIOS" : "workersAndroid"} as create } from ${JSON.stringify(fileURLToPath(entry))};
const app = create(${JSON.stringify(sessionOrigin ? { baseURL: sessionOrigin.origin, remote: { origin: sessionOrigin.origin }, render: "/" } : { baseURL: "https://worker.invalid", render: "/" })});
app.ready.catch(error => { console.error("EMBED_START_FAILED", error); });`,
    resolveDir: fileURLToPath(root),
    sourcefile: "native-entry.js",
  },
  outfile: fileURLToPath(new URL("main.js", output)),
  bundle: true,
  format: "esm",
  platform: "browser",
  plugins: [
    workersCapacitorPlugin({
      worker:
        scenario === "startup-failure" ? "./worker-failure.js" : "./worker.js",
      execution: sessionOrigin ? "network" : "local",
    }),
  ],
});
await writeFile(
  new URL("index.html", output),
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module" src="/${scenario === "broken-entry" ? "missing-entry.js" : "main.js"}"></script>`,
);
