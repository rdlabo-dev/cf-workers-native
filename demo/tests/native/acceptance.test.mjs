import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNativeAcceptance } from "./acceptance.mjs";
import { waitForAcceptance } from "./reports.mjs";

for (const refreshed of [false, true]) {
  test(`failure wins over completion in ${refreshed ? "refreshed" : "existing"} reports`, async () => {
    const reports = [
      { stage: "failure", error: "page crashed" },
      { stage: "complete" },
    ];
    const backend = {
      reports: refreshed ? [] : reports,
      refresh: refreshed
        ? async () => {
            backend.reports = reports;
          }
        : undefined,
    };
    await assert.rejects(waitForAcceptance(backend, 1000), /page crashed/);
  });
}

test("acceptance requires completion and refreshes pending reports", async () => {
  const backend = {
    reports: [],
    refresh: async () => {
      backend.reports.push({ stage: "complete" });
    },
  };
  assert.equal((await waitForAcceptance(backend, 1000)).stage, "complete");
  await assert.rejects(waitForAcceptance({ reports: [] }, 0));
});

test("invalid native configuration closes the already-started backend", async () => {
  const artifacts = await mkdtemp(join(tmpdir(), "native-acceptance-"));
  let closed = 0;
  try {
    await assert.rejects(
      runNativeAcceptance({
        artifacts,
        platform: "invalid",
        device: "",
        backend: {
          reports: [],
          requests: [],
          close: async () => {
            closed++;
          },
        },
      }),
      /Set UPSTREAM_PLATFORM/,
    );
    assert.equal(closed, 1);
  } finally {
    await rm(artifacts, { recursive: true });
  }
});

test("physical iOS rejects a local test CA and still closes the backend", async () => {
  const artifacts = await mkdtemp(join(tmpdir(), "native-acceptance-"));
  const previous = {
    physical: process.env.IOS_PHYSICAL_DEVICE,
    team: process.env.IOS_DEVELOPMENT_TEAM,
  };
  let closed = 0;
  process.env.IOS_PHYSICAL_DEVICE = "1";
  process.env.IOS_DEVELOPMENT_TEAM = "test-team";
  try {
    for (const name of [
      "ios-summary.json",
      "ios-error.log",
      "ios-reports.json",
      "android-summary.json",
    ])
      await writeFile(join(artifacts, name), "prior attempt");
    await assert.rejects(
      runNativeAcceptance({
        artifacts,
        platform: "ios",
        device: "test-device",
        backend: {
          ca: "/test-ca.pem",
          reports: [],
          requests: [],
          close: async () => {
            closed++;
          },
        },
      }),
      /deployed HTTPS backend/,
    );
    for (const name of ["ios-summary.json", "ios-error.log"])
      await assert.rejects(readFile(join(artifacts, name)), { code: "ENOENT" });
    assert.deepEqual(
      JSON.parse(await readFile(join(artifacts, "ios-reports.json"), "utf8")),
      { reports: [], requests: [] },
    );
    assert.equal(
      await readFile(join(artifacts, "android-summary.json"), "utf8"),
      "prior attempt",
    );
    assert.equal(closed, 1);
  } finally {
    for (const [key, value] of [
      ["IOS_PHYSICAL_DEVICE", previous.physical],
      ["IOS_DEVELOPMENT_TEAM", previous.team],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(artifacts, { recursive: true });
  }
});
