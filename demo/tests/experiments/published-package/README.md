# Published-package onboarding acceptance

This fixture starts from an exact npm release in a temporary consumer. The Worker
contains ordinary HTML, a link, a form and a redirect, with no mobile SDK imports.
Only the native bootstrap imports `cf-workers-native/capacitor`.

Run from the repository root, with the target devices already booted:

```sh
CONSUMER_VERSION=0.1.5 npm run test:events:native:prepare --prefix demo
node demo/tests/experiments/published-package/native.mjs ios <simulator-uuid>
node demo/tests/experiments/published-package/native.mjs android <emulator-serial>
```

Run serially. Preparation verifies the npm registry SHA-512 integrity and records
the tarball SHA-256. Each native run checks that hash, uses the installed Vite
plugin and runtime, and rejects modules from the checkout's `src` and `dist`.
The shared harness builds and installs the native application. A local HTTPS
Miniflare server executes the Worker; an injected UI test driver operates the link
and form. No production service is contacted.

The assertions require the initial page, `/details`, exactly one POST to `/save`,
a 303 redirect and the saved page containing exactly one submission. Evidence is
written under `artifacts/validation/published-<version>/onboarding/<platform>`.

The generated evidence is specific to the tested version. This network-execution
fixture does not establish offline operation, framework-wide compatibility or
whole-module Node.js compatibility. A single acceptance run is not a startup benchmark.

For repeated process-cold startup measurements, use:

```sh
node demo/tests/experiments/published-package/benchmark.mjs ios <simulator-uuid> 3
node demo/tests/experiments/published-package/benchmark.mjs android <emulator-serial> 3
```

Each sample clears application data and relaunches the process. Installation and
build time are excluded. OS/compiler caches are not reset. Results contain the
server-observed time to the first rendered page, full navigation/form duration,
and web asset bytes. The small sample reports min/median/max, not p95, and is not
a device-to-device performance comparison. Wasm module/instance initialization,
linear-memory bytes and batched warm compression timing are recorded separately
by `node-compat/expansion-native.mjs`.

To measure an unreleased checkout, prepare without `CONSUMER_VERSION` and run with
`ACCEPTANCE_CHECKOUT=1`. Its evidence directory uses the tarball hash rather than a
published version label; it must not be presented as evidence for an npm release.
