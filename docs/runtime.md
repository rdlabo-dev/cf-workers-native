# Runtime behavior

There are two separate decisions: cloud-binding dispatch selects local or remote
request execution; `prefer` selects a local JavaScript environment. A local
Dedicated Web Worker runs on the device, not on Cloudflare.

## Fetch-only integration

For an existing frontend calling Worker APIs, configure the Worker in the [Capacitor build](build-setup.md) and omit `render`. Initialize before mounting the UI:

```ts
import { workersCapacitor } from "cf-workers-native/capacitor";

const runtime = workersCapacitor({
  baseURL: "https://api.example.com/api/",
});
await runtime.ready;

const response = await fetch("/api/hello");
```

The existing UI keeps its ordinary Fetch calls. Matching requests use the configured local or remote Worker; requests outside the boundary keep their normal Fetch behavior. For cloud-dependent routes, configure the bindings and remote origin using the [integration guide](integration.md).

## Execution preference

The default `prefer: "worker"` starts a Dedicated Web Worker when available and the initial `env` contains only plain data. If Worker is absent, its constructor reports SecurityError/NotSupportedError, or `env` contains methods/custom prototypes/accessors (such as local KV bindings), it selects direct execution before handling any request. `prefer: "direct"` loads the direct module without creating a Worker. Direct execution is always the available baseline; a module or application error does not mean it is unavailable.

Await `runtime.ready` and inspect `runtime.execution` (`"worker"` or `"direct"`) to observe the selection. Direct code is dynamically imported only when selected. Selection happens once: startup script failures and request errors are reported, never replayed in the other environment. This is not automatic detection of every unsupported Workers API. Changes to `env` after selection do not trigger reselection. Worker selection conservatively accepts primitives, ordinary objects and arrays (including cycles), without non-enumerable custom properties or null prototypes; other structured-clone-capable types currently select direct too.

## Initialization and cleanup

Installation synchronously intercepts fetch. Worker-mode requests wait for startup; matching requests during direct-module loading reject explicitly to prevent top-level-await deadlocks. Await `runtime.ready` before starting UI requests. The runtime cannot distinguish module-initialization calls from concurrent UI calls, so both reject while direct loading is in progress. `await runtime.ready` observes startup success/failure before rendering the UI. `await workersCapacitor(...)` does **not** await Worker startup.

Only one installation is supported; `await runtime.dispose()` restores fetch, terminates the Dedicated Worker and waits for asynchronous cleanup when needed. Termination rejects unfinished local calls/body reads and releases background tracking.

## Explicit Worker sources

Explicit direct-handler imports and standard `new Worker(new URL(...), { type: "module" })` factories are supported. `prefer` requires the plugin configuration or an explicit source with both `createWorker` and `loadDirect`; it cannot manufacture a second candidate from a handler or factory alone.

Direct imports remain supported: `import worker from "./worker"` supplies an object with `fetch` and runs in the UI global scope. Hono needs no build plugin in that mode; Workers Express still needs the compatibility plugin. Worker subrequests stay outside UI interception only when `runtime.execution` is `"worker"`; direct fallback shares the UI global environment.

