export const diagnosticsCoverageCases = {
  diagnosticsCallbackCoverage: async function () {
    const d = await import("node:diagnostics_channel"),
      { AsyncLocalStorage } = await import("node:async_hooks"),
      out = {};
    for (const mode of ["error", "throw", "callbackThrow", "async"]) {
      const channel = d.tracingChannel("coverage-" + mode),
        context = {},
        marker = Error(mode),
        store = new AsyncLocalStorage(),
        receiver = {},
        events = [];
      const subscriptions = Object.fromEntries(
        ["start", "end", "error", "asyncStart", "asyncEnd"].map((name) => [
          name,
          () => events.push(name),
        ]),
      );
      channel.subscribe(subscriptions);
      channel.asyncStart.bindStore(store, () => marker);
      let timer, settle;
      const settled = new Promise((resolve) => {
        settle = resolve;
      });
      try {
        let thrown, result, callback;
        try {
          result = channel.traceCallback(
            (cb) => {
              if (mode === "throw") throw marker;
              if (mode === "async")
                queueMicrotask(() => cb.call(receiver, null, 4));
              else cb.call(receiver, mode === "error" ? marker : null, 4);
              return 8;
            },
            0,
            context,
            null,
            function (error, value) {
              callback = {
                receiver: this === receiver,
                store: store.getStore() === marker,
                error: error === marker,
                value,
              };
              events.push("callback");
              settle();
              if (mode === "callbackThrow") throw marker;
            },
          );
        } catch (e) {
          thrown = e;
        }
        const immediate = events.slice();
        if (mode === "async")
          await Promise.race([
            settled,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(Error("trace callback did not settle")),
                2000,
              );
            }),
          ]);
        out[mode] = {
          immediate,
          events,
          result: result ?? null,
          thrown: thrown === marker,
          contextError: context.error === marker,
          contextResult: context.result ?? null,
          callback: callback ?? null,
        };
      } finally {
        clearTimeout(timer);
        channel.asyncStart.unbindStore(store);
        channel.unsubscribe(subscriptions);
      }
    }
    return out;
  },
};
