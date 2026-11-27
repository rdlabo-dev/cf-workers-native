import { usePropagation } from "./propagation.js";
import * as hooks from "./hooks.js";
export * from "./hooks.js";
import { contextAware, addCallbackBinding } from "./callbacks.js";
import { getExecutionEnvironment } from "../../environment.js";
// Context propagation uses synchronous scopes and captured Promise callbacks.
// Native await bypasses Promise.then: browser builds must lower async functions
// with the supplied build plugins. Reject untransformed async scope callbacks
// before they can silently read another request's store.

const storageInstances = new WeakSet<object>();
const resourceInstances = new WeakSet<object>();
const illegalInvocation =
  "Illegal invocation: function called with incorrect `this` reference. See https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors for details.";
function brand(instances: WeakSet<object>, value: object): void {
  if (!instances.has(value)) throw new TypeError(illegalInvocation);
}

type Context = Map<AsyncLocalStorage<unknown>, unknown>;
let current: Context | undefined;

function withContext<T, A extends unknown[]>(
  context: Context | undefined,
  callback: (...args: A) => T,
  args: A,
): T {
  const previous = current;
  current = context;
  try {
    return Reflect.apply(callback, globalThis, args);
  } finally {
    current = previous;
  }
}

function scope<T, A extends unknown[]>(
  context: Context,
  callback: (...args: A) => T,
  args: A,
): T {
  if (Object.prototype.toString.call(callback) === "[object AsyncFunction]")
    throw new Error(
      "AsyncLocalStorage requires async/await lowering by the cf-workers-native build plugin; native async callbacks are unsupported.",
    );
  return withContext(context, callback, args);
}

const capture = () => (current === undefined ? undefined : new Map(current));

addCallbackBinding((callback) => {
  const context = capture();
  return function (this: unknown, ...args: unknown[]) {
    return withContext(context, () => Reflect.apply(callback, this, args), []);
  };
});

export class AsyncLocalStorage<Store = unknown> {
  readonly #defaultValue: Store | undefined;
  readonly #name: string;
  constructor(options?: { defaultValue?: Store; name?: string }) {
    if (
      options != null &&
      typeof options !== "object" &&
      typeof options !== "function"
    )
      throw new TypeError(
        "Failed to construct 'AsyncLocalStorage': constructor parameter 1 is not of type 'AsyncLocalStorageOptions'.",
      );
    this.#defaultValue = options?.defaultValue;
    const name = options?.name;
    this.#name = name == null ? "" : stringValue(name);
    storageInstances.add(this);
    // An unused import must not mutate timer/global ownership. Install only
    // when a Worker actually starts using context propagation.
    usePropagation(options, installAsyncContextPropagation);
  }

  get name() {
    brand(storageInstances, this);
    return this.#name;
  }

  static bind<Args extends unknown[], T>(
    callback: (...args: Args) => T,
  ): (...args: Args) => T {
    functionArgument(callback, "bind", "AsyncLocalStorage", 1, "Function");
    const context = capture();
    return (...args: Args) => withContext(context, callback, args);
  }

  static snapshot() {
    const context = capture();
    return <Args extends unknown[], T>(
      callback: (...args: Args) => T,
      ...args: Args
    ): T => withContext(context, callback, args);
  }

  disable(): void {
    brand(storageInstances, this);
    throw new Error("asyncLocalStorage.disable() is not implemented");
  }

  getStore(): Store | undefined {
    brand(storageInstances, this);
    return current?.has(this as AsyncLocalStorage<unknown>)
      ? (current.get(this as AsyncLocalStorage<unknown>) as Store | undefined)
      : this.#defaultValue;
  }

  enterWith(_store: Store): never {
    brand(storageInstances, this);
    throw new Error("asyncLocalStorage.enterWith() is not implemented");
  }

  run<Args extends unknown[], T>(
    store: Store,
    callback: (...args: Args) => T,
    ...args: Args
  ): T {
    brand(storageInstances, this);
    functionArgument(callback, "run", "AsyncLocalStorage", 2, "function");
    const context = capture() ?? new Map();
    context.set(this as AsyncLocalStorage<unknown>, store);
    return scope(context, callback, args);
  }

  exit<Args extends unknown[], T>(
    callback: (...args: Args) => T,
    ...args: Args
  ): T {
    brand(storageInstances, this);
    functionArgument(callback, "exit", "AsyncLocalStorage", 1, "function");
    const context = capture() ?? new Map();
    context.set(this as AsyncLocalStorage<unknown>, undefined);
    return scope(context, callback, args);
  }
}

