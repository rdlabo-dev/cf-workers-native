# Compatibility and limitations

The target is Cloudflare Workers, not a standalone Node.js process. The Node
profile uses workerd `1.20261012.1`, compatibility date `2026-10-17`, without
additional flags. Other dates and flags are not covered by this profile.
The WebView does not contain workerd or V8; iOS uses its own JavaScript engine.

Releases use the [remote-first application gate](../CONTRIBUTING.md#remote-first-application-release-gate).
The default network policy keeps server implementation on the deployed Worker.
A verified mobile application does not establish complete Workers or Node.js
compatibility. Local API completion continues independently with the limits below.

## Native hosts

| Host              | Scope                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS embedding     | 0.1.7 `WorkersIOS` SwiftPM product for UIKit/SwiftUI. Close before removing a UIKit controller; SwiftUI dismantling closes automatically.                                                 |
| Android embedding | Maven Central SDK `io.github.rdlabo:cf-workers-native-android:0.1.7`. Requires WebView `MULTI_PROFILE`; one SDK screen at a time, with persistent SDK cookies isolated from host cookies. |
| Capacitor         | Existing Capacitor 8 integration, verified with 8.5.3; use this path for general native plugins.                                                                                          |

The npm Preview uses the name `cf-workers-native`; use the exact version
and matching native dependencies in the [dependency matrix](native-embedding.md#dependency-setup). Use the documented compatible JS/native dependency set; they are not included in the earlier
`workers-capacitor@0.1.1` release. Both detect incomplete startup after 30 seconds. They reuse the
runtime and build tooling, so they retain the API/framework limits below. See
[embedding setup and lifecycle](native-embedding.md) for the platform behavior
and [verification scope](native-embedding.md#verification) for host-specific evidence.

## Node.js

Whole-Node compatibility is incomplete. Importing a module successfully does not
establish equivalent methods, validation, state, scheduling or engine behavior.

Whole-module status remains **In progress**, including modules whose existing
contracts pass. Release validation covers the implemented scenarios; it does not
certify untested operations. Missing APIs, known differences and unverified
operation coverage below remain outstanding after release.

| Area                                              | Behavior and limitations                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| path, querystring, string_decoder, buffer, timers | Implement the pinned Workers profile. Workers stubs remain stubs; for example, matchesGlob reproduces the pinned rejection.                                                                                                                                                                     |
| HTTP and net                                      | In-memory server dispatch; no OS listening server. Outbound TCP/TLS requires the native transport.                                                                                                                                                                                              |
| fs / fs/promises                                  | Read-only embedded files plus request-local in-memory `/tmp`, with writes, descriptors and FileHandle operations. Watch is unsupported, as in Workers. Full filesystem semantics remain under audit.                                                                                            |
| module                                            | Limited builtin registry; createRequire loads VFS JSON only. Executable modules must be bundled; arbitrary dynamic resolution is unsupported.                                                                                                                                                   |
| process, console, util / util/types / sys         | Process includes configuration, environment-file loading and standard streams; abort/reallyExit/getBuiltinModule remain missing. Engine introspection, call sites and host-object detection are not equivalent to Workers.                                                                      |
| crypto and zlib                                   | Selected profiles cover random/Hash/HMAC/PBKDF2/HKDF/scrypt, secret/asymmetric keys, signatures, primes and Brotli/Zstd streaming. X509Certificate parsing, fields and checks are implemented with the pinned Workers limits; additional algorithms and full crypto/codec parity remain gaps.   |
| TLS and HTTP internals                            | Direct TLS and STARTTLS use authenticated native transports and distinguish close_notify from truncated connections. STARTTLS exposes Workers' early secureConnect notification while application I/O still waits for certificate authentication. Complete class/state acceptance remains open. |
| WebSocket                                         | Owned WebSocket and WebSocketPair implement native WS/WSS, accept, close, compression and attachments. Attachment size accounting has an explicitly scoped engine-representation boundary; whole-API acceptance remains open.                                                                   |
| Streams                                           | An owned implementation supplies byte streams and the tested Workers tee cancellation and pipeTo abort behavior on every host. Whole-module acceptance remains open.                                                                                                                            |
| async_hooks                                       | Build-transformed async functions retain scoped stores. Untransformed native async callbacks reject; arbitrary dynamic code and request-origin isolation are not fully supported.                                                                                                               |
| diagnostics_channel                               | Synchronous channel/store contracts are implemented; async propagation depends on the async-hooks limitations.                                                                                                                                                                                  |
| worker_threads                                    | Workers stubs and local MessagePort behavior, not Node threads. Trusted-event branding, host-object serialization and global identity differ.                                                                                                                                                   |
| DNS                                               | DNS-over-HTTPS implementation; synthetic Service Binding/Hyperdrive address overrides are not implemented.                                                                                                                                                                                      |
| events                                            | [WebView events profile](../src/compat/events/README.md): EventEmitter, abort/iteration helpers, transformed AsyncResource propagation and process warning delivery. Native async and V8 inspection remain bounded.                                                                             |
| Other modules                                     | Implementations and shared contracts exist, but whole-module acceptance remains outstanding. Namespace equality alone is insufficient.                                                                                                                                                          |

The [WebSocket attachment boundary](../src/browser/websocket/README.md) applies only
to serialized sizes that depend on engine-private representation. It does not
waive supported values, snapshot isolation, normal size limits, TLS authentication
or network behavior.

The exact missing/extra export baseline is maintained in
[surface-gaps.json](../demo/tests/experiments/node-compat/surface-gaps.json), against
[the pinned exports](../demo/tests/experiments/node-compat/exports.json).
Those files are the source of truth; this guide does not duplicate the export list.
Run `npm run build`, then `npm run test:node-inventory --prefix demo` to check it.
Behavioral contracts live beside each implementation in `src/compat`.

### Completion assessment

The import audit checks export names and their JavaScript types against the pinned
Workers profile. A passing audit means no new surface regression; it does not
establish whole-module compatibility. In particular, a function replaced with an
object is now a regression even if the export name is unchanged.

After `npm run build`, run `npm run test:node-completion --prefix demo` to regenerate
`demo/artifacts/node-inventory/completion.json`. The report covers every pinned
module in both Chromium and WebKit, distinguishes surface gaps from aligned but
uncertified modules, and records the next investigation with evidence references.
Missing engines, modules, type-audit data or a mismatched profile fail generation.
The optional report flag `--require-complete` rejects surface-only evidence; it
must not be used to turn report generation into a compatibility certificate.

Residual work has different causes:

- **Implementation gaps:** `crypto`, `zlib` and remaining virtual filesystem semantics
  still need operation-level implementation and verification. Their absence is
  not evidence of technical impossibility.
- **Behavior gaps:** Remaining stream lifecycle and synthetic DNS behavior require
  specific adapters and contracts, beyond exporting the right names.
- **Engine boundaries:** proxy/promise introspection, native async continuation
  hooks and trusted MessagePort branding have observable differences. Build-time
  transforms or native bridges require explicit scope and separate verification.
- **Workers stubs:** preserve the pinned runtime's actual no-op/rejection behavior.
  Do not implement desktop Node capabilities merely because Node exposes them.
- **Verification gaps:** even an aligned export surface needs whole-module
  operation/prototype coverage and native acceptance before it is called complete.

A codec option getter can mutate an input or dictionary before native processing;
those ordinary mutations are preserved. Resizable ArrayBuffers and growable SharedArrayBuffer views are snapshotted
at conversion, as in Workers. A fixed ArrayBuffer transferred by an option getter
is a narrower engine boundary: Workers can retain its native backing store after
detachment, while JavaScript cannot recover mutations made immediately before the
transfer. Local fast codecs reject that case with `TypeError` instead of silently
compressing empty data. Avoid transferring input or dictionary buffers from option
getters. This limitation does not exempt other codec options or lifecycle behavior.

Run `npm run test:node-boundaries --prefix demo` for the counterexamples and
`npm run test:events --prefix demo` for the Workers events baseline and implementation. `node:events` is routed through the
[WebView events profile](../src/compat/events/README.md); process warning delivery
and microtask scheduling are shared with that adapter. Tests compare ordinary
Vite/esbuild imports in-page and in Dedicated Workers. Engine inspection and
untransformed native-async boundaries remain explicit; matching this profile does
not certify all Workers/Node modules.

The [additional compatibility profiles](../src/compat/expansion/README.md) cover
console stubs, sys/util aliases, selected crypto operations, request-local `/tmp`,
secret KeyObjects, Brotli/Zstd/CRC32, filesystem metadata, stream cancellation,
module metadata and HTTP helpers. Run
`npm run test:node-expansion --prefix demo` for live differential tests against
the pinned Workers version. CI runs these checks alongside the existing events
suite. For native verification, prepare an installed consumer with
`npm run test:events:native:prepare --prefix demo`, then run
`npm run test:node-expansion:native --prefix demo -- ios <simulator-uuid>` or
`npm run test:node-expansion:native --prefix demo -- android <emulator-serial>`.
Native reports include the candidate hash and installed tarball identity under
`demo/artifacts/node-inventory/native-expansion/`.

Workers non-functional modules do not gain device capabilities: VM isolates,
process spawning, V8 heap access, UDP sockets and an OS terminal are not supplied.
`node:test` exposes the Workers mock API, not Node's complete test runner.

## Workers APIs and bindings

- `passThroughOnException`, local WorkerEntrypoint/RPC, Cache API and HTMLRewriter
  are unsupported. Scheduled/queue/workflow lifecycles are not simulated locally.
- `cloudflare:workers` is partial. The isolated dispatcher updates a realm-wide
  `env` proxy; direct execution does not populate it. It is not request-local and
  is not populated before the first dispatch. Prefer the Fetch Handler argument.
  DurableObject is a constructor shell, not a local Durable Objects runtime.
- `Request.cf` preserves supplied values; it does not generate Cloudflare metadata.
- [Local KV](kv.md) uses device storage without cloud replication or binding RPC.
- D1, Hyperdrive, R2, Service Bindings, Queue producers and
  [other cloud services](cloudflare-bindings.md) execute remotely through the
  deployed Worker's HTTP handler. They are not local service implementations.
  Local ASSETS is unsupported; use the explicit remote asset policy.

## Native networking

HTTP/1.1 framing, redirects and response parsing run in JavaScript/Wasm. Native
code provides TCP/TLS and WebView lifecycle hooks. Each HTTP request uses a
connection with `Connection: close`; there is no implicit retry after sending.

- HTTPS requires Content-Length or chunked framing. EOF-delimited HTTPS rejects
  because the byte bridge cannot distinguish authenticated closure from truncation.
  Plain HTTP supports EOF framing.
- Trailers are parsed but are not exposed as Fetch response headers. HTTP/2,
  protocol upgrades and CONNECT are unsupported by this HTTP/1.1 transport.
- Socket reads/writes are bounded at 64 KiB; header text is limited to 64 KiB
  across informational/final headers and trailers. Reads follow consumer demand.
- Browser execution retains browser CORS/header/cookie restrictions. Native
  transport does not promise browser-equivalent SameSite or CSRF protection.
- OS termination can stop background work. Selected scenarios cover physical
  devices; your application's device behavior, WebView crash recovery and memory
  pressure require separate validation.

## Document rendering

Remote HTML is rendered at the app-local origin (`capacitor://localhost` on iOS,
`https://workers-sdk.local` in the Android embedding host, and normally
`https://localhost` in a Capacitor Android app). Remote execution keeps server code and
cloud services on the Worker; it does not turn the WebView into that site's origin
or supply every browser authentication feature. Check hydration and interactive
controls, not only a successful HTML response.

### Application integration limits

| Feature                                        | Current boundary                                                                                                                                                                                                                                    | Integration guidance                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Better Auth with an inferred client base URL   | The pinned flare-stack-blog application fails client initialization on iOS because Better Auth rejects `capacitor://localhost`. Android's HTTP(S) origin does not hit this rejection.                                                               | An explicit HTTPS authentication endpoint initializes the client, but its full login/cookie flow has not been validated here. Do not assume that setting alone completes migration. See the [reproduction](../demo/tests/upstream/flare-stack-blog/README.md).                                               |
| Passkeys / WebAuthn and PRF                    | Native passkey registration in pknotes fails on both tested platforms. Chromium's virtual authenticator acceptance does not establish native support.                                                                                               | Native credential integration, app/domain association and PRF availability need separate validation. Remote rendering cannot bypass relying-party origin checks. Native support is deferred, not proven technically impossible. See the [authentication boundary](../demo/tests/upstream/pknotes/README.md). |
| Void React Pages                               | Void / @void/react 1.1.12 covers remote D1 flows and explicitly permitted public GET route execution, including SSR and hydration, in an iOS simulator and Android emulator. Other Void frameworks and whole-Worker local execution are unverified. | Use 1.1.12 or newer for iOS custom-scheme navigation. See [Void integration and verification scope](void.md).                                                                                                                                                                                                |
| External-browser OAuth                         | The example verifies synthetic local and public-HTTPS test issuers, PKCE, callback handling and session exchange, including a physical iPhone. Real provider policies, refresh-token storage and cold-start resume are not covered.                 | Use the provider's native SDK where available. System-browser cookies are not automatically shared with the WebView. See the [authentication example](../demo/authentication/README.md).                                                                                                                     |
| Analytics Engine and other cloud-only services | Analytics Engine executes in Cloudflare; there is no local dataset implementation. Counterscale's live scenario requires a provisioned account, events and an analytics read token.                                                                 | Keep privileged tokens on the backend and authenticate device requests. The default CI authentication scenario does not exercise live analytics. See [Counterscale setup](../demo/tests/upstream/counterscale/README.md).                                                                                    |
| Image optimization and device performance      | The OpenNext fixture covers local workerd and deployed Cloudflare IMAGES, including rendering on a physical iPhone. Performance samples are single Debug runs; physical iOS memory is unmeasured.                                                   | Verify production image configuration and measure release-build startup and memory across physical devices before making performance claims. See [OpenNext gaps](opennext.md#current-gaps).                                                                                                                  |

Pinned third-party fixtures exercise specific user flows without editing their
application source; they are not certification of every feature or future version.
Most use local workerd behind HTTPS as the remote backend. Live Analytics Engine and the OpenNext public-HTTPS D1/Images scenario
are explicitly configured exceptions. See the [scenario scopes](../demo/tests/README.md#application-acceptance)
before relying on a result for a production integration.

See [native document rendering](native-rendering-api.md#scope-and-limits) for
navigation, form uploads, redirects, trust and lifecycle restrictions. Browser
Service Worker comparisons explicitly expect WebKit to lose replayed POST bodies
and expose `redirected: false` for synthetic redirects. All other assertions remain
required; these expectations record browser limitations, not supported behavior.
iOS uses a different native scheme bridge. Browser results
are not a substitute for iOS/Android validation.
