import { expect, it, vi } from "vitest";
import { WebSocket, WebSocketPair } from "./endpoint.js";

it("validates Workers URLs and protocols before accessing a host connection", () => {
  for (const [url, protocols, message] of [
    ["not a url", undefined, "The url is invalid."],
    ["http://localhost/", undefined, "The url scheme must be ws or wss."],
    ["ws://localhost/#", undefined, "The url fragment must be empty."],
    [
      "ws://localhost/",
      ["a", "a"],
      "The protocols header cannot have repeating values.",
    ],
    [
      "ws://localhost/",
      ["a b"],
      "One of the protocol header tokens is invalid.",
    ],
  ] as const) {
    expect(
      () => new WebSocket(url, protocols ? [...protocols] : undefined),
    ).toThrow(`WebSocket Constructor: ${message}`);
  }
});
it("queues pre-accept messages, snapshots intrinsic views and delivers ordered binary/text events", async () => {
  const [a, b] = new WebSocketPair();
  expect([a.readyState, b.readyState]).toEqual([1, 1]);
  expect(Object.keys(new WebSocketPair())).toEqual(["0", "1"]);
  expect(a.url).toBe(null);
  expect(() => a.send("early")).toThrow("You must call one of accept()");
  a.accept();
  a.accept();
  const messages: unknown[] = [];
  b.binaryType = "arraybuffer";
  b.addEventListener("message", (event) =>
    messages.push((event as MessageEvent).data),
  );
  a.send("text");
  const bytes = new Uint8Array([0, 1, 2, 3]);
  const view = new DataView(bytes.buffer, 1, 2);
  Object.defineProperty(view, "byteLength", {
    get() {
      throw new Error("shadowed");
    },
  });
  a.send(view);
  bytes.fill(9);
  await Promise.resolve();
  expect(messages).toEqual([]);
  b.accept();
  await vi.waitFor(() => expect(messages).toHaveLength(2));
  expect(messages[0]).toBe("text");
  expect([...new Uint8Array(messages[1] as ArrayBuffer)]).toEqual([1, 2]);
  a.close();
});
it("automatically replies to peer close and exposes CLOSED during both close callbacks", async () => {
  const [a, b] = new WebSocketPair();
  a.accept();
  b.accept();
  const events: unknown[] = [];
  for (const [name, socket] of [
    ["a", a],
    ["b", b],
  ] as const)
    socket.addEventListener("close", (event) => {
      const close = event as CloseEvent;
      events.push([
        name,
        socket.readyState,
        close.code,
        close.reason,
        close.wasClean,
      ]);
    });
  a.close(1000, "done");
  expect(a.readyState).toBe(2);
  expect(() => a.send("late")).toThrow(
    "Can't call WebSocket send() after close().",
  );
  await vi.waitFor(() => expect(events).toHaveLength(2));
  expect(events).toEqual([
    ["b", 3, 1000, "done", true],
    ["a", 3, 1000, "done", true],
  ]);
  a.close();
  // Validation still runs on a closed socket.
  expect(() => a.close(1005)).toThrow("Invalid WebSocket close code: 1005.");
});
it("supports explicit half-open acceptance and validates UTF-8 close reason length", async () => {
  const [a, b] = new WebSocketPair();
  a.accept();
  b.accept({ allowHalfOpen: true });
  const close = vi.fn();
  b.addEventListener("close", close);
  expect(() => a.close(1000, "あ".repeat(42))).toThrow("123 bytes");
  expect(() => a.close(undefined, "reason")).toThrow(
    "must also specify a code",
  );
  a.close(1000, "あ".repeat(41));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect([a.readyState, b.readyState]).toEqual([2, 2]);
  b.close(1000);
  await vi.waitFor(() => expect(a.readyState).toBe(3));
});

