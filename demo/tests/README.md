# Demo verification

These files verify the library. For the setup to copy into your application, start with [the demo guide](../README.md) and `../src/`.

## What belongs where

| Location                                     | Role                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `browser/`                                   | Playwright assertions for the same HTML demo with Hono/Express and for the compatibility page.                               |
| `runtime/`                                   | Playwright assertions for Worker isolation, request/response transport, execution preference, and bindings.                  |
| `build-tools/`                               | Playwright assertions for Vite, esbuild, and browser ES Modules.                                                             |
| `build/`                                     | Vitest assertions for the esbuild watch integration.                                                                         |
| `workers/`                                   | Vitest checks running Hono, Express, and compatibility handlers in local workerd.                                            |
| `upstream/`                                  | Verbatim upstream app checks. Sources stay in the git-ignored artifacts clone; see each sample's README.                     |
| `validation/`                                | The compatibility page, shared check runners/contracts, and Worker entry wrappers.                                           |
| `fixtures/apps/runtime/`                     | A browser/native test app that exposes runtime operations to the tests. Formerly the dedicated Worker experiment.            |
| `fixtures/apps/build-tools/`                 | Test apps built with Vite/esbuild or loaded as plain JavaScript. These are build inputs, not build scripts.                  |
| `fixtures/workers/`                          | Test-only Fetch Handlers used by the verification apps and workerd tests.                                                    |
| `scripts/`                                   | Node.js preparation scripts. `build-tools.mjs` builds the build-tool test apps and copies the plain JavaScript distribution. |
| `playwright*.config.ts`, `vitest*.config.ts` | Test discovery, browsers, local servers, and runner settings.                                                                |

The application under `src/` never imports these files. Tests may import the real demo Workers to check the same code a user runs.

`vite.express.config.ts` imports the ordinary demo Vite config and replaces its Worker selection with Express. Its output is isolated under `artifacts/demo-express`; the default Hono demo remains in `dist`. `test:browser` builds both variants and checks their rendered HTML, so switching frameworks is tested using the actual demo sources.

## Commands

Run from `demo/` after building the library and installing demo dependencies:

```sh
npm run typecheck
npm run build
npm run test:browser
npm run test:runtime
npm run test:runtime:dev
npm run test:build-tools
npm run test:workers
npm run test:documents
```

Upstream checks fetch the pinned application first, then compare it in
workerd and on native platforms — see `upstream/<sample>/README.md`:

```sh
npm run test:upstream:prepare -- hono-jsx-ssr
npm run test:upstream:workerd
npm run test:upstream:browser
npm run test:upstream -- hono-jsx-ssr ios <simulator-UUID>
# Or: npm run test:upstream -- hono-jsx-ssr android <emulator-serial>
```

`test:runtime` builds the runtime test app before running Playwright. `test:build-tools` runs the build checks, prepares the build-tool test apps using `scripts/build-tools.mjs`, then runs Playwright. Their generated files go to `../artifacts/`.

## Native embedding checks

- [iOS](native-embedding/ios/README.md): independent SwiftPM consumer, UIKit/SwiftUI lifecycle and startup cleanup.
- [Android](native-embedding/android/README.md): independent Maven consumer, host-state isolation, Activity recreation and startup cleanup.

These fixtures use the public SDK products without Capacitor application setup.
See their READMEs for commands, prerequisites and evidence limits.

<a id="native-checks"></a>

## Capacitor native checks

### Remote-first release coverage

