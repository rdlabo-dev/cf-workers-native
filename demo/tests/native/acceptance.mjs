import { waitForAcceptance } from "./reports.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  rm,
  readdir,
  stat,
  access,
  realpath,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "vite";
import { workersCapacitorPlugin } from "../../../dist/tooling/vite.js";
const exec = promisify(execFile);
// Native applications share only build/install plumbing. Each fixture owns its
// server, application entry, assertions and evidence directory. Run serially.
const defaultShell = fileURLToPath(new URL("../../opennext/", import.meta.url));
export async function runNativeAcceptance({
  backend,
  artifacts,
  worker,
  workerConfig,
  publicDir = false,
  kvExecution,
  remoteBindings,
  assetsExecution = "remote",
  execution = "network",
  expectedMode = "worker",
  render = "/",
  validate,
  platform = process.env.UPSTREAM_PLATFORM,
  device = process.env.UPSTREAM_DEVICE,
  shell = defaultShell,
  appId = "jp.rdlabo.workerscapacitor.opennext",
  bootstrapCode,
  configureNative,
  buildPlugin = workersCapacitorPlugin,
  bootstrapDirectory,
  forbiddenModuleRoots = [],
  timeout = 60000,
  measurements = () => ({}),
}) {
  const physicalIOS =
    platform === "ios" && process.env.IOS_PHYSICAL_DEVICE === "1";
  const iosBuild = join(shell, "ios/build");
  const run = async (command, args, cwd = shell) => {
    try {
      return await exec(command, args, {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          JAVA_HOME:
            process.env.JAVA_HOME ||
            "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
        },
      });
    } catch (error) {
      await writeFile(
        join(artifacts, `${platform}-error.log`),
        `${error.stdout}\n${error.stderr}`,
      );
      throw error;
    }
  };
  try {
    if (!["ios", "android"].includes(platform) || !device)
      throw Error("Set UPSTREAM_PLATFORM=ios|android and UPSTREAM_DEVICE");
    if (physicalIOS && !process.env.IOS_DEVELOPMENT_TEAM)
      throw Error("Set IOS_DEVELOPMENT_TEAM for physical iOS signing");
    if (physicalIOS && backend.ca)
      throw Error(
        "Physical iOS acceptance requires a deployed HTTPS backend; local test CAs are simulator-only",
      );
    await mkdir(artifacts, { recursive: true });
    const bootstrapPath = bootstrapDirectory ?? join(artifacts, "bootstrap");
    await mkdir(bootstrapPath, { recursive: true });
    const bootstrap = await realpath(bootstrapPath);
    await writeFile(
      join(bootstrap, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/main.js"></script></body></html>',
    );
    await writeFile(
      join(bootstrap, "main.js"),
      bootstrapCode ??
        `import { workersCapacitor } from "cf-workers-native/capacitor"; const runtime = workersCapacitor({baseURL:${JSON.stringify(backend.url.origin + "/")},remote:{origin:${JSON.stringify(backend.url.origin)}},render:${JSON.stringify(render)}}); await runtime.ready;`,
    );
    await build({
      configFile: false,
      root: bootstrap,
      publicDir,
      plugins: [
        {
          name: "acceptance-package-isolation",
          generateBundle() {
            for (const id of this.getModuleIds()) {
              for (const root of forbiddenModuleRoots)
                assert.ok(
                  !id.startsWith(root + "/"),
                  `Checkout module entered installed-package build: ${id}`,
                );
            }
          },
        },
        buildPlugin({
          execution,
          worker,
          workerConfig,
          kvExecution,
          remoteBindings,
          assetsExecution: assetsExecution ?? undefined,
        }),
      ],
      build: { outDir: join(shell, "www"), emptyOutDir: true },
    });
    const report = JSON.parse(
      await readFile(join(shell, "www/workers-capacitor-server.json"), "utf8"),
    );
    assert.equal(report.mode, expectedMode, report.reason);
    try {
      await access(join(shell, platform));
    } catch {
      await run("npx", ["cap", "add", platform]);
    }
    if (platform === "android") {
      const debug = join(shell, "android/app/src/debug");
      await mkdir(join(debug, "res/raw"), { recursive: true });
      await mkdir(join(debug, "res/xml"), { recursive: true });
      if (backend.ca)
        await cp(backend.ca, join(debug, "res/raw/opennext_ca.pem"));
      else await rm(join(debug, "res/raw/opennext_ca.pem"), { force: true });
      await writeFile(
        join(debug, "res/xml/opennext_security.xml"),
        backend.ca
          ? '<network-security-config><base-config><trust-anchors><certificates src="system"/></trust-anchors></base-config><debug-overrides><trust-anchors><certificates src="@raw/opennext_ca"/></trust-anchors></debug-overrides></network-security-config>'
          : '<network-security-config><base-config><trust-anchors><certificates src="system"/></trust-anchors></base-config></network-security-config>',
      );
      await writeFile(
        join(debug, "AndroidManifest.xml"),
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:networkSecurityConfig="@xml/opennext_security"/></manifest>',
      );
    }
    if (platform === "android") {
      const gradle = join(shell, "android/app/build.gradle");
      const source = await readFile(gradle, "utf8");
      if (!source.includes("META-INF/INDEX.LIST"))
        await writeFile(
          gradle,
          source.replace(
            "android {",
            "android {\npackaging.resources { excludes += 'META-INF/INDEX.LIST'; merges += 'META-INF/io.netty.versions.properties' }",
          ),
        );
    }
    if (configureNative) await configureNative({ shell, platform, run });
    await run("npx", ["cap", "sync", platform]);
    if (platform === "ios") {
      if (!physicalIOS && backend.ca)
        await run("xcrun", [
          "simctl",
          "keychain",
          device,
          "add-root-cert",
          backend.ca,
        ]);
      await run("xcodebuild", [
        "-quiet",
        "-project",
        "ios/App/App.xcodeproj",
        "-scheme",
        "App",
        "-configuration",
        "Debug",
        "-sdk",
        physicalIOS ? "iphoneos" : "iphonesimulator",
        "-destination",
        `id=${device}`,
        "-derivedDataPath",
        iosBuild,
        ...(physicalIOS
          ? [
              "-allowProvisioningUpdates",
              `DEVELOPMENT_TEAM=${process.env.IOS_DEVELOPMENT_TEAM}`,
              "CODE_SIGN_STYLE=Automatic",
            ]
          : ["CODE_SIGNING_ALLOWED=NO"]),
        "build",
      ]);
      // Match Android pm clear: each scenario starts with fresh application data.
      if (physicalIOS) {
        const { stdout } = await run("xcrun", [
          "devicectl",
          "device",
          "info",
          "apps",
          "--device",
          device,
          "--bundle-id",
          appId,
          "--json-output",
          "-",
        ]);
        if (JSON.parse(stdout).result.apps.length)
          await run("xcrun", [
            "devicectl",
            "device",
            "uninstall",
            "app",
            "--device",
            device,
            appId,
          ]);
      } else await run("xcrun", ["simctl", "uninstall", device, appId]);
      await run("xcrun", [
        ...(physicalIOS
          ? ["devicectl", "device", "install", "app", "--device", device]
          : ["simctl", "install", device]),
        join(
          iosBuild,
          `Build/Products/Debug-${physicalIOS ? "iphoneos" : "iphonesimulator"}/App.app`,
        ),
      ]);
    } else {
      await run(
        "./gradlew",
        ["--no-daemon", "assembleDebug"],
        join(shell, "android"),
      );
      await run("adb", [
        "-s",
        device,
        "install",
        "-r",
        join(shell, "android/app/build/outputs/apk/debug/app-debug.apk"),
      ]);
      await run("adb", [
        "-s",
        device,
        "reverse",
        `tcp:${backend.url.port}`,
        `tcp:${backend.url.port}`,
      ]);
      await run("adb", ["-s", device, "shell", "pm", "clear", appId]);
    }
    const launched = Date.now();
    if (platform === "ios")
      await run("xcrun", [
        ...(physicalIOS
          ? [
              "devicectl",
              "device",
              "process",
              "launch",
              "--terminate-existing",
              "--device",
              device,
            ]
          : ["simctl", "launch", "--terminate-running-process", device]),
        appId,
      ]);
    else
      await run("adb", [
        "-s",
        device,
        "shell",
        "am",
        "start",
        "-n",
        `${appId}/.MainActivity`,
      ]);
    await waitForAcceptance(backend, timeout);
    await validate(backend, platform);
    await writeFile(
      join(artifacts, `${platform}-summary.json`),
      JSON.stringify(
        {
          platform,
          ...measurements(launched),
          elapsedFlowMs: Date.now() - launched,
          bundleBytes: (
            await Promise.all(
              (await readdir(join(shell, "www"), { recursive: true })).map(
                (p) => stat(join(shell, "www", p)),
              ),
            )
          )
            .filter((s) => s.isFile())
            .reduce((n, s) => n + s.size, 0),
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await mkdir(artifacts, { recursive: true });
      await writeFile(
        join(artifacts, `${platform}-reports.json`),
        JSON.stringify(
          { reports: backend.reports, requests: backend.requests },
          null,
          2,
        ),
      );
    } finally {
      if (platform === "android")
        await run("adb", [
          "-s",
          device,
          "reverse",
          "--remove",
          `tcp:${backend.url.port}`,
        ]).catch(() => {});
      await backend.close();
    }
  }
}
