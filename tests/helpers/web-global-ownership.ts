import { describe, expect, it } from "vitest";
import { installWebGlobals } from "../../src/shared/globals/web.js";

export function testWebGlobalOwnership(values: Record<string, unknown>) {
  describe.each(Object.entries(values))(
    "%s global ownership",
    (name, value) => {
      it("preserves the original descriptor until the last owner releases", () => {
        const target = {};
        Object.defineProperty(target, name, {
          configurable: true,
          enumerable: false,
          get: () => "original",
        });
        const original = Object.getOwnPropertyDescriptors(target);
        const a = installWebGlobals(target);
        const b = installWebGlobals(target);
        expect(Reflect.get(target, name)).toBe(value);
        a();
        a();
        expect(Reflect.get(target, name)).toBe(value);
        b();
        expect(Object.getOwnPropertyDescriptors(target)).toEqual(original);
      });
      it("does not overwrite a later application replacement on release", () => {
        const target: Record<string, unknown> = {};
        const release = installWebGlobals(target);
        const replacement = {};
        target[name] = replacement;
        expect(() => installWebGlobals(target)).toThrow(`${name} changed`);
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
    },
  );
}
