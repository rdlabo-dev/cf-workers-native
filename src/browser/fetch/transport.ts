import { ReadableStream as WorkerReadableStream } from "../../compat/stream-web/runtime.js";

/** Byte transport shared by Web Fetch and node:http; it does not apply HTTP policy. */
export interface TransportRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body: ReadableStream<Uint8Array> | null;
  signal: AbortSignal;
  encodeResponseBody?: "automatic" | "manual";
}
export interface TransportResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
}
export interface NativeConnection {
  /** Resolves at response headers, independently of upload completion. */
  headers: Promise<Omit<TransportResponse, "body"> & { hasBody: boolean }>;
  /** Resolves only when this chunk has been accepted by the bounded native writer. */
  write(chunk: Uint8Array): Promise<void>;
  end(): Promise<void>;
  /** Pull one bounded response chunk; null means EOF. */
  read(): Promise<Uint8Array<ArrayBuffer> | null>;
  /** Idempotently release every native resource, rejecting pending operations. */
  close(): Promise<void>;
}
export interface NativeNetwork {
  open(
    request: Omit<TransportRequest, "body" | "signal"> & { hasBody: boolean },
  ): Promise<NativeConnection>;
}

/** A single owner closes a connection on abort, EOF, cancellation or failure. */
export class FetchTransport {
  constructor(private readonly network: NativeNetwork) {}

  async fetch(request: TransportRequest): Promise<TransportResponse> {
    request.signal.throwIfAborted();
    let connection: NativeConnection | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let responseController: ReadableByteStreamController | undefined;
    let closed = false;
    let closing: Promise<void> | undefined;
    let failure: unknown;
    let rejectFailure!: (reason: unknown) => void;
    const failed = new Promise<never>((_, reject) => {
      rejectFailure = reject;
    });
    // Every operation races the same failure. Attach a handler before native open.
    void failed.catch(() => {});
    const close = (reason?: unknown) => {
      if (closed) return closing!;
      closed = true;
      failure = reason;
      request.signal.removeEventListener("abort", onAbort);
      rejectFailure(
        reason ?? new DOMException("Connection closed", "AbortError"),
      );
      // A tee branch's cancellation waits for its retained sibling. Redirect
      // replay owns that sibling, so awaiting it here would deadlock an early
      // response. Cancel the upload, but await only native resource release.
      void reader?.cancel(reason).catch(() => {});
      closing = Promise.resolve(connection?.close());
      void closing.catch(() => {});
      return closing;
    };
    const fail = (reason: unknown) => {
      if (closed) return;
      rejectFailure(reason);
      responseController?.error(reason);
      void close(reason);
    };
    const onAbort = () => fail(request.signal.reason);
    request.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const opening = this.network
        .open({
          url: request.url,
          method: request.method,
          headers: request.headers,
          hasBody: request.body !== null,
          encodeResponseBody: request.encodeResponseBody,
        })
        .then(async (opened) => {
          if (closed) {
            await opened.close();
            throw failure;
          }
          connection = opened;
          return opened;
        });
      const current = await Promise.race([opening, failed]);
      const upload = async () => {
        try {
          if (request.body) {
            reader = request.body.getReader();
            for (;;) {
              const next = await Promise.race([reader.read(), failed]);
              if (next.done || closed) break;
              if (!(next.value instanceof Uint8Array))
                throw new TypeError("Fetch body chunks must be Uint8Array");
              await Promise.race([current.write(next.value), failed]);
            }
          }
          if (!closed) await Promise.race([current.end(), failed]);
        } finally {
          reader?.releaseLock();
          reader = undefined;
        }
      };
      void upload().catch(fail);
      const metadata = await Promise.race([current.headers, failed]);
      if (!metadata.hasBody) {
        await close();
        return {
          status: metadata.status,
          statusText: metadata.statusText,
          headers: metadata.headers,
          body: null,
        };
      }
      // Produce Workers bytes at the socket boundary. Adapting a host stream
      // here allocated a WebKit reader for every response, including assets.
      const body = new WorkerReadableStream(
        {
          type: "bytes",
          start(controller) {
            responseController = controller;
          },
          async pull(controller) {
            if (closed) return;
            try {
              let chunk;
              do {
                chunk = await Promise.race([current.read(), failed]);
              } while (chunk?.byteLength === 0 && !closed);
              if (closed) return;
              if (chunk === null) {
                await close();
                controller.close();
                controller.byobRequest?.respond(0);
              } else controller.enqueue(new Uint8Array(chunk));
            } catch (error) {
              if (closed) controller.error(error);
              else fail(error);
            }
          },
          cancel(reason) {
            return close(reason);
          },
        },
        { highWaterMark: 0 },
      );
      return {
        status: metadata.status,
        statusText: metadata.statusText,
        headers: metadata.headers,
        body,
      };
    } catch (error) {
      fail(error);
      throw error;
    }
  }
}
