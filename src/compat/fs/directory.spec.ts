import { test, beforeEach } from "vitest";
import { clearVirtualFiles, registerVirtualFiles } from "./index.js";
beforeEach(() => {
  clearVirtualFiles();
  registerVirtualFiles({ "/bundle/worker": "fixture module" });
});
import { runWithTemporaryFiles } from "./writable.js";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as cases from "./upstream-directory.fixture.mjs";
for (const [name, fixture] of Object.entries(cases))
  test(`pinned Workers directories: ${name}`, () =>
    runWithTemporaryFiles(() => (fixture as { test: () => unknown }).test()));

// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as miscellaneous from "./upstream-misc.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as fileHandles from "./upstream-filehandle.fixture.mjs";
for (const [group, cases] of Object.entries({ miscellaneous, fileHandles }))
  for (const [name, fixture] of Object.entries(cases))
    test(`pinned Workers ${group}: ${name}`, () =>
      runWithTemporaryFiles(() => (fixture as { test: () => unknown }).test()));

// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as access from "./upstream-access.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as chown_chmod from "./upstream-chown-chmod.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as link from "./upstream-link.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as stat from "./upstream-stat.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as utimes from "./upstream-utimes.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as readsync_byteoffset from "./upstream-readsync-byteoffset.fixture.mjs";
for (const [group, cases] of Object.entries({
  access,
  chown_chmod,
  link,
  stat,
  utimes,
  readsync_byteoffset,
}))
  for (const [name, fixture] of Object.entries(cases))
    test(`pinned Workers ${group}: ${name}`, () =>
      runWithTemporaryFiles(() => (fixture as { test: () => unknown }).test()));

// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as cp from "./upstream-cp.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as cp_into_subdirectory from "./upstream-cp-into-subdirectory.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as readstream from "./upstream-readstream.fixture.mjs";
// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as writestream from "./upstream-writestream.fixture.mjs";
for (const [group, cases] of Object.entries({
  cp,
  cp_into_subdirectory,
  readstream,
  writestream,
}))
  for (const [name, fixture] of Object.entries(cases))
    test(`pinned Workers ${group}: ${name}`, () =>
      runWithTemporaryFiles(() => (fixture as { test: () => unknown }).test()));

// @ts-expect-error Upstream JavaScript fixture has no declaration file.
import * as nodejs from "./upstream-nodejs.fixture.mjs";
for (const [name, fixture] of Object.entries(nodejs))
  test(`pinned Workers nodejs: ${name}`, () =>
    runWithTemporaryFiles(() => (fixture as { test: () => unknown }).test()));
