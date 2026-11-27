# Inkstone acceptance

`upstream.json` pins the LGPL-3.0-only [Inkstone](https://github.com/shuaiplus/inkstone) application. Preparation installs its npm lockfile and runs its normal build. The original source stays unchanged in the ignored checkout.

The scenario creates the initial owner through the original registration form, creates a note and sets its title and enters a Unicode body in the original CodeMirror editor. It waits for the saved content from the note API, reloads the page, and checks the editor text and the title and body stored in D1. The automated text insertion covers Japanese characters, an emoji and an accented word. The backend uses real local workerd D1, R2, KV and SQLite Durable Objects. Workers AI, MCP/OAuth clients, two-factor authentication, attachments, backups and multi-device WebSocket synchronization are outside this scenario.

Native tests use the public `workersCapacitor` API with remote Worker execution and `OAUTH_KV` set to `remote`. The Worker runs over local HTTPS and its pages run in the Capacitor WebView. This does not establish offline support or production Cloudflare behavior. A test driver is injected by the fixture server; application source is not patched.

```sh
node demo/tests/upstream/inkstone/prepare.mjs
node --test demo/tests/upstream/inkstone/browser.test.mjs
UPSTREAM_PLATFORM=ios UPSTREAM_DEVICE=<simulator-udid> node --test demo/tests/upstream/inkstone/native.test.mjs
UPSTREAM_PLATFORM=android UPSTREAM_DEVICE=<emulator-id> node --test demo/tests/upstream/inkstone/native.test.mjs
```

Install root/demo dependencies and build the library first; native tests also need `demo/opennext` dependencies. Tests using that shell must run serially and reset the test app's data. Credentials and stored data are local fixtures.