/** Patch Promise/timers/microtasks once per realm. Safe to call repeatedly. */
function installAsyncContextPropagation(): void {
  if (getExecutionEnvironment() === "cloudflare-workers") return;
  const then = Promise.prototype.then;
  Promise.prototype.then = function <T, R1 = T, R2 = never>(
    this: Promise<T>,
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    const context = capture();
    const wrap = <V, R>(fn?: ((value: V) => R) | null) =>
      typeof fn === "function"
        ? (value: V) => withContext(context, fn, [value])
        : fn;
    return then.call(this, wrap(onFulfilled), wrap(onRejected)) as Promise<
      R1 | R2
    >;
  };
  const wrapCallback = <F extends (...args: never[]) => unknown>(
    schedule: F,
  ): F =>
    ((
      callback: ((...args: unknown[]) => unknown) | undefined,
      ...args: unknown[]
    ) => {
      const context = capture();
      return Reflect.apply(schedule, undefined, [
        typeof callback === "function"
          ? (...cbArgs: unknown[]) => withContext(context, callback, cbArgs)
          : callback,
        ...args,
      ]);
    }) as unknown as F;
  globalThis.queueMicrotask = wrapCallback(globalThis.queueMicrotask);
  // Compat timers capture at scheduling time without changing global identity.
  // Retain the host fallback for environments without the Node timer adapter.
  for (const name of ["setTimeout", "setInterval", "setImmediate"] as const) {
    const schedule = globalThis[name];
    if (
      typeof schedule === "function" &&
      !(schedule as unknown as Record<symbol, unknown>)[contextAware]
    )
      (globalThis as unknown as Record<string, unknown>)[name] =
        wrapCallback(schedule);
  }
  // Stream constructors capture callbacks through the shared callback binding.
  // Their public identity must remain stable after AsyncLocalStorage is used.
  // Schedulers such as React's use MessageChannel; deliver each posted
  // message to its listeners under the context captured at postMessage.
  const NativeMessageChannel = globalThis.MessageChannel;
  if (typeof NativeMessageChannel === "function") {
    globalThis.MessageChannel = class {
      readonly port1: MessagePort;
      readonly port2: MessagePort;
      constructor() {
        const channel = new NativeMessageChannel();
        // Context queues are per receiving port; postMessage on the peer
        // captures the sender's context at send time.
        const queues = new WeakMap<MessagePort, (Context | undefined)[]>();
        const wrapSend = (send: MessagePort, receive: MessagePort) => {
          const queue: (Context | undefined)[] = [];
          queues.set(receive, queue);
          const post = send.postMessage.bind(send);
          (send as { postMessage: unknown }).postMessage = (
            ...args: unknown[]
          ) => {
            queue.push(capture());
            try {
              return Reflect.apply(post, send, args);
            } catch (error) {
              queue.pop();
              throw error;
            }
          };
        };
        const wrapReceive = (port: MessagePort) => {
          const queue = queues.get(port)!;
          const add = port.addEventListener.bind(port);
          // One context per message, shared by every listener for that event.
          const contexts = new WeakMap<Event, Context | undefined>();
          add("message", (event) => contexts.set(event, queue.shift()));
          add("messageerror", (event) => contexts.set(event, queue.shift()));
          const listeners = new WeakMap<object, EventListener>();
          const wrap = (listener: EventListenerOrEventListenerObject) => {
            let wrapped = listeners.get(listener);
            if (!wrapped) {
              wrapped = (event) =>
                withContext(
                  contexts.get(event),
                  () => {
                    if (typeof listener === "function")
                      listener.call(port, event);
                    else listener.handleEvent(event);
                  },
                  [],
                );
              listeners.set(listener, wrapped);
            }
            return wrapped;
          };
          const remove = port.removeEventListener.bind(port);
          port.addEventListener = ((
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions,
          ) =>
            listener &&
            add(
              type,
              ["message", "messageerror"].includes(type)
                ? wrap(listener)
                : listener,
              options,
            )) as typeof port.addEventListener;
          port.removeEventListener = ((
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions,
          ) =>
            listener &&
            remove(
              type,
              ["message", "messageerror"].includes(type)
                ? (listeners.get(listener) ?? listener)
                : listener,
              options,
            )) as typeof port.removeEventListener;
          for (const name of ["onmessage", "onmessageerror"] as const) {
            let stored: ((event: MessageEvent) => void) | null = null;
            const type = name.slice(2);
            Object.defineProperty(port, name, {
              configurable: true,
              enumerable: true,
              get: () => stored,
              set: (value) => {
                if (stored) remove(type, wrap(stored as EventListener));
                stored = typeof value === "function" ? value : null;
                if (stored) {
                  add(type, wrap(stored as EventListener));
                  if (name === "onmessage") port.start();
                }
              },
            });
          }
          const close = port.close.bind(port);
          port.close = () => {
            queue.length = 0;
            close();
          };
        };
        wrapSend(channel.port2, channel.port1);
        wrapSend(channel.port1, channel.port2);
        wrapReceive(channel.port1);
        wrapReceive(channel.port2);
        this.port1 = channel.port1;
        this.port2 = channel.port2;
      }
    } as unknown as typeof MessageChannel;
  }
}
// AsyncResource preserves the synchronous Workers API and its zero-valued
// resource IDs. Context continuation isolation retains the engine limitations
// documented above.
export class AsyncResource {
  readonly #context: Context | undefined;
  constructor(type?: string, options?: { triggerAsyncId?: number }) {
    if (type != null) stringValue(type);
    if (
      options != null &&
      typeof options !== "object" &&
      typeof options !== "function"
    )
      throw new TypeError(
        "Failed to construct 'AsyncResource': constructor parameter 2 is not of type 'Options'.",
      );
    if (options?.triggerAsyncId !== undefined)
      throw new Error(
        "The 'triggerAsyncId' field on 'Options' is not implemented.",
      );
    this.#context = capture();
    resourceInstances.add(this);
  }
  bind<F extends (...args: any[]) => any>(fn: F, thisArg?: unknown): F {
    brand(resourceInstances, this);
    functionArgument(fn, "bind", "AsyncResource", 1, "Function");
    const context = this.#context;
    const bound = (...args: any[]) =>
      withContext(
        context,
        () =>
          Reflect.apply(fn, thisArg === undefined ? globalThis : thisArg, args),
        [],
      );
    Object.defineProperty(bound, "name", { value: "", configurable: true });
    Object.assign(bound, { asyncResource: this });
    return bound as F;
  }
  runInAsyncScope<F extends (...args: any[]) => any>(
    fn: F,
    thisArg?: unknown,
    ...args: any[]
  ): ReturnType<F> {
    brand(resourceInstances, this);
    functionArgument(fn, "runInAsyncScope", "AsyncResource", 1, "function");
    const context = this.#context;
    return withContext(
      context,
      () =>
        Reflect.apply(
          fn,
          thisArg === undefined ? globalThis : thisArg,
          args,
        ) as ReturnType<F>,
      [],
    );
  }
  static bind<F extends (...args: any[]) => any>(
    fn: F,
    type?: string,
    thisArg?: unknown,
  ): F {
    functionArgument(fn, "bind", "AsyncResource", 1, "Function");
    return new AsyncResource(type).bind(fn, thisArg);
  }
  emitDestroy(): void {
    brand(resourceInstances, this);
  }
  asyncId(): number {
    brand(resourceInstances, this);
    return 0;
  }
  triggerAsyncId(): number {
    brand(resourceInstances, this);
    return 0;
  }
}

export default { AsyncLocalStorage, AsyncResource, ...hooks };

function stringValue(value: unknown): string {
  if (typeof value === "symbol")
    throw new TypeError("Cannot convert a Symbol value to a string");
  return `${value}`;
}
function functionArgument(
  value: unknown,
  method: string,
  owner: string,
  parameter: number,
  type: string,
): void {
  if (typeof value !== "function")
    throw new TypeError(
      `Failed to execute '${method}' on '${owner}': parameter ${parameter} is not of type '${type}'.`,
    );
}

for (const [name, Type] of Object.entries({
  AsyncLocalStorage,
  AsyncResource,
})) {
  Object.defineProperty(Type, "name", { value: name, configurable: true });
  Object.defineProperty(Type.prototype, Symbol.toStringTag, {
    value: name,
    configurable: true,
  });
  for (const key of Object.getOwnPropertyNames(Type.prototype)) {
    if (key !== "constructor")
      Object.defineProperty(Type.prototype, key, {
        ...Object.getOwnPropertyDescriptor(Type.prototype, key),
        enumerable: true,
      });
  }
}