If the Worker or any dependency uses Workers extensions (for example
`Headers.getAll("set-cookie")` or `Request.cf`) during module evaluation, configure
`worker` in the Vite/esbuild plugin as shown in the [build setup guide](build-setup.md). The runtime installs its Web
APIs before loading that entry and its dependencies, in both execution modes.
With a direct static import, module evaluation happens before `workersCapacitor()`
can initialize those APIs; only calls made after initialization use the installed
implementations. For plain JavaScript, use the [`loadDirect` source](build-setup.md#browser-es-modules-no-bundler)
when initialization must precede module evaluation.

## URL contract

### How local requests are selected

The adapter resolves the request URL, then checks both its address and path:

1. The URL must match either the running app's **protocol and host** (including the port), or the origin configured in `baseURL`.
2. Its path must equal the `baseURL` path boundary or be below it. For `/api/`, `/api` and `/api/hello` match; `/apiary` does not.

Matching requests normally run in the local Worker. With cloud-binding build integration, the generated selector can send them to the existing deployed Worker before local execution. The adapter replaces the origin with the `baseURL` origin while preserving the path and query. The protocol alone does not select local execution: `capacitor://other-host/api/hello` does not match an app running at `capacitor://localhost`.

With default Capacitor settings, `fetch("/api/hello")` follows these paths (assuming no `<base>` override and `baseURL: "https://api.example.com/api/"`):

| Platform | Resolved app request URL          | URL received by the local Worker    |
| -------- | --------------------------------- | ----------------------------------- |
| iOS      | `capacitor://localhost/api/hello` | `https://api.example.com/api/hello` |
| Android  | `https://localhost/api/hello`     | `https://api.example.com/api/hello` |

The adapter uses the running app's URL, so custom scheme/hostname settings are handled by the same comparison. Without a generated remote boundary these are local JavaScript calls; neither row sends an HTTP request to `api.example.com`. Requests selected for remote execution instead use `remote.origin`, defaulting to the `baseURL` origin when omitted. Remote options such as `getToken` can be supplied without an origin. Explicit overrides must be valid HTTPS origins and never fall back on validation failure.

### Endpoint examples

For `baseURL: "https://api.example.com/api/"` and an app served at `https://localhost/` (without a `<base>` override):

| URL passed to `fetch()`             | Request endpoint                           | Handled by     |
| ----------------------------------- | ------------------------------------------ | -------------- |
| `/api/hello?name=A`                 | `https://api.example.com/api/hello?name=A` | Local Worker   |
| `https://api.example.com/api/hello` | `https://api.example.com/api/hello`        | Local Worker   |
| `/api`                              | `https://api.example.com/api`              | Local Worker   |
| `/apiary`                           | `https://localhost/apiary`                 | Original fetch |
| `/outside.txt`                      | `https://localhost/outside.txt`            | Original fetch |
| `https://other.example/api/hello`   | `https://other.example/api/hello`          | Original fetch |

For local execution, the endpoint is the URL received by the Worker's Fetch Handler; no HTTP request is sent to that server.

The path in `baseURL` selects a boundary; it is **not appended** to request paths. Relative paths resolve against `document.baseURI` (including `<base href>`) first, falling back to location when no document exists. Same-app URLs (including iOS `capacitor://localhost`) in the boundary are remapped to the base origin. Set a root base URL only if you intend to intercept every same-app fetch. A local 404/500 or exception never retries against the network. In Fetch-only mode, this fetch adapter does not intercept UI navigation, XHR, images or other WebViews. With `render`, a separate [native document bridge](native-rendering-api.md) handles supported document navigation, forms and resource requests.

## Compatibility and limitations

### Verified API behavior

- Covered: Hono and Workers Express GET/POST/HEAD, query and route params, JSON bodies, middleware, 404/500, concurrent requests, Request input, logical URLs.
- Optional `env` injects caller-provided values into the fetch handler's second argument. In isolated mode it is cloned per call: functions/native plugin objects cannot be passed and object identity is not preserved. No Wrangler secret values or cloud binding objects are imported; the build plugins read binding configuration to choose local or remote execution. The `cloudflare:workers` named `env` import reads the current request’s bindings during direct and isolated dispatch. Initial module evaluation sees no bindings. Capture the handler argument for callbacks outside the request context. The isolated transport retains the most recent dispatch’s bindings for reads outside that context.
- `ctx.waitUntil()` tracks promises without delaying the response; `runtime.drain()` waits for them. Errors go to optional `onBackgroundError` (default: console). OS suspension/termination can stop pending work.
- Fetch abort rejects the caller and propagates a signal. It cannot forcibly stop arbitrary application work. Cookies, redirect following, `Response.url` population, credentials/cache policies and CORS enforcement are not emulated for local calls.

See [compatibility and limitations](compatibility.md) for incomplete Node
modules, Workers APIs, cloud services and native transport restrictions.
The [application integration limits](compatibility.md#application-integration-limits)
also cover Better Auth on iOS, passkeys, external-browser OAuth, Void routing,
live analytics and the boundary between simulator checks and physical devices.

### Framework and platform limits

- Workers HTTP request/response streaming and native TCP are covered by shared contracts. File serving, WebSockets, other Node modules and async context propagation require their own compatibility work; the inventory records their status. The compatibility layer is not a general Node runtime.
- `passThroughOnException`, WorkerEntrypoint/RPC and Service Worker format are unsupported. Workers-specific Request fields are covered only where stated in the compatibility inventory; `Request.cf` is preserved locally and is not populated with Cloudflare network metadata. Worker evaluation must not fetch its own local endpoints before installation.
- CapacitorHttp's fetch patch is not tested; leave it disabled for this Preview. The package includes native TCP/TLS transport and document integration sources (iOS SPM / Android Gradle). A plain browser uses browser Fetch; native document rendering requires Capacitor.

### Security and network boundaries

- Treat everything packaged in the app as readable by users. Do not embed database credentials, service tokens or other server secrets.
- For detected remote execution boundaries, the build removes server implementations, including their SQL, from the client bundle. This is not a general secret scanner: inspect the generated build report and bundled assets before shipping.
- Authenticate and authorize requests on the deployed Worker. `remote.getToken` can supply existing bearer credentials, and native rendering supports server-managed Cookie sessions; the library does not provide an authentication system. A URL configured in `remote.origin` does not protect the endpoint.
- Worker-generated HTML runs with the app's Capacitor plugin access. Only render trusted application content; do not use this integration to display arbitrary external pages.

See the [integration security guidance](integration.md) for the client/server boundary and migration checks.

With a direct Worker import, matching Worker subrequests can re-enter the UI handler. In Capacitor, outbound HTTP(S) uses the packaged native transport, including when relayed from a Dedicated Worker. This transport handles headers, redirects and response bytes outside browser CORS enforcement. In a plain browser, outbound requests use browser Fetch and remain subject to its CORS and header restrictions. Neither execution mode is a workerd isolate.

### Worker transport and resource lifetime

The isolated transport streams uploads and responses as pull-driven MessagePort chunks (uploads are split at 64 KiB). Upload handlers can run before EOF; cancellation releases the upload reader. It preserves status/statusText/headers, body cancellation, abort after headers and background completion. Invalid/used/locked responses and status-0 opaque/error responses reject. Errors retain name/message, not identity/stack; custom abort/cancel reasons are not transported to the Worker. Unconsumed response bodies retain resources until consumed, cancelled or disposed. `drain()` tracks background work, not body consumption.

## Execution environment and async context

The original Worker handler remains the Cloudflare entry. Install the Vite/esbuild
plugin only in the Capacitor/browser build: its aliases select the local API
implementations; the Cloudflare build retains native `node:*` and `cloudflare:*`.
`getExecutionEnvironment()` (also available from `cf-workers-native/environment`)
distinguishes Cloudflare Workers, native Capacitor hosts, browser workers, browsers,
and unknown realms. A browser Dedicated Worker is not Cloudflare Workers.
Installing the Capacitor runtime in Cloudflare Workers fails before changing globals.

Capacitor builds lower async functions and generators, preserving module-level
`await`, so AsyncLocalStorage scopes restore immediately and Promise continuations
retain their own stores. Application handlers need no edits. Native async callbacks
created outside this build pipeline (for example with `eval`) are rejected as ALS
scope callbacks. Cloudflare continues to use its native async context implementation.

Document responses are fetched incrementally on iOS and Android. Native document
uploads still cross a buffered boundary and reject above 8 MiB before concatenation;
use the Fetch-only runtime for streaming uploads. LocalStorage KV stream reads decode
bounded chunks lazily, but the storage API itself necessarily returns a complete
encoded record. Its synchronous storage/quota limits still apply.
