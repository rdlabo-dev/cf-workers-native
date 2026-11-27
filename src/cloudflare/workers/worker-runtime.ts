import { runWithRequestScope } from "../../shared/request-scope.js";
import { installWebGlobals } from "../../shared/globals/web.js";
import { createOutboundFetch } from "../../browser/fetch/outbound.js";
import { browserFetch, isRequest } from "../../browser/fetch/interop.js";
import type { RequestInit as WorkerRequestInit } from "../../browser/request/index.js";
import { installDirectNetworkScope } from "../../browser/fetch/scope.js";
import configuredWorker from "../../configured.js";
import { createIsolatedWorker } from "../../browser/isolated/bridge.js";
import { createRemoteWorker } from "../../cloudflare/bindings/remote.js";
import { FetchRuntime, type FetchRuntimeOptions } from "./runtime.js";
import type {
  WorkersCapacitorOptions,
  LoadedWorker,
  WorkerContext,
  WorkerFactory,
  WorkerHandler,
  WorkerSource,
} from "./types.js";

export class DirectFetchRuntime<Env> extends FetchRuntime<Env> {
  readonly execution = "direct" as const;
  private readonly releaseNetwork: (() => Promise<void>) | undefined;
  private readonly restoreWeb: () => void;
  private readonly outbound: ReturnType<typeof createOutboundFetch>;
  constructor(
    options: FetchRuntimeOptions<Env>,
    private readonly worker: WorkerHandler<Env>,
  ) {
    super(options);
    this.restoreWeb = installWebGlobals();
    try {
      this.releaseNetwork = installDirectNetworkScope();
      this.outbound = createOutboundFetch(this.original.bind(globalThis));
    } catch (error) {
      this.restoreWeb();
      throw error;
    }
  }
  protected override externalFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    url: URL,
  ): Promise<Response> {
    if (
      this.localURL &&
      url.protocol === this.localURL.protocol &&
      url.host === this.localURL.host
    )
      return browserFetch(
        isRequest(input) ? input : url.href,
        init as WorkerRequestInit,
        this.original.bind(globalThis),
      ) as unknown as Promise<Response>;
    return this.outbound(
      isRequest(input) ? input : url.href,
      init as WorkerRequestInit,
    ) as unknown as Promise<Response>;
  }
  protected override close() {
    const closing = this.releaseNetwork?.();
    if (closing) return closing.finally(this.restoreWeb);
    this.restoreWeb();
  }
  protected dispatch(request: Request, env: Env, ctx: WorkerContext) {
    return runWithRequestScope(() => this.worker.fetch(request, env, ctx), env);
  }
}

export class IsolatedFetchRuntime<Env> extends FetchRuntime<Env> {
  readonly execution = "worker" as const;
  private readonly isolated: ReturnType<typeof createIsolatedWorker<Env>>;
  override readonly ready: Promise<void>;
  constructor(options: FetchRuntimeOptions<Env>, factory: WorkerFactory) {
    super(options);
    this.isolated = createIsolatedWorker<Env>(factory());
    this.ready = this.isolated.ready;
  }
  protected dispatch(request: Request, env: Env, ctx: WorkerContext) {
    return this.isolated.handler.fetch(request, env, ctx);
  }
  protected override close() {
    return this.isolated.dispose();
  }
}

// Conservative transport eligibility: methods, accessors and custom prototypes
// (including bindings) must retain their semantics in the direct environment.
function plainData(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object")
    return ["string", "number", "boolean", "bigint"].includes(typeof value);
  if (seen.has(value)) return true;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (Array.isArray(value) && prototype !== Array.prototype) ||
    (!Array.isArray(value) && prototype !== Object.prototype)
  )
    return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key === "symbol") return false;
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    // Array length is intrinsic and preserved by structured cloning.
    if (Array.isArray(value) && key === "length") return true;
    return (
      property.enumerable === true &&
      "value" in property &&
      plainData(property.value, seen)
    );
  });
}

function loadedWorker<Env>(
  value: WorkerHandler<Env> | LoadedWorker<Env>,
): value is LoadedWorker<Env> {
  return "handler" in value && typeof value.dispose === "function";
}

