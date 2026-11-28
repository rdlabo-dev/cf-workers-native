import { expect, it, vi } from "vitest";
import { Blob, File } from "./blob.js";
import { installWebGlobals } from "../../shared/globals/web.js";
import { testWebGlobalOwnership } from "../../../tests/helpers/web-global-ownership.js";

testWebGlobalOwnership({ Blob, File });

it("recovers host constructors when another bundle loads after installation", async () => {
  const restore = installWebGlobals();
  try {
    vi.resetModules();
    const other = await import("./blob.js");
    const blob = new other.Blob(["hello"]);
    const file = new other.File([blob], "test.txt", { lastModified: 12.5 });
    expect(await file.text()).toBe("hello");
    expect(file.lastModified).toBe(12.5);
    expect(file.name).toBe("test.txt");
    const original = new Blob(["x"], { type: "a\x7fz" });
    expect(other.cloneBlob(original).type).toBe("a\x7fz");
  } finally {
    restore();
  }
});
