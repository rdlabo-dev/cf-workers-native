import { getRequestBindings } from "../../../shared/request-context.js";

// Bindings arrive per request through the fetch signature; the worker
// transport installs them so module-scope `env` reads resolve too.
let workerEnv: Record<string, unknown> = {};

/** Runtime-internal: called by the dispatch layer before worker.fetch. */
export function setWorkerEnv(env: unknown): void {
  workerEnv =
    env !== null && typeof env === "object"
      ? (env as Record<string, unknown>)
      : {};
}

function currentBindings() {
  return getRequestBindings() ?? workerEnv;
}

export const env: Record<string, unknown> = new Proxy(Object.create(null), {
  get(_target, name) {
    return Reflect.get(currentBindings(), name);
  },
  has(_target, name) {
    return Reflect.has(currentBindings(), name);
  },
  ownKeys() {
    return Reflect.ownKeys(currentBindings());
  },
  getOwnPropertyDescriptor(_target, name) {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      currentBindings(),
      name,
    );
    return descriptor && { ...descriptor, configurable: true };
  },
});

// Durable Object namespaces need stateful storage; bundles such as OpenNext
// export subclass shells that must at least resolve and construct.
export class DurableObject<Env = unknown> {
  constructor(
    protected readonly ctx: unknown,
    protected readonly env: Env,
  ) {}
}
