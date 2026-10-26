import { test, expect } from "vitest";
import { createHash } from "./hash.js";
import { getHashes } from "./metadata.js";
// @ts-expect-error Upstream JavaScript fixture has no declarations.
import * as cases from "./upstream-hash.fixture.mjs";
for (const [name, fixture] of Object.entries(cases))
  test(`pinned Workers hash: ${name}`, () =>
    (fixture as { test: () => unknown }).test());
test("all pinned digest names support incremental and copied input", () => {
  for (const name of getHashes()) {
    const hash = createHash(name).update("a");
    const copy = hash.copy();
    expect(hash.update("bc").digest("hex")).toBe(
      createHash(name).update("abc").digest("hex"),
    );
    expect(copy.update("d").digest("hex")).toBe(
      createHash(name).update("ad").digest("hex"),
    );
  }
});

// @ts-expect-error Upstream JavaScript fixture has no declarations.
import * as hmacCases from "./upstream-hmac.fixture.mjs";
for (const [name, fixture] of Object.entries(hmacCases))
  test(`pinned Workers hmac: ${name}`, () =>
    (fixture as { test: () => unknown }).test());

// @ts-expect-error Upstream JavaScript fixture has no declarations.
import * as pbkdfCases from "./upstream-pbkdf2.fixture.mjs";
for (const [name, fixture] of Object.entries(pbkdfCases))
  test(`pinned Workers pbkdf2: ${name}`, () =>
    (fixture as { test: () => unknown }).test());

// @ts-expect-error Upstream JavaScript fixture has no declarations.
import * as hkdfCases from "./upstream-hkdf.fixture.mjs";
for (const [name, fixture] of Object.entries(hkdfCases))
  test(`pinned Workers hkdf: ${name}`, () =>
    (fixture as { test: () => unknown }).test());

import { validateCryptoLength } from "./validation.js";
test("native crypto length guard rejects before narrowing to signed int", () => {
  for (const length of [0, 0x7fffffff])
    expect(() => validateCryptoLength(length, "too large")).not.toThrow();
  for (const length of [0x80000000, 0x100000000])
    expect(() => validateCryptoLength(length, "too large")).toThrow(
      new RangeError("too large"),
    );
});
