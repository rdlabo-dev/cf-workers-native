export type {
  WorkerExecution,
  WorkerExecutionMode,
  LocalRoute,
} from "./server.js";
import { guardHtmlAssets } from "./server-only-html.js";
import {
  assertSeparateOutput,
  assertNoOutputLinks,
} from "./build-isolation.js";
import { serverOnlyFiles } from "./server-only.js";
import { readWorkerFiles } from "./files.js";
import { lowerAsync, asyncContextPlugin } from "./async.js";
import { documentAssets, listAssets } from "./documents.js";
import { serverModules } from "./server-modules.js";
import type { ServerBuildOptions } from "./server.js";
import { resolve, dirname, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import {
  configuredPath,
  compatibilityAliases,
  compatibilityDependencies,
  processStatePath,
  commonJSCompatibilityAliases,
  globalsInstallPath,
  nodeGlobalsInstallPath,
  globalsPath,
  globalsInjectPath,
  workerEntry,
} from "./shared.js";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import inject from "@rollup/plugin-inject";
import type { Plugin, PluginOption } from "vite";
import { normalizePath } from "vite";

/** Add only to the Capacitor/browser build, never the Cloudflare build. */
function compatibilityPlugins(
  installGlobals: false | "worker" | "node" = false,
): PluginOption[] {
  // Overrides take bare module names only; both bare and "node:" imports of
  // the same module resolve to the shared compat profile.
  const globalsRuntimePath = globalsInjectPath.replace(
    /inject\.js$/,
    "runtime.js",
  );
  const aliases = compatibilityAliases();
  const commonJS = commonJSCompatibilityAliases();
  const commonJSPaths = new Map(
    Object.entries(commonJS).map(([specifier, path]) => [
      normalizePath(aliases[specifier as keyof typeof aliases]!),
      path,
    ]),
  );
  const overrides = Object.fromEntries(
    Object.entries(aliases).filter(([specifier]) => !specifier.includes(":")),
  );
  return [
    {
      name: "workers-capacitor-async-context",
      enforce: "post",
      transform(code, id) {
        if (/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return lowerAsync(code, id);
      },
      renderChunk(code, chunk) {
        return lowerAsync(code, chunk.fileName);
      },
    },
    ...(installGlobals
      ? [
          {
            name: "workers-capacitor-global-install",
            enforce: "pre" as const,
            transform(code: string, id: string) {
              // CommonJS proxy modules are already generated ESM. Injecting a
              // require into their virtual .cjs IDs leaves it unbundled.
              if (id.startsWith("\0")) return;
              const path = normalizePath(id.split("?")[0]);
              if (
                !/\.[cm]?[jt]sx?$/.test(path) ||
                path.includes("/node_modules/") ||
                path.startsWith(
                  normalizePath(resolve(globalsPath, "../../../")),
                )
              )
                return;
              const installation = JSON.stringify(
                installGlobals === "worker"
                  ? globalsInstallPath
                  : nodeGlobalsInstallPath,
              );
              return /\.c[jt]s$/.test(path)
                ? `require(${installation});\n${code}`
                : `import ${installation};\n${code}`;
            },
          },
        ]
      : []),
    {
      name: "workers-capacitor",
      enforce: "pre",
      async resolveId(source, importer, options) {
        if (options.custom?.["node-resolve"]?.isRequire)
          return commonJS[source] ?? commonJSPaths.get(normalizePath(source));
        if (!importer || !source.startsWith(".")) return;
        const root = normalizePath(resolve(globalsPath, "../../.."));
        const owner = normalizePath(importer.split("?")[0]);
        if (!owner.startsWith(`${root}/`)) return;
        const target = normalizePath(resolve(dirname(owner), source));
        // Runtime-relative imports and public builtins must resolve to the same
        // optimized module. Keep internal buffer/performance imports untouched.
        let specifier: string | undefined;
        if (target === `${root}/compat/stream-web/index.js`)
          specifier = "node:stream/web";
        else if (target === `${root}/browser/response/index.js`)
          specifier = "cf-workers-native:response";
        else if (target === `${root}/browser/headers/index.js`)
          specifier = "cf-workers-native:headers";
        else if (
          owner === `${root}/browser/body/stream-body.js` ||
          owner === `${root}/shared/globals/web.js`
        ) {
          if (target === `${root}/compat/buffer/blob.js`)
            specifier = "node:buffer";
          if (target === `${root}/compat/perf-hooks/performance.js`)
            specifier = "node:perf_hooks";
        }
        if (specifier)
          return this.resolve(specifier, importer, { skipSelf: true });
      },
      config: () => ({
        // Generated Workers (including OpenNext) can mix ESM exports with
        // require() calls in .mjs files outside node_modules.
        build: {
          commonjsOptions: {
            include: [/node_modules/, /\.[cm]?js$/],
            extensions: [".js", ".cjs", ".mjs"],
            transformMixedEsModules: true,
          },
        },
        // App globals and dependencies must share Buffer identity and the HTTP registry.
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              asyncContextPlugin(),
              {
                name: "workers-capacitor-commonjs-builtins",
                setup(build) {
                  build.onResolve(
                    {
                      filter: /^(?:node:)?[\w/]+$/,
                    },
                    ({ path, kind }) =>
                      kind === "require-call" && commonJS[path]
                        ? { path: commonJS[path] }
                        : undefined,
                  );
                },
              },
            ],
          },
          include: compatibilityDependencies(),
        },
        resolve: {
          alias: aliases,
        },
      }),
    },
    ...nodePolyfills({
      overrides,
      globals: { Buffer: false, global: false, process: false },
    }),
    {
      ...inject({
        Buffer: [globalsInjectPath, "Buffer"],
        // util reads process during Buffer initialization. Keep this import
        // on the shared state leaf: importing the full process adapter here
        // would cycle through events/util in optimized development chunks.
        process: [processStatePath, "default"],
        global: [globalsRuntimePath, "global"],
        setImmediate: [globalsRuntimePath, "setImmediate"],
        clearImmediate: [globalsRuntimePath, "clearImmediate"],
        // Static requires were bundled above; remaining resolve references
        // must fail explicitly when called rather than during module setup.
        "require.resolve": [
          resolve(dirname(aliases["module"]), "resolve-unavailable.js"),
          "default",
        ],
        exclude: [
          normalizePath(globalsPath),
          normalizePath(globalsInjectPath),
          normalizePath(globalsRuntimePath),
          normalizePath(globalsInstallPath),
        ],
      }),
      enforce: "post",
    },
  ];
}

