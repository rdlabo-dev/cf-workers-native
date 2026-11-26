import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fileURLToPath } from "node:url";
import { nativeBackend } from "../native/backend.mjs";
export const redirectUri =
  "jp.rdlabo.workerscapacitor.authentication://oauth/callback";
// A local OAuth test issuer, not a substitute for a production identity provider.
// Exercises the system-browser redirect, S256 exchange, one-use code and bearer
// transfer without contacting a real account or publishing an endpoint.
export async function startBackend({ interruptFirstCallback } = {}) {
  const token = randomBytes(32).toString("base64url");
  const session = randomBytes(32).toString("base64url");
  let interrupted = false;
  const codes = new Map();
  const evidence = [];
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL("worker.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    write: false,
  });
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: "2026-10-17",
      bindings: { SESSION_TOKEN: token, COOKIE_SESSION: session },
    }),
  );
  const dispatch = async (url, init) => {
    const target = new URL(url);
    if (target.pathname === "/authorize") {
      const params =
        init.method === "POST"
          ? new URLSearchParams(init.body.toString())
          : target.searchParams;
      if (
        params.get("client_id") !== "native-test" ||
        params.get("redirect_uri") !== redirectUri ||
        params.get("response_type") !== "code" ||
        params.get("code_challenge_method") !== "S256" ||
        !/^[\w-]{43}$/.test(params.get("code_challenge") ?? "") ||
        !/^[\w-]{43}$/.test(params.get("state") ?? "")
      )
        return new Response("Invalid OAuth request", { status: 400 });
      if (init.method === "GET") {
        evidence.push({
          stage: "system-browser",
          userAgent: init.headers["user-agent"],
        });
        // The test issuer represents an already authenticated test account, like
        // an existing SSO session. The actual browser must follow the callback.
      }
      const code = randomBytes(32).toString("base64url");
      codes.set(code, {
        challenge: params.get("code_challenge"),
        expires: Date.now() + 60000,
      });
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", params.get("state"));
      evidence.push({ stage: "authorization-code" });
      if (interruptFirstCallback && !interrupted) {
        interrupted = true;
        await interruptFirstCallback(redirect.href);
        evidence.push({ stage: "cold-callback" });
        return new Response(null, { status: 204 });
      }
      return new Response(null, {
        status: 302,
        headers: { location: redirect.href },
      });
    }
    if (target.pathname === "/token") {
      const params = new URLSearchParams(init.body.toString());
      const entry = codes.get(params.get("code"));
      codes.delete(params.get("code"));
      const challenge = createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !entry ||
        entry.expires < Date.now() ||
        params.get("grant_type") !== "authorization_code" ||
        params.get("client_id") !== "native-test" ||
        params.get("redirect_uri") !== redirectUri ||
        challenge.length !== entry.challenge.length ||
        !timingSafeEqual(Buffer.from(challenge), Buffer.from(entry.challenge))
      )
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      evidence.push({ stage: "pkce-exchange" });
      return Response.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 300,
      });
    }
    const response = await worker.dispatchFetch(url, init);
    if (target.pathname === "/session" && response.status === 204)
      evidence.push({ stage: "session-created" });
    if (target.pathname === "/" && response.status === 200)
      evidence.push({ stage: "authenticated-request" });
    return response;
  };
  const backend = await nativeBackend({
    tlsDirectory: process.env.OAUTH_TEST_TLS_DIRECTORY,
    dispatch,
    instrument: (path) => path === "/",
    driver: `fetch('/__acceptance/report',{method:'POST',body:JSON.stringify({stage:'complete',platform:window.Capacitor?.getPlatform?.(),text:document.querySelector('h1')?.textContent})})`,
    dispose: () => worker.dispose(),
  });
  return { ...backend, evidence, dispatch };
}
