# flare-stack-blog acceptance

`upstream.json` pins the GPL-3.0-only-licensed [flare-stack-blog](https://github.com/du2333/flare-stack-blog) source. Preparation installs the upstream lockfile and runs its normal build in an ignored checkout without source edits.

It applies the original migrations to local workerd D1, seeds a published article, verifies navbar CSS and the client-side navigation menu, follows its original list link and verifies the article body. Script/stylesheet failures fail the scenario. The pinned original Worker can emit React #418 when server and client locale selection differ; this recoverable baseline mismatch is recorded separately, and functional hydration is still required. R2, KV, Queue and SQLite Durable Objects use local workerd services. Authoring, OAuth, email, scheduled jobs and production Cloudflare resources are outside this scenario.

Native tests use the public `workersCapacitor` API with remote Worker execution over local HTTPS. The original pages run in the Capacitor WebView. A fixture-only driver is injected into HTML; this does not establish offline support. The native configuration keeps KV remote. The fixture configuration describes the original cf build output and bindings; application source is unchanged.

### iOS limitation

The unchanged application passes this scenario on Android, but fails on iOS. Its `createAuthClient()` call omits `baseURL`, so Better Auth derives it from `window.location.origin` and rejects `capacitor://localhost` with `BetterAuthError: Invalid base URL`. The HTML and assets load, but client initialization stops and the navigation menu cannot open. SSR output alone is not acceptance. The iOS test deliberately retains the same functional assertions and fails until this boundary is resolved.

### Configured Better Auth client

A separate acceptance page uses Better Auth 1.7.6 from the upstream lockfile and the original
Worker auth handler with a verified local test account. Set the server's
`BETTER_AUTH_URL` and the client's `baseURL` to the canonical HTTPS Worker
origin. In the native document, route that client's auth requests through the
local document path. For example, with the bridge changes in this checkout:

```js
const origin = "https://your-worker.example";
const auth = createAuthClient({
  baseURL: origin,
  fetchOptions: {
    customFetchImpl(input, init) {
      const url = new URL(input);
      if (url.origin !== origin || !url.pathname.startsWith("/api/auth/"))
        throw new Error("Unexpected authentication URL");
      return fetch(url.pathname + url.search, { ...init, mode: "same-origin" });
    },
  },
});
```

The native transport uses its Worker cookie store. Better Auth receives the
canonical origin on sign-in and sign-out and retains its origin checks. On iOS
26.5 and Android API 35 the test signs in, opens a protected test page, reloads
it and signs out. It checks D1 session removal and looks up the previous
session with cookie caching disabled. Upstream enables a five-minute cookie
cache; these checks establish database-backed revocation only.

The same test isolates the earlier anonymous-session failure. Direct HTTPS
requests both returned 200 at the server. The WebView could read the response
only when the test endpoint sent credentialed CORS headers for its exact
origin. The configured sign-in flow uses same-origin fetches throughout.

Run the configured acceptance with the same prepared upstream checkout and
native shell as the original article test. Use `session.native.test.mjs` in
place of `native.test.mjs` for either platform. The iOS shell must include
the updated native plugin and the Android build must include the updated
document service worker. To refresh a shell that already has an older local
package installed, run these commands from the repository root:

```sh
npm run build
pack_dir=$(mktemp -d)
package_file=$(npm pack --silent --pack-destination "$pack_dir")
npm install --prefix demo/opennext --no-save --package-lock=false "$pack_dir/$package_file"
```

```sh
node demo/tests/upstream/flare-stack-blog/prepare.mjs
node --test demo/tests/upstream/flare-stack-blog/browser.test.mjs
UPSTREAM_PLATFORM=ios UPSTREAM_DEVICE=<simulator-udid> node --test demo/tests/upstream/flare-stack-blog/native.test.mjs
UPSTREAM_PLATFORM=android UPSTREAM_DEVICE=<emulator-id> node --test demo/tests/upstream/flare-stack-blog/native.test.mjs
```

Install root/demo dependencies and build the library first; native tests also need `demo/opennext` dependencies. Run tests sharing that native shell serially. Each run resets the test app's data.
