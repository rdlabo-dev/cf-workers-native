import streams from "../../compat/stream-web/index.js";
import { installAbortTimeout } from "../../browser/abort/index.js";
import { installResourceSymbols } from "./symbols.js";
import { Request } from "../../browser/request/index.js";
import { Response } from "../../browser/response/index.js";
import { Headers } from "../../browser/headers/index.js";
import { structuredClone } from "../../browser/structured-clone/index.js";
import { WebSocket, WebSocketPair } from "../../browser/websocket/endpoint.js";
import { CloseEvent } from "../../browser/websocket/close-event.js";

import { Blob, File } from "../../compat/buffer/blob.js";

import {
  Performance,
  PerformanceEntry,
  PerformanceMark,
  PerformanceMeasure,
  PerformanceObserver,
  PerformanceObserverEntryList,
  PerformanceResourceTiming,
  performance,
} from "../../compat/perf-hooks/performance.js";
const values = {
  ...streams,
  Request,
  Response,
  Headers,
  structuredClone,
  WebSocket,
  WebSocketPair,
  CloseEvent,
  Blob,
  File,
  Performance,
  PerformanceEntry,
  PerformanceMark,
  PerformanceMeasure,
  PerformanceObserver,
  PerformanceObserverEntryList,
  PerformanceResourceTiming,
  performance,
};
type Name = keyof typeof values | "self";
type Target = Record<string, unknown>;
type Patch = {
  previous: PropertyDescriptor | undefined;
  installed: PropertyDescriptor;
};
const installations = new WeakMap<
  Target,
  {
    owners: number;
    abortSignal: unknown;
    patches: Map<Name, Patch>;
    restoreSymbols: () => void;
    restoreAbort: () => void;
  }
>();
function owns(target: Target, name: Name, expected: PropertyDescriptor) {
  const actual = Object.getOwnPropertyDescriptor(target, name);
  return (
    actual?.value === expected.value &&
    actual?.writable === expected.writable &&
    actual?.enumerable === expected.enumerable &&
    actual?.configurable === expected.configurable
  );
}
function restore(target: Target, patches: Map<Name, Patch>) {
  for (const [name, { previous, installed }] of patches) {
    if (!owns(target, name, installed)) continue;
    if (previous) Object.defineProperty(target, name, previous);
    else delete target[name];
  }
}
/** Own only these replacements; preserve exact descriptors and later app changes. */
export function installWebGlobals(target: Target = globalThis) {
  let installation = installations.get(target);
  if (installation) {
    if (target.AbortSignal !== installation.abortSignal)
      throw new Error(
        "Workers AbortSignal constructor changed during installation",
      );
    for (const [name, patch] of installation.patches)
      if (!owns(target, name, patch.installed))
        throw new Error(`Workers global ${name} changed during installation`);
    installAbortTimeout(target.AbortSignal as typeof AbortSignal | undefined)();
    installation.owners++;
  } else {
    const patches = new Map<Name, Patch>();
    // Workers exposes a writable self alias. Web Worker hosts may inherit a
    // getter-only self, which breaks generated Workers assigning this alias.
    const replacements = { ...values, self: target };
    let restoreSymbols = () => {};
    let restoreAbort = () => {};
    try {
      for (const name of Object.keys(replacements) as Name[]) {
        const previous = Object.getOwnPropertyDescriptor(target, name);
        if (
          previous?.value === replacements[name] &&
          (name !== "self" || previous.writable)
        )
          continue;
        const installed = {
          configurable: true,
          enumerable: previous?.enumerable ?? false,
          writable: true,
          value: replacements[name],
        };
        Object.defineProperty(target, name, installed);
        patches.set(name, { previous, installed });
      }
      restoreAbort = installAbortTimeout(
        target.AbortSignal as typeof AbortSignal | undefined,
      );
      restoreSymbols = installResourceSymbols(
        target.Symbol as SymbolConstructor | undefined,
      );
    } catch (error) {
      restoreAbort();
      restore(target, patches);
      throw error;
    }
    installation = {
      owners: 1,
      abortSignal: target.AbortSignal,
      patches,
      restoreSymbols,
      restoreAbort,
    };
    installations.set(target, installation);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--installation.owners) return;
    installations.delete(target);
    restore(target, installation.patches);
    installation.restoreSymbols();
    installation.restoreAbort();
  };
}
