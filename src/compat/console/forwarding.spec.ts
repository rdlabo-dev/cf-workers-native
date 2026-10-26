import { test, expect, vi } from "vitest";

test("console methods retain their host receiver and arguments after import", async () => {
  const names = [
    "log",
    "info",
    "debug",
    "warn",
    "error",
    "dir",
    "time",
    "timeEnd",
    "timeLog",
    "trace",
    "assert",
    "clear",
    "count",
    "countReset",
    "group",
    "groupEnd",
    "table",
    "dirxml",
    "groupCollapsed",
    "profile",
    "profileEnd",
    "timeStamp",
  ] as const;
  const descriptors = Object.getOwnPropertyDescriptors(globalThis.console);
  const seen: { name: string; receiver: unknown; args: unknown[] }[] = [];
  try {
    for (const name of names)
      Object.defineProperty(console, name, {
        configurable: true,
        writable: true,
        value: function (this: unknown, ...args: unknown[]) {
          seen.push({ name, receiver: this, args });
        },
      });
    vi.resetModules();
    const api = await import("./index.js");
    for (const name of names) {
      // Captured binding must not be replaced by later mutation of the host.
      Object.defineProperty(console, name, {
        configurable: true,
        writable: true,
        value: () => {
          throw Error("late host lookup");
        },
      });
      const payload = { name };
      expect(Reflect.apply(api[name], {}, ["%s", payload, 3])).toBeUndefined();
      const event = seen.pop();
      expect(event).toEqual({
        name,
        receiver: console,
        args: ["%s", payload, 3],
      });
      expect(event!.args[1]).toBe(payload);
      expect(api.Console.prototype[name]).toBe(api[name]);
    }
    expect(api.default).toBe(console);
  } finally {
    for (const name of Reflect.ownKeys(console))
      if (!Object.hasOwn(descriptors, name))
        Reflect.deleteProperty(console, name);
    Object.defineProperties(console, descriptors);
    vi.resetModules();
  }
});
