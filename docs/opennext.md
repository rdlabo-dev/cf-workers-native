# OpenNext and vinext support

OpenNext and vinext use the Workers compatibility profile. Support depends on
where the request executes; remote rendering does not establish local framework
compatibility. The [standalone OpenNext sample](../demo/opennext/README.md) separates
these paths and keeps its test drivers outside the application.

The default sample uses Next.js 16.4.2. Route splitting also retains the exact
Next.js 15.5.28 compatibility profile with OpenNext 1.20.12. This does not extend
Next.js 15's upstream maintenance period. For that legacy version, build with
`next build` and `opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion`;
route isolation applies the same support-window exception only to 15.5.28.
Use `next build --webpack` for 16.4.2; its support check remains enabled.
Node middleware/proxy and unrecognized build formats remain entirely remote.

## Execution and configuration

### Route execution

For OpenNext 1.20.12 with Next.js 16.4.2 App Router output built using `next build --webpack`, the Vite and esbuild plugins can separate explicitly selected static GET routes. Point `worker` at the ordinary generated Worker; no additional preparation script or Worker wrapper is required:

```ts
workersCapacitorPlugin({
  worker: "../.open-next/worker.js",
  assetsExecution: "remote",
  execution: [
    { method: "GET", path: "/" },
    { method: "GET", path: "/api/message" },
  ],
});
```

The plugin uses the existing `.next` and `.open-next` output to generate a separate local entry. It does not run `next build` or overwrite the deployed Worker. Permissions apply to route registration paths; wildcard and RegExp selection follow the same rules as Hono permissions. Actual request matching remains exact for the supported static routes.

Routes matched by middleware, dynamic/grouped routes, unselected paths, non-GET methods, credential-bearing requests and Next protocol requests remain remote. RSC navigation, Server Actions and local middleware execution are not supported by this route-splitting path. The build report explains which registrations stay remote. If the selected output still needs a Cloudflare environment, the whole selection remains remote.

This integration accepts the standard `defineCloudflareConfig` configuration with `incrementalCache`, `tagCache` and `queue` set to `"dummy"`. Other versions, custom OpenNext configuration, Next rewrites/headers/custom redirects/base paths, and non-public generated environment data remain remote. Keep the original Worker deployed and configure the runtime's `remote.origin` as usual. Generated runtime files must remain alongside the Worker entry.

Route permission includes the selected implementation and retained dependencies. It is not secret detection: review shared code and fixed data before permitting distribution. The plugin isolates known Next-generated preview/action keys in the local output; that does not sanitize arbitrary application credentials. Explicit `workerFiles` and copied public assets remain the application's responsibility.

The [route execution fixture](../demo/tests/opennext/split/README.md) covers Vite/esbuild and Chromium/WebKit. Native route-splitting acceptance covers iOS 26.1 and Android API 36.1, including hydration, RSC navigation to the remote Worker, native plugin events, HttpOnly sessions, D1 form updates, rejected CSRF, expired sessions, restart persistence and logout. The public-HTTPS route scenario also passes on an iPhone 15 Pro Max running iOS 27.0.1 with a dedicated Worker and D1; expiry is checked in the local workerd scenarios. Use `OPENNEXT_SPLIT=1` with the native runner. The [release-skew fixture](../demo/tests/opennext/releases/README.md) prepares separate client/Worker builds to test a compatible HTTP/form rollout; this does not establish compatibility for retained Server Action closures or breaking API/schema changes.

### Whole-Worker execution

- With D1 and asset-first routing, the generated OpenNext Worker executes
  remotely as a whole for requests not served by bundled assets. Configure `worker: ".open-next/worker.js"`,
  `assetsExecution: "remote"` and the deployed HTTPS `remote.origin`.
  The server application is excluded from the device bundle. Leave `workerFiles`
  unset: explicitly selected files are still distributed and are unnecessary here.
- Local execution uses the generated Worker in a Dedicated Worker. The sample's
  test-only profile covers public SSR pages, client hydration, static images/CSS,
  Next.js links and middleware. It does not provide D1 or local ASSETS.
  This demonstrates execution, not a distributable AppShell: the generated
  server JavaScript can still contain server-only code and Next-generated keys.
  Removing filesystem metadata does not make that JavaScript safe to distribute.
- The Vite plugin transforms builtin `require()` calls inside generated ESM
  `.mjs` files. This is a Capacitor build setting; the Cloudflare build stays
  independent.

### Bundle client assets alongside remote pages

In the Capacitor Vite configuration, set `publicDir` to the existing OpenNext asset output. The sample uses an absolute path resolved relative to its config file:

```ts
export default defineConfig({
  root: here("."),
  publicDir: here("../.open-next/assets"),
  plugins: [
    workersCapacitorPlugin({
      worker: here("../.open-next/worker.js"),
      assetsExecution: "remote",
    }),
  ],
  build: { outDir: here("../www"), emptyOutDir: true },
});
```

See the [complete configuration](../demo/opennext/capacitor/vite.config.ts) for imports and `here`. Bundled `/_next/static/` JavaScript, CSS and public images are served by Capacitor. HTML, RSC navigation, middleware, session handling, D1 operations and `/_next/image` remain on the Worker. Hydration and client events execute in the WebView using the bundled scripts. The build report's `mode: "worker"` describes the server handler; it does not mean every asset is remote.

Use the same application build for the deployed Worker and the bundled assets, and preserve compatibility for older installed apps when deploying updates. Missing asset paths fall back to the Worker. Only copy public assets that can bypass server authentication and response-header rules; Capacitor does not implement Cloudflare `_headers` or `_redirects` for bundled files. Neither Vite `publicDir` nor a plain esbuild copy honors `.assetsignore`. Check that the copied output contains only public files; if it includes files excluded from Cloudflare delivery, stage only the intended public assets in a separate directory. Do not copy server-functions or prerender cache output into `publicDir`. A prerendered page may still need middleware, redirects or revalidation, so prerendering alone does not select a page for local execution. Initial page requests still require connectivity.

