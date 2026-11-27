# FlareDrive acceptance

`upstream.json` pins the MIT-licensed [FlareDrive](https://github.com/longern/FlareDrive) application. Preparation builds its original React UI, then compiles Pages Functions with Cloudflare's existing Pages compiler. The `cf` CLI does not currently expose that legacy compiler, so this one build step uses the Wrangler executable already installed with the demo. `worker.jsonc` describes those generated outputs and the R2 binding for the adapter.

The scenario displays a seeded file in the original UI, rejects an unauthenticated write, writes a file using authenticated WebDAV PUT, checks PROPFIND, reloads the UI and reads the saved file. It also uploads a 256 KiB + 17 byte binary file with a Japanese filename, finds it in the reloaded UI and compares three contiguous byte ranges with the original. Storage assertions verify the complete R2 object, its content type and the absence of the rejected file. The pinned Worker sends each range with HTTP 200 and omits the Content-Range header. This covers the original listing and WebDAV protocol; credentials are supplied by the test driver. It does not claim native HTTP Basic login prompts or acceptance of the UI's upload dialog, camera, drag-and-drop or large/chunked uploads.

Native verification uses the public `workersCapacitor` API with remote Worker execution: the original Worker and bindings run in local workerd over HTTPS, and its pages run in the Capacitor WebView. This does not claim offline operation or a Cloudflare production deployment. The test driver is injected by the fixture server; upstream source files are not patched.

```sh
node demo/tests/upstream/flaredrive/prepare.mjs
node --test demo/tests/upstream/flaredrive/browser.test.mjs
UPSTREAM_PLATFORM=ios UPSTREAM_DEVICE=<simulator-udid> node --test demo/tests/upstream/flaredrive/native.test.mjs
UPSTREAM_PLATFORM=android UPSTREAM_DEVICE=<emulator-id> node --test demo/tests/upstream/flaredrive/native.test.mjs
```

Install the root/demo dependencies and build the library first; native tests also need `demo/opennext` dependencies. Run tests sharing that native shell serially. Credentials and R2 data are local test fixtures; no Cloudflare account or production bucket is used.
