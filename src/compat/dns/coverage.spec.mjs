export const dnsCoverageCases = {
  dnsCallbackFailureCoverage: async function () {
    const dns = await import("node:dns"),
      out = {},
      original = globalThis.fetch;
    try {
      for (const mode of ["http", "network", "missing"])
        for (const route of ["module", "resolver"]) {
          globalThis.fetch = async () => {
            if (mode === "network") throw Error("network");
            if (mode === "http") return new Response("", { status: 500 });
            return Response.json({ Question: [{}] });
          };
          const api = route === "module" ? dns : new dns.Resolver(),
            order = [],
            calls = [];
          let timer, returned;
          try {
            await new Promise((resolve, reject) => {
              timer = setTimeout(
                () => reject(Error("DNS callback did not settle")),
                2000,
              );
              returned = api.resolve4("fixture.test", (error, value) => {
                order.push("callback");
                calls.push({
                  error: error
                    ? {
                        name: error.name,
                        code: error.code ?? null,
                        message: error.message,
                        hostname: error.hostname,
                        syscall: error.syscall,
                        errno: error.errno ?? null,
                      }
                    : null,
                  valuePresent: value !== undefined,
                });
                resolve();
              });
              order.push("returned");
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            out[mode + "/" + route] = {
              order,
              calls,
              returnedUndefined: returned === undefined,
            };
          } finally {
            clearTimeout(timer);
          }
        }
    } finally {
      globalThis.fetch = original;
    }
    return out;
  },
};
