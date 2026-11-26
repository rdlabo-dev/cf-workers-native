import { authorizationCode } from "./callback";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

// iOS updates its last URL even while the app is running. Only inspect it
// for the first login in this JavaScript context.
let checkedLaunchUrl = false;

/** Public-client authorization code + PKCE. No client secret belongs in the app.
 * Supply endpoints registered for this native client by your identity provider.
 * Use an existing provider SDK instead when it already implements this flow.
 */
export async function login(options: {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  signal?: AbortSignal;
}) {
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const authorization = new URL(options.authorizationEndpoint);
  const callback = new URL(options.redirectUri);
  if (
    authorization.protocol !== "https:" ||
    new URL(options.tokenEndpoint).protocol !== "https:"
  )
    throw new Error("OAuth endpoints must use HTTPS");
  if (
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new Error("Register an exact callback without query or fragment");
  // A terminated process has lost the PKCE verifier. Let the user start a
  // fresh transaction when the OS launches the app with the old callback.
  const checkLaunchUrl = !checkedLaunchUrl;
  checkedLaunchUrl = true;
  const launch = checkLaunchUrl ? await App.getLaunchUrl() : undefined;
  if (launch) {
    const url = new URL(launch.url);
    if (
      url.protocol === callback.protocol &&
      url.host === callback.host &&
      url.pathname === callback.pathname
    ) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Sign in again";
      document.body.append(retry);
      try {
        await new Promise<void>((resolve, reject) => {
          const cancel = () => {
            retry.removeEventListener("click", restart);
            reject(options.signal?.reason ?? new Error("Login cancelled"));
          };
          const restart = () => {
            options.signal?.removeEventListener("abort", cancel);
            resolve();
          };
          retry.addEventListener("click", restart, { once: true });
          options.signal?.addEventListener("abort", cancel, { once: true });
          if (options.signal?.aborted) cancel();
        });
      } finally {
        retry.remove();
      }
    }
  }
  for (const [name, value] of Object.entries({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: callback.href,
    scope: options.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }))
    authorization.searchParams.set(name, value);
  let listener: Awaited<ReturnType<typeof App.addListener>> | undefined;
  let closed: Awaited<ReturnType<typeof Browser.addListener>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let setup: Promise<void> | undefined;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      let used = false;
      const rejectOnce = (reason: unknown) => {
        if (!used) {
          used = true;
          reject(reason);
        }
      };
      abort = () =>
        rejectOnce(options.signal?.reason ?? new Error("Login cancelled"));
      options.signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => rejectOnce(new Error("Login timed out")),
        120000,
      );
      setup = (async () => {
        listener = await App.addListener("appUrlOpen", ({ url }) => {
          // Capacitor may replay the launch intent when the listener attaches.
          if (used || url === launch?.url) return;
          try {
            const value = authorizationCode(url, callback.href, state);
            if (value !== undefined) {
              used = true;
              resolve(value);
            }
          } catch (error) {
            rejectOnce(error);
          }
        });
        closed = await Browser.addListener("browserFinished", () =>
          rejectOnce(new Error("Login cancelled")),
        );
        if (options.signal?.aborted) {
          abort?.();
          return;
        }
        if (!used) await Browser.open({ url: authorization.href });
      })().catch(rejectOnce);
    });
    // The system browser's cookies are deliberately not copied into the WebView.
    // Exchange this access token through the existing Worker session endpoint.
    const response = await CapacitorHttp.post({
      url: options.tokenEndpoint,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: callback.href,
        client_id: options.clientId,
      }).toString(),
      disableRedirects: true,
    });
    if (
      response.status !== 200 ||
      typeof response.data?.access_token !== "string" ||
      response.data.token_type?.toLowerCase() !== "bearer"
    )
      throw new Error("Token exchange failed");
    return response.data.access_token as string;
  } finally {
    clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
    await setup;
    await listener?.remove();
    await closed?.remove();
    if (Capacitor.getPlatform() === "ios") await Browser.close();
  }
}
