# 0bin acceptance

`upstream.json` pins the MIT-licensed [0bin-cloudflare](https://github.com/h1n054ur/0bin-cloudflare) application. Preparation installs its Bun lockfile and builds the original TanStack Start/Hono Worker without source changes.

The same HTML driver operates the original React form in Chromium, WebKit and the native WebView. It enters text, submits the form, follows the app's document navigation with its URL-fragment key, and waits for the decrypted text. It then attaches a Japanese-named PNG via the original file input, submits it, and verifies both decoded pixels in the displayed image. The test checks that both paste IDs and kinds match the ciphertext records in D1. CSP and browser cryptography remain enabled. Turnstile is disabled through the app's supported configuration; the test does not validate Turnstile, clipboard permissions, the OS file picker, OS downloads or every editor feature.

From the repository root, after installing the root/demo dependencies and building the library:

Native verification uses the public `workersCapacitor` API with remote Worker execution: the original Worker and bindings run in local workerd over HTTPS, and its pages run in the Capacitor WebView. This does not claim offline operation or a Cloudflare production deployment. The test driver is injected by the fixture server; upstream source files are not patched.

```sh
node demo/tests/upstream/0bin/prepare.mjs
node --test demo/tests/upstream/0bin/browser.test.mjs
UPSTREAM_PLATFORM=ios UPSTREAM_DEVICE=<simulator-udid> node --test demo/tests/upstream/0bin/native.test.mjs
UPSTREAM_PLATFORM=android UPSTREAM_DEVICE=<emulator-id> node --test demo/tests/upstream/0bin/native.test.mjs
```

Native tests also require the `demo/opennext` dependencies and platform tooling. They share that shell and must run serially. All bindings use disposable local workerd storage. No upstream deployment command or production database is used.
