import { AsyncLocalStorage } from "../compat/async-hooks/index.js";
// Created at dispatch, before optional modules are imported. Merely importing
// the SDK must not install async-context propagation or replace host globals.
let active: AsyncLocalStorage<boolean> | undefined;
export function hasActiveRequest(): boolean {
  return active?.getStore() === true;
}
export function runWithActiveRequest<T>(callback: () => T): T {
  active ??= new AsyncLocalStorage<boolean>();
  return active.run(true, callback);
}
