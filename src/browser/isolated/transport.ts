import { runWithRequestScope } from "../../shared/request-scope.js";
import { setWorkerEnv } from "../../cloudflare/apis/cloudflare-workers/index.js";
import { isResponse } from "../fetch/interop.js";
import { Request as WorkerRequest } from "../request/index.js";
import type { WorkerHandler } from "../../cloudflare/workers/types.js";
import type { Command, Invocation, Reply } from "./protocol.js";

export function serve(worker: WorkerHandler<unknown>) {
  // Both directions are pull-driven; chunks are bounded without transferable streams.
  self.onmessage = async ({ data }: MessageEvent<Invocation>) => {
    const { port, url, method, headers, hasBody, env } = data;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let bodyDone = false;
    let cancelling = false;
    let backgroundDone = false;
    const send = (reply: Reply) => port.postMessage(reply);
    let uploadController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    let uploadPulled: (() => void) | undefined;
    let uploadDone = !hasBody;
    const stopUpload = (reason: unknown) => {
      if (uploadDone) return;
      uploadDone = true;
      uploadController?.error(reason);
      uploadPulled?.();
      send({ type: "upload-cancel" });
    };
    const body = hasBody
      ? new ReadableStream<Uint8Array>(
          {
            start(controller) {
              uploadController = controller;
            },
            pull() {
              return new Promise<void>((resolve) => {
                uploadPulled = resolve;
                send({ type: "upload-pull" });
              });
            },
            cancel() {
              uploadDone = true;
              uploadPulled?.();
              send({ type: "upload-cancel" });
            },
          },
          { highWaterMark: 0 },
        )
      : null;
    const close = () => {
      if (bodyDone && backgroundDone) {
        stopUpload(new Error("Response completed"));
        port.close();
      }
    };
    const end = () => {
      if (!bodyDone) {
        bodyDone = true;
        send({ type: "end" });
      }
      close();
    };
    const error = (cause: unknown) => {
      bodyDone = true;
      send({
        type: "error",
        name: cause instanceof Error ? cause.name : "Error",
        message: String(cause),
      });
      close();
    };
    port.onmessage = async ({ data }: MessageEvent<Command>) => {
      try {
        if (typeof data === "object") {
          if (!uploadDone) {
            if (data.type === "upload-chunk")
              uploadController!.enqueue(data.value);
            else {
              uploadDone = true;
              if (data.type === "upload-end") uploadController!.close();
              else uploadController!.error(new Error(data.message));
            }
            uploadPulled?.();
            uploadPulled = undefined;
          }
        } else if (data === "abort") {
          controller.abort();
          stopUpload(controller.signal.reason);
          if (reader) {
            cancelling = true;
            await reader.cancel();
            end();
          }
        } else if (data === "cancel") {
          cancelling = true;
          await reader?.cancel();
          end();
        } else if (data === "pull" && reader && !bodyDone) {
          const chunk = await reader.read();
          if (cancelling) return;
          if (chunk.done) end();
          else if (!bodyDone) send({ type: "chunk", value: chunk.value });
        }
      } catch (cause) {
        error(cause);
      }
    };
    const pending: Promise<unknown>[] = [];
    const errors: string[] = [];
    try {
      setWorkerEnv(env);
      const request = new WorkerRequest(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const response = await runWithRequestScope(
        () =>
          worker.fetch(request as unknown as Request, env, {
            props: {},
            passThroughOnException() {
              throw new Error(
                "passThroughOnException is unsupported for local execution.",
              );
            },
            waitUntil(promise) {
              pending.push(
                promise.catch((cause) => {
                  errors.push(String(cause));
                }),
              );
            },
          }),
        env,
      );
      if (!isResponse(response) || response.status === 0)
        throw new TypeError("worker.fetch must return a non-error Response.");
      if (response.bodyUsed || response.body?.locked)
        throw new TypeError("worker.fetch returned an unusable response body.");
      reader = response.body?.getReader();
      bodyDone = !reader;
      send({
        type: "response",
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers],
        hasBody: !!reader,
      });
    } catch (cause) {
      error(cause);
    } finally {
      while (pending.length) await Promise.all(pending.splice(0));
      send({ type: "done", errors });
      backgroundDone = true;
      close();
    }
  };
  self.postMessage({ type: "ready" });
}
