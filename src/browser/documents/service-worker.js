// Native Android document transport. Bundled assets bypass the Worker router.
// Persist shutdown across SW idle termination while an old page is still controlled.
const lifecycleCache = "workers-capacitor-document-lifecycle";
const disabledKey = new URL("/workers-capacitor-disabled", self.location.href)
  .href;
let disabled = false;
self.addEventListener("message", (event) => {
  if (
    ![
      "workers-capacitor:disable-documents",
      "workers-capacitor:enable-documents",
    ].includes(event.data)
  )
    return;
  disabled = event.data === "workers-capacitor:disable-documents";
  const stopping = disabled;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(lifecycleCache);
      if (stopping) await cache.put(disabledKey, new Response("disabled"));
      else await cache.delete(disabledKey);
      event.ports[0]?.postMessage("done");
    })(),
  );
});
const baseURL = new URL(self.location.href).searchParams.get("baseURL");
// Read the current manifest: a previously installed SW can outlive an app update.
function assets() {
  return fetch("/workers-capacitor-assets.json", { cache: "no-store" }).then(
    (response) => {
      if (!response.ok) throw new Error("Missing document assets manifest");
      return response.json();
    },
  );
}
// Bound simultaneous header RPCs to avoid flooding the Android bridge.
// Body reads and cancellation must remain independent of these slots.
let opening = 0;
const waiting = [];
function acquire(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = waiting.indexOf(start);
      if (index !== -1) waiting.splice(index, 1);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener("abort", abort);
      opening++;
      resolve(() => {
        opening--;
        waiting.shift()?.();
      });
    };
    if (signal.aborted) return reject(signal.reason);
    if (opening < 6) start();
    else {
      waiting.push(start);
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}
// Android's native interceptor cannot expose request bodies or return redirects.
// Keep those semantics in the browser's standard FetchEvent pipeline.
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  if (disabled) return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      if (await (await caches.open(lifecycleCache)).match(disabledKey))
        return fetch(event.request);
      const paths = await assets();
      if (disabled) return fetch(event.request);
      if (
        paths.includes(url.pathname) ||
        url.pathname.startsWith("/_capacitor_")
      )
        return fetch(event.request);
      return dispatch(event.request, event.clientId);
    })(),
  );
});
// A destroyed Android WebView can remain in clients.matchAll briefly. Probe
// before sending a navigation request; never replay an application request.
function hostReady(host, signal) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (ready, error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      channel.port1.close();
      channel.port2.close();
      error ? reject(error) : resolve(ready);
    };
    const abort = () => finish(false, signal.reason);
    const timer = setTimeout(() => finish(false), 2000);
    channel.port1.onmessage = (event) =>
      finish(event.data === "workers-capacitor:host-ready");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    try {
      host.postMessage("workers-capacitor:host-ready", [channel.port2]);
    } catch {
      finish(false);
    }
  });
}
async function dispatch(request, clientId) {
  const deadline = Date.now() + 10000;
  let host = (
    await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  ).find((client) =>
    new URL(client.url).searchParams.has("__workers_capacitor_host"),
  );
  // An installed SW survives process restarts. Let the bundled entry restart the
  // native host before intercepting its first document, without a network server.
  if (request.mode === "navigate" && request.method === "GET") {
    request.signal.throwIfAborted();
    if (!host || !(await hostReady(host, request.signal)))
      return fetch(new URL("/index.html", self.location.origin).href, {
        cache: "no-store",
        signal: request.signal,
      });
  }
  while (!host) {
    host = (
      await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    ).find((client) =>
      new URL(client.url).searchParams.has("__workers_capacitor_host"),
    );
    if (Date.now() > deadline) throw new Error("Worker host unavailable");
    if (!host) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await readUpload(request);
  request.signal.throwIfAborted();
  const requestHeaders = Object.fromEntries(request.headers);
  // For an explicit same-origin fetch, Chromium can omit Origin from the
  // FetchEvent. Clients.get only exposes same-origin clients to this worker.
  if (
    clientId &&
    request.mode === "same-origin" &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    !request.headers.has("Origin")
  ) {
    const client = await self.clients.get(clientId);
    if (
      client?.type === "window" &&
      client.frameType === "top-level" &&
      new URL(client.url).origin === self.location.origin
    )
      requestHeaders.origin = self.location.origin;
  }
  const message = {
    id: crypto.randomUUID(),
    url: request.url,
    method: request.method,
    headers: requestHeaders,
    body,
    stream: true,
  };
  const rpc = (message, signal) =>
    new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        channel.port1.close();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Worker response timeout"));
      }, 30000);
      channel.port1.onmessage = (event) => {
        cleanup();
        resolve(event.data);
      };
      host.postMessage(message, [channel.port2]);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  let result;
  const release = await acquire(request.signal);
  try {
    result = await rpc(message, request.signal);
  } catch (error) {
    // The host may still be opening a connection or have produced a late stream.
    void rpc({ action: "cancel", streamId: message.id }).catch(() => {});
    throw error;
  } finally {
    release();
  }
  const cancel = () => rpc({ action: "cancel", streamId: result.streamId });
  if (result.error) throw new Error(result.error);
  const headers = new Headers(result.headers);
  if (
    [301, 302, 303, 307, 308].includes(result.status) &&
    headers.has("location")
  ) {
    const target = new URL(headers.get("location"), result.url);
    if (target.origin !== baseURL) {
      if (result.streamId) await cancel();
      throw new Error("External redirects are not supported");
    }
    headers.set(
      "location",
      self.location.origin + target.pathname + target.search + target.hash,
    );
  }
  let controller;
  const abort = () => {
    controller?.error(request.signal.reason);
    void cancel().catch(() => {});
  };
  const responseBody = result.streamId
    ? new ReadableStream(
        {
          start(value) {
            controller = value;
            request.signal.addEventListener("abort", abort, { once: true });
          },
          async pull(value) {
            try {
              const next = await rpc({
                action: "pull",
                streamId: result.streamId,
              });
              if (request.signal.aborted) return;
              if (next.error) throw new Error(next.error);
              if (next.done) {
                request.signal.removeEventListener("abort", abort);
                value.close();
              } else
                value.enqueue(
                  Uint8Array.from(atob(next.body), (c) => c.charCodeAt(0)),
                );
            } catch (error) {
              request.signal.removeEventListener("abort", abort);
              value.error(error);
              void cancel().catch(() => {});
            }
          },
          async cancel() {
            request.signal.removeEventListener("abort", abort);
            await cancel();
          },
        },
        { highWaterMark: 0 },
      )
    : result.body;
  if (result.streamId && request.signal.aborted) {
    await cancel();
    request.signal.throwIfAborted();
  }
  return new Response(
    [101, 204, 205, 304].includes(result.status) ? null : responseBody,
    { status: result.status, headers },
  );
}

async function readUpload(request) {
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 8 * 1024 * 1024)
        throw new RangeError("Document upload exceeds 8 MiB");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes.buffer;
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
