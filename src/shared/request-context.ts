import { AsyncLocalStorage } from "../compat/async-hooks/index.js";
// Created at dispatch, before optional modules are imported. Merely importing
// the SDK must not install async-context propagation or replace host globals.
type RequestContext = { bindings: Record<string, unknown> };
// Vite development may evaluate optimized and source copies in the same realm.
const key = Symbol.for("workers-capacitor/request-context");
const realm = globalThis as typeof globalThis & {
  [key]?: AsyncLocalStorage<RequestContext>;
};
export function getRequestBindings(): Record<string, unknown> | undefined {
  return realm[key]?.getStore()?.bindings;
}
export function hasActiveRequest(): boolean {
  return realm[key]?.getStore() !== undefined;
}
export function runWithActiveRequest<T>(callback: () => T, env?: unknown): T {
  const active = (realm[key] ??= new AsyncLocalStorage<RequestContext>());
  const bindings =
    env !== null && typeof env === "object"
      ? (env as Record<string, unknown>)
      : Object.create(null);
  return active.run({ bindings }, callback);
}
