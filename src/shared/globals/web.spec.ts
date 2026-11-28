import { expect, it } from "vitest";
import { installWebGlobals } from "./web.js";
import { Request } from "../../browser/request/index.js";
import { Response } from "../../browser/response/index.js";
import { Headers } from "../../browser/headers/index.js";
import { structuredClone } from "../../browser/structured-clone/index.js";
import { platform } from "./platform.js";
import { WebSocket, WebSocketPair } from "../../browser/websocket/endpoint.js";
import { CloseEvent } from "../../browser/websocket/close-event.js";

import { testWebGlobalOwnership } from "../../../tests/helpers/web-global-ownership.js";

testWebGlobalOwnership({
  WebSocket,
  WebSocketPair,
  CloseEvent,
  Request,
  Response,
  Headers,
  structuredClone,
});

it("rolls back earlier changes if a later global is non-configurable", () => {
  const target = { Request: platform.Request };
  Object.defineProperty(target, "Headers", {
    value: platform.Headers,
    configurable: false,
  });
  const before = Object.getOwnPropertyDescriptors(target);
  expect(() => installWebGlobals(target)).toThrow();
  expect(Object.getOwnPropertyDescriptors(target)).toEqual(before);
});
it("owns and restores a missing resource-management symbol alongside Web globals", () => {
  const symbol = {};
  const target = { Symbol: symbol };
  const first = installWebGlobals(target);
  const installed = Object.getOwnPropertyDescriptor(symbol, "asyncDispose");
  expect(typeof installed?.value).toBe("symbol");
  expect(typeof Object.getOwnPropertyDescriptor(symbol, "dispose")?.value).toBe(
    "symbol",
  );
  const second = installWebGlobals(target);
  first();
  expect(Object.getOwnPropertyDescriptor(symbol, "asyncDispose")).toEqual(
    installed,
  );
  second();
  expect(Object.hasOwn(symbol, "asyncDispose")).toBe(false);
  expect(Object.hasOwn(symbol, "dispose")).toBe(false);
});

it("rejects a new owner after the AbortSignal constructor is replaced", () => {
  class Original {
    static timeout = () => "original";
  }
  class Replacement {
    static timeout = () => "replacement";
  }
  const originalTimeout = Original.timeout;
  const replacementTimeout = Replacement.timeout;
  const target = { AbortSignal: Original } as Record<string, unknown>;
  const release = installWebGlobals(target);
  target.AbortSignal = Replacement;
  expect(() => installWebGlobals(target)).toThrow(
    "AbortSignal constructor changed",
  );
  expect(Replacement.timeout).toBe(replacementTimeout);
  release();
  expect(target.AbortSignal).toBe(Replacement);
  expect(Original.timeout).toBe(originalTimeout);
});

it("makes the inherited self alias writable and restores its descriptor", () => {
  const prototype = Object.defineProperty({}, "self", {
    get() {
      return this;
    },
    configurable: true,
  });
  const target = Object.create(prototype);
  const release = installWebGlobals(target);
  target.self = target;
  expect(target.self).toBe(target);
  expect(Object.getOwnPropertyDescriptor(target, "self")?.writable).toBe(true);
  release();
  expect(Object.hasOwn(target, "self")).toBe(false);
  expect(target.self).toBe(target);
});
