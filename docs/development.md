# Development and testing

Requires Node 22.18+ (22.x) or 24.11+, npm, and the native SDKs for native tests. Package publication, PR creation and cloud deployment are not part of these commands.

## Library and package tests

```sh
npm install
npm run build
npm run typecheck
npm test
npx playwright install chromium
npm run test:package
```

## Demo and integration tests

Follow the [demo setup guide](../demo/README.md) to see which files to configure and how to run the app.

The demo is an independent npm project under `demo/`, with its own package manifest. Dependency lockfiles are generated locally and are not committed. Capacitor, Hono, Express, native projects and integration tests belong to that project. It consumes the built library through `file:..`; it is not an npm workspace.

The demo layout separates application sources from tooling:

```text
demo/
  src/
    main.ts         Runtime initialization and Worker HTML display
    workers/        Hono and Express application code
  tests/
    validation/     Validation page, runners, contracts and Worker entries
    fixtures/
      apps/         Runtime and build-tool test apps
      workers/      Test-only Worker handlers
    scripts/        Node.js helpers that build test apps
    ...             Automated tests and Playwright/Vitest configurations
  ios/, android/    Native projects
```

`demo/src/main.ts` initializes the runtime and displays the HTML returned by the Worker’s `/` route. Hono is selected by default; the commented Express entry in `demo/vite.config.ts` shows how to switch. Browser tests build and render the same demo with each Worker. The separate `demo/tests/validation/` page runs compatibility checks; it has its own build and is served separately by the browser tests. Application sources never import validation code. Its shared HTTP checks live in `demo/tests/validation/contracts/http.ts` and are reused by the build-tool and runtime tests.

Application Workers are organized as `demo/src/workers/<framework>/<scenario>.ts`. The Hono and Express examples each render HTML at `/` and expose `/api/hello` as JSON. This Fetch-only example inserts the returned HTML into the existing page; it is not the native document rendering path and does not provide navigation, returned-script execution, or form handling. For Worker-owned documents on iOS/Android, `demo/rendering` uses `workersCapacitor({ baseURL, render: "/" })` with the packaged native integration. Broader routing and error-handling cases live in `demo/tests/fixtures/workers/{hono,express}/standard.ts`; runtime and binding fixtures also live under `demo/tests/fixtures/workers/`.

```sh
cd demo
npm install
npm run typecheck
npm run build
npx playwright install chromium webkit
npm run test:browser
npm run test:workers
npm run test:runtime
npm run test:runtime:dev
npm run test:build-tools
```

`npm run test:build-tools` in `demo` checks Vite and esbuild with Hono and Express, plus unbundled browser ESM, in both execution modes on Chromium and WebKit.

`test:workers` runs Vitest tests in `demo/tests/workers/` against **local workerd**, using Wrangler's `createTestHarness`. Hono and Express each have two checks for the demo Worker and ten contract-fixture checks covering the API behavior checked in the WebView. It is not a live Cloudflare deployment. To filter tests, use e.g. `npm run test:workers -- -t hono`. `test:package` installs an actual npm tarball into a fresh temporary consumer and checks package types plus both direct and isolated framework execution without handwritten aliases/polyfills.

## Local Cloudflare development

Cloudflare CLI configuration lives in `demo/cloudflare.config.ts`. From `demo/`, run `npx cf build --mode hono` or `npx cf build --mode express` to build the corresponding Worker; use `npx cf dev --mode hono` (or `express`) for local development. The installed `cf` version is currently beta. Wrangler remains a development dependency for the CLI's bundler and the test harness; tests use the same compatibility settings, checking the example Workers as well as separate contract fixtures.

## Void React Pages + D1

Use Void / @void/react 1.1.12 or newer for Capacitor navigation on iOS and Android.
The sample pins Void / @void/react 1.1.12. Its iOS and Android tests require successful hydration, form submission, D1 persistence and client-only navigation using the published packages without patches. See [Void integration](void.md) for setup and verification scope.

## OpenNext + D1

[`demo/opennext`](../demo/opennext/README.md) is a standalone Next.js application with D1-backed sessions, ordinary forms and static assets. Its normal Capacitor build sends requests to the existing Worker. Separate tests exercise public pages locally, so remote success is not counted as local OpenNext support. See [OpenNext configuration and limits](opennext.md).

## Native embedding consumers

These independent consumers verify that an existing native app can use the SDK
without Capacitor application setup. Build the library first, then follow:

