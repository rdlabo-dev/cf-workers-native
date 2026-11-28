import { describe, expect, it } from "vitest";
import { installWebGlobals } from "../../src/shared/globals/web.js";

export function testWebGlobalOwnership(values: Record<string, unknown>) {
  const entries = Object.entries(values);
  it("restores all original descriptors only after the final owner releases", () => {
    const target = {};
    for (const [name] of entries)
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: false,
        get: () => name,
      });
    const original = Object.getOwnPropertyDescriptors(target);
    const first = installWebGlobals(target);
    const second = installWebGlobals(target);
    for (const [name, value] of entries)
      expect(Reflect.get(target, name), name).toBe(value);
    first();
    first();
    for (const [name, value] of entries)
      expect(Reflect.get(target, name), name).toBe(value);
    second();
    expect(Object.getOwnPropertyDescriptors(target)).toEqual(original);
  });
  describe.each(entries)("%s global ownership", (name) => {
    it("does not overwrite a later application replacement on release", () => {
      const target: Record<string, unknown> = {};
      const release = installWebGlobals(target);
      const replacement = {};
      target[name] = replacement;
      expect(() => installWebGlobals(target)).toThrow(
        `${name} changed during installation`,
      );
      release();
      expect(target[name]).toBe(replacement);
      expect(Object.getOwnPropertyNames(target)).toEqual([name]);
    });
    it("rolls back earlier globals when this property cannot be replaced", () => {
      const target = {};
      Object.defineProperty(target, name, {
        value: "locked",
        configurable: false,
      });
      const before = Object.getOwnPropertyDescriptors(target);
      expect(() => installWebGlobals(target)).toThrow();
      expect(Object.getOwnPropertyDescriptors(target)).toEqual(before);
    });
  });
}
