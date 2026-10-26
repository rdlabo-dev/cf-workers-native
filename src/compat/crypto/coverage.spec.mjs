// Shared operation-level comparisons. Every function is self-contained so the
// same source runs in pinned workerd and through the public/native package.
export const cryptoCoverageCases = {
  cryptoSignatureCallbacks: async function ({ crypto: c }) {
    const { privateKey, publicKey } = c.generateKeyPairSync("ed25519");
    const data = new Uint8Array([1, 2, 3]);
    const signature = c.sign(null, data, privateKey);
    const results = {};
    for (const name of [
      "sign",
      "verifyTrue",
      "verifyFalse",
      "signDigest",
      "verifyDigest",
      "signData",
      "verifySignature",
      "missingKey",
    ]) {
      const order = [],
        callbacks = [];
      let settleCallback;
      const settled = new Promise((resolve) => {
        settleCallback = resolve;
      });
      const error = (e) => ({
        name: e.name,
        code: e.code ?? null,
        message: e.message,
      });
      const callback = (e, value) => {
        settleCallback();
        order.push("callback");
        callbacks.push(
          e
            ? { error: error(e) }
            : {
                value:
                  typeof value === "boolean"
                    ? value
                    : c.verify(null, data, publicKey, value),
              },
        );
      };
      let returned, thrown;
      try {
        if (name === "sign")
          returned = c.sign(null, data, privateKey, callback);
        if (name === "verifyTrue")
          returned = c.verify(null, data, publicKey, signature, callback);
        if (name === "verifyFalse")
          returned = c.verify(
            null,
            new Uint8Array([4]),
            publicKey,
            signature,
            callback,
          );
        if (name === "signDigest")
          returned = c.sign("not-a-digest", data, privateKey, callback);
        if (name === "verifyDigest")
          returned = c.verify(
            "not-a-digest",
            data,
            publicKey,
            signature,
            callback,
          );
        if (name === "signData")
          returned = c.sign(null, {}, privateKey, callback);
        if (name === "verifySignature")
          returned = c.verify(null, data, publicKey, {}, callback);
        if (name === "missingKey")
          returned = c.sign(null, data, undefined, callback);
      } catch (e) {
        thrown = error(e);
        order.push("throw");
      }
      order.push("returned");
      queueMicrotask(() => order.push("microtask"));
      if (!thrown && name !== "nullOverload") {
        let timer;
        try {
          await Promise.race([
            settled,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("callback did not settle: " + name)),
                2000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      // Observe duplicates through the next task; this is a bounded scheduling check.
      await new Promise((resolve) => setTimeout(resolve, 0));
      results[name] = {
        order,
        callbacks,
        returnedUndefined: returned === undefined,
        thrown: thrown ?? null,
      };
    }
    return results;
  },
  cryptoEcdhInputCoverage: function ({ crypto: c }) {
    const left = c.createECDH("prime256v1"),
      right = c.createECDH("prime256v1");
    left.setPrivateKey(new Uint8Array([1]));
    right.setPrivateKey(new Uint8Array([2]));
    const peer = right.getPublicKey(),
      results = {};
    const attempt = (fn) => {
      try {
        return { value: fn() };
      } catch (e) {
        return {
          error: { name: e.name, code: e.code ?? null, message: e.message },
        };
      }
    };
    const hex = (view) =>
      Array.from(view, (x) => x.toString(16).padStart(2, "0")).join("");
    for (const operation of ["setPrivateKey", "computeSecret", "convertKey"]) {
      const bytes = operation === "setPrivateKey" ? new Uint8Array([2]) : peer;
      const invoke = (input) => {
        if (operation === "setPrivateKey") {
          left.setPrivateKey(input);
          return hex(left.getPublicKey());
        }
        if (operation === "computeSecret")
          return hex(left.computeSecret(input));
        return hex(c.ECDH.convertKey(input, "prime256v1"));
      };
      for (const kind of ["typed", "dataView"])
        for (const shadow of [
          "none",
          "buffer",
          "byteOffset",
          "byteLength",
          "detached",
        ]) {
          left.setPrivateKey(new Uint8Array([1]));
          const backing = new Uint8Array(bytes.length + 4);
          backing.set(bytes, 2);
          const view =
            kind === "typed"
              ? new Uint8Array(backing.buffer, 2, bytes.length)
              : new DataView(backing.buffer, 2, bytes.length);
          let reads = 0;
          if (!["none", "detached"].includes(shadow))
            Object.defineProperty(view, shadow, {
              get() {
                reads++;
                throw new Error("shadow " + shadow);
              },
            });
          if (shadow === "detached")
            structuredClone(backing.buffer, { transfer: [backing.buffer] });
          const result = attempt(() => invoke(view));
          results[`${operation}/${kind}/${shadow}`] = {
            ...result,
            reads,
            state: hex(left.getPublicKey()),
          };
        }
      left.setPrivateKey(new Uint8Array([1]));
      results[operation + "/arrayBuffer"] = attempt(() =>
        invoke(Uint8Array.from(bytes).buffer),
      );
    }
    for (const invalid of [new Uint8Array([0]), new Uint8Array(32).fill(255)]) {
      left.setPrivateKey(new Uint8Array([1]));
      results["failedSet/" + hex(invalid)] = {
        result: attempt(() => left.setPrivateKey(invalid) && true),
        privateKey: hex(left.getPrivateKey()),
        publicKey: hex(left.getPublicKey()),
        secret: hex(left.computeSecret(peer)),
      };
    }
    return results;
  },
  cryptoRandomCallbackCoverage: async function ({ crypto: c }) {
    const results = {};
    for (const name of [
      "negative",
      "maxOnly",
      "invalidRange",
      "tooWide",
      "nullOverload",
    ]) {
      const order = [],
        callbacks = [];
      let settleCallback;
      const settled = new Promise((resolve) => {
        settleCallback = resolve;
      });
      const error = (e) => ({
        name: e.name,
        code: e.code ?? null,
        message: e.message,
      });
      const callback = (e, value) => {
        settleCallback();
        order.push("callback");
        callbacks.push(e ? { error: error(e) } : { value });
      };
      let returned, thrown;
      try {
        if (name === "negative") returned = c.randomInt(-1, 0, callback);
        if (name === "maxOnly") returned = c.randomInt(1, callback);
        if (name === "invalidRange") returned = c.randomInt(1, 1, callback);
        if (name === "tooWide") returned = c.randomInt(0, 2 ** 48, callback);
        if (name === "nullOverload") returned = c.randomInt(1, null);
      } catch (e) {
        thrown = error(e);
        order.push("throw");
      }
      order.push("returned");
      queueMicrotask(() => order.push("microtask"));
      if (!thrown && name !== "nullOverload") {
        let timer;
        try {
          await Promise.race([
            settled,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("callback did not settle: " + name)),
                2000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      // Observe duplicates through the next task; this is a bounded scheduling check.
      await new Promise((resolve) => setTimeout(resolve, 0));
      results[name] = {
        order,
        callbacks,
        returnedUndefined: returned === undefined,
        thrown: thrown ?? null,
      };
    }
    const uuid = [];
    for (const kind of [
      "undefined",
      "empty",
      "true",
      "false",
      "null",
      "invalid",
      "getter",
      "throwingGetter",
    ]) {
      let reads = 0;
      const options =
        kind === "undefined"
          ? undefined
          : kind === "null"
            ? null
            : kind === "empty"
              ? {}
              : {
                  get disableEntropyCache() {
                    reads++;
                    if (kind === "throwingGetter")
                      throw new Error("uuid getter");
                    return kind === "invalid" ? 1 : kind !== "false";
                  },
                };
      let result;
      try {
        const value = c.randomUUID(options);
        result = {
          valid:
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
              value,
            ),
        };
      } catch (e) {
        result = {
          error: { name: e.name, code: e.code ?? null, message: e.message },
        };
      }
      uuid.push({ kind, reads, ...result });
    }
    return { results, uuid };
  },
  cryptoSecretKeyCallbackCoverage: async function ({ crypto: c }) {
    const results = {};
    for (const [name, type, options] of [
      ["type", "bad", { length: 9 }],
      ["hmacZero", "hmac", { length: 0 }],
      ["aesLength", "aes", { length: 129 }],
      ["null", "hmac", null],
      ["valid", "hmac", { length: 9 }],
    ]) {
      const order = [],
        callbacks = [];
      let settleCallback;
      const settled = new Promise((resolve) => {
        settleCallback = resolve;
      });
      const error = (e) => ({
        name: e.name,
        code: e.code ?? null,
        message: e.message,
      });
      let thrown, returned;
      try {
        returned = c.generateKey(type, options, (e, key) => {
          settleCallback();
          order.push("callback");
          callbacks.push(
            e
              ? { error: error(e) }
              : { type: key.type, bytes: key.export().length },
          );
        });
      } catch (e) {
        thrown = error(e);
        order.push("throw");
      }
      order.push("returned");
      queueMicrotask(() => order.push("microtask"));
      if (!thrown && name !== "nullOverload") {
        let timer;
        try {
          await Promise.race([
            settled,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("callback did not settle: " + name)),
                2000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      // Observe duplicates through the next task; this is a bounded scheduling check.
      await new Promise((resolve) => setTimeout(resolve, 0));
      results[name] = {
        order,
        callbacks,
        returnedUndefined: returned === undefined,
        thrown: thrown ?? null,
      };
    }
    let reads = 0;
    try {
      const key = c.generateKeySync("hmac", {
        get length() {
          return ++reads === 1 ? 9 : 16;
        },
      });
      results.getter = { reads, bytes: key.export().length };
    } catch (e) {
      results.getter = {
        reads,
        error: { name: e.name, code: e.code ?? null, message: e.message },
      };
    }
    return results;
  },
};
