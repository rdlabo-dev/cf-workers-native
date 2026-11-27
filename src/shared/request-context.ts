import { AsyncLocalStorage } from "../compat/async-hooks/index.js";
// Created at dispatch, before optional modules are imported. Merely importing
// the SDK must not install async-context propagation or replace host globals.
type RequestContext = { bindings: Record<string, unknown> };
let active: AsyncLocalStorage<RequestContext> | undefined;
export function getRequestBindings(): Record<string, unknown> | undefined {
  return active?.getStore()?.bindings;
}
export function hasActiveRequest(): boolean {
  return active?.getStore() !== undefined;
}
export function runWithActiveRequest<T>(callback: () => T, env?: unknown): T {
  active ??= new AsyncLocalStorage<RequestContext>();
  const bindings =
    env !== null && typeof env === "object"
      ? (env as Record<string, unknown>)
      : Object.create(null);
  return active.run({ bindings }, callback);
}
