import { expect, test } from "vitest";
import { createFetchRuntime } from "../../src/cloudflare/workers/worker-runtime";
import { env } from "../../src/cloudflare/apis/cloudflare-workers/index";
import { AsyncLocalStorage } from "../../src/compat/async-hooks/index";

const globals = () => [
  Promise.prototype.then,
  globalThis.queueMicrotask,
  globalThis.MessageChannel,
  globalThis.setTimeout,
  globalThis.setInterval,
  globalThis.setImmediate,
];
const baseURL = "https://local.test/api";
const handler = {
  fetch: () => Promise.resolve().then(() => new Response(String(env.VALUE))),
};
function start(value: string, preferred = false) {
  return createFetchRuntime({
    baseURL,
    env: { VALUE: value },
    worker: preferred
      ? {
          loadDirect: async () => handler,
          createWorker: () => {
            throw Error("expected direct");
          },
        }
      : handler,
    ...(preferred && { prefer: "direct" as const }),
  });
}

test("overlapping direct runtimes restore host propagation after the final owner closes", async () => {
  const before = globals();
  const first = start("first"),
    second = start("second", true);
  try {
    expect(await (await first.fetch(baseURL)).text()).toBe("first");
    expect(await (await second.fetch(baseURL)).text()).toBe("second");
    expect(Promise.prototype.then).not.toBe(before[0]);
    await first.dispose();
    expect(await (await second.fetch(baseURL)).text()).toBe("second");
  } finally {
    await first.dispose();
    await second.dispose();
  }
  expect(globals()).toEqual(before);
  const restarted = start("again", true);
  try {
    expect(await (await restarted.fetch(baseURL)).text()).toBe("again");
  } finally {
    await restarted.dispose();
  }
  expect(globals()).toEqual(before);
});

test("same-tick disposal prevents queued direct dispatch from acquiring host hooks", async () => {
  const before = globals();
  const runtime = start("closing");
  const pending = runtime.fetch(baseURL);
  const disposal = runtime.dispose();
  await expect(pending).rejects.toThrow("Worker runtime disposed");
  await disposal;
  await expect(runtime.fetch(baseURL)).rejects.toThrow(
    "Worker runtime disposed",
  );
  expect(globals()).toEqual(before);
});

test("disposing a direct runtime preserves a subsequent host replacement", async () => {
  const initial = globalThis.queueMicrotask;
  const runtime = start("direct");
  await runtime.fetch(baseURL);
  const replacement = (callback: VoidFunction) => initial(callback);
  globalThis.queueMicrotask = replacement;
  try {
    await runtime.dispose();
    expect(globalThis.queueMicrotask).toBe(replacement);
  } finally {
    globalThis.queueMicrotask = initial;
  }
});

test("independent async storage keeps propagation after direct disposal", async () => {
  const runtime = start("direct");
  await runtime.fetch(baseURL);
  const independent = new AsyncLocalStorage<string>();
  await runtime.dispose();
  expect(
    await independent.run("independent", () =>
      Promise.resolve().then(() => independent.getStore()),
    ),
  ).toBe("independent");
});
