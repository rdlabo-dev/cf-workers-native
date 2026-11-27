import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

const here = fileURLToPath(new URL("./", import.meta.url));
const device = process.argv[2];
const recovery = process.argv.includes("session-recovery");
const lifecycle = process.argv.includes("--lifecycle");
if (lifecycle) {
  const response = await fetch("http://127.0.0.1:18764/ok", {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok || (await response.text()) !== "network-ok")
    throw new Error(
      "Start the native-embedding/network-server.mjs fixture first",
    );
}
const configuration = process.env.WORKERS_BUILD_CONFIGURATION || "debug";
const measureOnly = process.argv.includes("--measure-only");
if (!["debug", "release"].includes(configuration))
  throw new Error("Invalid build configuration");
if (configuration === "release" && !measureOnly)
  throw new Error(
    "Release supports --measure-only; full acceptance requires Debug WebView inspection",
  );
if (measureOnly && lifecycle)
  throw new Error("Run lifecycle acceptance separately from --measure-only");
const centralOnly = process.argv.includes("--central");
if (!device) throw new Error("Usage: node run.mjs <emulator-serial>");
if (!device.startsWith("emulator-"))
  throw new Error("This fixture requires an emulator");
const gradle = fileURLToPath(
  new URL("../../../android/gradlew", import.meta.url),
);
const artifacts = path.join(here, "build/acceptance");
await mkdir(artifacts, { recursive: true });
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: here,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
const adb = (...args) =>
  run("adb", ["-s", device, ...args], { timeout: 60_000 });
await writeFile(
  path.join(artifacts, "webview.txt"),
  adb("shell", "dumpsys", "webviewupdate"),
);
for (const scenario of recovery
  ? ["session-recovery"]
  : ["normal", "startup-failure", "broken-entry"])
  run(process.execPath, ["../build-web.mjs", "android", scenario]);
if (!centralOnly)
  run(gradle, [
    "-p",
    here,
    "-PincludeSdk",
    ":workers:publishReleasePublicationToProbeRepository",
    "--console=plain",
  ]);
// No SDK project in this invocation: resolve the AAR and its metadata.
run(gradle, [
  "-p",
  here,
  ...(centralOnly ? ["-PcentralOnly", "--refresh-dependencies"] : []),
  ...(process.env.WORKERS_ANDROID_VERSION
    ? [`-PsdkVersion=${process.env.WORKERS_ANDROID_VERSION}`]
    : []),
  `:app:assemble${configuration === "release" ? "Release" : "Debug"}`,
  "--console=plain",
]);
adb(
  "install",
  "-r",
  `app/build/outputs/apk/${configuration}/app-${configuration}.apk`,
);
adb("shell", "am", "force-stop", "probe.workersembed");
adb("logcat", "-c");
adb("shell", "am", "start", "-n", "probe.workersembed/probe.Launcher");

async function screen() {
  const dumpFile = "/sdcard/workers-embedding.xml";
  for (let attempt = 0; attempt < 3; attempt++) {
    // A killed dumper may leave a completed file; never read a previous attempt.
    adb("shell", "rm", "-f", dumpFile);
    try {
      adb("shell", "uiautomator", "dump", dumpFile);
    } catch (error) {
      if (error.status !== 137 || attempt === 2) throw error;
      await delay(300 * (attempt + 1));
      continue;
    }
    return adb("exec-out", "cat", dumpFile);
  }
}
function labelledNode(xml, text) {
  return [...xml.matchAll(/<node\b[^>]*>/g)].find(([tag]) =>
    ["text", "content-desc"].some((attribute) =>
      tag.includes(`${attribute}="${text}"`),
    ),
  )?.[0];
}
// Some emulator WebViews stop exposing descendants to UIAutomator after navigation.
// Use the rendered DOM only for fixture web elements; native host checks stay UI-based.
async function renderedWebNode(text, xml) {
  if (
    !/^(Worker Home|Worker Next|Posted verified|Network recovered|Network interrupted|Next|Submit|Check network|Interrupt network)$/.test(
      text,
    )
  )
    return null;
  const webView = [...xml.matchAll(/<node\b[^>]*>/g)].find(
    ([tag]) =>
      tag.includes('class="android.webkit.WebView"') &&
      tag.includes('package="probe.workersembed"'),
  )?.[0];
  const bounds = webView?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) return null;
  const pid = adb("shell", "pidof", "probe.workersembed").trim();
  const port = adb(
    "forward",
    "tcp:0",
    `localabstract:webview_devtools_remote_${pid}`,
  ).trim();
  try {
    const targets = await (
      await fetch(`http://127.0.0.1:${port}/json`, {
        signal: AbortSignal.timeout(3000),
      })
    ).json();
    const page = targets.find(
      (target) =>
        target.type === "page" &&
        target.url.startsWith("https://workers-sdk.local/") &&
        !target.url.includes("__workers_capacitor_host"),
    );
    if (!page) return null;
    const result = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("DOM probe timeout"));
      }, 5000);
      socket.addEventListener("open", () =>
        socket.send(
          JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: {
              expression: `(() => { const element = [...document.querySelectorAll('h1,a,button')].find(el => el.textContent.trim() === ${JSON.stringify(text)}); if (!element) return null; const r = element.getBoundingClientRect(); const s = getComputedStyle(element); if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight || s.visibility !== 'visible' || s.display === 'none') return null; return { x: r.x+r.width/2, y: r.y+r.height/2, width: innerWidth, height: innerHeight, url: location.href }; })()`,
              returnByValue: true,
            },
          }),
        ),
      );
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id === 1) {
          clearTimeout(timer);
          socket.close();
          if (message.error || message.result?.exceptionDetails)
            reject(new Error(JSON.stringify(message)));
          else resolve(message.result?.result?.value);
        }
      });
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          socket.close();
          reject(new Error("DOM probe connection failed"));
        },
        { once: true },
      );
    });
    if (!result) return null;
    console.log(`DOM visibility verified: ${text} at ${result.url}`);
    await writeFile(
      path.join(artifacts, "dom-visibility.png"),
      run("adb", ["-s", device, "exec-out", "screencap", "-p"], {
        encoding: null,
      }),
    );
    return {
      x: +bounds[1] + (result.x * (+bounds[3] - +bounds[1])) / result.width,
      y: +bounds[2] + (result.y * (+bounds[4] - +bounds[2])) / result.height,
    };
  } finally {
    adb("forward", "--remove", `tcp:${port}`);
  }
}
async function waitFor(text, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let xml = "";
  while (Date.now() < deadline) {
    xml = await screen();
    if (labelledNode(xml, text)) return { xml };
    const dom = await renderedWebNode(text, xml);
    if (dom) return { xml, dom };
    await delay(300);
  }
  await writeFile(path.join(artifacts, "failure.xml"), xml);
  throw new Error(`Screen did not contain ${text}`);
}
async function tap(text) {
  const { xml, dom } = await waitFor(text);
  if (dom) {
    adb(
      "shell",
      "input",
      "tap",
      String(Math.round(dom.x)),
      String(Math.round(dom.y)),
    );
    return;
  }
  const node = labelledNode(xml, text);
  const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) throw new Error(`No bounds for ${text}`);
  adb(
    "shell",
    "input",
    "tap",
    String(Math.floor((+bounds[1] + +bounds[3]) / 2)),
    String(Math.floor((+bounds[2] + +bounds[4]) / 2)),
  );
}
async function crashRenderer() {
  const pid = adb("shell", "pidof", "probe.workersembed").trim();
  const port = adb(
    "forward",
    "tcp:0",
    `localabstract:webview_devtools_remote_${pid}`,
  ).trim();
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const target = targets.find(
      (page) =>
        page.type === "page" && page.url === "https://workers-sdk.local/",
    );
    if (!target) throw new Error("No SDK document debug target");
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("Renderer did not crash"));
      }, 10_000);
      const done = () => {
        clearTimeout(timer);
        socket.close();
        resolve();
      };
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ id: 1, method: "Page.crash" })),
      );
      socket.addEventListener("close", done, { once: true });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.method === "Inspector.targetCrashed") done();
        else if (message.id === 1 && message.error) {
          clearTimeout(timer);
          socket.close();
          reject(new Error(JSON.stringify(message.error)));
        }
      });
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Debugger connection failed"));
        },
        { once: true },
      );
    });
  } finally {
    adb("forward", "--remove", `tcp:${port}`);
  }
}
let reverseInstalled = false;
const autoRotate = adb(
  "shell",
  "settings",
  "get",
  "system",
  "accelerometer_rotation",
).trim();
const rotation = adb(
  "shell",
  "settings",
  "get",
  "system",
  "user_rotation",
).trim();
async function acceptance() {
  try {
    await waitFor("Native host visits 0");
    await waitFor("Host service worker host-sw-retained");
    if (recovery) {
      const port = new URL(process.env.WORKERS_SESSION_ORIGIN).port;
      adb("reverse", "tcp:" + port, "tcp:" + port);
      try {
        await tap("Open Worker");
        await waitFor("Sign in and save");
        await tap("Sign in and save");
        await waitFor("Saved for reader@example.com");
        adb("shell", "input", "keyevent", "4");
        await waitFor("Native host visits 1");
        await tap("Open Worker");
        await waitFor("Saved for reader@example.com");
        await crashRenderer();
        await waitFor("Native host visits 2");
        await tap("Open Worker");
        await waitFor("Saved for reader@example.com");
        adb("shell", "input", "keyevent", "4");
        await waitFor("Native host visits 3");
      } finally {
        adb("reverse", "--remove", "tcp:" + port);
      }
      return;
    }
    const startedAt = Date.now();
    await tap("Open Worker");
    await waitFor("Worker Home");
    await writeFile(
      path.join(artifacts, "startup.json"),
      JSON.stringify({
        configuration,
        tapAndAccessibilityReadyMs: Date.now() - startedAt,
      }),
    );
    await writeFile(
      path.join(artifacts, "memory-ready.txt"),
      adb("shell", "dumpsys", "meminfo", "probe.workersembed"),
    );
    if (measureOnly) {
      await writeFile(
        path.join(artifacts, "measurement.png"),
        run("adb", ["-s", device, "exec-out", "screencap", "-p"], {
          encoding: null,
        }),
      );
      adb("shell", "input", "keyevent", "4");
      await waitFor("Native host visits 1");
      console.log(
        `PASS ${configuration} measurement: Worker Home displayed and closed`,
      );
      return;
    }
    if (lifecycle) {
      adb("reverse", "tcp:18764", "tcp:18764");
      reverseInstalled = true;
      adb("shell", "input", "keyevent", "KEYCODE_HOME");
      await delay(2000);
      adb("shell", "input", "keyevent", "KEYCODE_APP_SWITCH");
      await tap("probe.workersembed probe.Launcher");
      await waitFor("Worker Home");
      const lifecycleEvidence = adb(
        "logcat",
        "-d",
        "-s",
        "HostIsolation:I",
        "*:S",
      );
      const stopped = lifecycleEvidence.match(
        /SDK Activity stopped (\d+)/,
      )?.[1];
      if (
        !stopped ||
        !lifecycleEvidence
          .slice(lifecycleEvidence.indexOf(`SDK Activity stopped ${stopped}`))
          .includes(`SDK Activity resumed ${stopped}`)
      )
        throw new Error("Same SDK Activity did not stop and resume");
      await tap("Check network");
      await waitFor("Network recovered");
      await tap("Interrupt network");
      await waitFor("Network interrupted");
      await tap("Check network");
      await waitFor("Network recovered");
      console.log(
        "PASS background resume and connection interruption/recovery",
      );
      await tap("Next");
      await waitFor("Worker Next");
    }
    // Healthy ready must cancel the native 30-second startup deadline.
    await delay(35_000);
    await waitFor(lifecycle ? "Worker Next" : "Worker Home");
    if (
      !adb("logcat", "-d", "-s", "HostIsolation:I", "*:S").includes(
        "Host SW result during SDK open: host-sw-retained",
      )
    )
      throw new Error("Host service-worker routing failed while SDK was open");
    await tap("Next");
    await waitFor("Worker Next");
    await tap("Submit");
    await waitFor("Posted verified");
    adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    adb("shell", "settings", "put", "system", "user_rotation", "1");
    await delay(1500);
    await waitFor("Posted verified");
    adb("shell", "input", "keyevent", "4");
    await waitFor("Native host visits 1");
    await tap("Verify host isolation");
    const isolationScreen = await screen();
    await writeFile(
      path.join(artifacts, "host-isolation.xml"),
      isolationScreen,
    );
    await writeFile(
      path.join(artifacts, "host-isolation.log"),
      adb("logcat", "-d", "-s", "HostIsolation:I", "*:S"),
    );
    if (
      !isolationScreen.includes(
        'text="Host isolation session=true persistent=true handler=true"',
      )
    )
      throw new Error(
        "SDK open/close changed host cookies or process CookieHandler; see host-isolation.log",
      );
    await tap("Verify host service worker");
    await waitFor("Host service worker host-sw-retained");
    await tap("Open Worker");
    await waitFor("Worker Home");
    adb("shell", "input", "keyevent", "4");
    await waitFor("Native host visits 2");
    await tap("Open failed Worker");
    // Failure must return without user Back and release the singleton for retry.
    await waitFor("Native host visits 3");
    let log = "";
    const failureDeadline = Date.now() + 30_000;
    while (Date.now() < failureDeadline) {
      log = adb("logcat", "-d", "-s", "WorkersNative:E");
      if (log.includes("Native embedding startup failure probe")) break;
      await delay(300);
    }
    if (!log.includes("Native embedding startup failure probe"))
      throw new Error(`Expected SDK startup failure notification:\n${log}`);
    await tap("Open Worker");
    await waitFor("Worker Home");
    await crashRenderer();
    await waitFor("Native host visits 4");
    await tap("Open Worker");
    await waitFor("Worker Home");
    adb("shell", "input", "keyevent", "4");
    await waitFor("Native host visits 5");
    const lifecycleLog = () =>
      adb("logcat", "-d", "-s", "HostIsolation:I", "*:S");
    const createdBefore = (lifecycleLog().match(/SDK Activity created /g) ?? [])
      .length;
    await tap("Recreate Worker");
    const recreateDeadline = Date.now() + 30_000;
    while (
      !adb("logcat", "-d", "-s", "HostIsolation:I", "*:S").includes(
        "Recreating SDK Activity",
      )
    ) {
      if (Date.now() > recreateDeadline)
        throw new Error("SDK Activity recreation not triggered");
      await delay(300);
    }
    while (
      (lifecycleLog().match(/SDK Activity created /g) ?? []).length <
      createdBefore + 2
    ) {
      if (Date.now() > recreateDeadline)
        throw new Error("SDK Activity was not recreated");
      await delay(300);
    }
    await waitFor("Worker Home");
    await tap("Next");
    await waitFor("Worker Next");
    await tap("Submit");
    await waitFor("Posted verified");
    adb("shell", "input", "keyevent", "4");
    await waitFor("Native host visits 6");
    await tap("Open broken Worker");
    await waitFor("Native host visits 7", 60_000);
    if (
      !adb("logcat", "-d", "-s", "WorkersNative:E").includes(
        "Runtime startup timed out before ready",
      )
    )
      throw new Error(
        "Missing JavaScript entry did not report the native startup deadline",
      );
    // A deadline failure must also release the runtime so a normal open works.
    await tap("Open Worker");
    await waitFor("Worker Home");
    adb("shell", "input", "keyevent", "4");
    await waitFor("Native host visits 8");
    await tap("Verify host isolation");
    await waitFor("Host isolation session=true persistent=true handler=true");
    await tap("Verify host service worker");
    await waitFor("Host service worker host-sw-retained");
    await writeFile(path.join(artifacts, "passed.xml"), await screen());
    await writeFile(
      path.join(artifacts, "passed.png"),
      run("adb", ["-s", device, "exec-out", "screencap", "-p"], {
        encoding: null,
      }),
    );
    console.log(
      "PASS Maven consumer: navigation, POST, rotation, close/reopen, startup failure, renderer loss, Activity recreation, broken entry, cookies, CookieHandler and host service-worker routing",
    );
  } finally {
    if (reverseInstalled) adb("reverse", "--remove", "tcp:18764");
    for (const [name, value] of [
      ["accelerometer_rotation", autoRotate],
      ["user_rotation", rotation],
    ]) {
      if (value === "null") adb("shell", "settings", "delete", "system", name);
      else adb("shell", "settings", "put", "system", name, value);
    }
    await writeFile(path.join(artifacts, "runtime.log"), adb("logcat", "-d"));
    await writeFile(
      path.join(artifacts, "host-isolation.log"),
      adb("logcat", "-d", "-s", "HostIsolation:I", "*:S"),
    );
  }
}
await acceptance();
