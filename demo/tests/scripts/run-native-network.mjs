import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const [platform, device, manifest = "artifacts/native-package-consumer.json"] =
  process.argv.slice(2);
if (!["ios", "android"].includes(platform) || !device)
  throw Error(
    "Usage: run-native-network.mjs ios|android <device> [consumer manifest relative to demo]",
  );
const demo = fileURLToPath(new URL("../../", import.meta.url));
const { consumer } = JSON.parse(
  await readFile(resolve(demo, manifest), "utf8"),
);
const output = join(consumer, "artifacts/network");
const repo = resolve(demo, "..");
await mkdir(output, { recursive: true });
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: consumer,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
const adb = process.env.ADB ?? "adb";
const adbArgs = [
  ...(process.env.ADB_SERVER_PORT ? ["-P", process.env.ADB_SERVER_PORT] : []),
  "-s",
  device,
];
// The loopback fixture is a separate process so both platforms can share it.
assert.equal(
  (await fetch("http://127.0.0.1:4201/active")).status,
  200,
  "Start npm run test:native:network:server first",
);
// Trust a generated test CA only in the simulator / independent debug consumer.
// Production plugin trust remains the platform default.
if (process.env.NETWORK_TLS === "1") {
  const ca = join(demo, "artifacts/network-tls/ca.pem");
  await readFile(ca); // The local fixture server generates these certificates.
  if (platform === "ios") {
    run("xcrun", ["simctl", "keychain", device, "add-root-cert", ca]);
  } else {
    const debug = join(consumer, "android/app/src/debug");
    await mkdir(join(debug, "res/raw"), { recursive: true });
    await mkdir(join(debug, "res/xml"), { recursive: true });
    await cp(ca, join(debug, "res/raw/network_test_ca.pem"));
    await writeFile(
      join(debug, "res/xml/network_test_security.xml"),
      '<network-security-config><base-config cleartextTrafficPermitted="true"><trust-anchors><certificates src="system"/></trust-anchors></base-config><debug-overrides><trust-anchors><certificates src="@raw/network_test_ca"/></trust-anchors></debug-overrides></network-security-config>',
    );
    await writeFile(
      join(debug, "AndroidManifest.xml"),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:networkSecurityConfig="@xml/network_test_security"/></manifest>',
    );
  }
}
run("npm", ["run", "build:native-network", "--", consumer], { cwd: demo });
await rm(join(consumer, "dist"), { recursive: true, force: true });
await cp(join(demo, "artifacts/native-network"), join(consumer, "dist"), {
  recursive: true,
});
run("npx", ["cap", "sync", platform]);
const fingerprints = {};
for (const file of ["main.js", "worker.js"])
  fingerprints[file] = createHash("sha256")
    .update(await readFile(join(consumer, "dist", file)))
    .digest("hex");
await writeFile(
  join(output, `${platform}-revision.json`),
  JSON.stringify(
    {
      revision: run("git", ["rev-parse", "HEAD"], { cwd: repo }).trim(),
      dirty: Boolean(
        run("git", ["status", "--porcelain"], { cwd: repo }).trim(),
      ),
      platform,
      device,
      fingerprints,
    },
    null,
    2,
  ),
);

const configFile =
  platform === "ios"
    ? "ios/App/App/capacitor.config.json"
    : "android/app/src/main/assets/capacitor.config.json";
const { appId } = JSON.parse(
  await readFile(join(consumer, configFile), "utf8"),
);
async function buildApp(command, args, options) {
  const logPath = join(output, `${platform}-build.log`);
  try {
    await writeFile(logPath, run(command, args, options));
  } catch (error) {
    await writeFile(
      logPath,
      [error.message, error.stdout, error.stderr].filter(Boolean).join("\n"),
    );
    throw error;
  }
}
let child;
let log = "";
try {
  if (platform === "ios") {
    await buildApp("xcodebuild", [
      "-quiet",
      "-project",
      "ios/App/App.xcodeproj",
      "-scheme",
      "App",
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-destination",
      `id=${device}`,
      "-derivedDataPath",
      "artifacts/ios",
      "-skipPackageUpdates",
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ]);
    run("xcrun", [
      "simctl",
      "install",
      device,
      join(
        consumer,
        "artifacts/ios/Build/Products/Debug-iphonesimulator/App.app",
      ),
    ]);
    child = spawn("xcrun", [
      "simctl",
      "launch",
      "--console-pty",
      "--terminate-running-process",
      device,
      appId,
    ]);
  } else {
    await buildApp("./gradlew", ["--no-daemon", "assembleDebug"], {
      cwd: join(consumer, "android"),
    });
    run(adb, [
      ...adbArgs,
      "install",
      "-r",
      join(consumer, "android/app/build/outputs/apk/debug/app-debug.apk"),
    ]);
    run(adb, [...adbArgs, "shell", "am", "force-stop", appId]);
    child = spawn(adb, [...adbArgs, "logcat", "-T", "1", "-v", "raw"]);
  }
  child.stdout.on("data", (data) => {
    log += data;
  });
  child.stderr.on("data", (data) => {
    log += data;
  });
  if (platform === "android") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    run(adb, [
      ...adbArgs,
      "shell",
      "am",
      "start",
      "-n",
      `${appId}/.MainActivity`,
    ]);
  }
  const deadline = Date.now() + 120_000;
  let results;
  while (!results && Date.now() < deadline) {
    const match = log.match(/NETWORK_COMPLETE (\d+)/);
    if (match) {
      results = [...log.matchAll(/NETWORK_RESULT (\{[^\r\n]+\})/g)].map(
        (entry) => JSON.parse(entry[1]),
      );
      assert.equal(
        results.length,
        Number(match[1]),
        "Incomplete native result log",
      );
    } else await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(results, "Native network report timed out");
  await writeFile(
    join(output, `${platform}.json`),
    JSON.stringify(results, null, 2),
  );
  assert.equal(
    results.length,
    process.env.NETWORK_TLS === "1" ? 94 : 84,
    "Unexpected native network contract coverage",
  );
  assert.deepEqual(
    results.filter((result) => !result.ok),
    [],
  );
  console.log(`${platform}: ${results.length} native network checks passed`);
} finally {
  child?.kill("SIGTERM");
  await writeFile(join(output, `${platform}.log`), log);
}
