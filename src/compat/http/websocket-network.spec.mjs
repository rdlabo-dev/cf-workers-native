export async function runWebSocketLifecycle(WebSocket, ports) {
  const results = {};
  for (const [scheme, port, variant] of [
    ["ws", ports.http],
    ["wss", ports.https],
  ].flatMap(([scheme, port]) =>
    ["plain", "compressed", "reset"].map((variant) => [scheme, port, variant]),
  )) {
    const label = variant === "plain" ? scheme : `${scheme}/${variant}`;
    const path = variant === "plain" ? "/websocket" : `/websocket/${variant}`;
    for (const closeBy of ["client", "server"]) {
      results[`${label}/${closeBy}`] = await new Promise((resolve, reject) => {
        const socket = new WebSocket(`${scheme}://127.0.0.1:${port}${path}`, [
          "compat",
        ]);
        socket.binaryType = "arraybuffer";
        const messages = [],
          events = [],
          timeline = [],
          errors = [];
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error(`WebSocket timeout: ${scheme}/${closeBy}`));
        }, 5000);
        socket.addEventListener("open", () => {
          events.push("open");
          timeline.push("open");
          socket.send("text");
          socket.send(new Uint8Array([1, 2, 255]));
          socket.send("");
          socket.send("repeat-".repeat(300));
          socket.send("repeat-".repeat(300));
        });
        socket.addEventListener("message", (event) => {
          timeline.push("message");
          messages.push(
            typeof event.data === "string"
              ? event.data
              : Array.from(new Uint8Array(event.data)),
          );
          if (messages.length === 5) {
            if (closeBy === "client") socket.close(1000, "done");
            else socket.send("close-me");
          }
        });
        socket.addEventListener("error", (event) => {
          events.push("error");
          timeline.push("error");
          errors.push({
            message: event.message ?? null,
            error: event.error ? String(event.error) : null,
            readyState: socket.readyState,
          });
        });
        socket.addEventListener("close", (event) => {
          clearTimeout(timer);
          timeline.push("close");
          const closedState = socket.readyState;
          // A server-initiated WS/WSS close in the pinned raw workerd can
          // report a network error after the clean close event. Observe that
          // tail explicitly instead of returning arrays that mutate later.
          setTimeout(
            () =>
              resolve({
                protocol: socket.protocol,
                extensions: socket.extensions,
                binaryType: socket.binaryType,
                readyState: closedState,
                messages,
                events: events.slice(),
                timeline: timeline.slice(),
                errors: errors.slice(),
                close: {
                  code: event.code,
                  reason: event.reason,
                  clean: event.wasClean,
                },
              }),
            100,
          );
        });
      });
    }
  }
  return results;
}
