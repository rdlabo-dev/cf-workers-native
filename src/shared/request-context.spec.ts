import { test, expect } from "vitest";
test("unused dispatcher import preserves host globals", async () => {
  const globals = [
    globalThis.Promise,
    globalThis.Promise.prototype.then,
    globalThis.MessageChannel,
    globalThis.setTimeout,
    globalThis.queueMicrotask,
  ];
  await import("./request-scope.js");
  expect([
    globalThis.Promise,
    globalThis.Promise.prototype.then,
    globalThis.MessageChannel,
    globalThis.setTimeout,
    globalThis.queueMicrotask,
  ]).toEqual(globals);
});
test("first crypto dynamic import retains the active request", async () => {
  const { runWithRequestScope } = await import("./request-scope.js");
  const { hasActiveRequest } = await import("./request-context.js");
  expect(hasActiveRequest()).toBe(false);
  const result = await runWithRequestScope(async () => {
    await Promise.resolve();
    const { createDiffieHellman } = await import("../compat/crypto/dh.js");
    expect(hasActiveRequest()).toBe(true);
    return createDiffieHellman(64).getPrime().length;
  });
  expect(result).toBe(8);
  expect(hasActiveRequest()).toBe(false);
});
test("request marker does not leak into concurrent outside callbacks", async () => {
  const { runWithRequestScope } = await import("./request-scope.js");
  const { hasActiveRequest } = await import("./request-context.js");
  const inside = runWithRequestScope(async () => {
    await Promise.resolve();
    return hasActiveRequest();
  });
  const outside = Promise.resolve().then(() => hasActiveRequest());
  expect(await Promise.all([inside, outside])).toEqual([true, false]);
});
test("imported worker env follows nested and overlapping dispatches", async () => {
  const { env } =
    await import("../cloudflare/apis/cloudflare-workers/index.js");
  const { runWithRequestScope } = await import("./request-scope.js");
  const first = { NAME: "first", EMPTY: undefined, COUNT: 0 };
  const second = { NAME: "second" };
  const read = (bindings: typeof first | typeof second) =>
    runWithRequestScope(async () => {
      await Promise.resolve();
      expect(Object.keys(env)).toEqual(Object.keys(bindings));
      expect("EMPTY" in env).toBe("EMPTY" in bindings);
      expect(env.COUNT).toBe(Reflect.get(bindings, "COUNT"));
      expect(runWithRequestScope(() => env.NAME, {})).toBeUndefined();
      return env.NAME;
    }, bindings);
  expect(await Promise.all([read(first), read(second)])).toEqual([
    "first",
    "second",
  ]);
  expect(env.NAME).toBeUndefined();
});
