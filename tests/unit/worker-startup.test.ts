import { afterEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import {
  workerEntry,
  networkRelayPath,
  globalsInstallPath,
  transportPath,
} from "../../src/tooling/shared";
import { createIsolatedWorker } from "../../src/browser/isolated/bridge";

const relay = vi.hoisted(() => ({
  receive: vi.fn(),
  dispose: vi.fn(async () => {}),
}));
vi.mock("../../src/browser/fetch/relay", () => ({
  createNetworkRelay: () => relay,
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("reports an actual bootstrap import rejection without Worker.onerror and releases pending ownership", async () => {
  const client = {
    onmessage: null as null | ((event: { data: unknown }) => void),
    terminate: vi.fn(),
    postMessage: vi.fn(),
  };
  const isolated = createIsolatedWorker(client as unknown as Worker);
  const ready = expect(isolated.ready).rejects.toMatchObject({
    name: "RangeError",
    message: "user module initialization",
  });
  const pending = expect(
    isolated.handler.fetch(
      new Request("https://worker.invalid"),
      {},
      { props: {}, passThroughOnException() {}, waitUntil() {} },
    ),
  ).rejects.toMatchObject({
    name: "RangeError",
    message: "user module initialization",
  });
  expect(isolated.activeCalls).toBe(1);
  vi.stubGlobal("self", {
    postMessage(data: unknown) {
      client.onmessage?.({ data });
    },
  });
  const stages: string[] = [];
  vi.stubGlobal("recordBootstrapStage", (stage: string) => stages.push(stage));
  const result = await build({
    stdin: { contents: workerEntry("user-entry"), resolveDir: process.cwd() },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    plugins: [
      {
        name: "startup-fixture",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) => ({
            path,
            namespace: "fixture",
          }));
          const modules = new Map([
            [
              networkRelayPath,
              "export async function initializeWorkerNetwork() { await new Promise(resolve => setTimeout(resolve, 0)); recordBootstrapStage('network ready'); }",
            ],
            [globalsInstallPath, "recordBootstrapStage('globals installed');"],
            [
              transportPath,
              "export function serve() { throw new Error('Must not serve'); }",
            ],
            [
              "user-entry",
              "recordBootstrapStage('worker evaluated'); throw new RangeError('user module initialization'); export default {};",
            ],
          ]);
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
            const contents = modules.get(path);
            if (contents === undefined)
              throw new Error("Unexpected bootstrap import: " + path);
            return { contents };
          });
        },
      },
    ],
  });
  // Execute the generated bootstrap, including its rejected dynamic import.
  const bootstrap = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  expect(Object.keys(bootstrap)).toEqual([]);
  expect(stages).toEqual([
    "network ready",
    "globals installed",
    "worker evaluated",
  ]);
  await ready;
  await pending;
  expect(client.terminate).toHaveBeenCalledOnce();
  expect(relay.dispose).toHaveBeenCalledOnce();
  expect(isolated.activeCalls).toBe(0);
  await expect(
    isolated.handler.fetch(
      new Request("https://worker.invalid"),
      {},
      { props: {}, passThroughOnException() {}, waitUntil() {} },
    ),
  ).rejects.toMatchObject({
    name: "RangeError",
    message: "user module initialization",
  });
});