// A real-looking absolute ID survives Vite's worker query stripping without
// writing generated entry files into the consumer's project.
const entrySuffix = ".workers-capacitor-worker.js";
function virtualId(
  source: string,
  root: string,
  owns: (path: string) => boolean,
) {
  const [path, ...query] = source.split("?");
  const candidates = [path];
  if (path.startsWith("/@fs/"))
    candidates.push(
      /^[a-z]:/i.test(path.slice(5)) ? path.slice(5) : "/" + path.slice(5),
    );
  if (root && path.startsWith("/"))
    candidates.push(normalizePath(resolve(root, "." + path)));
  const match = candidates.find(owns);
  return match
    ? match + (query.length ? "?" + query.join("?") : "")
    : undefined;
}
function workerEntryPlugin(
  entries: Map<string, string>,
  root: () => string,
  virtualFiles?: () => Promise<string | undefined>,
): Plugin {
  return {
    name: "workers-capacitor-entry",
    enforce: "pre",
    resolveId(source) {
      return virtualId(source, root(), (path) => entries.has(path));
    },
    load(id) {
      const [path, query = ""] = id.split("?");
      if (entries.has(path) && !new URLSearchParams(query).has("worker")) {
        const original = entries.get(path)!;
        if (!virtualFiles) return workerEntry(original);
        return virtualFiles().then((files) => workerEntry(original, files));
      }
    },
  };
}