1. [iOS: UIKit and SwiftUI consumer](../demo/tests/native-embedding/ios/README.md).
2. [Android: Maven-only ComponentActivity consumer](../demo/tests/native-embedding/android/README.md).

They exercise navigation, POST, close/reopen and startup failure. They also guard
the ready deadline, Android Activity recreation, and preservation of Android host
cookies and Service Worker behavior. Generated assets and local publications are
fixture outputs, not release artifacts. The `Native embedding` workflow runs both
platforms separately from the existing compatibility workflow.

## Capacitor native demo

The native build requires Xcode 26 / Swift 6.2 or newer and Java 21.
HTTP/1.1 request framing and response parsing run in JavaScript/WebAssembly.
The native plugin provides TCP/TLS byte I/O and WebView integration; iOS uses
Network.framework without AsyncHTTPClient or Swift NIO. Android uses Netty for
TCP/TLS, without its HTTP codec.
HTTPS response bodies require Content-Length or chunked framing; EOF-delimited
HTTPS bodies fail explicitly because the native byte bridge cannot distinguish
authenticated closure from truncation. See [the native boundary](compatibility.md).
For Android, add the following resource rules inside `android {}` in the application's
`android/app/build.gradle` (already present in the demo):

```groovy
packaging.resources {
    excludes += 'META-INF/INDEX.LIST'
    merges += 'META-INF/io.netty.versions.properties'
}
```

These combine Netty's dependency metadata; the library does not modify the application's Gradle configuration.

Run the following from `demo/`, after building its web assets:

```sh
npm run sync
npm run ios
npm run android
```

Android requires Java 21+. The demo opens the minimal Hono example. For the separate 26-check validation app, run `npm run test:native:prepare -- validation`, then the same sync/ios/android commands. This replaces generated `dist/` assets; run `npm run build` and `npm run sync` to restore the example app. No `server.url` or development server is configured in Capacitor. Results appear in the UI and as `POC_RESULT` in the native console. Browser tests additionally re-run 18 API checks with networking disabled.

## Continuous integration

See [test execution cost](test-execution-time.md) for the CI timing baseline, setup consolidation, and measurement limits.

CI runs library/type checks, local workerd contracts, Chromium/WebKit integration, a fresh npm-tarball consumer and nine Android application scenarios in parallel jobs. iOS simulator checks run separately. See [CI and merge protection](../CONTRIBUTING.md#ci-and-regression-protection) for the release `CI` gate, reuse of verified PR results on main, and verification boundaries. CI does not block merging.

## Android Maven publication

Use the [standalone publication build](../scripts/android-release/README.md) to
prepare and verify the Android SDK independently of a Capacitor application.
Native embedding CI checks a disposable-key signed bundle and builds an
independent consumer from that Maven repository. Actual Central publication
requires a verified namespace, release signing key and explicit publication.

## Verify a published npm package

Run the independent consumer suite against an exact registry version:

```sh
CONSUMER_PACKAGE=cf-workers-native@0.1.5 npm run test:package
```

This downloads the published tarball instead of packing the checkout. The same
checks cover packed files, TypeScript imports, Vite/esbuild, browser execution and
shared runtime contracts. `artifacts/package-results.json` records the temporary
consumer directory. Its `node_modules/cf-workers-native` directory can also be
passed as `WORKERS_NPM_PACKAGE_DIR` to the native embedding runners. Without
`CONSUMER_PACKAGE`, the suite builds and packs the local checkout as before.

For native acceptance from a fresh registry installation, prepare once, then run
the ordinary Worker onboarding flow on each booted simulator/emulator:

```sh
CONSUMER_VERSION=0.1.5 npm run test:events:native:prepare --prefix demo
node demo/tests/experiments/published-package/native.mjs ios <simulator-uuid>
node demo/tests/experiments/published-package/native.mjs android <emulator-serial>
```

Run these commands serially: the consumer shares its generated web directory.
Preparation verifies npm's SHA-512 integrity and records the archive SHA-256.
The native build imports the installed Vite plugin and runtime, and rejects SDK
modules from the checkout. The fixture checks initial rendering, link navigation,
form submission exactly once and the POST/303/GET flow against a local HTTPS
Workers backend. It does not contact a production service.

Evidence is written to `artifacts/validation/published-<version>/onboarding/`.
`elapsedFlowMs` measures native launch through completion of the whole flow;
it is not a startup benchmark. `documentReadyMs` is the document's performance
clock, and `bundleBytes` covers generated web assets, not the native app binary.
The [published-package fixture](../demo/tests/experiments/published-package/README.md)
documents the procedure and verification limits.
