import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runNativeAcceptance } from "../native/acceptance.mjs";
import { startBackend, redirectUri } from "./backend.mjs";
import { startLiveBackend } from "./live/backend.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const appId = "jp.rdlabo.workerscapacitor.authentication";
const coldStart = process.env.OAUTH_COLD_START === "1";
async function interruptFirstCallback(url) {
  const device = process.env.UPSTREAM_DEVICE;
  if (process.env.UPSTREAM_PLATFORM === "ios") {
    await exec("xcrun", ["simctl", "terminate", device, appId]);
    await exec("xcrun", ["simctl", "openurl", device, url]);
  } else {
    await exec("adb", ["-s", device, "shell", "am", "force-stop", appId]);
    await exec("adb", [
      "-s",
      device,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "'" + url + "'",
      "-p",
      appId,
    ]);
  }
}
const here = fileURLToPath(new URL(".", import.meta.url));
const shell = fileURLToPath(new URL("../../authentication/", import.meta.url));
test(
  "system browser OAuth with PKCE and Worker-owned HttpOnly session",
  { timeout: 600000 },
  async () => {
    const backend = process.env.NATIVE_TEST_OAUTH_ORIGIN
      ? await startLiveBackend()
      : await startBackend({
          interruptFirstCallback: coldStart
            ? interruptFirstCallback
            : undefined,
        });
    const options = {
      authorizationEndpoint: new URL("/authorize", backend.url).href,
      tokenEndpoint: new URL("/token", backend.url).href,
      clientId: backend.clientId ?? "native-test",
      redirectUri,
      scope: "profile",
    };
    await runNativeAcceptance({
      backend,
      shell,
      appId: "jp.rdlabo.workerscapacitor.authentication",
      timeout: 150000,
      artifacts: fileURLToPath(
        new URL("../../artifacts/authentication-native/", import.meta.url),
      ),
      worker: join(here, "worker.ts"),
      workerConfig: join(here, "wrangler.jsonc"),
      bootstrapCode: `
import { workersCapacitor } from 'cf-workers-native/capacitor';
import { Capacitor, CapacitorHttp } from ${JSON.stringify(join(shell, "node_modules/@capacitor/core/dist/index.js"))};
import { login } from ${JSON.stringify(join(shell, "login.ts"))};
try {
  // The hidden document host is a plain WebView without the native UI bridge.
  if (Capacitor.isNativePlatform()) {
    if (${coldStart}) {
      const observer = new MutationObserver(async () => {
        const button = document.querySelector('button');
        if (button?.textContent === 'Sign in again') {
          observer.disconnect();
          await CapacitorHttp.post({
            url: ${JSON.stringify(new URL("/__acceptance/report", backend.url).href)},
            headers: { 'content-type': 'application/json' },
            data: { stage: 'retry-offered' },
          });
          button.click();
        }
      });
      observer.observe(document.body, {childList:true});
    }
    const token = await login(${JSON.stringify(options)});
    const session = await CapacitorHttp.post({
      url: ${JSON.stringify(new URL("/session", backend.url).href)},
      headers: { authorization: 'Bearer ' + token },
      disableRedirects: true,
    });
    if (session.status !== 204) throw Error('Session exchange failed');
  }
  const runtime = workersCapacitor({
    baseURL: 'https://worker.invalid/',
    remote: { origin: ${JSON.stringify(backend.url.origin)} },
    render: '/',
  });
  await runtime.ready;
} catch (error) {
  await CapacitorHttp.post({
    url: ${JSON.stringify(new URL("/__acceptance/report", backend.url).href)},
    headers: { 'content-type': 'application/json' },
    data: { stage: 'failure', error: String(error) },
  });
}`,
      configureNative: async ({ shell, platform }) => {
        if (platform === "ios") {
          const path = join(shell, "ios/App/App/Info.plist");
          let source = await readFile(path, "utf8");
          if (!source.includes("jp.rdlabo.workerscapacitor.authentication")) {
            const end = source.lastIndexOf("</dict>");
            source =
              source.slice(0, end) +
              "<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>jp.rdlabo.workerscapacitor.authentication</string></array></dict></array>" +
              source.slice(end);
            await writeFile(path, source);
          }
        } else {
          const path = join(shell, "android/app/src/main/AndroidManifest.xml");
          let source = await readFile(path, "utf8");
          if (!source.includes('android:host="oauth"')) {
            source = source.replace(
              "</activity>",
              '<intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="jp.rdlabo.workerscapacitor.authentication" android:host="oauth" android:path="/callback"/></intent-filter></activity>',
            );
            await writeFile(path, source);
          }
        }
      },
      validate: async (backend, platform) => {
        assert.equal(
          backend.reports.find((r) => r.stage === "complete").platform,
          platform,
        );
        assert.equal(
          backend.reports.find((r) => r.stage === "complete").text,
          "Authenticated Worker",
        );
        if (coldStart) {
          assert.equal(
            backend.requests.filter(
              (r) => r.method === "POST" && r.path === "/token",
            ).length,
            1,
            "Only the fresh authorization may attempt a token exchange",
          );
          assert.equal(
            backend.reports.filter((r) => r.stage === "retry-offered").length,
            1,
          );
          for (const [stage, count] of [
            ["authorization-code", 2],
            ["cold-callback", 1],
            ["pkce-exchange", 1],
            ["session-created", 1],
          ]) {
            assert.equal(
              backend.evidence.filter((event) => event.stage === stage).length,
              count,
              stage,
            );
          }
        }
        for (const stage of [
          "system-browser",
          "authorization-code",
          "pkce-exchange",
          "session-created",
          "authenticated-request",
        ])
          assert.ok(
            backend.evidence.some((r) => r.stage === stage),
            stage,
          );
        await writeFile(
          join(
            fileURLToPath(
              new URL(
                "../../artifacts/authentication-native/",
                import.meta.url,
              ),
            ),
            `${platform}-oauth.json`,
          ),
          JSON.stringify(backend.evidence, null, 2),
        );
      },
    });
  },
);
