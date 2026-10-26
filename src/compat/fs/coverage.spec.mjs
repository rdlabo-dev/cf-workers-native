// Functions are serialized into the same Workers and public-package runners.
export const fsCoverageCases = {
  fsExportCoverage: async function ({ fs }) {
    const out = {};
    for (const [name, fn] of [
      ["DirMissing", () => new fs.Dir()],
      [
        "DirEmpty",
        () => {
          const dir = new fs.Dir([], "/tmp", {});
          try {
            return { path: dir.path, empty: dir.readSync() === null };
          } finally {
            dir.closeSync();
          }
        },
      ],
      [
        "Stats",
        () => {
          const stat = new fs.Stats();
          return Object.fromEntries(
            [
              "isFile",
              "isDirectory",
              "isSymbolicLink",
              "isBlockDevice",
              "isCharacterDevice",
              "isFIFO",
              "isSocket",
            ].map((name) => [name, stat[name]()]),
          );
        },
      ],
      ["StatsCall", () => fs.Stats()],
      ["StatsPrototypeConstructor", () => new fs.Stats.prototype.constructor()],
      [
        "StatsIdentity",
        () => {
          const path = "/tmp/stats-export-coverage";
          fs.writeFileSync(path, "abc");
          try {
            const stat = fs.statSync(path);
            let error;
            try {
              new stat.constructor();
            } catch (e) {
              error = {
                name: e.name,
                code: e.code ?? null,
                message: e.message,
              };
            }
            return {
              prototypeConstructor: fs.Stats.prototype.constructor === fs.Stats,
              constructor: stat.constructor === fs.Stats,
              instance: stat instanceof fs.Stats,
              prototype: Object.getPrototypeOf(stat) === fs.Stats.prototype,
              error,
            };
          } finally {
            fs.unlinkSync(path);
          }
        },
      ],
      ["watch", () => fs.promises.watch("/tmp")],
    ]) {
      try {
        out[name] = { value: await fn() };
      } catch (e) {
        out[name] = {
          error: { name: e.name, code: e.code ?? null, message: e.message },
        };
      }
    }
    return out;
  },
  fsReadOverloadCoverage: async function ({ fs }) {
    const path = "/tmp/read-overload-coverage";
    fs.writeFileSync(path, "abcdef");
    const out = {};
    try {
      for (const name of [
        "default",
        "options",
        "override",
        "getters",
        "invalid",
      ]) {
        const h = await fs.promises.open(path, "r");
        try {
          const a = new Uint8Array(5),
            b = new Uint8Array(5),
            trace = [];
          let phase = "call";
          try {
            let pending;
            if (name === "default") pending = h.read();
            if (name === "options")
              pending = h.read({
                buffer: a,
                offset: 1,
                length: 2,
                position: 0,
              });
            if (name === "override")
              pending = h.read(a, {
                buffer: b,
                offset: 1,
                length: 2,
                position: 0,
              });
            if (name === "invalid")
              pending = h.read({ buffer: a, offset: -1, position: -2 });
            if (name === "getters")
              pending = h.read({
                get buffer() {
                  trace.push("buffer");
                  return a;
                },
                get offset() {
                  trace.push("offset");
                  return 1;
                },
                get length() {
                  trace.push("length");
                  return 2;
                },
                get position() {
                  trace.push("position");
                  return 0;
                },
              });
            phase = "await";
            const r = await pending;
            out[name] = {
              count: r.bytesRead,
              length: r.buffer.length,
              bytes: Array.from(r.buffer.subarray(0, 8)),
              sameA: r.buffer === a,
              sameB: r.buffer === b,
            };
          } catch (e) {
            out[name] = {
              phase,
              error: { name: e.name, code: e.code ?? null, message: e.message },
            };
          }
          out[name] = {
            ...out[name],
            a: Array.from(a),
            b: Array.from(b),
            trace,
          };
        } finally {
          await h.close();
        }
      }
    } finally {
      fs.unlinkSync(path);
    }
    return out;
  },
  fsVectorCoverage: async function ({ fs }) {
    const path = "/tmp/vector-coverage",
      out = {};
    try {
      for (const operation of ["readv", "writev"])
        for (const mode of ["sync", "callback", "handle"])
          for (const position of [null, 1])
            for (const kind of ["views", "shadow", "detached"]) {
              fs.writeFileSync(path, "abcdef");
              const a = new Uint8Array([88, 65, 66, 88]),
                b = new Uint8Array([88, 67, 68, 88]);
              const view = a.subarray(1, 3);
              const buffers =
                kind === "views"
                  ? [view, new DataView(b.buffer, 1, 2), new Uint8Array()]
                  : [view];
              if (kind === "shadow")
                Object.defineProperty(view, "byteLength", { value: 0 });
              if (kind === "detached")
                structuredClone(a.buffer, { transfer: [a.buffer] });
              const h =
                mode === "handle" ? await fs.promises.open(path, "r+") : null;
              const fd = h ? h.fd : fs.openSync(path, "r+");
              try {
                let result;
                try {
                  if (mode === "sync")
                    result = {
                      count: fs[operation + "Sync"](fd, buffers, position),
                    };
                  if (mode === "callback")
                    result = await new Promise((resolve) =>
                      fs[operation](
                        fd,
                        buffers,
                        position,
                        (e, count, returned) =>
                          resolve(
                            e
                              ? {
                                  error: {
                                    name: e.name,
                                    code: e.code ?? null,
                                    message: e.message,
                                  },
                                }
                              : { count, same: returned === buffers },
                          ),
                      ),
                    );
                  if (mode === "handle") {
                    const r = await h[operation](buffers, position);
                    result = {
                      count: r.bytesRead ?? r.bytesWritten,
                      same: r.buffers === buffers,
                    };
                  }
                } catch (e) {
                  result = {
                    error: {
                      name: e.name,
                      code: e.code ?? null,
                      message: e.message,
                    },
                  };
                }
                const next = new Uint8Array(1);
                const count = fs.readSync(fd, next, 0, 1, null);
                out[[operation, mode, position, kind].join("/")] = {
                  ...result,
                  a: a.buffer.byteLength ? Array.from(a) : [],
                  b: Array.from(b),
                  next: Array.from(next),
                  nextCount: count,
                  file: fs.readFileSync(path, "utf8"),
                };
              } finally {
                if (h) await h.close();
                else fs.closeSync(fd);
              }
            }
    } finally {
      fs.unlinkSync(path);
    }
    return out;
  },
  fsWebStreamCoverage: async function ({ fs }) {
    const path = "/tmp/webstream-coverage",
      out = {};
    fs.writeFileSync(path, "abcdef");
    const bounded = async (p) => {
      let timer;
      try {
        return await Promise.race([
          p,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("read did not settle")),
              2000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      for (const autoClose of [true, false])
        for (const action of ["eof", "cancel", "close"])
          for (const offset of [0, 2]) {
            const row = autoClose + "/" + action + "/" + offset;
            const h = await fs.promises.open(path, "r");
            let closes = 0;
            h.on("close", () => closes++);
            const reader = h
                .readableWebStream({ autoClose })
                .getReader({ mode: "byob" }),
              reads = [];
            try {
              const first = bounded(
                reader.read(new Uint8Array(new ArrayBuffer(10), offset, 3)),
              );
              first.catch(() => {});
              if (action === "close") await h.close();
              const capture = (r) => ({
                done: r.done,
                bytes: Array.from(r.value ?? []),
                offset: r.value?.byteOffset ?? null,
                length: r.value?.byteLength ?? null,
              });
              reads.push(capture(await bounded(first)));
              if (action === "cancel") await reader.cancel("stop");
              if (action === "eof")
                for (let i = 0; i < 8; i++) {
                  const r = await bounded(reader.read(new Uint8Array(3)));
                  reads.push(capture(r));
                  if (r.done) break;
                  if (i === 7) throw new Error("EOF not reached");
                }
              out[row] = {
                reads,
                closes,
                open: typeof h.fd === "number",
              };
              if (!autoClose && action !== "close") {
                const r = await h.read(new Uint8Array(1));
                out[row].remaining = r.bytesRead;
                out[row].size = (await h.stat()).size;
              }
            } catch (e) {
              if (
                e.message === "read did not settle" ||
                e.message === "EOF not reached"
              )
                throw new Error(row + ": " + e.message);
              out[row] = {
                reads,
                closes,
                open: typeof h.fd === "number",
                error: {
                  name: e.name,
                  code: e.code ?? null,
                  message: e.message,
                },
              };
            } finally {
              const cleanup = [];
              try {
                reader.releaseLock();
              } catch (e) {
                cleanup.push({
                  name: e.name,
                  code: e.code ?? null,
                  message: e.message,
                });
              }
              try {
                if (typeof h.fd === "number") await h.close();
              } catch (e) {
                cleanup.push({
                  name: e.name,
                  code: e.code ?? null,
                  message: e.message,
                });
              }
              if (out[row]) out[row].cleanup = cleanup;
            }
          }
    } finally {
      fs.unlinkSync(path);
    }
    return out;
  },
};
