import { test, expect } from "@playwright/test";
for (const mode of ["default", "direct", "unavailable", "binding"] as const) {
  test(`configured entry selects ${mode} before dispatch`, async ({ page }) => {
    if (mode === "unavailable")
      await page.addInitScript(() =>
        Object.defineProperty(globalThis, "Worker", { value: undefined }),
      );
    await page.goto("/");
    await page.waitForFunction(
      () => typeof window.startPreferred === "function",
    );
    const result = await page.evaluate(async (mode) => {
      const runtime = window.startPreferred(
        mode === "direct" ? "direct" : undefined,
        mode === "binding"
          ? {
              KV: {
                get() {
                  return "value";
                },
              },
            }
          : {},
      );
      try {
        await runtime.ready;
        const response = await fetch("/api/echo", {
          method: "POST",
          body: "preference 🍷",
        });
        return { execution: runtime.execution, text: await response.text() };
      } finally {
        runtime.dispose();
      }
    }, mode);
    expect(result).toEqual({
      execution: mode === "default" ? "worker" : "direct",
      text: "preference 🍷",
    });
  });
}
test("top-level local fetch fails startup explicitly", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.startStartupProbe === "function",
  );
  const error = await page.evaluate(async () => {
    const runtime = window.startStartupProbe();
    try {
      await runtime.ready;
      return "unexpected success";
    } catch (error) {
      return String(error);
    } finally {
      runtime.dispose();
    }
  });
  expect(error).toContain("Direct module initialization is in progress");
});
test("early direct requests reject and aborted requests never replay after startup", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.startDelayedDirect === "function",
  );
  const results = await page.evaluate(async () => {
    const { runtime, release, dispatched } = window.startDelayedDirect();
    try {
      const early = await fetch("/api/echo", {
        method: "POST",
        body: "early",
      }).then(() => "unexpected", String);
      const controller = new AbortController();
      const pending = fetch("/api/echo", {
        method: "POST",
        body: "aborted",
        signal: controller.signal,
      }).then(
        () => "unexpected",
        (error) => error.name,
      );
      controller.abort();
      const aborted = await pending;
      release();
      await runtime.ready;
      const text = await (
        await fetch("/api/echo", { method: "POST", body: "ready" })
      ).text();
      return { early, aborted, text, dispatched: dispatched() };
    } finally {
      release();
      runtime.dispose();
    }
  });
  expect(results.early).toContain(
    "Direct module initialization is in progress",
  );
  expect(results.aborted).toBe("AbortError");
  expect(results.text).toBe("ready");
  expect(results.dispatched).toBe(1);
});
for (const prefer of ["direct", "worker"] as const) {
  test(`configured ${prefer} handler reads imported bindings after await`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => typeof window.startPreferred === "function",
    );
    const result = await page.evaluate(async (prefer) => {
      const runtime = window.startPreferred(prefer, { TEST_VALUE: 0 });
      try {
        await runtime.ready;
        return await (await fetch("/api/imported-env")).json();
      } finally {
        runtime.dispose();
      }
    }, prefer);
    expect(result).toEqual({ value: 0, keys: ["TEST_VALUE"] });
  });
}
