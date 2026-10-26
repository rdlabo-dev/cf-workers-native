# Build setup

Choose your application's framework first, then configure the build tool used for
its iOS, Android or Capacitor integration. The framework guide identifies the Worker entry and
execution boundary; the tool plugin connects that entry to the mobile app.
Keep the existing Cloudflare build separate.

Use a separate configuration and output directory for the mobile build. The
plugin reads the server entry and deployment configuration; it generates a mobile
copy without rewriting those inputs. Vite rejects SSR/server environments and
configurations containing the Cloudflare Vite plugin. Both builders reject output
directories containing known server inputs, and existing links inside the output
directory are rejected to prevent writes through them. Do not reuse an arbitrary
Cloudflare deployment directory as mobile output: the plugin cannot identify every
custom build directory. OpenNext route compilation uses a disposable directory in
`node_modules/.cache/workers-capacitor/opennext`, outside `.next` and `.open-next`.

These build boundaries preserve the existing Cloudflare deployment. Explicit
client choices such as local execution, remote origin and `getToken` still control
which requests reach it and how the client authenticates; they do not modify the
server's routes, authorization logic or bindings.

## Choose the runtime entry

The bundler plugin stays `workersCapacitorPlugin` for every host. Only the
application's runtime import changes; Worker source and execution options are shared.

