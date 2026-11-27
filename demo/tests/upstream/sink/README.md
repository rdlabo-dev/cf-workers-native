# Sink acceptance

`upstream.json` pins the AGPL-3.0 [Sink](https://github.com/miantiao-me/Sink) application. Preparation uses its pnpm lockfile and normal Nuxt build. The checkout stays unchanged and separate from the library's published package.

The test signs in through the original token form, opens the link editor, creates a short link and checks its D1 record. It opens the short URL and follows the original Worker’s 301 redirect to a local destination. The destination page checks its path, Unicode query value and fragment. The server records the redirect and the final GET. It runs against disposable local workerd D1/KV/R2 storage in Chromium, WebKit and the native WebView. Sink uses `ssr: false`; this tests its actual client-rendered UI and Nitro API, not an SSR substitute. Analytics Engine reporting, Workers AI, Cloudflare Access and scheduled backups are outside this scenario.

Native verification uses the public `workersCapacitor` API with remote Worker execution: the original Worker and bindings run in local workerd over HTTPS, and its pages run in the Capacitor WebView. This does not claim offline operation or a Cloudflare production deployment. The test driver is injected by the fixture server; upstream source files are not patched.

```sh
node demo/tests/upstream/sink/prepare.mjs
node --test demo/tests/upstream/sink/browser.test.mjs
UPSTREAM_PLATFORM=ios UPSTREAM_DEVICE=<simulator-udid> node --test demo/tests/upstream/sink/native.test.mjs
UPSTREAM_PLATFORM=android UPSTREAM_DEVICE=<emulator-id> node --test demo/tests/upstream/sink/native.test.mjs
```

Install the root/demo dependencies and build the library first; native tests also need the `demo/opennext` dependencies. Tests sharing that native shell must run serially. Do not use Sink's deployment scripts for acceptance: they migrate the remote database.