The product gate is defined in [CONTRIBUTING](../../CONTRIBUTING.md#remote-first-application-release-gate).
Use these existing suites together; no single smoke test certifies an application
or whole-module Node compatibility. Commands below run from `demo/` unless noted.

| Release contract                                                                             | Verification entry                                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Server-only dependency exclusion; pre-execution selection; failed mutations are not replayed | Root `npm test` (`execution-policy`, `remote-worker`, binding/build suites)                             |
| Public package imports, types and independent Vite/esbuild consumer                          | Root `npm run typecheck` and `npm run test:package`                                                     |
| Hono / Workers Express builds and page behavior                                              | `npm run test:browser`, `npm run test:build-tools`; packaged native rendering below on both platforms   |
| Void React Pages hydration, navigation and D1 action                                         | `npm run test:void`, `npm run test:void:routes`; [Void native fixture](void/native.test.mjs)            |
| OpenNext public assets, remote protocol/session/form behavior and lifecycle                  | `npm run test:opennext`, `npm run test:opennext:split`; [OpenNext fixture](upstream/opennext/README.md) |
| D1/R2 backed application operations                                                          | [0bin](upstream/0bin/README.md), [FlareDrive](upstream/flaredrive/README.md), and binding suites        |
| Native cookies, redirects, streaming, cancellation and restart                               | Packaged native rendering and native networking procedures below                                        |
| Standalone iOS / Android installation and lifecycle                                          | Native embedding workflow and independent consumers above                                               |

Record exact source/package revisions and platform results in generated artifacts
and the PR. Browser results do not replace native transport results. Local workerd
database assertions do not certify every deployed Cloudflare service. Keep upstream
authentication restrictions, passkeys, arbitrary version skew and unsupported
upgrade transport outside the supported profile until their own acceptance passes.

Prepare a test app in Capacitor's ordinary `dist/` directory, then sync and run:

```sh
npm run test:native:prepare -- validation
# Or: npm run test:native:prepare -- runtime
npm run sync
npm run ios
# Or: npm run android
```

The preparation command builds the selected test app and replaces only the generated `dist/` directory. The normal Capacitor configuration does not change. Restore the example application with `npm run build`, then `npm run sync`.

## Document browser checks

`npm run test:documents` exercises the document Service Worker and injected iOS
page script in Chromium/WebKit. WebKit Service Worker comparisons explicitly
expect empty replayed POST bodies and `redirected: false` for synthetic redirects;
URL, method, history and all other assertions remain required. Native iOS uses a
scheme bridge, so these browser checks do not replace native validation.

## Packaged native rendering API

Build the library from the repository root, then from `demo/` run:

```sh
npm run test:native:package:prepare
npm run test:native:package -- ios hono <simulator-UUID>
npm run test:native:package -- ios express <simulator-UUID>
npm run test:native:package -- android hono <emulator-serial>
npm run test:native:package -- android express <emulator-serial>
```

The prepare command creates an independent consumer in the OS temporary directory,
with its location recorded in `demo/artifacts/native-package-consumer.json`,
installs `npm pack` output (not a repository symlink), adds ordinary Capacitor
platforms, and asserts automatic registration on both platforms. It also bundles
the installed package entry into `public/lifecycle.js` (an esbuild IIFE) so the
Android lifecycle stage can reuse the Fetch-only migration checks from inside
the rendered document. Native source files and Activity/ViewController entry
points are never patched. The runner builds and installs this consumer; it
requires Xcode or the normal Android SDK/JDK environment. `ADB` and
`ADB_SERVER_PORT` optionally select an adb binary and server. Reports and
console/build logs are in the consumer's `artifacts/`.

The test-only Worker wrapper adds the acceptance script to generated HTML, and
`fixtures/apps/packaged-native/probe-lifecycle.js` is appended to that driver by
the prepare script. Each run writes a fresh `public/packaged-run.json` token; the
probe resets its persisted stage when the token changes, while application data
is otherwise left intact across the run's own stages. One invocation covers, in
order:

1. The 50 document/navigation/POST/redirect checks on a fresh launch.
2. Background then foreground; the still-rendered document verifies the local
   API again (`stage:"background"`).
3. Terminate the app process and relaunch; fresh rendering and local API access
   are verified (`stage:"relaunch"`).
4. Rebuild with an updated bundled Worker marker plus changed/added static
   assets and reinstall _without_ deleting application data; the new Worker
   output and assets must be served (`stage:"update"`). On Android this
   exercises the persistent document Service Worker across an app update.
5. Shutdown and reinitialization (`stage:"reinit"`). iOS requests public
   `dispose()` from the document; the retained runtime host performs it and
   then calls the public startup API again. Android stops the native host via
   `WorkersCapacitor.stop` from the visible page, reloads, and lets the
   persistent Service Worker restart the bundled bootstrap. These are distinct
   mechanisms: public `dispose()` and the native stop method are not claimed
   equivalent. The Android reinit stage additionally reuses the Fetch-only
   migration, Service Worker registration cleanup and current-client native
   asset fallback assertions.

Reports record each lifecycle stage result. OS process termination and relaunch
are exercised; WebView crash recovery is not claimed. The former iOS diagnostic
fetch checks requiring script injection before page creation are not counted in
this package acceptance suite. The underlying production native source is
unmodified.

The earlier public-source registration overlays have been removed. Historical
custom-controller experiments remain under `tests/` for the investigation record;
they are not the installation path.

The document browser suite also tests shutdown and re-registration with the real
production Service Worker in Chromium/WebKit. The lifecycle fixture and an asset
intentionally omitted from its manifest verify that already controlled clients
return to native asset handling. Unit tests cover startup failure, disposal while
registration is pending, legacy transport migration, unrelated registrations and
persisted shutdown across Service Worker restarts.

The historical Android probe retains `--lifecycle` to check Fetch-only migration,
Service Worker registration cleanup and native asset fallback on the current client.
The packaged runner performs the same assertions in its `reinit` stage through
the bundled `lifecycle.js` entry, so the CDP probe remains for the earlier
overlay investigation only.

## Native outbound HTTP contracts

The raw byte transport and Workers Fetch policy run against the same loopback
fixture in direct execution and a Dedicated Worker. Tests include redirects,
compression, cookies, streaming, cancellation, main-frame reload and Worker
termination. The public `workersCapacitor()` entry is exercised in both realms.

After building the library, prepare an independent packed consumer as above:

```sh
npm run test:native:package:prepare
# Keep this server running in another terminal:
npm run test:native:network:server
# Run one platform at a time against the same consumer:
npm run test:native:network -- ios <simulator-UUID>
npm run test:native:network -- android <emulator-serial>
```

These commands replace only the temporary consumer's generated `dist`, sync the
plugin, build, install and check all 82 results. They fail on missing or failed
results. Build logs and reports are written under the consumer's
`artifacts/network/`. Android uses `10.0.2.2:4201`; iOS uses `127.0.0.1:4201`.
`ADB` and `ADB_SERVER_PORT` can select an alternate Android tool/server.
The library does not start this test HTTP server.

Certificate acceptance uses local TLS fixtures on ports 4204–4206:

```sh
NETWORK_TLS=1 npm run test:native:network -- ios <simulator-UUID>
NETWORK_TLS=1 npm run test:native:network -- android <emulator-serial>
```

The fixture server generates short-lived certificates with OpenSSL: a valid
certificate, an untrusted self-signed certificate and a trusted certificate for
the wrong hostname. The runner installs the test CA in the selected iOS
simulator and in the independent Android consumer's **debug-only** network
security configuration. No test trust configuration is shipped in the library.
Keep the fixture server running during the run so its certificates match.
The TLS cases also consume the body and reject both clean and unclean
EOF-delimited responses, enforcing the documented HTTPS framing requirement.
Each platform must produce 92 successful results; DNS failures and timeouts do
not count as certificate rejection. Native TLS tests require no external site.

The separate `npm run test:workers:tls` reference test still uses public
[badssl](https://badssl.com/) endpoints and requires working Internet/DNS.

The same network run also checks `node:net`: half-close, vectored writes, custom
lookup, `onread` buffers, abort/timeout, paused payload preservation and FIN/reset
notification before and after data delivery. Both Cloudflare TCP helpers dispatch
through a public `net.Server`, including drop, pause-on-connect and close ordering.
The server registers a logical port; it does not open an OS listening socket.

## Rendering checks

`test:documents` checks Hono/TSX and Workers Express using the existing document fixtures. `test:opennext` checks Next.js/OpenNext in the existing browser integration and local Vite/esbuild builds. Both use `rendering/assertions.ts` to inspect initial HTML with page JavaScript disabled, then their integration scenarios check client interaction and API results. Scripts, serialized payloads and comments containing markup must not count as rendered elements.

Initial HTML is not automatically request-time SSR. Fresh query values must appear in the returned document for the request-rendered cases; the OpenNext suite separately checks a prerendered route against Next.js build metadata. These are expected-region assertions for representative applications, not a universal SSR classifier or an input to remote dispatch. No application startup probes or additional CI jobs are installed.

## Native plugin calls from remote pages

The OpenNext native test installs `fixtures/plugins/bridge-probe` through Capacitor's normal package discovery. The test-only driver uses `@capacitor/core` to call the plugin, receive its delayed native event and observe a rejected call from the remote-rendered page. The same checks run after client navigation, full document navigation and app relaunch. The driver removes its listener after each check and registers again in each new document; old JavaScript listeners are not expected to survive document replacement. Run the existing OpenNext native commands sequentially because they share generated assets and a temporary Capacitor configuration override, restored in `finally`.

This verifies an automatically registered package plugin. It does not verify manual host-controller registration, arbitrary third-party plugins or background lifecycle delivery. This fixture adds no production plugin.

## Application acceptance

Each application's `browser.test.mjs` establishes the unchanged upstream Worker's baseline; it does not exercise the adapter. The CI matrix then runs `native.test.mjs` through the public API on an Android emulator, independently per application. pknotes has browser coverage only because native passkey registration remains unsupported by this fixture. Counterscale defaults to authentication-only coverage in CI; live analytics requires explicit test-account configuration.

- [Inkstone](upstream/inkstone/README.md): owner registration, note creation and persistence across reloads.
- [Counterscale](upstream/counterscale/README.md): password/session acceptance in CI; an explicit live mode verifies Analytics Engine counts and dashboard rendering using a test account.
- [pknotes](upstream/pknotes/README.md): browser PRF registration and encrypted note round trip; native registration fails in the current shell; this is a diagnostic, not acceptance.
- [TSRSS](upstream/tsrss/README.md): HTML form login, article read/star state and logout with D1/KV assertions.
- [0bin](upstream/0bin/README.md): original encryption/decryption UI and D1 ciphertext assertions.
- [Sink](upstream/sink/README.md): original Nuxt login and link creation UI with D1 assertions.
- [FlareDrive](upstream/flaredrive/README.md): original file listing and authenticated WebDAV/R2 round trip; HTTP Basic login prompts are outside this scenario.
- [Minvoice](upstream/minvoice/README.md): pinned third-party source, original login/client/invoice forms, D1 assertions and cross-origin rejection.
- [External-browser OAuth](../authentication/README.md): real browser callback, PKCE and Worker-issued HttpOnly session with local or public-HTTPS synthetic test issuers.
- `opennext/images.test.mjs` and `opennext/images.native.test.mjs`: real IMAGES transformation, WebP bytes/dimensions and native image rendering.
- `void/native.test.mjs`: iOS/Android SSR, hydration, form actions, D1 persistence and client-only flow with released Void 1.1.12.

- [microfeed](upstream/microfeed/README.md): It seeds a published article in real local workerd D1, opens it from the original feed and reads the RSS feed.
- [UptimeFlare](upstream/uptimeflare/README.md): It seeds monitor status and latency history in real local workerd D1, verifies the original status page, follows its Incidents link and selects a monitor filter.
- [flare-stack-blog](upstream/flare-stack-blog/README.md): D1-backed articles, navbar styling, client-side navigation controls and article navigation. Android passes; iOS client initialization fails because Better Auth rejects the app-local URL scheme.

Native tests use `UPSTREAM_PLATFORM=ios|android` and `UPSTREAM_DEVICE` (the Android serial from `adb devices`, for either an emulator or a connected physical device). Run every test sharing `demo/opennext` serially, including its browser integration build. For multiple files use `node --test --test-concurrency=1 <files>` (runner options precede file names). OAuth uses its independent `demo/authentication` shell, but must not run alongside another test on the same device.

`native/acceptance.mjs` owns only build/install/launch plumbing. It resets the test app’s data before each scenario (reinstall on iOS, `pm clear` on Android), so a previous login cannot bypass the scenario’s authentication flow. Each scenario owns its Worker, data and assertions. Artifacts are ignored by git. Its `elapsedFlowMs` is launch-to-scenario-completion time, not startup latency; simulator/emulator measurements are not physical-device performance results.

OpenNext native acceptance gates functional behavior only. Earlier single-sample Debug timing and host-process RSS measurements had no regression threshold and are no longer collected by this harness. Performance budgets require a separate repeatable release-build benchmark.

The route-execution tests protect different failure boundaries:

- Unit tests check compiler selection and rejection rules; real bundler tests check the distributed JavaScript and source maps for excluded server code.
- Chromium/WebKit acceptance checks browser behavior with Vite/esbuild output, including unavailable-backend public requests and rebuild transitions.
- OpenNext native acceptance checks WebView routing, cookies, app restart and Capacitor plugin communication. Same-build navigation and independent A/B builds cover soft navigation and full-document fallback respectively; they share one driver and assertion set.
- CI runs OpenNext's Android same-build and A/B scenarios. iOS, public-HTTPS physical-device scenarios and Void native scenarios remain explicit manual checks. Their successful local runs are not automatic PR gates.

New tests should identify a distinct failure boundary or replace a weaker assertion. Repeated setup, snapshots of implementation details and unbounded single-run measurements do not add a regression guarantee by themselves.

### Physical iOS devices

The native runners also accept a paired iPhone UDID when `IOS_PHYSICAL_DEVICE=1` and `IOS_DEVELOPMENT_TEAM=<your-team-id>` are set. Enable Developer Mode and keep the phone unlocked. The runners sign a Debug build with your local Xcode account and use `devicectl` to install and launch it; they do not change library native source. The packaged Hono/Express scenarios need no test server.

Physical-device remote acceptance uses a deployed HTTPS Worker with a publicly trusted certificate, not a CA installed on the phone. For OpenNext, use `NATIVE_TEST_ORIGIN`, `NATIVE_TEST_ADMIN_TOKEN` (host only) and `NATIVE_TEST_DEVICE_TOKEN` (a temporary credential scoped to the test deployment). See [live OpenNext acceptance](opennext/live/README.md) and [live OAuth acceptance](authentication/live/README.md). Never ship test credentials, test report endpoints or certificate bypasses in a consumer application.
