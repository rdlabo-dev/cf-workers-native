# Integrate an existing Workers application with Capacitor

For an existing [iOS](native-embedding.md#ios) or [Android](native-embedding.md#android)
application, use the embedding guide. This guide is for a Capacitor app, including
creating one when starting a mobile application or using general Capacitor plugins.

Bring your existing Workers pages to an iOS and Android app with Capacitor. Add a mobile build, connect the Worker entry and use Capacitor for the native shell and plugins. Keep your cloud build, rendering, routes, business logic and authentication.

Follow the [workflow](#workflow) below yourself, or give the [integration prompt](#prompt-to-give-your-ai-assistant) to an assistant with access to your application repository.

The primary success criterion is a working native application with minimal integration effort, not a new application architecture. Keep ordinary HTML documents, links and forms where the application uses them. SPA conversion, a new client router, App Shell redesign, SSR/API separation and adding hydration are not prerequisites.

## Before you start

This path is for a developer who has a Workers web app and wants to add a mobile
version. Capacitor supplies the native projects; cf-workers-native connects the
existing Worker pages and requests to them.

Have these ready:

- Your application's source and a working web build. For a first example, use [Hono / Express pages](../demo/rendering/README.md) or [Void + D1](../demo/void/README.md).
- A deployed **test** Worker URL for cloud-backed pages, data and authentication. Keep D1 and server credentials on that Worker.
- Node and the platform development tools: macOS with Xcode for iOS, or the Android toolchain for Android. Follow [Capacitor's environment setup](https://capacitorjs.com/docs/getting-started/environment-setup) and your framework's version requirements.
- An application name and ID for the mobile projects. A simulator or emulator is enough for the first run.

The first milestone is an existing page displayed in the app, a link that navigates,
and a form or data action that succeeds. Then verify the full flow, including
login and session handling, in [the acceptance checklist](#6-verify-the-existing-application-in-capacitor).
Web authentication may need mobile callback configuration; assess it in your app.

This guide requires a mobile build configuration and native project setup.
Signing, store accounts, submission and review come after the application works.

## Prompt to give your AI assistant

```text
Follow https://github.com/rdlabo-dev/cf-workers-native/blob/main/docs/integration.md
to bring this app to iOS and Android with cf-workers-native.
Preserve its pages, routes and authentication; verify it on the target platforms.
```

Provide the target platforms, app ID/name, and an existing test Worker origin if available. The assistant should infer entries, framework and scripts from the repository, asking only for missing product choices or access it cannot infer.

## Workflow

Follow the security and verification steps below. Cloud deployments and app publication require explicit user authorization.

1. Inspect the application and select native HTML rendering or Fetch-only integration.
2. Install Capacitor and this package in the application.
3. Configure the native build and connect the existing Worker.
4. Verify unchanged behavior; fix only demonstrated incompatibilities.
5. Check security and verify the actual application flow.

## 1. Inspect the application and choose the integration

Start with the [framework integration inventory](build-setup.md#frameworks). Angular SSR on Workers is not yet verified; build-tool support alone does not establish framework support. For Void, follow its generated-entry guide and version requirements.

Read the Worker entry, build scripts, Wrangler configuration, page routes, middleware and authentication code. Record these decisions in the implementation plan, rather than adding a permanent progress document:

- Which routes produce HTML, JSON and static assets?
- Which pages require D1, other bindings, secrets or a session before rendering?
- Which dependencies can execute locally, and which require the existing deployed Worker?
- What authenticates API calls, and where is ownership/authorization enforced?
- Does navigation request more server-rendered content? Include nested layouts, redirects, framework data requests and mutations, not just the first page.
- Which assets and runtime APIs must be available locally?

Preserve the existing cloud build. Add Vite or esbuild integration only to the Capacitor build. Do not add a Node HTTP server, replace the native controller, embed an iframe, or import library-internal transport files into application code.

Choose the smallest integration that preserves the application:

- **Existing frontend calling Worker APIs:** keep that frontend and initialize the Fetch-only runtime before mounting it. No rendering migration is required.
- **Worker returning HTML (Hono/TSX, Workers Express, OpenNext):** use native document rendering with `render`. Preserve its router and rendering where supported.
- **Cloud-dependent requests:** configure remote execution and inspect the build report. Keep the existing handler unchanged. Whole-Worker remote dispatch is a compatibility fallback; it does not require fetching every client asset remotely. Bundle the framework’s public client output where safe, and verify asset requests separately.

## 2. Install Capacitor and this package

Use Capacitor 8 and compatible platform packages. Prepare the platform SDKs using [Capacitor's installation guide](https://capacitorjs.com/docs/getting-started). In the application package (reuse its existing Capacitor configuration if any):

```sh
npm install @capacitor/core@8 @capacitor/ios@8 @capacitor/android@8
npm install -D @capacitor/cli@8 typescript
npx cap init
```

For the Vite example below, install `vite@7` as a dev dependency if it is not already present. Keep an existing supported esbuild setup instead of adding Vite.

Set the application's own ID/name and `webDir: "www"`. Use Swift Package Manager for iOS; this library does not include CocoaPods integration. Install the npm Preview using its exact version. The `latest` tag includes 0.x Preview releases:

```sh
npm install --save-exact cf-workers-native@0.1.5
```

For a source build instead, create a package tarball from a checkout of this repository:

```sh
# In the SDK checkout:
npm install
npm pack

# In the application package:
npm install /path/to/cf-workers-native/cf-workers-native-0.1.5.tgz
```

`npm pack` runs the SDK build through `prepack`. Install the generated tarball rather than the checkout directory: directory installs can create a symlink back to the SDK tree, including a recursive path when the app lives inside that checkout. The tarball filename above uses the current source version.

The installed package is named `cf-workers-native`; the checkout directory can retain the repository name. The earlier published `workers-capacitor@0.1.1` Preview uses the old package name and does not provide the imports shown here. Use the [documented JS/native dependency set](native-embedding.md#dependency-setup), or keep source-build dependencies on the same revision.

### Migrating from the old npm package

If your application already depends on `workers-capacitor`, remove it before installing the renamed package. Keeping both dependencies can make Capacitor discover and register the same native plugin twice. In the application package, using 0.1.5:

```sh
npm uninstall workers-capacitor
npm install --save-exact cf-workers-native@0.1.5
```

Change runtime imports from `workers-capacitor` to `cf-workers-native/capacitor`, and change other package subpaths to the `cf-workers-native` prefix. Rebuild the application's mobile web assets with its existing build command, then run `npx cap sync` to regenerate native plugin dependencies. New applications use the installation steps above directly.

Before building a native target, check the [native SDK requirements and Android Gradle resource rules](development.md#capacitor-native-demo). The Android resource rules belong in the application's `android/app/build.gradle`.

Keep Capacitor/native projects in the application package, not in the library's source tree. Reuse existing dependencies and scripts rather than scaffolding a second application unnecessarily.

## 3. Configure and build the native application

For a Worker-rendered application, add these files alongside the existing Worker:

```text
src/worker.ts             Existing Worker entry
capacitor/index.html     Runtime bootstrap only
capacitor/main.ts        Runtime initialization
capacitor/vite.config.ts Separate native build
capacitor.config.ts      webDir: "www"
```

```html
<!-- capacitor/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Application</title>
  </head>
  <body>
    <script type="module" src="/main.ts"></script>
  </body>
</html>
```

```ts
// capacitor/vite.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { workersCapacitorPlugin } from "cf-workers-native/tooling/vite";
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: here("."),
  base: "/",
  plugins: [
    workersCapacitorPlugin({
      worker: here("../src/worker.ts"),
      workerConfig: here("../wrangler.jsonc"),
    }),
  ],
  build: { outDir: here("../www"), emptyOutDir: true, target: "es2022" },
});
```

This example uses Vite. For an existing esbuild build, use the [esbuild setup](build-setup.md#esbuild) instead. Do not introduce Vite solely to replace a supported build. Plain browser ESM is available for browser-compatible JavaScript, but does not perform the native document asset setup automatically.

Adjust paths to the actual application. For OpenNext the entry is the generated `.open-next/worker.js`; build it first and explicitly configure remote ASSETS if used. Additional configuration is described in the [binding guide](cloudflare-bindings.md).

```ts
// capacitor/main.ts — local document setup
import { workersCapacitor } from "cf-workers-native/capacitor";
const runtime = workersCapacitor({
  baseURL: "https://your-worker.example.com/",
  render: "/",
});
await runtime.ready;
```

For remote routes or whole-Worker remote execution, the destination defaults to
`new URL(baseURL).origin`. Set `remote.origin` only when the deployed destination
differs from this logical origin. Authentication options such as
`remote: { getToken: async () => getExistingSessionToken() }` do not require
repeating the URL; session management remains application-owned.

The `baseURL` path remains the interception boundary, not a prefix appended to
requests. Local-only builds remain local. Remote destinations must use HTTPS.
Existing integrations using a placeholder logical `baseURL` must replace it with
the deployed URL or retain an explicit `remote.origin`: omission now selects the
`baseURL` origin instead of failing for missing configuration. An invalid explicit
override is rejected, not replaced. The app origin remains `capacitor://localhost`
on iOS and normally `https://localhost` on Android. See the [URL contract](runtime.md#url-contract).

`render` selects native document rendering, including links and forms; it is not an option specifically for forms. For an existing separately built frontend, omit `render`, initialize the Fetch-only runtime before mounting the UI, and use an API-only `baseURL` boundary such as `https://your-worker.example.com/api/`. Keep that frontend outside the API boundary. The plugin entry must be the corresponding API Worker; inspect its remote-dispatch report too.

Build and install (add each native platform only once):

```sh
npx vite build --config capacitor/vite.config.ts
npx cap add ios
npx cap add android
npx cap sync
npx cap run ios
# Or: npx cap run android
```

Build before every sync. Document rendering uses bundled assets, not the Vite dev server. See [native rendering](native-rendering-api.md) for lifecycle and assets.

## 4. Preserve behavior and fix only actual incompatibilities

Build and run the existing entry before proposing an application refactor. Configure its bindings and connection to the existing Worker using the [remote binding guide](cloudflare-bindings.md). `remote.origin` (or the `baseURL` origin when omitted) supplies the destination; it does not itself classify routes. The build plugin generates dispatch from the application and its configuration.

Check client initialization as well as SSR output. A client library that derives an HTTP(S) endpoint from `window.location.origin` can reject the iOS `capacitor://` scheme before hydration completes. The pinned [flare-stack-blog fixture](../demo/tests/upstream/flare-stack-blog/README.md) reproduces this with Better Auth. If the library supports an explicit HTTPS endpoint, validate that configuration together with authentication, cookies and routing; remote Worker execution alone does not change the visible page's origin. Do not spoof the origin or disable authentication checks to make initialization pass.

| Existing application                | First integration approach                                                             | Boundary to verify                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Hono / TSX returning HTML           | Keep `export default app`, templates, routes and forms; use `render`                   | Compatible handlers render locally without a listening HTTP server               |
| Workers Express                     | Keep the Workers Fetch Handler entry and existing routes                               | Supported Workers Express is distinct from arbitrary Node.js server applications |
| D1 query followed by SSR            | Keep the query and HTML response together; dispatch the request to the existing Worker | D1 remains remote; no SQL-to-fetch rewrite or new JSON endpoint is required      |
| Session middleware protecting pages | Keep middleware and server-managed sessions                                            | Cookie/shared-state dependencies can select whole-Worker remote execution        |
| Next.js / OpenNext                  | Build the existing cloud output and select `.open-next/worker.js`                      | Cloud dependencies can keep the entire generated Worker remote                   |
| Cloud ASSETS                        | Configure `assetsExecution: "remote"`                                                  | Local ASSETS is not implemented; retain the existing cloud asset behavior        |

The default `execution: "network"` keeps the existing Worker on the server. Do not ask the user to enumerate routes before basic integration works. When local execution is needed, an `execution` array explicitly permits selected route implementations and retained dependencies to ship to the device. Hono registrations and a [limited OpenNext generated-build profile](opennext.md#route-execution) support this selection. The build preserves server boundaries and can keep the whole Worker remote when separation is uncertain. Inspect `workers-capacitor-d1.json` or `workers-capacitor-server.json`; a nonempty selection with no local handlers emits a warning.

Route patterns select registrations, not incoming URLs. Hono uses its registered patterns; the supported OpenNext profile selects static route paths. `/app/*` includes `/app` itself and matching descendants; patterns can also permit future registrations. Review that scope before using `method: "*"`. Never infer distribution permission from GET, HTML output, a REST API prefix or the absence of a known binding. A standalone application may explicitly use `execution: "local"`, which distributes the whole Worker without route analysis. Do not use it to bypass protected boundaries. See [execution configuration](cloudflare-bindings.md#choosing-execution).

For example, a page that authenticates the user, queries D1 and returns SSR HTML can retain that entire sequence on the deployed Worker. The device renders the response and uses the application's existing interaction model. This requires connectivity; it does not make D1 available locally. See [D1 dispatch](d1-transparent-migration.md) and the [OpenNext sample](../demo/opennext/README.md). Remote execution is a supported way to preserve the application, not an incomplete migration requiring a subsequent redesign.

### Next.js: distinguish rendering from data execution

`dynamic(..., { ssr: false })` disables server prerendering for that Client Component. Its JavaScript renders it in the WebView. It does not disable the entire page's server processing, move database queries to the device, or create a remote API automatically. See [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading).

Inspect where each query actually executes before proposing changes:

| Existing query location                                     | Behavior to preserve                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useQuery`, SWR or client code calling an HTTP API          | The WebView executes the client code; the API handles its server operations. Preserve the existing endpoint and authentication.                         |
| Parent Server Component or `getServerSideProps` querying D1 | The query remains server-dependent even when a child component has `ssr: false`. Use the supported remote request dispatch.                             |
| Direct D1 access imported into client code                  | This cannot execute in the WebView. `ssr: false` does not turn it into an HTTP call; identify the invalid boundary before making a targeted correction. |

For an application already structured as client rendering → API request → D1, keep that structure. Do not add another API layer, force SSR on, or replace its query library to integrate Capacitor. If the query uses Server Actions or another framework transport instead of an ordinary HTTP API, verify that transport against the documented framework limits rather than assuming identical support.

Do not infer actual SSR from a flag, an HTTP 200 response or a string found in the response body. Check that the expected content exists as document elements before page scripts execute; text inside scripts or serialized RSC data is not rendered HTML. Initial HTML alone does not distinguish build-time prerendering from request-time SSR. Check framework build metadata for prerendered routes, and verify request-time rendering with fresh request-dependent values present in document elements. Without that evidence, report initial HTML with unknown rendering time. Then compare with JavaScript enabled and observe API/framework requests. A page may contain a server-rendered layout and client-only data regions simultaneously. Record the result per region and tested route, not as a universal application-wide SSR label.

Bundle public client assets through Vite `publicDir`, or copy them into esbuild’s output before building. The document host serves those exact paths locally even when server handlers remain remote. Only copy files that need no server authorization or middleware; Cloudflare asset control files are not applied locally. See the [OpenNext](opennext.md#bundle-client-assets-alongside-remote-pages) and [Void](void.md) configurations. Keep server and bundled client versions compatible, including older installed apps.

Component rendering and Worker dispatch are separate decisions. The build integration does not interpret `ssr: false` as a local-route instruction. A generated OpenNext Worker with cloud dependencies may still select whole-Worker remote execution for initial documents and API requests. Inspect the build report and test the actual requests; a client-rendered screen alone does not establish local startup or offline availability.

### When configuration is insufficient

Reproduce the failure and identify whether it comes from configuration, the library's documented limits or the application's assumptions. Correct configuration first. If an application change is necessary, keep it scoped to the failing behavior and verify that cloud behavior is preserved.

- **Origin-only CSRF checks:** observed headers are preserved; iOS recovers a missing form Origin only from a verified local main-frame initiator. Other requests can omit it. Retain CSRF protection, such as token validation; never disable it.
- **External authentication redirects:** the remote transport rejects redirects to another origin. Use an explicit [external-browser authentication integration](../demo/authentication/README.md) if the application requires it; do not replace its identity provider just to avoid this boundary.
- **Passkeys/WebAuthn:** rendering remote HTML retains the local document origin. Browser authentication success does not establish native registration or PRF support. Validate the relying-party domain, platform credential integration and app/domain association; do not bypass origin checks. The [pknotes fixture](../demo/tests/upstream/pknotes/README.md) documents the current native boundary.
- **Unsupported runtime or framework behavior:** consult the [compatibility inventory](compatibility.md) and [OpenNext limits](opennext.md). Demonstrate the failing feature before replacing dependencies or changing rendering. A successful import or SSR response does not establish complete framework support.

Report unresolved limits explicitly. Do not hide them with empty data, mocked success or automatic retries that could repeat writes.

### Optional later optimization: local initial rendering

Only pursue this when the application requires local startup or a measured improvement after basic integration works. Compatible existing SSR can execute in the local Worker, yielding HTML before client interaction or hydration. SSR is worth preserving; local execution does not imply client-only rendering.

If that renderer waits for remote data, separating a locally rendered App Shell from authenticated data requests is a possible application refactor. It is not automatic and is outside the default integration work. Preserve templates, navigation and authorization, and measure useful content and usable controls before claiming a speed improvement. For Next.js, hydration alone does not remove server dependencies; see [OpenNext limitations](opennext.md). Do not switch the cloud application to static export or add new APIs solely to complete this guide.

### Declared server-only files

Use `serverOnly` in the Capacitor Vite or esbuild plugin to prohibit distributing
specific source modules or files:

```ts
workersCapacitorPlugin({
  worker: "./src/worker.ts",
  execution: [{ method: "GET", path: "/public" }],
  serverOnly: ["./src/server/signing.ts", "./secrets/test-key.pem"],
  remoteBindings: ["SIGNING_KEY"],
});
```

Declarations are exact existing file paths relative to Vite's root or esbuild's
`absWorkingDir` (cwd by default); absolute paths work too. Directories and globs
are not declarations. Symlink aliases resolve to the same protected file.
`remoteBindings` declares server binding names; `serverOnly` protects files that
need not access a binding. Neither declaration contains secret values or fetches
production credentials.

`network` continues to exclude Worker code. `local` fails if its bundled imports
include a declared file. With route permissions, a declared dependency keeps the
Worker remote: the current implementation conservatively retains the whole
Worker rather than attempting to separate code across that file boundary. When
`serverOnly` is supplied, generated-framework optimization uses the conservative
generic analysis. Route permission never overrides a file prohibition.

Separate direct/transitive client imports, `workerFiles`, Vite public-directory
copies (including symlinks), and normal Vite/esbuild asset imports cannot include
a declared file. Vite also checks the tracked inputs of inlined CSS/HTML assets
and static `new URL(..., import.meta.url)` references, including aliases. A forbidden inclusion fails the build with the source path,
not its contents. The rule also applies inside the generated Dedicated Worker.

This is a production-build distribution boundary, not a general secret scanner.
It covers files consumed by these plugins and built-in bundler import/asset
handling. Custom plugins or external scripts that inject/copy data without source
file provenance, precompiled artifacts that already contain a file's transformed
contents, and files added after the build require separate artifact review.
Bundler defines and client `env` are not scanned for undeclared secret values.
Public verification keys/configuration remain allowed unless explicitly declared;
a variable named `KEY` alone is not rejected.

The runnable synthetic fixture in `demo/tests/build/server-only.test.ts` builds a
Worker importing a private module, proves its marker is absent from permitted
mobile JS/maps/files, and checks rejected client imports/copies in both adapters.
After `npm run build`, run it with
`cd demo && npx vitest run --config tests/vitest.build.config.ts tests/build/server-only.test.ts`.
Keep real server credentials in server-side storage/bindings and obtain user
credentials at runtime through the existing authentication flow described below.

## 5. Security: the device is not a trusted server

### What the build removes

With the build-generated remote boundary, server handlers and their unused helpers, including their SQL, are removed from the client module graph before source maps are generated. Whole-Worker remote mode omits the application implementation. This is **build-time exclusion**, not deletion of original source or a runtime SQL sanitizer. See [code removal](d1-transparent-migration.md#code-removal-and-execution-boundaries).

It does not discover every hardcoded secret. Files manually copied to public assets, `workerFiles`, bundler defines, client `env`, logs and unrelated client imports can still expose sensitive data. Inspect packaged JS, maps and assets. Never bypass the removal by importing the original server module separately.

### Authenticate and authorize remote operations

For private data and writes, the Worker must validate a session or bearer token and authorize each operation. Obtain the user ID from the verified identity, not an untrusted request field. Scope database queries by the authorized owner or tenant. Test that user A cannot read or modify user B's records.

CORS, a hidden endpoint, SQL removal, a device-supplied ID and an embedded shared API key are not authentication. Keep existing authentication if available; this library transports credentials but does not issue identities or enforce policy. Public read endpoints can intentionally remain public with appropriate limits.

### Anonymous users when no login UI is needed

For an application without existing authentication, Firebase Anonymous Authentication is an option for guest identities. It creates a UID without a signup screen; preserve the existing session instead of creating a new account at every launch. See [Firebase's anonymous sign-in guide](https://firebase.google.com/docs/auth/web/anonymous-auth).

Connect the initialized host-side auth instance through `remote.getToken`:

```ts
remote: {
  origin: "https://your-worker.example.com",
  getToken: async () => {
    const user = auth.currentUser; // Firebase auth initialized before startup
    if (!user) throw new Error("Authentication required");
    return user.getIdToken(); // Refreshes expired tokens through the SDK
  },
}
```

This is connection pseudocode, not a bundled Firebase adapter. Use it only when the application has no existing authentication and guest identity fits its access policy. Restore the existing session before deciding whether anonymous sign-in is needed; gate protected requests on authentication readiness and handle failure explicitly. If the application already has a public local loading screen, authentication need not block it. This does not require adding a new App Shell.

Keep token retrieval in the host, not in the isolated Worker. Native document pages and the runtime host have separate JavaScript contexts; a page-side Firebase instance is not automatically the host instance. Android bootstraps the host separately. A token held only in the initial UI closure is unavailable there. Restore credentials in the host without duplicate interactive sign-in, or exchange the provider token for the existing Worker’s HttpOnly session; the [external-browser example](../demo/authentication/README.md) demonstrates the latter.

The server must verify the signature, expiry, issuer and project audience using Firebase's [ID token verification requirements](https://firebase.google.com/docs/auth/admin/verify-id-tokens) and a Workers-compatible verifier; decoding JWT claims alone is insufficient. Firebase Security Rules do not protect D1: implement authorization in the Worker.

Anonymous identity does not prove a real person, a trusted device or an official app installation. Anyone may create a guest account. Limit guest privileges, request rates and costly operations; provide account linking if data must survive loss of local credentials. Consider [App Check](https://firebase.google.com/docs/app-check) for abuse protection separately from user authentication. This library does not supply native attestation or App Check validation.

[Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) is an alternative for access-controlled audiences such as internal applications, not a drop-in guest identity service. Never embed a shared Access service-token secret in a distributed app.

### Treat packaged code and data as extractable

Capacitor bundles can be inspected. Do not embed Cloudflare management tokens, service-account private keys, database credentials or privileged service tokens in JS, native sources, `.env` values compiled into the app, or bundled files. Obfuscation does not make a secret safe. Public client identifiers/configuration are different from server credentials and must not be used as proof of trust.

User credentials need expiration, revocation/logout handling and platform-appropriate storage. OS-protected storage reduces exposure but does not make a compromised device trustworthy. Avoid logging tokens and private responses; clear user-scoped cached data on account changes. The remote Worker must return only data the caller is allowed to receive.

Remote HTML executes its client scripts inside the application's document WebView; plugin calls originate there, not in the remote Worker. Verify custom plugin calls, results and native event delivery from the rendered page after navigation. iOS creates a separate Capacitor document controller, so manually registered plugin instances and listeners on the original host are not assumed to carry over. Android retains the visible application WebView. The [native acceptance scenario](../demo/tests/README.md#native-plugin-calls-from-remote-pages) checks an automatically registered package plugin, including call results, native events and errors after navigation and relaunch. New documents register new listeners; old page listeners do not survive document replacement. Arbitrary custom plugin lifecycles and manual host registration remain outside that coverage.

Native documents have Capacitor plugin access: escape untrusted content and do not render arbitrary HTML as application code. For cookie authentication retain CSRF protection. Observed Origin and Fetch Metadata headers are preserved. For an iOS main-frame form whose Origin is missing, the native bridge recovers it only from a verified local WebKit security origin. Sandboxed or unknown initiators are not granted that origin. Other native requests may still omit Origin; retain CSRF protection and never treat Origin as authentication. External-origin redirects are rejected; OAuth/SSO requires an explicit external-browser integration. See the [remote transport boundaries](d1-transparent-migration.md).

## 6. Verify the existing application in Capacitor

Acceptance means the existing application works through the new entry and configuration, with every application-code change justified by a demonstrated incompatibility. Compare the native flow with the existing cloud application; do not make a rendering redesign or a performance improvement a condition of integration.

Test the target iOS and Android platforms using an actual user flow:

- Launch the app and check the existing initial page, scripts, styles, images and interaction. Check hydration only if the application uses it.
- Follow links, navigate back, submit forms and follow same-origin redirects. Test the application's existing deep-link behavior where applicable.
- Authenticate, read private data, update once, relaunch and sign out. Verify the database state and session behavior, including isolation from a previous account.
- Reject missing/expired/forged credentials and cross-user access. Verify CSRF protection for cookie-authenticated mutations.
- Disconnect or delay the backend. Report the chosen execution mode's dependency on connectivity and verify explicit failures without false success or repeated writes. Local startup is not required for a whole-Worker remote application.
- Inspect build reports and packaged assets: local/remote dispatch matches the selected configuration, excluded server SQL/helpers are absent, and no privileged credentials were embedded.
- Run the application's existing cloud tests to check that integration has not changed its server behavior. Browser tests do not replace native navigation/session tests.

Report the integration files added, each necessary application change and its reason, commands executed, tested platforms, execution boundaries and remaining limitations. Distinguish simulator/emulator checks from physical-device checks, and remote execution from local compatibility. If there is no deployed test backend or native SDK available, state what could and could not be verified rather than claiming completion.

## How existing Worker pages reach the screen

With `render`, the library supplies the Worker's response as the response to a WebView document request. The WebView renders that HTML as a page, executes its scripts and loads its resources. The application does not need to insert HTML into an existing DOM or display it in an iframe.

```text
WebView opens /notes at the app's local origin
  → the library receives the document request
  → generated dispatch selects local or remote execution
      local:  the existing Fetch handler runs on the device
      remote: the request goes to the existing deployed Worker
  → response status, headers and HTML body return through the document bridge
  → WebView renders the page
```

Both execution paths use the same document response mechanism. A D1-backed page can retain authentication, its query and SSR on the remote Worker; a compatible independent page can render locally. The build may select the entire Worker for remote execution when safe separation is not possible. This is request dispatch, not moving D1 operations individually between runtimes.

Following an ordinary link produces the next document request through the same mechanism. Supported form submissions and same-origin redirects also retain document navigation. Existing client scripts can provide interaction or hydration where the framework uses it. Bundled assets bypass the Worker router; other requests follow their configured routing. Preserve the application's existing page model before considering any redesign.

On iOS the bridge uses `WKURLSchemeHandler`; on Android it uses a Service Worker. The visible page keeps the app-local URL (normally `capacitor://localhost` on iOS and `https://localhost` on Android), while the Worker receives its logical HTTP(S) URL. This is native document rendering, not a remote browser tab or a local HTTP server. See the [native rendering guide](native-rendering-api.md) for form, redirect, asset and lifecycle limits; this does not guarantee every browser or framework feature.
