// Run unchanged through pinned workerd and installed native transports.
export async function runTlsLifecycle({ net, tls }, ports) {
  const results = {};
  for (const mode of ["direct", "upgrade"]) {
    for (const kind of [
      "abort-handshake",
      "close-before",
      "close-mid",
      "truncated-after-data",
      "reset-after-data",
      "graceful-end",
      "abort-read",
      "timeout",
      "repeat-destroy",
    ]) {
      results[`${mode}/${kind}`] = await new Promise((resolve, reject) => {
        const controller = new AbortController();
        const events = [];
        let secure = false,
          body = "",
          socket,
          plain,
          abortTimer,
          observationTimer;
        const timer = setTimeout(() => {
          socket?.destroy();
          plain?.destroy();
          reject(
            new Error(
              `TLS lifecycle timeout: ${mode}/${kind} ${JSON.stringify(events)}`,
            ),
          );
        }, 5000);
        const observePending = () => {
          observationTimer = setTimeout(() => {
            clearTimeout(timer);
            const result = {
              pending: true,
              secure,
              body,
              events: events.slice(),
              destroyed: socket.destroyed,
            };
            socket.removeAllListeners("close");
            socket.destroy();
            plain?.destroy();
            resolve(result);
          }, 100);
        };
        const attach = () => {
          socket.on("secureConnect", () => {
            secure = true;
            if (kind === "abort-read") {
              controller.abort(new Error("stop-read"));
              observePending();
            } else if (kind === "repeat-destroy") {
              socket.destroy();
              socket.destroy();
            } else if (kind === "timeout")
              socket.setTimeout(30, () => {
                events.push("timeout");
                socket.destroy();
              });
          });
          socket.on("data", (chunk) => (body += chunk.toString()));
          socket.on("error", (error) =>
            events.push({
              name: error.name,
              code: error.code ?? null,
              message: error.message,
            }),
          );
          socket.on("end", () => events.push("end"));
          socket.on("close", () => {
            clearTimeout(timer);
            clearTimeout(abortTimer);
            clearTimeout(observationTimer);
            plain?.destroy();
            resolve({ secure, body, events, destroyed: socket.destroyed });
          });
          if (kind === "abort-handshake")
            abortTimer = setTimeout(() => {
              controller.abort(new Error("stop-handshake"));
              observePending();
            }, 30);
        };
        if (mode === "direct") {
          const port =
            kind === "abort-handshake"
              ? ports.silentTcp
              : kind === "close-before"
                ? ports.eofTcp
                : kind === "close-mid"
                  ? ports.badTcp
                  : kind === "reset-after-data"
                    ? ports.resetTls
                    : kind === "graceful-end"
                      ? ports.gracefulTls
                      : kind === "truncated-after-data"
                        ? ports.dataTls
                        : ports.idleTls;
          socket = tls.connect({
            host: "127.0.0.1",
            port,
            servername: "localhost",
            signal: controller.signal,
          });
          attach();
        } else {
          plain = net.connect({
            host: "127.0.0.1",
            port:
              kind === "graceful-end"
                ? ports.gracefulUpgrade
                : ports.lifecycleUpgrade,
          });
          plain.on("error", reject);
          plain.on("connect", () => plain.write(kind + "\n"));
          let greeting = "";
          const read = (chunk) => {
            greeting += chunk.toString();
            if (!greeting.endsWith("\n")) return;
            plain.off("data", read);
            socket = tls.connect({
              socket: plain,
              servername: "localhost",
              signal: controller.signal,
            });
            attach();
          };
          plain.on("data", read);
        }
      });
    }
  }
  // These rows isolate SNI selection and paused reads from terminal-event parity.
  for (const kind of [
    "sni-omitted",
    "sni-ip",
    "sni-host",
    "paused-small-buffer",
    "cancel-isolation",
  ]) {
    results[kind] = await new Promise((resolve, reject) => {
      let other,
        bytes = 0,
        authorized = false,
        encrypted = false;
      const errors = [];
      const socket = tls.connect({
        host: "127.0.0.1",
        port: ports.bulkTls,
        ...(kind === "sni-omitted"
          ? {}
          : { servername: kind === "sni-ip" ? "127.0.0.1" : "localhost" }),
        highWaterMark: 64,
      });
      const timer = setTimeout(() => {
        socket.destroy();
        other?.destroy();
        reject(new Error("TLS lifecycle timeout: " + kind));
      }, 5000);
      socket.on("secureConnect", () => {
        authorized = socket.authorized;
        encrypted = socket.encrypted;
        if (kind === "paused-small-buffer") {
          socket.pause();
          setTimeout(() => socket.resume(), 30);
        }
        if (kind === "cancel-isolation") {
          other = tls.connect({
            host: "127.0.0.1",
            port: ports.idleTls,
            servername: "localhost",
          });
          other.on("error", () => {});
          other.on("secureConnect", () => {
            other.destroy();
            socket.end("bulk");
          });
        } else socket.end("bulk");
      });
      socket.on("data", (chunk) => {
        bytes += chunk.length;
      });
      socket.on("error", (error) =>
        errors.push({
          name: error.name,
          code: error.code ?? null,
          message: error.message,
        }),
      );
      socket.on("close", () => {
        clearTimeout(timer);
        other?.destroy();
        resolve({
          authorized,
          encrypted,
          bytes,
          errors,
          destroyed: socket.destroyed,
        });
      });
    });
  }
  return results;
}
