// Optional modules register request-local state here. The active request marker
// exists before registration so a first dynamic import sees its current request.
import { runWithActiveRequest } from "./request-context.js";
type Scope = <T>(callback: () => T) => T;
const scopes = new Set<Scope>();
export function registerRequestScope(scope: Scope): void {
  scopes.add(scope);
}
export function runWithRequestScope<T>(callback: () => T): T {
  const entries = [...scopes];
  const run = (index: number): T =>
    index === entries.length
      ? callback()
      : entries[index](() => run(index + 1));
  return runWithActiveRequest(() => run(0));
}
