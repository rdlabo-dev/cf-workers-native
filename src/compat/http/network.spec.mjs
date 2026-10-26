// Shared between pinned workerd and the installed native adapter.
export async function runNetworkLifecycle({ http, https }, ports) {
  const results = {};
  const failure = (error) => ({ name: error.name, code: error.code ?? null });
  for (const [scheme, api, port] of [
    ["http", http, ports.http],
    ["https", https, ports.https],
  ]) {
    const base = `${scheme}://127.0.0.1:${port}`;
    for (const kind of [
      "head",
      "204",
      "304",
      "premature",
      "redirect",
      "upload",
      "upload-snapshot",
      "upload-cork-snapshot",
      ...(scheme === "https" ? ["hostname-mismatch"] : []),
    ]) {
      results[`${scheme}/${kind}`] = await new Promise((resolve, reject) => {
        let body = "",
          response;
        const events = [];
        const request = api.request(
          `${kind === "hostname-mismatch" ? `https://127.0.0.1:${ports.mismatchHttps}` : base}/${kind}`,
          {
            method:
              kind === "head"
                ? "HEAD"
                : kind.startsWith("upload")
                  ? "POST"
                  : "GET",
          },
          (incoming) => {
            response = incoming;
            incoming.on("aborted", () => events.push("aborted"));
            incoming.on("data", (chunk) => {
              body += chunk.toString();
            });
            incoming.on("error", (error) => events.push(failure(error)));
            incoming.on("close", () => {
              clearTimeout(timer);
              resolve({
                status: incoming.statusCode,
                body,
                complete: incoming.complete,
                aborted: incoming.aborted,
                cookies: incoming.headers["set-cookie"] ?? null,
                distinctCookies: incoming.headersDistinct["set-cookie"] ?? null,
                rawCookies: incoming.rawHeaders.filter(
                  (value, index) =>
                    index % 2 === 0 && value.toLowerCase() === "set-cookie",
                ).length,
                location: incoming.headers.location ?? null,
                events,
              });
            });
          },
        );
        const timer = setTimeout(() => {
          request.destroy();
          response?.destroy();
          reject(new Error(`Network lifecycle timeout: ${scheme}/${kind}`));
        }, 8000);
        request.on("error", (error) => {
          if (response) events.push(failure(error));
          else {
            clearTimeout(timer);
            resolve({ error: failure(error) });
          }
        });
        if (kind === "upload") request.write("one");
        if (kind.endsWith("snapshot")) {
          if (kind === "upload-cork-snapshot") request.cork();
          const chunk = new Uint8Array([65]);
          request.write(chunk);
          chunk[0] = 66;
          if (kind === "upload-cork-snapshot") request.uncork();
        }
        request.end(
          kind === "upload"
            ? "two"
            : kind === "upload-snapshot"
              ? "C"
              : undefined,
        );
      });
    }
    for (const phase of ["before", "upload", "response"]) {
      results[`${scheme}/abort-${phase}`] = await new Promise(
        (resolve, reject) => {
          const controller = new AbortController(),
            reason = new Error("controlled-abort"),
            events = [];
          let response,
            writeCallbacks = 0;
          if (phase === "before") controller.abort(reason);
          const request = api.request(
            `${base}/${phase === "response" ? "pending-response" : "pending-upload"}`,
            {
              method: phase === "upload" ? "POST" : "GET",
              signal: controller.signal,
            },
            (incoming) => {
              response = incoming;
              incoming.on("error", (error) =>
                events.push(["response-error", failure(error)]),
              );
              incoming.on("aborted", () => events.push(["aborted"]));
              incoming.resume();
              if (phase === "response") controller.abort(reason);
            },
          );
          const timer = setTimeout(() => {
            request.destroy();
            response?.destroy();
            reject(
              new Error(
                `Abort lifecycle timeout: ${scheme}/${phase} ${JSON.stringify({ events, writeCallbacks, destroyed: request.destroyed, closed: request._closed, response: response ? { aborted: response.aborted, complete: response.complete, destroyed: response.destroyed } : null })}`,
              ),
            );
          }, 8000);
          request.on("error", (error) =>
            events.push([
              "request-error",
              failure(error),
              error.cause === reason,
            ]),
          );
          request.on("close", () => {
            clearTimeout(timer);
            resolve({
              events,
              writeCallbacks,
              destroyed: request.destroyed,
              response: response
                ? {
                    aborted: response.aborted,
                    complete: response.complete,
                    destroyed: response.destroyed,
                  }
                : null,
            });
          });
          if (phase === "upload") {
            request.write("first", (error) => {
              writeCallbacks++;
              events.push(["write", error ? failure(error) : null]);
            });
            controller.abort(reason);
          } else request.end();
        },
      );
    }
  }
  return results;
}
