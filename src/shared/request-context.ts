import { AsyncLocalStorage } from "../compat/async-hooks/index.js";
import {
  retainPropagation,
  requestStorageOptions,
} from "../compat/async-hooks/propagation.js";
// Created at dispatch, before optional modules are imported. Merely importing
// the SDK must not install async-context propagation or replace host globals.
type RequestContext = { bindings: Record<string, unknown> };
// Vite development may evaluate optimized and source copies in the same realm.
const key = Symbol.for("workers-capacitor/request-context");
const realm = globalThis as typeof globalThis & {
  [key]?: {
    storage?: AsyncLocalStorage<RequestContext>;
    retain: typeof retainPropagation;
    create: () => AsyncLocalStorage<RequestContext>;
  };
};
function requestState() {
  return (realm[key] ??= {
    retain: retainPropagation,
    create: () => new AsyncLocalStorage<RequestContext>(requestStorageOptions),
  });
}
export function retainDirectRequestContext() {
  return requestState().retain();
}
export function getRequestBindings(): Record<string, unknown> | undefined {
  return realm[key]?.storage?.getStore()?.bindings;
}
export function hasActiveRequest(): boolean {
  return realm[key]?.storage?.getStore() !== undefined;
}
export function runWithActiveRequest<T>(callback: () => T, env?: unknown): T {
  const state = requestState();
  const active = (state.storage ??= state.create());
  const bindings =
    env !== null && typeof env === "object"
      ? (env as Record<string, unknown>)
      : Object.create(null);
  return active.run({ bindings }, callback);
}
