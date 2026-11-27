import { isRequest, isResponse } from "../../browser/fetch/interop.js";
import {
  Request as WorkerRequest,
  type RequestInit as WorkerRequestInit,
} from "../../browser/request/index.js";
import type { FetchRuntimeOptions, WorkerContext } from "./types.js";
export type { FetchRuntimeOptions } from "./types.js";

/** Shared Fetch contract. Subclasses implement execution, not URL or HTTP semantics. */
export abstract class FetchRuntime<Env = Record<string, unknown>> {
  private readonly base: URL;
  private readonly boundary: string;
  protected readonly localURL: URL | undefined;
  protected readonly original: typeof fetch;
  private readonly env: Env;
  private readonly pending = new Set<Promise<void>>();
  private disposed = false;
  private disposal: void | Promise<void> = undefined;
  readonly ready: Promise<void> = Promise.resolve();

  constructor(private readonly options: FetchRuntimeOptions<Env>) {
    const base = new URL(options.baseURL);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) {
      throw new TypeError(
        "baseURL must be an HTTP(S) URL without credentials, query or fragment.",
      );
    }

    this.base = base;
    this.boundary = base.pathname.replace(/\/+$/, "");
    this.original = globalThis.fetch;
    this.localURL = globalThis.location
      ? new URL(globalThis.location.href)
      : undefined;
    this.env = options.env ?? ({} as Env);
  }

  protected abstract dispatch(
    request: Request,
    env: Env,
    ctx: WorkerContext,
  ): Response | Promise<Response>;
  protected close(): void | Promise<void> {}

  protected externalFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    _url: URL,
  ): Promise<Response> {
    return this.original.call(globalThis, input, init);
  }

  /** Bound function; creating a runtime does not patch global fetch. */
  readonly fetch: typeof fetch = async (input, init) => {
    const inputIsRequest = isRequest(input);
    const address = inputIsRequest ? input.url : String(input);
    const url = new URL(
      address,
      globalThis.document?.baseURI ??
        globalThis.location?.href ??
        this.base.href,
    );
    const matchesPath =
      !this.boundary ||
      url.pathname === this.boundary ||
      url.pathname.startsWith(`${this.boundary}/`);
    const isLocal =
      this.localURL &&
      url.protocol === this.localURL.protocol &&
      url.host === this.localURL.host;
    if (!matchesPath || (url.origin !== this.base.origin && !isLocal)) {
      return this.externalFetch(input, init, url);
    }
    if (url.username || url.password)
      throw new TypeError("Request URL must not contain credentials.");
    const target = new URL(this.base.origin);
    target.pathname = url.pathname;
    target.search = url.search;
    const request = (inputIsRequest
      ? new WorkerRequest(
          target,
          new WorkerRequest(
            input,
            init as WorkerRequestInit,
          ) as WorkerRequestInit,
        )
      : new WorkerRequest(
          target,
          init as WorkerRequestInit,
        )) as unknown as Request;
    request.signal.throwIfAborted();
    const ctx: WorkerContext = {
      props: {},
      passThroughOnException() {
        throw new Error(
          "passThroughOnException is unsupported for local execution.",
        );
      },
      waitUntil: (promise) => {
        const tracked = Promise.resolve(promise).then(
          () => {},
          (error) => {
            try {
              (this.options.onBackgroundError ?? console.error)(error);
            } catch (reportError) {
              console.error(reportError);
            }
          },
        );
        this.pending.add(tracked);
        void tracked.finally(() => this.pending.delete(tracked));
      },
    };
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(request.signal.reason);
      request.signal.addEventListener("abort", abort, { once: true });
    });
    let response: Response;
    try {
      response = await Promise.race([
        Promise.resolve().then(() => {
          request.signal.throwIfAborted();
          if (this.disposed) throw new Error("Worker runtime disposed");
          return this.dispatch(request, this.env, ctx);
        }),
        cancelled,
      ]);
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
    if (!isResponse(response))
      throw new TypeError("worker.fetch must return a Response.");
    if (response.type === "error")
      throw new TypeError("worker.fetch returned a network error response.");
    if (response.bodyUsed || response.body?.locked)
      throw new TypeError("worker.fetch returned an unusable response body.");
    if (request.method === "HEAD" && response.body) {
      void response.body.cancel().catch(() => {});
      return new Response(null, response);
    }
    return response;
  };

  async drain() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  dispose() {
    if (this.disposed) return this.disposal;
    this.disposal = this.close();
    this.disposed = true;
    return this.disposal;
  }
}