export class PreferredFetchRuntime<Env> extends FetchRuntime<Env> {
  private readonly remote?: ReturnType<typeof createRemoteWorker>;
  private isolated?: ReturnType<typeof createIsolatedWorker<Env>>;
  private handler?: WorkerHandler<Env>;
  private closed = false;
  private loadingDirect = false;
  private selected?: "worker" | "direct";
  private disposeDirect?: () => void | Promise<void>;
  private startupDisposal?: Promise<void>;
  private releaseNetwork?: () => Promise<void>;
  private restoreWeb?: () => void;
  private outbound?: ReturnType<typeof createOutboundFetch>;
  protected override externalFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    url: URL,
  ): Promise<Response> {
    if (!this.outbound)
      return browserFetch(
        isRequest(input) ? input : url.href,
        init as WorkerRequestInit,
        this.original.bind(globalThis),
      ) as unknown as Promise<Response>;
    if (
      this.localURL &&
      url.protocol === this.localURL.protocol &&
      url.host === this.localURL.host
    )
      return browserFetch(
        isRequest(input) ? input : url.href,
        init as WorkerRequestInit,
        this.original.bind(globalThis),
      ) as unknown as Promise<Response>;
    return this.outbound(
      isRequest(input) ? input : url.href,
      init as WorkerRequestInit,
    ) as unknown as Promise<Response>;
  }
  get execution() {
    return this.selected;
  }
  override readonly ready: Promise<void>;
  constructor(
    options: WorkersCapacitorOptions<Env>,
    private readonly source: WorkerSource<Env>,
  ) {
    super(options);
    if (options.remote && !source.needsRemote)
      throw new TypeError(
        "remote requires build-generated server routes; configure the Worker's server bindings in the build plugin.",
      );
    if (
      options.remote ||
      (source.needsRemote && source.requiresRemote !== false)
    )
      this.remote = createRemoteWorker(
        {
          ...options.remote,
          origin:
            options.remote?.origin === undefined
              ? new URL(options.baseURL).origin
              : options.remote.origin,
        },
        this.original.bind(globalThis),
      );
    this.ready = this.initialize(options, source);
    void this.ready.catch(() => {});
  }
  private async initialize(
    options: WorkersCapacitorOptions<Env>,
    source: WorkerSource<Env>,
  ) {
    if (
      options.prefer !== "direct" &&
      typeof Worker === "function" &&
      plainData(options.env)
    ) {
      try {
        this.isolated = createIsolatedWorker<Env>(source.createWorker());
      } catch (error) {
        // Only platform unavailability permits fallback, not application errors.
        if (
          !(error instanceof DOMException) ||
          !["SecurityError", "NotSupportedError"].includes(error.name)
        )
          throw error;
      }
      if (this.isolated) {
        await this.isolated.ready;
        if (this.closed) throw new Error("Worker runtime disposed");
        this.handler = this.isolated.handler;
        this.selected = "worker";
        return;
      }
    }
    this.loadingDirect = true;
    try {
      this.restoreWeb = installWebGlobals();
      this.releaseNetwork = installDirectNetworkScope();
      this.outbound = createOutboundFetch(this.original.bind(globalThis));
      const loaded = await source.loadDirect();
      const owned = loadedWorker(loaded);
      const dispose = owned ? () => loaded.dispose() : undefined;
      try {
        const handler = owned ? loaded.handler : loaded;
        if (this.closed) throw new Error("Worker runtime disposed");
        if (typeof handler?.fetch !== "function")
          throw new TypeError("worker.fetch is required.");
        this.disposeDirect = dispose;
        this.handler = handler;
        this.selected = "direct";
      } catch (error) {
        this.startupDisposal = Promise.resolve().then(() => dispose?.());
        await this.startupDisposal;
        throw error;
      }
    } catch (error) {
      try {
        await this.releaseNetwork?.();
      } finally {
        this.restoreWeb?.();
      }
      throw error;
    } finally {
      this.loadingDirect = false;
    }
  }
  protected async dispatch(request: Request, env: Env, ctx: WorkerContext) {
    if (this.closed) throw new Error("Worker runtime disposed");
    if (this.loadingDirect)
      throw new Error(
        "Direct module initialization is in progress; await runtime.ready before local fetch and do not await local fetch at module top level.",
      );
    await this.ready;
    if (this.closed) throw new Error("Worker runtime disposed");
    request.signal.throwIfAborted();
    const remote = await this.source.needsRemote?.(request);
    request.signal.throwIfAborted();
    if (this.closed) throw new Error("Worker runtime disposed");
    if (remote) {
      if (!this.remote)
        throw new TypeError(
          "Remote dispatch requires remote.origin; local fallback is not permitted.",
        );
      return this.remote.fetch(request);
    }
    return this.selected === "direct"
      ? runWithRequestScope(() => this.handler!.fetch(request, env, ctx), env)
      : this.handler!.fetch(request, env, ctx);
  }
  protected override close() {
    this.closed = true;
    const pending = [
      () => this.remote?.dispose(),
      () => this.isolated?.dispose(),
      () => this.disposeDirect?.(),
      () => this.releaseNetwork?.(),
      // An import already in flight may return a loader-owned resource later.
      // initialize() disposes that resource when closed; join it before allowing
      // another runtime to acquire globals or native ownership.
      () =>
        this.loadingDirect
          ? this.ready.catch(() => {}).then(() => this.startupDisposal)
          : this.startupDisposal,
    ]
      .map((close) => {
        try {
          return close();
        } catch (error) {
          return Promise.reject(error);
        }
      })
      .filter((value): value is Promise<void> => value !== undefined);
    if (pending.length)
      return Promise.allSettled(pending)
        .then((results) => {
          const failures = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (failures.length)
            throw new AggregateError(failures, "Runtime cleanup failed");
        })
        .finally(() => this.restoreWeb?.());
    this.restoreWeb?.();
  }
}

/** The installer and feature host select execution in exactly the same way. */
export function createFetchRuntime<Env>(options: WorkersCapacitorOptions<Env>) {
  if (
    options.prefer !== undefined &&
    !["worker", "direct"].includes(options.prefer)
  )
    throw new TypeError("prefer must be worker or direct.");
  const worker = options.worker ?? configuredWorker;
  if (!worker)
    throw new TypeError(
      "No Worker configured. Set worker in the Vite/esbuild workersCapacitorPlugin, or pass an explicit worker option for browser ESM.",
    );
  const source = worker as WorkerSource<Env>;
  if (
    typeof source?.createWorker === "function" &&
    typeof source?.loadDirect === "function"
  )
    return new PreferredFetchRuntime(options, source);
  if (options.remote)
    throw new TypeError("remote requires a build-generated WorkerSource.");
  if (options.prefer !== undefined)
    throw new TypeError(
      "prefer requires both createWorker and loadDirect in a WorkerSource.",
    );
  const hasFetch = typeof (worker as WorkerHandler<Env>)?.fetch === "function";
  if (!hasFetch && typeof worker !== "function")
    throw new TypeError("worker.fetch is required.");
  return hasFetch
    ? new DirectFetchRuntime(options, worker as WorkerHandler<Env>)
    : new IsolatedFetchRuntime(options, worker as WorkerFactory);
}
