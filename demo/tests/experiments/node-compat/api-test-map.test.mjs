import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { referenceIndex } from "./api-test-map.mjs";
import { eventCases } from "../../../../src/compat/expansion/index.spec.mjs";
const operations = JSON.parse(
  await readFile(new URL("api-test-operations.json", import.meta.url), "utf8"),
);
const exports = JSON.parse(
  await readFile(new URL("exports.json", import.meta.url), "utf8"),
);

test("API reference index retains every pinned module and export without implying behavior coverage", () => {
  assert.deepEqual(referenceIndex.profile, exports.profile);
  assert.deepEqual(
    referenceIndex.modules.map((m) => m.module),
    Object.keys(exports.modules),
  );
  const ids = new Set(referenceIndex.cases.map((c) => c.id));
  for (const module of referenceIndex.modules) {
    assert.deepEqual(
      module.exports.map((e) => e.name),
      exports.modules[module.module],
    );
    for (const entry of module.exports)
      for (const id of entry.cases) assert.ok(ids.has(id), id);
  }
  assert.match(referenceIndex.scope, /not behavioral coverage/);
});

test("reviewed operation rows refer to registered named tests and valid API targets", async () => {
  assert.deepEqual(operations.profile, exports.profile);
  const ids = new Set();
  for (const operation of operations.operations) {
    assert.ok(!ids.has(operation.id), operation.id);
    ids.add(operation.id);
    for (const module of operation.modules)
      assert.ok(exports.modules[module], module);
    const id = operation.test.file + "#" + operation.test.case;
    assert.ok(
      referenceIndex.cases.some((c) => c.id === id),
      "Missing named contract: " + id,
    );
    assert.ok(
      operation.apis.length &&
        operation.scenarios.length &&
        operation.targets.length,
      operation.id,
    );
    for (const api of operation.apis) {
      const receiver = api.split(".")[0];
      assert.ok(
        operation.modules.some((module) =>
          exports.modules[module].includes(receiver),
        ) || operation.receivers?.[receiver],
        `Unknown API: ${operation.id}/${api}`,
      );
    }
    const allowed = new Set([
      "unit",
      "workerd",
      ...["esbuild", "vite"].flatMap((build) =>
        ["chromium", "webkit"].flatMap((engine) =>
          ["page", "worker"].map((mode) => `${build}/${engine}/${mode}`),
        ),
      ),
      ...["ios", "android"].flatMap((platform) =>
        ["page", "worker"].map((mode) => `${platform}/${mode}`),
      ),
    ]);
    for (const target of operation.targets)
      assert.ok(allowed.has(target), `Unknown target: ${target}`);
    if (operation.targets.includes("workerd")) {
      const owner = await import(
        new URL("../../../../" + operation.test.file, import.meta.url)
      );
      const owned = Object.values(owner).find(
        (value) => typeof value?.[operation.test.case] === "function",
      )?.[operation.test.case];
      assert.equal(typeof owned, "function", id);
      assert.equal(
        eventCases[operation.test.case],
        owned,
        `Contract is not registered in the shared public/native runner: ${id}`,
      );
      for (const target of [
        "ios/page",
        "ios/worker",
        "android/page",
        "android/worker",
      ])
        assert.ok(
          operation.targets.includes(target),
          `Missing native target: ${id}/${target}`,
        );
    } else {
      const configuration = await readFile(
        new URL("../../../../vitest.config.ts", import.meta.url),
        "utf8",
      );
      assert.ok(
        configuration.includes(JSON.stringify(operation.test.file)),
        `Unit case is not registered: ${id}`,
      );
    }
  }
  for (const limitation of operations.remainingBoundaries)
    assert.ok(["Not implemented", "In progress"].includes(limitation.status));
});