import { Blob } from "../../compat/buffer/blob.js";
import { Headers } from "../headers/index.js";
import { Request } from "../request/index.js";
import { Response } from "../response/index.js";
// @ts-expect-error Shared JavaScript contract also runs untransformed in workerd.
import * as attachments from "./attachment.observations.spec.mjs";
const { observeAttachments, expectedAttachments } = attachments;
it("clones attachments, preserves aliases and prior values on failed writes, and enforces serialized limits", async () => {
  const observed = await observeAttachments({
    WebSocketPair,
    wasmModule: new WebAssembly.Module(
      Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0),
    ),
    Blob,
    Headers,
    Request,
    Response,
  });
  expect(JSON.parse(JSON.stringify(observed))).toEqual(expectedAttachments);
  expect(observed).toMatchObject({
    initial: null,
    undefinedValue: true,
    graph: [true, true, true, 1, [1, 2, 3]],
    independent: 1,
    getterCalls: 1,
    rejections: Array(6).fill("DataCloneError"),
    shared: { name: "Error", message: "Unable to deserialize cloned data." },
  });
  expect(observed.sizes).toEqual([
    {
      name: "Error",
      message:
        "A WebSocket 'attachment' cannot be larger than 16384 bytes.'attachment' was 16385 bytes.",
    },
    16379,
    {
      name: "Error",
      message:
        "A WebSocket 'attachment' cannot be larger than 16384 bytes.'attachment' was 16385 bytes.",
    },
    16379,
  ]);
  expect(observed.clones[4]).toEqual([
    "Error",
    "hello",
    "stack",
    { value: 1 },
    "kept",
  ]);
});

import { CloseEvent as WorkersCloseEvent } from "./close-event.js";
it("uses Workers CloseEvent fields and accepts only branded endpoints in upgrade responses", async () => {
  const event = new WorkersCloseEvent("close", {
    code: -1,
    reason: "done",
    wasClean: true,
    bubbles: true,
  });
  expect(event).toBeInstanceOf(Event);
  expect(Object.keys(event)).toEqual(["wasClean", "reason", "code"]);
  expect(Object.getOwnPropertyDescriptor(event, "code")).toEqual({
    value: -1,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  expect([event.code, event.reason, event.wasClean, event.bubbles]).toEqual([
    -1,
    "done",
    true,
    true,
  ]);
  expect(Object.prototype.toString.call(event)).toBe("[object CloseEvent]");
  const pair = new WebSocketPair();
  const response = new Response(null, { status: 101, webSocket: pair[0] });
  expect(response.webSocket).toBe(pair[0]);
  expect(() => response.clone()).toThrow("WebSocket handshake");
  expect(
    () => new Response(null, { status: 101, webSocket: {} as never }),
  ).toThrow("webSocket must be a WebSocket");
  pair[0].accept();
  pair[1].accept();
  let delivered: Event | undefined;
  pair[1].addEventListener("close", (e) => (delivered = e));
  pair[0].close(1000, "done");
  await vi.waitFor(() => expect(delivered).toBeInstanceOf(WorkersCloseEvent));
});

it("converts protocol arrays by indexed access with a length snapshot", () => {
  const calls: string[] = [];
  const protocols = ["bad token", "second"];
  Object.defineProperty(protocols, Symbol.iterator, {
    get() {
      throw new Error("unexpected iterator access");
    },
  });
  Object.defineProperty(protocols, "0", {
    get() {
      calls.push("0");
      protocols.push("extra");
      return "bad token";
    },
  });
  Object.defineProperty(protocols, "1", {
    get() {
      calls.push("1");
      return "second";
    },
  });
  expect(() => new WebSocket("ws://localhost/", protocols)).toThrow(
    "One of the protocol header tokens is invalid.",
  );
  expect(calls).toEqual(["0", "1"]);
});
it("rejects out-of-range close codes before converting the reason", () => {
  const [a, b] = new WebSocketPair();
  a.accept();
  b.accept();
  const toString = vi.fn(() => "reason");
  for (const code of [2147483648, -2147483649, 4294968296, 2147483647.5])
    expect(() => a.close(code, { toString } as unknown as string)).toThrow(
      "Value out of range. Must be between -2147483648 and 2147483647 (inclusive).",
    );
  expect(toString).not.toHaveBeenCalled();
  expect(a.readyState).toBe(WebSocket.OPEN);
  a.close();
  b.close();
});
it("reads CloseEvent dictionary getters once in Workers order", async () => {
  const { CloseEvent } = await import("./close-event.js");
  const calls: string[] = [];
  const init = {};
  for (const [key, value] of Object.entries({
    bubbles: true,
    cancelable: true,
    composed: true,
    code: 1000,
    reason: "ok",
    wasClean: true,
  }))
    Object.defineProperty(init, key, {
      get() {
        if (calls.includes(key)) throw new Error("repeated getter");
        calls.push(key);
        return value;
      },
    });
  const event = new CloseEvent("close", init);
  expect(calls).toEqual([
    "bubbles",
    "cancelable",
    "composed",
    "code",
    "reason",
    "wasClean",
  ]);
  expect([event.code, event.reason, event.wasClean]).toEqual([
    1000,
    "ok",
    true,
  ]);
  expect(() => new CloseEvent("close", { code: 4294968296 })).toThrow(
    "Value out of range.",
  );
});
