import { createIsolatedWorker } from "../../../../dist/browser/isolated/bridge";
import {
  getNativeCall,
  nativeNetwork,
} from "../../../../dist/browser/fetch/native-network";
import { FetchTransport } from "../../../../dist/browser/fetch/transport";
import { runNativeNetwork } from "../../validation/native-network";

const base = /Android/.test(navigator.userAgent)
  ? "http://10.0.2.2:4201"
  : "http://127.0.0.1:4201";
// Keep a native response pending across a real main-frame reload. A fresh JS
// realm cannot dispose the old connection; the native lifecycle must own it.
console.log("NETWORK_STAGE reload lifecycle");
const reloadTransport = new FetchTransport(nativeNetwork);
const reloadKey = "workers-capacitor-network-reload";
const previousID = sessionStorage.getItem(reloadKey);
const reloadID = previousID ?? crypto.randomUUID();
async function waitForReloadConnection(expected: boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await reloadTransport.fetch({
      url: `${base}/active`,
      method: "GET",
      headers: [],
      body: null,
      signal: AbortSignal.timeout(15_000),
    });
    const active: string[] = await new Response(response.body).json();
    if (active.some((id) => id.startsWith(reloadID)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Reload connection did not become ${expected ? "active" : "closed"}`,
  );
}
if (!previousID) {
  void reloadTransport
    .fetch({
      url: `${base}/never?id=${reloadID}`,
      method: "GET",
      headers: [],
      body: null,
      signal: new AbortController().signal,
    })
    .catch(() => {});
  await waitForReloadConnection(true);
  // Queue additional opens without waiting for native dispatch. Reload must
  // drain/close these on the old owner rather than publish them in the new one.
  for (let index = 0; index < 16; index++) {
    void reloadTransport
      .fetch({
        url: `${base}/never?id=${reloadID}-${index}`,
        method: "GET",
        headers: [],
        body: null,
        signal: new AbortController().signal,
      })
      .catch(() => {});
  }
  sessionStorage.setItem(reloadKey, reloadID);
  location.reload();
  await new Promise(() => {});
}
sessionStorage.removeItem(reloadKey);
let reloadError: string | undefined;
try {
  await waitForReloadConnection(false);
} catch (error) {
  reloadError = String(error);
}
console.log("NETWORK_STAGE direct contracts");
const results = (await runNativeNetwork(base, getNativeCall())).map(
  (result) => ({ ...result, name: `direct: ${result.name}` }),
);
results.push({
  name: "page reload closes previous native socket",
  ok: !reloadError,
  ...(reloadError ? { error: reloadError } : {}),
});
console.log("NETWORK_STAGE worker contracts");
const workerURL = new URL("./worker.js", import.meta.url);
workerURL.searchParams.set("base", base);
const worker = new Worker(workerURL, { type: "module" });
const runtime = createIsolatedWorker(worker);
try {
  const isolated = await new Promise<typeof results>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Native network Worker timed out")),
      60000,
    );
    worker.addEventListener("message", ({ data }) => {
      if (data.type !== "network-report") return;
      clearTimeout(timer);
      resolve(data.results);
    });
  });
  results.push(
    ...isolated.map((result) => ({
      ...result,
      name: `worker: ${result.name}`,
    })),
  );
} catch (error) {
  results.push({ name: "worker: completion", ok: false, error: String(error) });
} finally {
  await runtime.dispose();
}

const id = crypto.randomUUID();
workerURL.searchParams.set("pending", id);
const pending = createIsolatedWorker(new Worker(workerURL, { type: "module" }));
const transport = new FetchTransport(nativeNetwork);
async function untilActive(expected: boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await transport.fetch({
      url: `${base}/active`,
      method: "GET",
      headers: [],
      body: null,
      signal: AbortSignal.timeout(15_000),
    });
    const active: string[] = await new Response(result.body).json();
    if (active.includes(id) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Native connection did not become ${expected ? "active" : "closed"}`,
  );
}
try {
  await untilActive(true);
  await pending.dispose();
  await untilActive(false);
  results.push({ name: "worker: terminate closes native socket", ok: true });
} catch (error) {
  results.push({
    name: "worker: terminate closes native socket",
    ok: false,
    error: String(error),
  });
} finally {
  await pending.dispose();
}
for (const result of results)
  console.log("NETWORK_RESULT " + JSON.stringify(result));
console.log("NETWORK_COMPLETE " + results.length);
document.body.textContent = JSON.stringify(results, null, 2);
