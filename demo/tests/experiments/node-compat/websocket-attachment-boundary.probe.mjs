import {
  observeAttachments,
  expectedAttachments,
} from "../../../../src/browser/websocket/attachment.observations.spec.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// This proves the narrowly approved engine boundary. It does not certify the
// candidate WebSocket implementation or waive other attachment contracts.
test("pin attachment representation boundary and ordinary limit contracts", async () => {
  const require = createRequire(import.meta.url);
  const mfRequire = createRequire(require.resolve("miniflare/package.json"));
  const inventory = JSON.parse(
    await readFile(new URL("exports.json", import.meta.url), "utf8"),
  );
  const version = JSON.parse(
    await readFile(mfRequire.resolve("workerd/package.json"), "utf8"),
  ).version;
  assert.equal(version, inventory.profile.workerd);
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: inventory.profile.compatibilityDate,
      script: `export default { fetch() {
        const socket = new WebSocketPair()[0];
        const store = value => {
          try { socket.serializeAttachment(value); return { accepted: true }; }
          catch (error) { return { accepted: false, message: error.message }; }
        };
        const packed = [1, 2, 3];
        const holey = new Array(3);
        for (let i = 0; i < 3; i++) holey[i] = i + 1;
        const wrapper = value => [value, 'x'.repeat(16363)];
        const packedResult = store(wrapper(packed));
        const holeyResult = store(wrapper(holey));
        const preserved = socket.deserializeAttachment()[1].length === 16363;
        const normalAccepted = store('x'.repeat(16379));
        const normalRejected = store('x'.repeat(16380));
        const bufferAccepted = store(new ArrayBuffer(16379));
        const bufferRejected = store(new ArrayBuffer(16380));
        const input = { nested: { value: 1 } };
        input.self = input;
        socket.serializeAttachment(input);
        input.nested.value = 2;
        const first = socket.deserializeAttachment();
        const cyclic = first.self === first;
        const snapshot = first.nested.value;
        first.nested.value = 3;
        const isolated = socket.deserializeAttachment().nested.value;
        return Response.json({
          sameValues: JSON.stringify(packed) === JSON.stringify(holey),
          sameKeys: JSON.stringify(Object.keys(packed)) === JSON.stringify(Object.keys(holey)),
          packedResult, holeyResult, preserved,
          normalAccepted, normalRejected, bufferAccepted, bufferRejected,
          cyclic, snapshot, isolated,
        });
      } };`,
    }),
  );
  try {
    const response = await runtime.dispatchFetch("https://attachment.invalid/");
    assert.equal(response.status, 200);
    const rejected = (bytes) => ({
      accepted: false,
      message: `A WebSocket 'attachment' cannot be larger than 16384 bytes.'attachment' was ${bytes} bytes.`,
    });
    assert.deepEqual(await response.json(), {
      sameValues: true,
      sameKeys: true,
      packedResult: { accepted: true },
      holeyResult: rejected(16390),
      preserved: true,
      normalAccepted: { accepted: true },
      normalRejected: rejected(16385),
      bufferAccepted: { accepted: true },
      bufferRejected: rejected(16385),
      cyclic: true,
      snapshot: 1,
      isolated: 1,
    });
  } finally {
    await runtime.dispose();
  }
});

test("shared attachment contracts match the pinned Workers profile", async () => {
  const inventory = JSON.parse(
    await readFile(new URL("exports.json", import.meta.url), "utf8"),
  );
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modulesRoot: "/fixture",
      compatibilityDate: inventory.profile.compatibilityDate,
      modules: [
        {
          type: "ESModule",
          path: "/fixture/main.mjs",
          contents: `import wasmModule from './empty.wasm';export default {async fetch(){return Response.json(await (${observeAttachments})({WebSocketPair, Blob, Headers, Request, Response, wasmModule}))}}`,
        },
        {
          type: "CompiledWasm",
          path: "/fixture/empty.wasm",
          contents: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0),
        },
      ],
    }),
  );
  try {
    const response = await runtime.dispatchFetch("https://attachment.invalid/");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expectedAttachments);
  } finally {
    await runtime.dispose();
  }
});
