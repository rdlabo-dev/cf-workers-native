import { test } from "vitest";
import { runWithTemporaryFiles } from "./writable.js";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as cases from "./upstream-glob.fixture.mjs";
for (const [name, fixture] of Object.entries(cases))
  test(`pinned Workers glob: ${name}`, () =>
    runWithTemporaryFiles(() => (fixture as { test: () => unknown }).test()));
