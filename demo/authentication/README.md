# External-browser authentication

Use your identity provider's native SDK when one is already installed. The small `login.ts` example demonstrates a public OAuth client using Capacitor App/Browser, authorization code + S256 PKCE, exact callback matching and state validation. It connects to an existing provider; it does not implement an identity provider or change the Worker's authentication middleware.

```ts
import { workersCapacitor } from "cf-workers-native/capacitor";
import { login } from "./login";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

// The Android document runtime also evaluates this entry in a hidden host.
// Interactive authentication belongs only in the native UI, where native plugins are available.
if (Capacitor.isNativePlatform()) {
  const token = await login({
    authorizationEndpoint: "https://identity.example/authorize",
    tokenEndpoint: "https://identity.example/token",
    clientId: "your-registered-public-native-client",
    redirectUri: "your.registered.app://oauth/callback",
    scope: "your-provider-api-scope",
  });
  const session = await CapacitorHttp.post({
    url: "https://your-worker.example/session",
    headers: { authorization: `Bearer ${token}` },
    disableRedirects: true,
  });
  if (session.status !== 204) throw new Error("Session exchange failed");
}
const runtime = workersCapacitor({
  baseURL: "https://worker.invalid/",
  remote: { origin: "https://your-worker.example" },
  render: "/",
});
await runtime.ready;
```

Install the packages from this example in your Capacitor application, register the exact callback with the provider and add its URL scheme to iOS `CFBundleURLTypes` and the Android activity's `VIEW` / `DEFAULT` / `BROWSABLE` intent filter. Use verified Universal Links/App Links when the provider supports them. `App.appUrlOpen` receives the callback. Complete authentication before starting document rendering. The Worker’s existing session-exchange endpoint validates the bearer token and returns its own Secure, HttpOnly session cookie; the native cookie store makes that session available to the document transport. Keep native-only code outside the Workers bundle.

The `/session` path and 204 response above are an example application contract, not a library API. Use your existing session endpoint; add one only if the application does not already provide it. The Worker must verify the access token (issuer, audience, signature or introspection, expiration and required permissions). An ID token is not automatically an API access token. Keep your existing provider. The test Worker uses a synthetic opaque token only; production JWT validation must use your provider’s verifier.

## Security and lifecycle

- Never embed a client secret, administrative token or database credential in Capacitor. Device bundles are extractable. This example sets `loggingBehavior: "none"` because bridge debug logs can include token responses; do not log credentials.
- The public client binds the authorization code to a random verifier and a fresh state. Unrelated deep links are ignored; invalid state, duplicate parameters, denial, timeout and cancellation fail closed. Authorization codes are exchanged once.
- The bearer token is used only for the session exchange and is not embedded in rendered HTML, localStorage or Dedicated Worker messages. The Worker session is HttpOnly. This is not protection against a compromised device or injected privileged application code.
- System-browser cookies are not copied into the WebView. The remote transport continues to reject external redirects. Open authentication deliberately through the system browser instead of enabling arbitrary cross-origin document redirects.
- This minimal example keeps the pending verifier and token in memory. If a registered callback launches a terminated app, the example offers **Sign in again**. Tapping it starts a new login with a fresh state and verifier. For refresh tokens, resuming the original transaction across process death, logout/revocation and secure persistent storage, use the provider's established native SDK and renew the Worker session through its existing endpoint. `remote.getToken` remains available when the token provider can run in the document host; a token held only in the initial Android UI closure does not survive its separate host startup.
- The application must still enforce authorization and CSRF protections for cookie-based endpoints. A valid Origin header is not authentication.

## Acceptance tests

For physical-device acceptance, use the [public HTTPS test issuer](../tests/authentication/live/README.md). Normal public Workers certificates require no certificate installation on the device. The local-certificate setup below is for simulator/emulator development only.

The test issuer under `demo/tests/authentication` is local and uses a preauthenticated synthetic account. The real system browser follows its callback into the app, PKCE is checked, and a real workerd handler exchanges the resulting bearer token for an HttpOnly session. The public document API then renders the authenticated page using that session. The harness never deploys this issuer or contacts a real user's account. It is protocol/bridge acceptance, not a claim that every provider's login UI or policy has been verified.

```sh
npm install
npm run build
npm install --prefix demo
npm install --prefix demo/authentication
node --test demo/tests/authentication/backend.test.mjs
UPSTREAM_PLATFORM=ios UPSTREAM_DEVICE=<simulator-udid> node --test demo/tests/authentication/native.test.mjs
UPSTREAM_PLATFORM=android UPSTREAM_DEVICE=<emulator-id> node --test demo/tests/authentication/native.test.mjs
```

Set `OAUTH_COLD_START=1` with the local test issuer to exercise process death. The harness terminates the app after the first authorization, opens the issued callback through the OS, activates the retry button and checks that two authorizations produce exactly one successful code exchange and one session. Accept the system prompt to open the example if the iOS simulator displays it.

The native harness generates platform projects and test-only callback registration. Initialize the Android system browser before running. A locally trusted HTTPS test certificate is required by the system browser as well as the app; the app's Android debug trust configuration does not configure Chrome. Never disable production TLS validation to run these tests.

To reuse a browser-trusted test certificate, set `OAUTH_TEST_TLS_DIRECTORY` to an absolute directory containing `ca.pem` and `key.pem` with a localhost subject alternative name. The harness reads these files without modifying or deleting them. [Install only that test CA](https://support.google.com/pixelphone/answer/2844832?hl=en) in the emulator's user credential store and remove it when testing is finished; keep the private key outside version control. Without this option, each run generates an ephemeral CA (automatically trusted by the iOS simulator and the Android debug app, but not Android Chrome).
