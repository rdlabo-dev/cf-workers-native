import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

let release!: () => void;
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
const background: string[] = [];
// Upstream exists only in tests; the mobile adapter still opens no HTTP server.
const upstream = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://upstream");
  if (url.pathname === "/api/background.txt") {
    await gate;
    background.push(req.method!);
  }
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(
    url.pathname === "/api/upstream.txt"
      ? `upstream:${url.searchParams.get("id")}`
      : "background completed",
  );
});
const harness = createTestHarness();
beforeAll(async () => {
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address() as { port: number };
  await harness.update({
    workers: [
      {
        config: {
          name: "runtime-isolation",
          main: "tests/fixtures/workers/runtime/isolation.ts",
          compatibility_date: "2026-10-01",
          vars: { UPSTREAM: `http://127.0.0.1:${address.port}` },
        },
      },
    ],
  });
  await harness.listen();
});
afterAll(async () => {
  release();
  await harness.close();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

it("keeps outbound fetch and waitUntil independent of concurrent incoming calls", async () => {
  try {
    const outbound = Promise.all(
      ["a", "b", "c"].map(async (id) =>
        (
          await harness.fetch(`http://logical.example/api/outbound?id=${id}`)
        ).json(),
      ),
    );
    const echo = await harness.fetch("/api/echo", {
      method: "POST",
      body: "日本語 🍷",
    });
    expect(await echo.text()).toBe("日本語 🍷");
    expect(echo.headers.get("x-runtime")).toBe("local");
    expect(await outbound).toEqual(
      ["a", "b", "c"].map((id) => ({
        upstream: `upstream:${id}`,
        url: `http://logical.example/api/outbound?id=${id}`,
        dom: false,
      })),
    );
    expect(background).toEqual([]);
    release();
    await expect.poll(() => background).toEqual(["POST", "POST", "POST"]);
  } finally {
    release();
  }
});

it("streams before completion and allows the client to cancel", async () => {
  const response = await harness.fetch("/api/stream", {
    headers: { "accept-encoding": "identity" },
  });
  const reader = response.body!.getReader();
  let chunk = await reader.read();
  while (!chunk.done && !chunk.value?.length) chunk = await reader.read();
  expect(new TextDecoder().decode(chunk.value)).toBe("first");
  await reader.cancel();
  expect((await reader.read()).done).toBe(true);
  // HTTP disconnect does not guarantee a JS cancel callback in the old request context.
  // The Dedicated Worker transport tests that callback separately.
});