With esbuild, copy the public asset output into the Capacitor output directory **before** calling `build()` with `workersCapacitorPlugin`. The plugin includes existing files in the document asset manifest. Keep the bootstrap `index.html` separate from framework pages and avoid path collisions. No additional asset API is needed.

See the [Node inventory](compatibility.md) for remaining runtime restrictions.

## What the runtime provides

| Surface                              | Implementation                                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare:workers` `env`           | During direct and isolated dispatch the proxy reads the current request’s bindings. Initial module evaluation sees no bindings. Use the handler argument for callbacks outside request context.                                          |
| `cloudflare:workers` `DurableObject` | Base class so OpenNext's exported DO subclasses (queue, tag cache, cache purge) resolve and construct. No DO storage; configure `open-next.config` with `incrementalCache: "dummy"`, `tagCache: "dummy"`, `queue: "dummy"` to drop them. |
| `node:async_hooks`                   | Scoped ALS approximation (see Async context below).                                                                                                                                                                                      |
| `node:fs` / `node:fs/promises`       | Read-only in-memory virtual filesystem. `readFile(Sync)`, `readdir(Sync)`, `existsSync`, `stat(Sync)`, `lstat(Sync)`, `realpathSync`, `promises.{readFile,readdir,stat,lstat,realpath,access}`. Writes throw.                            |
| `node:module`                        | `builtinModules`, `isBuiltin`, `createRequire` (VFS-backed `.json` only; executable modules throw).                                                                                                                                      |
| `node:stream/web`                    | Owned stream adapter with a packaged byte-stream fallback when the host lacks it; full Workers stream parity remains unverified.                                                                                                         |
| `node:util`                          | Module-owned util implementation and shared contracts, with remaining export/engine gaps listed in the inventory.                                                                                                                        |
| Other `node:*`                       | Module-owned implementations plus dependency fallbacks; the current alias table is `src/tooling/shared.ts`. Importability is not whole-module acceptance; see the Node inventory.                                                        |

## Explicit runtime files (`workerFiles`)

Server build directories are not copied into the device filesystem. A `.json`
extension does not establish that a file is public: Next.js manifests can contain
server-generated keys and configuration. The tested local renderer does not need
these files copied alongside its bundled code.

Public application data read through `node:fs` can be selected with `workerFiles`
as individual paths (not directories). These files are distributed verbatim;
only select data intended for every app user:

```ts
workersCapacitorPlugin({
  worker: "./src/worker.ts",
  execution: "local", // Only for code and dependencies permitted on every device.
  // Public data read by this local Worker:
  workerFiles: ["./templates/email.txt"],
});
```

VFS lookups normalize separators and suffix-match, so absolute traced paths
resolve regardless of the bundle's build-time directory.

## Async context (the real boundary)

- The Capacitor Vite/esbuild plugins lower async functions and generators to
  Promise continuations while preserving top-level `await`. The compatibility
  implementation captures context at callback registration and restores it after
  each synchronous scope. Concurrent and nested async scopes use separate stores;
  dispatch serialization is no longer required for the shared ALS contract.
- Untransformed native async callbacks passed to `run`/`exit` reject before execution
  instead of silently leaking another request's store. Dynamic code and externally
  built modules must participate in the same transform.
- The transforms and aliases belong only in the Capacitor build. Cloudflare keeps
  its native `node:async_hooks`; the Worker application source is unchanged.
- Direct-mode patches affect the UI realm too. Prefer an isolated Worker for
  ALS-dependent applications. Full OpenNext native acceptance remains separate
  from the shared ALS contract.

## Upstream application acceptance

The [official App Router acceptance fixture](../demo/tests/upstream/opennext/README.md) pins an upstream OpenNext application and preserves its application source and configuration. It covers hydrated Server Actions, form actions with redirects/query parameters, and delayed SSR with a Suspense loading fallback. Native tests exercise remote Worker execution and WebView hydration through the public API; they do not establish local Server Action support. The browser baseline runs separately in CI. See the fixture for reproduction commands and proxy/streaming test boundaries.

## Current gaps

- The sample's native scenarios cover public pages and remote D1/session flows,
  not arbitrary Next.js applications or release-build performance.
- **Bindings:** use the [remote binding configuration](cloudflare-bindings.md) for cloud services or explicit local KV in direct mode. ASSETS remains remote-only. These general integrations do not establish OpenNext cache/binding compatibility; the smoke configuration uses dummy caches.
- `createRequire` loads `.json` only; executable traced files must already be
  bundled by OpenNext (they are).
- `/_next/image` uses the remote Worker's IMAGES binding. The `/images` fixture checks actual PNG-to-WebP transformation and output dimensions through native rendering. The public-HTTPS scenario also verifies the deployed Cloudflare IMAGES binding on an iPhone 15 Pro Max running iOS 27.0.1 without installing a test CA. Custom `cdn-cgi` loaders remain unverified.
- The document host preserves observed Origin/Fetch Metadata. iOS recovers a missing form Origin only for a verified local main-frame initiator; opaque or unknown initiators remain untrusted. Keep CSRF validation. The sample uses a random token and a Secure, HttpOnly `__Host-` cookie.
- Native acceptance checks functional behavior. Earlier single-sample Debug timing, bundle-size and host-process RSS artifacts were exploratory measurements, not regression budgets; the functional harness no longer collects them. Release-build startup distributions and peak memory remain unverified.