| Host      | Runtime import                                        | Native setup                                        |
| --------- | ----------------------------------------------------- | --------------------------------------------------- |
| iOS       | `workersIOS` from `cf-workers-native/ios`             | [UIKit / SwiftUI](native-embedding.md#ios)          |
| Android   | `workersAndroid` from `cf-workers-native/android`     | [Existing Android app](native-embedding.md#android) |
| Capacitor | `workersCapacitor` from `cf-workers-native/capacitor` | [Capacitor app](integration.md)                     |

Use `cf-workers-native@0.1.7` with matching
native dependencies; see [dependency setup](native-embedding.md#dependency-setup).
Build the corresponding entry for each target, then package the entire output
directory. Existing Capacitor examples below use `workersCapacitor`; the same
options apply to `workersIOS` and `workersAndroid` in their SDK hosts.

## Frameworks

For the first mobile build, keep the default network execution and configure the
deployed Worker's HTTPS URL. Unsupported server APIs can stay on that Worker;
they do not need local polyfills. A client-side library that rejects the WebView
origin before sending a request still needs an integration change. Remote dispatch
does not repair that client initialization failure.

Network execution requires connectivity. A failed mutation is reported to the
caller without automatic replay. Route selection happens before a local handler
runs; a local exception never causes the request to be retried remotely. If an
optional local route cannot be safely split, keep the whole Worker remote and
inspect the generated binding report. Explicit `execution: "local"` requires its
own supported API profile and does not opt into this fallback.

The following integrations have examples and verification evidence. Support is
scoped to the execution paths described here; see the [compatibility limits](compatibility.md)
for API and application restrictions.

| Framework          | Execution and verified scope                                                                                                                                                                                    | Setup                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Hono               | Local Fetch handlers and HTML pages; routing, forms and request/response behavior are exercised in the Hono fixtures. Cloud-dependent requests use remote dispatch.                                             | [Hono entry](#hono), [native rendering example](../demo/rendering)                       |
| Workers Express    | Local execution through `cloudflare:node`; API and HTML rendering fixtures. Cloud-dependent requests use remote dispatch.                                                                                       | [Workers Express entry](#workers-express), [native rendering example](../demo/rendering) |
| Void React Pages   | SSR, loaders and actions on the remote Worker; client hydration and forms in the WebView. Use Void / @void/react 1.1.12 or newer; published 1.1.12 packages pass iOS simulator and Android emulator acceptance. | [Void setup and verification](void.md)                                                   |
| Next.js / OpenNext | Network execution is the default. Supported generated builds can select static GET routes locally while keeping D1, middleware and Next protocol requests remote; see the version and configuration limits.     | [OpenNext setup and limits](opennext.md)                                                 |

### Hono

Connect the application's existing Fetch Handler. For example:

```ts
import { Hono } from "hono";

const app = new Hono();
app.get("/", (c) => c.html("<h1>Hello from Hono</h1>"));
app.get("/api/hello", (c) => c.json({ hello: "world" }));
export default app;
```

Point the [Vite](#vite) or [esbuild](#esbuild) plugin's `worker` option at this
entry. Use `render: "/"` for Worker-owned pages, or omit `render` when integrating
an existing frontend with the API. Follow the [application integration guide](integration.md)
for Capacitor setup, cloud bindings and authentication.

Start with the default `execution: "network"` and set `baseURL` to the deployed
Worker's HTTPS URL. Remote requests use its origin unless you explicitly set
`remote.origin` to a different deployed origin. To permit selected implementations to ship to the device, set
`execution` to a route array. Hono paths such as `/app/*` are supported. Permission
includes retained dependency data and does not override detected server boundaries.
See [local route selection](cloudflare-bindings.md#selecting-local-routes).

### Workers Express

The sample uses the real `express` package and the Workers entry style:

```ts
import express from "express";
import { httpServerHandler } from "cloudflare:node";

const app = express();
app.use(express.json());
app.get("/api/hello", (_req, res) => res.json({ hello: "world" }));
app.listen(3000);
export default httpServerHandler({ port: 3000 });
```

Use the [Vite](#vite) or [esbuild](#esbuild) plugin only in the mobile/browser build, never the Cloudflare build. It supplies Workers-compatible `node:http` and `node:net` adapters alongside browser polyfills; the [compatibility inventory](compatibility.md) records the verified baseline and modules. `listen(3000)` registers an in-memory handler, not a listening TCP port. The plugin supports both Hono and Workers Express; framework code stays unchanged.

The default `execution: "network"` keeps the Worker entirely remote. Set `baseURL`
in `workersCapacitor()` to the deployed Worker's HTTPS URL; set `remote.origin`
only when the remote origin must differ from `baseURL`'s origin.
For a deliberately standalone Express app, add `execution: "local"` to the
Vite or esbuild plugin options below. This permits the entire Worker implementation
and retained fixed data to ship to the device; do not use it with server secrets.
Configured server bindings make `local` fail the build. See
[execution policies](cloudflare-bindings.md#choosing-execution).

#### TypeScript types

The package provides the `cloudflare:node` type for its supported `httpServerHandler` adapter. For a browser build without existing Workers type declarations, add it to `compilerOptions.types` in `tsconfig.json`:

```json
{ "compilerOptions": { "types": ["cf-workers-native/cloudflare/apis/types"] } }
```

Keep any other types your project already uses. This is a type-only entry; do not import it at runtime. Projects with generated Workers types should keep those declarations instead. No application-owned `cloudflare.d.ts` or `client.d.ts` is needed.

### Angular on Workers

This integration is not yet verified. The target is an **existing Angular SSR
application deployed on Cloudflare Workers**, preserving its rendering, routing
and hydration when brought to Capacitor. A dedicated Worker-entry configuration
and acceptance sample are still needed before it can be listed as supported.

Vite or esbuild support alone does not establish Angular SSR support. The
Fetch-only integration of a separate frontend is a different use case.

## Tools

These versions describe the separate mobile build. A framework's existing
cloud build may use a different tool or version; keep it unchanged and connect
its generated Worker as described in the framework guide.

| Build              | Setup                                      | Input                                                                              |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Vite 7             | `cf-workers-native/tooling/vite` plugin    | TypeScript / JavaScript Worker entries, including framework output described above |
| esbuild 0.28       | `cf-workers-native/tooling/esbuild` plugin | TypeScript / JavaScript Worker entries, including framework output described above |
| Browser ES Modules | Explicit Worker source below               | Browser-compatible JavaScript only                                                 |

Other bundlers are not currently supported. Add these plugins only to the mobile/browser build, never the Cloudflare build.

### Vite

Add the plugin to the mobile/browser Vite configuration:

```ts
import { defineConfig } from "vite";
import { workersCapacitorPlugin } from "cf-workers-native/tooling/vite";

export default defineConfig({
  plugins: [workersCapacitorPlugin({ worker: "./src/worker.ts" })],
});
```

`src/worker.ts` is your existing application entry exporting a Fetch Handler (for example, Hono’s `export default app`), not a library transport module. The plugin's `worker` path is relative to the Vite root (absolute paths also work). The plugin connects that entry to the normal package import; no special import or generated source file is needed in application code.

### esbuild

For esbuild, use the same application code with this build configuration:

```js
import { build } from "esbuild";
import { workersCapacitorPlugin } from "cf-workers-native/tooling/esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outdir: "www",
  bundle: true,
  format: "esm",
  platform: "browser",
  plugins: [workersCapacitorPlugin({ worker: "./src/worker.ts" })],
});
```

The entry path is relative to `absWorkingDir` (or the current directory). Serve the entire output directory, including emitted Worker assets and lazy direct modules. Worker compilation uses the plugin's compatibility transforms; additional application plugins are not applied to the Worker bundle. Browser ESM output with `outdir` or `outfile` is required. Worker entries must bundle into a single JavaScript file; separate CSS/file assets are not supported.

### Browser ES Modules (no bundler)

This path is for Fetch-only integration and does not automatically prepare native document assets. Without a bundler, copy the package's `dist` directory to your public `lib` directory and use ordinary relative ES Module imports:

```js
// main.js (loaded with <script type="module">)
import { workersCapacitor } from "./lib/index.js";

const runtime = workersCapacitor({
  baseURL: "https://api.example.com/api/",
  worker: {
    createWorker: () =>
      new Worker(new URL("./worker-entry.js", import.meta.url), {
        type: "module",
      }),
    loadDirect: async () => (await import("./worker.js")).default,
  },
});
await runtime.ready;
```

```js
// worker-entry.js
import { serve } from "./lib/browser/isolated/transport.js";
import worker from "./worker.js";
serve(worker);
```

`worker.js` exports the existing Fetch Handler. All its dependencies must also be browser-compatible ES Modules with resolvable URLs. This path does not transform TypeScript, bare npm imports, Node APIs or `cloudflare:*` imports. The public bundled equivalent of `lib/browser/isolated/transport.js` is `cf-workers-native/browser/isolated`.
