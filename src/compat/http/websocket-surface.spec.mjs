export function runWebSocketSurface() {
  const attempt = (fn) => {
    try {
      const value = fn();
      return { ok: true, value: value === undefined ? "undefined" : value };
    } catch (e) {
      return {
        ok: false,
        name: e.name,
        message: e.message,
        code: e.code ?? null,
      };
    }
  };
  const out = {
    surface: {
      constructor: typeof WebSocket,
      pair: typeof WebSocketPair,
      constructorLengths: [
        WebSocket.length,
        typeof WebSocketPair === "function" ? WebSocketPair.length : null,
      ],
      prototype: Object.getOwnPropertyNames(WebSocket.prototype).sort(),
      methods: Object.fromEntries(
        [
          "accept",
          "send",
          "close",
          "serializeAttachment",
          "deserializeAttachment",
        ].map((k) => [k, typeof WebSocket.prototype[k]]),
      ),
    },
    constructors: [],
  };
  for (const [id, args] of [
    ["invalid", ["not a url"]],
    ["http", ["http://localhost/"]],
    ["fragment", ["ws://localhost/#x"]],
    ["duplicate", ["ws://localhost/", ["a", "a"]]],
  ])
    out.constructors.push({
      id,
      result: attempt(() => {
        const ws = new WebSocket(...args);
        ws.addEventListener("error", () => {});
        ws.close();
        return "created";
      }),
    });
  out.protocolConversion = ["iterator", "length", "allGetters"].map((mode) => {
    const log = [];
    const protocols = ["bad token", "second"];
    Object.defineProperty(protocols, Symbol.iterator, {
      get() {
        throw new Error("iterator must not be observed");
      },
    });
    Object.defineProperty(protocols, "0", {
      get() {
        log.push("0");
        if (mode === "length") protocols.push("extra");
        return "bad token";
      },
    });
    Object.defineProperty(protocols, "1", {
      get() {
        log.push("1");
        return "second";
      },
    });
    return {
      mode,
      result: attempt(() => new WebSocket("ws://localhost/", protocols)),
      log,
    };
  });
  out.closeEventConversion = attempt(() => {
    const log = [];
    const init = {};
    for (const [key, value] of Object.entries({
      bubbles: true,
      cancelable: true,
      composed: true,
      code: 1000,
      reason: "ok",
      wasClean: true,
    }))
      Object.defineProperty(init, key, {
        get() {
          if (log.includes(key)) throw new Error(`repeated ${key}`);
          log.push(key);
          return value;
        },
      });
    const event = new CloseEvent("close", init);
    return {
      log,
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    };
  });
  out.closeCodeConversion = [
    2147483648,
    -2147483649,
    4294968296,
    2147483647.5,
    NaN,
    Infinity,
    1000.9,
  ].map((code) => {
    const [a, b] = new WebSocketPair();
    a.accept();
    b.accept();
    const log = [];
    const result = attempt(() =>
      a.close(code, {
        toString() {
          log.push("reason");
          return "ok";
        },
      }),
    );
    a.close();
    b.close();
    return {
      code: String(code),
      result,
      log,
      event: attempt(() => new CloseEvent("close", { code }).code),
    };
  });
  out.pair = attempt(() => {
    const p = new WebSocketPair(),
      a = p[0],
      b = p[1],
      v = { stateBefore: [a.readyState, b.readyState], keys: Object.keys(p) };
    v.tags = [
      Object.prototype.toString.call(p),
      Object.prototype.toString.call(a),
    ];
    v.methodLengths = Object.fromEntries(
      [
        "accept",
        "send",
        "close",
        "serializeAttachment",
        "deserializeAttachment",
      ].map((name) => [name, a[name].length]),
    );
    v.sendBefore = attempt(() => a.send("before"));
    v.accept = attempt(() => a.accept());
    v.repeatAccept = attempt(() => a.accept());
    v.emptyAttachment = attempt(() => a.deserializeAttachment());
    const attachment = { x: { n: 1 }, bytes: new Uint8Array([1, 2]) };
    v.serialize = attempt(() => a.serializeAttachment(attachment));
    attachment.x.n = 2;
    attachment.bytes[0] = 9;
    const first = a.deserializeAttachment();
    v.clone = { n: first.x.n, bytes: Array.from(first.bytes) };
    first.x.n = 3;
    v.cloneAgain = a.deserializeAttachment().x.n;
    v.missing = attempt(() => a.serializeAttachment());
    v.afterMissing = attempt(() => a.deserializeAttachment());
    const nonCloneable = () => {};
    v.function = attempt(() => a.serializeAttachment(nonCloneable));
    // Bundlers rewrite whitespace in function source. Still require the exact
    // source of the actual input in the error before comparing runtimes.
    if (v.function.message === `${String(nonCloneable)} could not be cloned.`)
      v.function.message = "<input function source> could not be cloned.";
    v.stateAfter = [a.readyState, b.readyState];
    a.close();
    b.accept();
    b.close();
    return v;
  });
  return out;
}
