# TSRSS acceptance

`upstream.json` pins the MIT-licensed [TSRSS](https://github.com/johnwmail/tsrss) RSS reader. Preparation installs its locked runtime dependencies. Upstream has no separate frontend build: its HTML, CSS and JavaScript are checked in. The fixture bundles the original Worker with esbuild and supplies Node's `createRequire` for the CommonJS RSS parser's built-in imports. Upstream source files remain unchanged.

The scenario uses the original HTML login form to reject a wrong password, sign in, open an article, mark it read, add a star and log out. Assertions check the D1 article state, the login/redirect requests and KV session revocation. The HttpOnly session must not be visible to page JavaScript. The application's CSP remains intact.

A feed and article are seeded in disposable D1 storage. While authenticated, the client uploads a UTF-8 OPML file through the original multipart endpoint. A local RSS fixture serves the new subscription. The test checks the exported XML, attachment headers and stored feed, category and article, then reimports the exported bytes to verify duplicate handling. External RSS downloads, scheduled refresh and proxy authentication are outside this scenario. This is a password-authenticated reader test, not a claim that every TSRSS feature is supported.

Native verification uses the public `workersCapacitor` API with `SESSIONS` configured for remote execution. The unchanged Worker and its bindings run in local workerd over HTTPS; its pages run in the Capacitor WebView. This does not test offline operation or Cloudflare production deployment. The fixture server injects the UI driver without changing upstream source.

```sh
node demo/tests/upstream/tsrss/prepare.mjs
node --test demo/tests/upstream/tsrss/browser.test.mjs
UPSTREAM_PLATFORM=ios UPSTREAM_DEVICE=<simulator-udid> node --test demo/tests/upstream/tsrss/native.test.mjs
UPSTREAM_PLATFORM=android UPSTREAM_DEVICE=<emulator-id> node --test demo/tests/upstream/tsrss/native.test.mjs
```

Install root/demo dependencies and build the library first. Native tests also need the `demo/opennext` dependencies and must run serially with other tests using that shell. The test app's data is reset before each native scenario. All passwords, sessions and database records belong to the local fixture.