/** Add only to the Capacitor/browser build, never the Cloudflare build. */
export interface WorkersCapacitorPluginOptions extends ServerBuildOptions {
  /** Workers application entry, relative to Vite root or an absolute path. */
  worker?: string;
  /**
   * Additional files embedded into the worker's read-only virtual filesystem.
   * Only explicitly selected public files are included; server build metadata
   * is never discovered recursively.
   * Paths resolve relative to the Vite root; the
   * normalized absolute path is the lookup key, with suffix matching so
   * bundled runtimes find entries regardless of their cwd assumptions.
   */
  workerFiles?: string[];
}
export function workersCapacitorPlugin(
  options: WorkersCapacitorPluginOptions = {},
): PluginOption[] {
  const entries = new Map<string, string>();
  const virtualFiles = () =>
    readWorkerFiles(root, options.workerFiles, options.serverOnly);
  let root: string;
  let publicDir: string;
  let htmlEnv: Record<string, string>;
  let denied: ReturnType<typeof serverOnlyFiles>;
  let server: ReturnType<typeof serverModules> | undefined;
  let outputDirectory: string | undefined;
  const serverPlugin = (): Plugin => ({
    name: "workers-capacitor-server",
    enforce: "pre",
    resolveId(id) {
      if (this.environment.config.consumer === "server")
        this.error("workersCapacitorPlugin cannot build a server environment");
      return virtualId(id, root, (path) => server?.owns(path) ?? false);
    },
    transform(_code, id) {
      denied.assertPublic(id);
    },
    async load(id) {
      denied.assertPublic(id);
      if (outputDirectory && isAbsolute(id))
        assertSeparateOutput(outputDirectory, [id.split("?")[0]]);
      if (!server) return;
      const path = id.split("?")[0];
      const generated = await server.load(path);
      if (generated) {
        // Declared file contents are replaced before analysis and cannot affect
        // the mobile output. Keep them out of client-asset provenance below.
        for (const input of generated.inputs)
          if (!denied.matches(input)) this.addWatchFile(input);
        return { code: generated.code, map: null };
      }
      await server.guard(path);
    },
    generateBundle() {
      // Vite's CSS and new URL assets can be inlined without loading a module.
      // Their tracked source files still identify what entered the client build.
      for (const path of this.getWatchFiles()) denied.assertPublic(path);
    },
    buildEnd() {
      if (outputDirectory)
        assertSeparateOutput(outputDirectory, this.getWatchFiles());
    },
    async handleHotUpdate(ctx) {
      const previous = await server?.get();
      if (previous?.inputs.includes(ctx.file)) {
        server?.reset();
        ctx.server.moduleGraph.invalidateAll();
        ctx.server.ws.send({ type: "full-reload" });
        return [];
      }
    },
  });
  const assetGuard = (): Plugin => ({
    name: "workers-capacitor-server-only-urls",
    async transform(code, id) {
      if (
        !options.serverOnly?.length ||
        !code.includes("import.meta.url") ||
        !code.includes("URL")
      )
        return;
      const paths: string[] = [];
      const visit = (node: import("estree").Node) => {
        if (
          node.type === "NewExpression" &&
          node.callee.type === "Identifier" &&
          node.callee.name === "URL"
        ) {
          const [value, base] = node.arguments;
          if (
            base?.type === "MemberExpression" &&
            base.object.type === "MetaProperty" &&
            base.object.meta.name === "import" &&
            base.property.type === "Identifier" &&
            base.property.name === "url"
          ) {
            const path =
              value?.type === "Literal" && typeof value.value === "string"
                ? value.value
                : value?.type === "TemplateLiteral" && !value.expressions.length
                  ? value.quasis[0].value.cooked
                  : undefined;
            if (path) paths.push(path);
          }
        }
        for (const value of Object.values(node))
          for (const child of Array.isArray(value) ? value : [value])
            if (
              child &&
              typeof child === "object" &&
              typeof child.type === "string"
            )
              visit(child);
      };
      visit(this.parse(code));
      for (const path of paths) {
        // Vite does not track new URL files with query suffixes as watch inputs.
        // Resolve aliases as well as relative paths before built-in inlining.
        const resolved = await this.resolve(path, id, { skipSelf: true });
        denied.assertPublic(resolved?.id ?? resolve(dirname(id), path));
      }
    },
  });
  return [
    serverPlugin(),
    assetGuard(),
    {
      name: "workers-capacitor-source",
      enforce: "pre",
      config: () => ({
        optimizeDeps: { exclude: ["cf-workers-native"] },
        worker: { format: "es" },
      }),
      transformIndexHtml: {
        order: "pre",
        handler(html, context) {
          if (options.serverOnly?.length)
            guardHtmlAssets(
              html.replace(/%(\S+?)%/g, (match, key) => htmlEnv[key] ?? match),
              context.filename,
              root,
              denied.assertPublic,
            );
        },
      },
      configResolved(config) {
        if (
          config.build.ssr ||
          Object.entries(config.environments).some(
            ([name, environment]) =>
              environment.consumer === "server" &&
              // Vite adds an unused default SSR environment to every dev server.
              // Its actual use is rejected by the server-environment hooks.
              (config.command === "build" || name !== "ssr"),
          ) ||
          config.plugins.some((plugin) =>
            /^vite-plugin-cloudflare(?::|$)/.test(plugin.name),
          )
        )
          throw new Error(
            "workersCapacitorPlugin is only for a separate Capacitor/browser build; do not add it to the Cloudflare or SSR build.",
          );
        root = config.root;
        outputDirectory = config.build.write
          ? resolve(root, config.build.outDir)
          : undefined;
        if (outputDirectory && options.worker)
          assertSeparateOutput(outputDirectory, [
            resolve(root, options.worker),
          ]);
        if (outputDirectory) assertNoOutputLinks(outputDirectory);
        htmlEnv = { ...config.env };
        // Match Vite HTML substitution, including define overrides of env.
        for (const [key, value] of Object.entries(config.define ?? {})) {
          if (!key.startsWith("import.meta.env.")) continue;
          let replacement =
            typeof value === "string" ? value : JSON.stringify(value);
          if (typeof value === "string") {
            try {
              const parsed: unknown = JSON.parse(value);
              if (typeof parsed === "string") replacement = parsed;
            } catch {
              /* Vite retains non-JSON strings. */
            }
          }
          htmlEnv[key.slice(16)] = replacement;
        }
        denied = serverOnlyFiles(root, options.serverOnly);
        publicDir = config.publicDir;
        if (options.worker)
          server = serverModules(resolve(root, options.worker), root, options);
      },
      async buildStart() {
        if (outputDirectory) assertNoOutputLinks(outputDirectory);
        if (this.environment.config.consumer === "server")
          this.error(
            "workersCapacitorPlugin cannot build a server environment",
          );
        if (outputDirectory && server)
          assertSeparateOutput(outputDirectory, (await server.get()).inputs);
        denied = serverOnlyFiles(root, options.serverOnly);
        if (publicDir && existsSync(publicDir))
          denied.assertDirectory(publicDir);
        for (const file of options.workerFiles ?? [])
          denied.assertPublic(resolve(root, file));
      },
      generateBundle: {
        order: "post",
        async handler(_options, bundle) {
          for (const asset of Object.values(bundle)) {
            if (asset.type === "asset")
              for (const path of asset.originalFileNames)
                denied.assertPublic(resolve(root, path));
          }
          const files = [
            ...Object.keys(bundle),
            ...(publicDir ? await listAssets(publicDir) : []),
          ];
          const compilation = await server?.get();
          if (compilation) {
            const fileName = compilation.reportFile;
            if (files.includes(fileName))
              this.error("Server report asset collision: " + fileName);
            const { mode, reason, routes } = compilation;
            this.emitFile({
              type: "asset",
              fileName,
              source: JSON.stringify({ mode, reason, routes }, null, 2),
            });
            files.push(fileName);
          }
          const assets = await documentAssets(files);
          for (const [fileName, source] of Object.entries(assets)) {
            if (files.includes(fileName))
              this.error("Document asset collision: " + fileName);
            this.emitFile({ type: "asset", fileName, source });
          }
        },
      },
      async load(id) {
        if (
          id.split("?")[0] !== normalizePath(configuredPath) ||
          !options.worker
        )
          return;
        const path = resolve(root, options.worker);
        const compilation = await server?.get();
        // Resolve only the selected graph: CommonJS resolution may eagerly load
        // its target, and server source must never enter the client graph.
        const resolved = await this.resolve(
          compilation ? server!.localEntry : path,
          undefined,
          {
            skipSelf: true,
          },
        );
        if (!resolved || resolved.external)
          this.error("Cannot resolve Worker entry: " + path);
        if (compilation) this.warn(compilation.message);
        const entry = resolved.id;
        const generated = entry + entrySuffix;
        if (existsSync(generated))
          this.error(
            "Generated Worker entry conflicts with an existing file: " +
              generated,
          );
        entries.set(generated, entry);
        return `import Constructor from ${JSON.stringify(generated + "?worker")};
${compilation ? `import { needsRemote, requiresRemote } from ${JSON.stringify(server!.selectorEntry)};` : ""}
import { installNodeGlobals } from ${JSON.stringify(globalsPath)};
export default { createWorker: () => new Constructor(), ${compilation ? "needsRemote, requiresRemote," : ""} async loadDirect() {
  const dispose = installNodeGlobals();
  try {
    return { handler: (await import(${JSON.stringify(entry)})).default, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
} };`;
      },
    },
    workerEntryPlugin(entries, () => root, virtualFiles),
    {
      name: "workers-capacitor-worker-build",
      config(config) {
        const previous = config.worker?.plugins;
        return {
          worker: {
            plugins: () => [
              ...(previous?.() ?? []),
              serverPlugin(),
              assetGuard(),
              workerEntryPlugin(entries, () => root, virtualFiles),
              ...compatibilityPlugins("worker"),
            ],
          },
        };
      },
    },
    ...compatibilityPlugins(options.worker ? false : "node"),
  ];
}
