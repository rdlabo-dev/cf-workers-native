import { test, expect } from "vitest";
test("imported worker env follows nested and overlapping dispatches", async () => {
  const { env } =
    await import("./index.js");
  const { runWithRequestScope } = await import("../../../shared/request-scope.js");
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
