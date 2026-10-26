export const eventCases = {
  httpEndBodyStates: async function ({ http: h, cloudflareNode: n }) {
    const out = {};
    for (const [id, chunk] of [
      ["empty", ""],
      ["zero", 0],
      ["false", false],
      ["invalid", {}],
      ["bytes", new Uint8Array(0)],
    ]) {
      const req = new h.IncomingMessage();
      req.method = "HEAD";
      const res = new h.ServerResponse(req, {
        rejectNonStandardBodyWrites: true,
      });
      res._hasBody = false;
      res.on("error", () => {});
      try {
        res.end(chunk);
        out[id] = "ok";
      } catch (e) {
        out[id] = { name: e.name, code: e.code ?? null, message: e.message };
      }
    }
    return out;
  },
  httpUploadLifetime: async function ({ http: h, cloudflareNode: n }) {
    const out = {};
    for (const mode of ["early", "readerCancel"]) {
      let cancelled = false;
      const upload = new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        request = new Request("https://example.test/", {
          method: "POST",
          body: upload,
          duplex: "half",
        });
      let req, res;
      const log = [];
      const server = h.createServer((q, s) => {
        req = q;
        res = s;
        q.on("aborted", () => log.push("aborted"));
        q.on("close", () => log.push("reqClose"));
        s.on("close", () => log.push("resClose"));
        if (mode === "early") s.end("early");
        else s.flushHeaders();
      });
      try {
        const response = await n.httpServerHandler(server).fetch(request);
        let body;
        if (mode === "early") body = await response.text();
        else await response.body.cancel();
        await new Promise((r) => setTimeout(r, 0));
        out[mode] = {
          body,
          cancelled,
          locked: request.body.locked,
          reqDestroyed: req.destroyed,
          resDestroyed: res.destroyed,
          log,
        };
      } catch (e) {
        out[mode] = { name: e.name, message: e.message };
      } finally {
        server.close();
      }
    }
    return out;
  },
  httpServerStateTransitions: async function ({ http: h, cloudflareNode: n }) {
    const out = {},
      error = (e) => ({
        name: e.name,
        code: e.code ?? null,
        message: e.message,
      });
    for (const mode of [
      "lateSetHeader",
      "lateWriteHead",
      "headReject",
      "noContentWrite",
      "abortPending",
      "custom",
    ]) {
      let server, req, res;
      const log = [];
      let observed;
      const options = {};
      if (mode === "headReject") options.rejectNonStandardBodyWrites = true;
      if (mode === "custom") {
        options.IncomingMessage = class extends h.IncomingMessage {
          constructor(...a) {
            super(...a);
            log.push("customRequest");
          }
        };
        options.ServerResponse = class extends h.ServerResponse {
          constructor(...a) {
            super(...a);
            log.push("customResponse");
          }
        };
      }
      const abort = new AbortController();
      try {
        server = h.createServer(options, (q, s) => {
          req = q;
          res = s;
          q.on("error", (e) => log.push(["requestError", error(e)]));
          q.on("aborted", () => log.push("aborted"));
          q.on("close", () => log.push("requestClose"));
          s.on("error", (e) => log.push(["responseError", error(e)]));
          s.on("close", () => log.push("responseClose"));
          if (mode === "abortPending") return;
          try {
            if (mode === "lateSetHeader") {
              s.flushHeaders();
              s.setHeader("x-late", "yes");
            }
            if (mode === "lateWriteHead") {
              s.flushHeaders();
              s.writeHead(201);
            }
            if (mode === "headReject" || mode === "noContentWrite") {
              if (mode === "noContentWrite") s.statusCode = 204;
              observed = s.write("data", (e) =>
                log.push(["writeCallback", e ? error(e) : null]),
              );
            }
            if (mode === "custom")
              observed = [
                q instanceof options.IncomingMessage,
                s instanceof options.ServerResponse,
              ];
          } catch (e) {
            observed = error(e);
          }
          s.end();
        });
        const pending = n.httpServerHandler(server).fetch(
          new Request("https://test/", {
            method: mode === "headReject" ? "HEAD" : "GET",
            signal: abort.signal,
          }),
        );
        let response;
        if (mode === "abortPending") {
          await Promise.resolve();
          abort.abort(new Error("cancel-request"));
          const result = await Promise.race([
            pending.then(
              (r) => ({ response: r }),
              (e) => ({ failure: error(e) }),
            ),
            new Promise((resolve) =>
              setTimeout(() => resolve({ pending: true }), 30),
            ),
          ]);
          observed = {
            ...result,
            response: result.response ? true : undefined,
            requestDestroyed: req?.destroyed,
            responseDestroyed: res?.destroyed,
          };
          if (result.response) response = result.response;
          else {
            res.end();
            try {
              response = await pending;
            } catch {}
          }
        } else response = await pending;
        let body;
        if (response)
          try {
            body = await response.text();
          } catch (e) {
            body = error(e);
          }
        await new Promise((r) => setTimeout(r, 0));
        out[mode] = { observed, status: response?.status, body, log };
      } catch (e) {
        out[mode] = { error: error(e), log };
      } finally {
        server?.close();
      }
    }
    return out;
  },

  zlibParamsStates: async function ({ zlib: z }) {
    const out = [];
    for (const stage of ["before", "between", "after"])
      for (const level of [1, 10]) {
        const stream = z.createDeflate(),
          trace = [],
          original = globalThis.queueMicrotask;
        stream.on("error", (e) =>
          trace.push(["error", e.name, e.code ?? null, e.message]),
        );
        stream.resume();
        try {
          if (stage === "between")
            await new Promise((resolve, reject) =>
              stream.write("payload", (e) => (e ? reject(e) : resolve())),
            );
          if (stage === "after")
            await new Promise((resolve) => {
              stream.once("close", resolve);
              stream.end("payload");
            });
          globalThis.queueMicrotask = (callback) =>
            original(() => {
              try {
                callback();
              } catch (error) {
                trace.push([
                  "uncaught",
                  error.name,
                  error.code ?? null,
                  error.message,
                ]);
              }
            });
          try {
            stream.params(level, 0, (error) =>
              trace.push(["callback", error?.name ?? null]),
            );
            trace.push(["returned"]);
          } catch (error) {
            trace.push([
              "throw",
              error.name,
              error.code ?? null,
              error.message,
            ]);
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
          globalThis.queueMicrotask = original;
          stream.destroy();
        }
        out.push({ stage, level, trace });
      }
    for (const operation of [
      "invalid-flush",
      "invalid-callback",
      "close-twice",
    ]) {
      const stream = z.createDeflate(),
        trace = [];
      stream.on("error", (error) =>
        trace.push(["error", error.name, error.code ?? null, error.message]),
      );
      stream.on("close", () => trace.push(["close"]));
      const callback = () => trace.push(["callback"]);
      try {
        if (operation === "invalid-flush") stream.flush(-1, callback);
        else if (operation === "invalid-callback") stream.flush(0, 1);
        else {
          stream.close(callback);
          stream.close(callback);
        }
      } catch (error) {
        trace.push(["throw", error.name, error.code ?? null, error.message]);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      stream.destroy();
      await new Promise((resolve) => setTimeout(resolve, 0));
      out.push({ operation, trace });
    }
    return out;
  },

  cryptoRsaOperationStates: function ({ crypto: c }) {
    const pair = c.generateKeyPairSync("rsa", {
        modulusLength: 1024,
        publicKeyEncoding: { format: "pem", type: "spki" },
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
      }),
      secret = c.createSecretKey(new Uint8Array(16)),
      out = [];
    const capture = (fn) => {
      try {
        const value = fn();
        return { length: value.length };
      } catch (error) {
        return {
          name: error.name,
          code: error.code ?? null,
          message: error.message,
        };
      }
    };
    for (const method of [
      "publicEncrypt",
      "privateDecrypt",
      "privateEncrypt",
      "publicDecrypt",
    ]) {
      const key = method.startsWith("private")
        ? pair.privateKey
        : pair.publicKey;
      for (const scenario of [
        "wrong-key",
        "short-input",
        "malformed-ciphertext",
        "invalid-padding",
      ]) {
        out.push({
          method,
          scenario,
          result: capture(() =>
            c[method](
              {
                key: scenario === "wrong-key" ? secret : key,
                ...(scenario === "invalid-padding" ? { padding: 999 } : {}),
              },
              scenario === "malformed-ciphertext"
                ? new Uint8Array(128)
                : new Uint8Array([1]),
            ),
          ),
        });
      }
    }
    const text = "label",
      bytes = new TextEncoder().encode(text),
      extended = new Uint8Array([0, ...bytes, 0]);
    for (const [kind, label] of [
      ["string", text],
      ["buffer", bytes.buffer],
      ["offset", new DataView(extended.buffer, 1, bytes.length)],
      ["mismatch", bytes],
    ]) {
      const encrypted = c.publicEncrypt(
        { key: pair.publicKey, padding: 4, oaepLabel: label },
        new Uint8Array([1, 2, 3]),
      );
      out.push({
        kind,
        result: capture(() =>
          c.privateDecrypt(
            {
              key: pair.privateKey,
              padding: 4,
              oaepLabel: kind === "mismatch" ? "wrong" : label,
            },
            encrypted,
          ),
        ),
      });
    }
    for (const [encrypt, decrypt] of [
      ["publicEncrypt", "privateDecrypt"],
      ["privateEncrypt", "publicDecrypt"],
    ]) {
      const input = new Uint8Array([1, 2, 3]);
      const encoded = c[encrypt](
        encrypt.startsWith("public") ? pair.publicKey : pair.privateKey,
        input,
      );
      const decoded = c[decrypt](
        decrypt.startsWith("public") ? pair.publicKey : pair.privateKey,
        encoded,
      );
      out.push({ encrypt, decrypt, roundTrip: Array.from(decoded) });
    }
    return out;
  },

  cryptoSubtleOperations: async function ({ crypto: c }) {
    const subtle = c.webcrypto.subtle,
      bytes = new Uint8Array([1, 2, 3, 4]),
      out = [];
    const equal = (a, b) => {
      a = new Uint8Array(a);
      b = new Uint8Array(b);
      return (
        a.length === b.length && a.every((value, index) => value === b[index])
      );
    };
    for (const extractable of [true, false])
      for (const flow of [
        "AES-GCM",
        "HMAC",
        "RSA-OAEP",
        "ECDSA",
        "ECDH",
        "HKDF",
        "PBKDF2",
        "AES-KW",
        "raw-JWK",
      ]) {
        try {
          let result;
          if (flow === "AES-GCM") {
            const key = await subtle.generateKey(
                { name: flow, length: 128 },
                extractable,
                ["encrypt", "decrypt"],
              ),
              algorithm = {
                name: flow,
                iv: new Uint8Array(12),
                additionalData: bytes,
              };
            const encrypted = await subtle.encrypt(algorithm, key, bytes);
            result = {
              length: encrypted.byteLength,
              roundTrip: equal(
                await subtle.decrypt(algorithm, key, encrypted),
                bytes,
              ),
            };
          } else if (flow === "HMAC") {
            const key = await subtle.generateKey(
                { name: flow, hash: "SHA-256", length: 128 },
                extractable,
                ["sign", "verify"],
              ),
              signature = await subtle.sign(flow, key, bytes);
            result = {
              length: signature.byteLength,
              valid: await subtle.verify(flow, key, signature, bytes),
              invalid: await subtle.verify(
                flow,
                key,
                signature,
                new Uint8Array([9]),
              ),
            };
          } else if (flow === "RSA-OAEP") {
            const key = await subtle.generateKey(
                {
                  name: flow,
                  modulusLength: 1024,
                  publicExponent: new Uint8Array([1, 0, 1]),
                  hash: "SHA-256",
                },
                extractable,
                ["encrypt", "decrypt"],
              ),
              algorithm = { name: flow, label: bytes };
            const encrypted = await subtle.encrypt(
              algorithm,
              key.publicKey,
              bytes,
            );
            result = {
              length: encrypted.byteLength,
              roundTrip: equal(
                await subtle.decrypt(algorithm, key.privateKey, encrypted),
                bytes,
              ),
            };
          } else if (flow === "ECDSA") {
            const key = await subtle.generateKey(
                { name: flow, namedCurve: "P-256" },
                extractable,
                ["sign", "verify"],
              ),
              algorithm = { name: flow, hash: "SHA-256" },
              signature = await subtle.sign(algorithm, key.privateKey, bytes);
            result = {
              length: signature.byteLength,
              valid: await subtle.verify(
                algorithm,
                key.publicKey,
                signature,
                bytes,
              ),
              invalid: await subtle.verify(
                algorithm,
                key.publicKey,
                signature,
                new Uint8Array([9]),
              ),
            };
          } else if (flow === "ECDH") {
            const a = await subtle.generateKey(
                { name: flow, namedCurve: "P-256" },
                extractable,
                ["deriveBits"],
              ),
              b = await subtle.generateKey(
                { name: flow, namedCurve: "P-256" },
                extractable,
                ["deriveBits"],
              );
            const left = await subtle.deriveBits(
                { name: flow, public: b.publicKey },
                a.privateKey,
                256,
              ),
              right = await subtle.deriveBits(
                { name: flow, public: a.publicKey },
                b.privateKey,
                256,
              );
            result = { length: left.byteLength, equal: equal(left, right) };
          } else if (flow === "HKDF" || flow === "PBKDF2") {
            const key = await subtle.importKey(
              "raw",
              bytes,
              flow,
              extractable,
              ["deriveBits"],
            );
            const algorithm =
              flow === "HKDF"
                ? { name: flow, hash: "SHA-256", salt: bytes, info: bytes }
                : { name: flow, hash: "SHA-256", salt: bytes, iterations: 2 };
            result = {
              bytes: Array.from(
                new Uint8Array(await subtle.deriveBits(algorithm, key, 128)),
              ),
            };
          } else if (flow === "AES-KW") {
            const wrapping = await subtle.generateKey(
                { name: flow, length: 128 },
                extractable,
                ["wrapKey", "unwrapKey"],
              ),
              original = await subtle.generateKey(
                { name: "AES-GCM", length: 128 },
                true,
                ["encrypt", "decrypt"],
              );
            const wrapped = await subtle.wrapKey(
                "raw",
                original,
                wrapping,
                flow,
              ),
              restored = await subtle.unwrapKey(
                "raw",
                wrapped,
                wrapping,
                flow,
                { name: "AES-GCM" },
                extractable,
                ["encrypt", "decrypt"],
              );
            const algorithm = { name: "AES-GCM", iv: new Uint8Array(12) },
              encrypted = await subtle.encrypt(algorithm, original, bytes);
            result = {
              length: wrapped.byteLength,
              extractable: restored.extractable,
              roundTrip: equal(
                await subtle.decrypt(algorithm, restored, encrypted),
                bytes,
              ),
            };
          } else {
            const raw = new Uint8Array(16),
              key = await subtle.importKey(
                "raw",
                raw,
                { name: "AES-GCM" },
                extractable,
                ["encrypt", "decrypt"],
              );
            const exported = await subtle.exportKey("jwk", key),
              imported = await subtle.importKey(
                "jwk",
                exported,
                { name: "AES-GCM" },
                extractable,
                ["encrypt", "decrypt"],
              );
            result = {
              kty: exported.kty,
              alg: exported.alg,
              ext: exported.ext,
              roundTrip: equal(await subtle.exportKey("raw", imported), raw),
            };
          }
          out.push({ flow, extractable, result });
        } catch (error) {
          out.push({ flow, extractable, error: error.name });
        }
      }
    return out;
  },

  tlsIdentityBoundaries: function ({ tls }) {
    const out = { names: [], alpn: [] };
    for (const [host, cert] of [
      ["api.example.com", { subjectaltname: 'DNS:"api.example.com"' }],
      ["api.example.com", { subjectaltname: 'DNS:"api\\u002eexample.com"' }],
      ["api.example.com", { subjectaltname: 'DNS:"api\\qexample.com"' }],
      [
        "two.example.com",
        { subject: { CN: ["one.example.com", "two.example.com"] } },
      ],
      ["api.one.example.com", { subjectaltname: "DNS:api.*.example.com" }],
      [
        "xn--bcher-kva.example",
        { subjectaltname: "DNS:xn--bcher-kva.example" },
      ],
      ["bücher.example", { subjectaltname: "DNS:xn--bcher-kva.example" }],
    ]) {
      try {
        const error = tls.checkServerIdentity(host, cert);
        out.names.push(
          error
            ? {
                name: error.name,
                code: error.code,
                message: error.message,
                sameCert: error.cert === cert,
              }
            : null,
        );
      } catch (error) {
        out.names.push({
          name: error.name,
          code: error.code ?? null,
          message: error.message,
        });
      }
    }
    for (const value of [
      [],
      ["x".repeat(255)],
      new Uint8Array(0),
      new Uint8Array([2, 104, 50]),
      new DataView(new Uint8Array([0, 2, 104, 50, 0]).buffer, 1, 3),
    ]) {
      const target = {};
      tls.convertALPNProtocols(value, target);
      const before = target.ALPNProtocols
        ? Array.from(target.ALPNProtocols)
        : null;
      if (ArrayBuffer.isView(value))
        new Uint8Array(value.buffer)[value.byteOffset] = 99;
      out.alpn.push({
        before,
        after: target.ALPNProtocols ? Array.from(target.ALPNProtocols) : null,
        same: target.ALPNProtocols === value,
      });
    }
    return out;
  },

  fsWholeFileSignals: async function ({ fs }) {
    const out = [],
      path = "/tmp/signal-whole-file";
    try {
      for (const method of ["readFile", "writeFile", "appendFile"])
        for (const timing of ["before", "getter"])
          for (const mode of ["callback", "promise"]) {
            fs.writeFileSync(path, "seed");
            const controller = new AbortController(),
              reads = [],
              reason = new Error("cancel-file");
            if (timing === "before") controller.abort(reason);
            const options = {
              get encoding() {
                reads.push("encoding");
                if (timing === "getter") controller.abort(reason);
                return "utf8";
              },
              get signal() {
                reads.push("signal");
                return controller.signal;
              },
            };
            let returned = false;
            const args =
              method === "readFile"
                ? [path, options]
                : [path, "payload", options];
            let result;
            try {
              const pending =
                mode === "promise"
                  ? fs.promises[method](...args)
                  : new Promise((resolve, reject) =>
                      fs[method](...args, (error, value) =>
                        error ? reject(error) : resolve(value),
                      ),
                    );
              returned = true;
              const value = await pending;
              result = { value: value ?? null, type: typeof value };
            } catch (error) {
              result = {
                error: {
                  name: error.name,
                  code: error.code ?? null,
                  message: error.message,
                },
                sameReason: error === reason,
                returned,
              };
            }
            out.push({
              method,
              timing,
              mode,
              reads,
              result,
              contents: fs.readFileSync(path, "utf8"),
            });
          }
    } finally {
      fs.rmSync(path, { force: true });
    }
    return out;
  },
  fsBlobDirectoryLifetime: async function ({ fs }) {
    const root = "/tmp/lifetime-matrix",
      out = {};
    fs.mkdirSync(root, { recursive: true });
    try {
      for (const change of ["overwrite", "unlink"]) {
        const path = root + "/blob";
        fs.writeFileSync(path, "before");
        const blob = await fs.openAsBlob(path);
        if (change === "overwrite") fs.writeFileSync(path, "after");
        else fs.unlinkSync(path);
        try {
          out[change] = { text: await blob.text(), size: blob.size };
        } catch (error) {
          out[change] = {
            name: error.name,
            code: error.code ?? null,
            message: error.message,
          };
        }
        fs.rmSync(path, { force: true });
      }
      fs.writeFileSync(root + "/a", "a");
      fs.writeFileSync(root + "/b", "b");
      const dir = await fs.promises.opendir(root),
        seen = [];
      for await (const entry of dir) {
        seen.push(entry.name);
        break;
      }
      const attempt = async (fn) => {
        try {
          const value = await fn();
          return value?.name ?? value ?? null;
        } catch (error) {
          return {
            name: error.name,
            code: error.code ?? null,
            message: error.message,
          };
        }
      };
      out.early = {
        seen,
        next: await attempt(() => dir.read()),
        close: await attempt(() => dir.close()),
      };
      const concurrent = await fs.promises.opendir(root);
      out.concurrent = (
        await Promise.all([
          concurrent.read(),
          concurrent.read(),
          concurrent.read(),
        ])
      ).map((entry) => entry?.name ?? null);
      await concurrent.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    return out;
  },

  zlibDictionaryStates: async function ({ zlib: z }) {
    const dictionary = new TextEncoder().encode("common-prefix-common-prefix");
    const wrong = new TextEncoder().encode("different");
    const plain = "common-prefix-common-prefix-payload";
    const out = [];
    for (const [encode, decode, Constructor] of [
      ["deflateSync", "inflate", "Inflate"],
      ["deflateRawSync", "inflateRaw", "InflateRaw"],
    ]) {
      const input = z[encode](plain, { dictionary });
      for (const dict of [undefined, wrong, dictionary]) {
        const options = dict === undefined ? {} : { dictionary: dict };
        for (const mode of ["sync", "callback", "info", "stream"]) {
          try {
            let value;
            if (mode === "sync") value = z[decode + "Sync"](input, options);
            else if (mode === "info")
              value = z[decode + "Sync"](input, {
                ...options,
                info: true,
              }).buffer;
            else if (mode === "callback")
              value = await new Promise((resolve, reject) =>
                z[decode](input, options, (error, result) =>
                  error ? reject(error) : resolve(result),
                ),
              );
            else
              value = await new Promise((resolve, reject) => {
                const stream = new z[Constructor](options),
                  chunks = [];
                stream.on("data", (chunk) => chunks.push(...chunk));
                stream.once("error", (error) => {
                  stream.destroy();
                  reject(error);
                });
                stream.once("end", () => resolve(new Uint8Array(chunks)));
                stream.end(input);
              });
            out.push({ decode, mode, text: new TextDecoder().decode(value) });
          } catch (error) {
            out.push({
              decode,
              mode,
              error: {
                name: error.name,
                code: error.code ?? null,
                message: error.message,
              },
            });
          }
        }
      }
    }
    return out;
  },
  zlibUnzipHeaderStates: async function ({ zlib: z }) {
    const out = [];
    for (const method of ["gzipSync", "deflateSync"])
      for (const split of [1, 2])
        for (const truncate of [false, true]) {
          const encoded = z[method]("split-header-payload");
          out.push(
            await new Promise((resolve) => {
              const stream = z.createUnzip(),
                chunks = [];
              stream.on("data", (chunk) => chunks.push(...chunk));
              stream.once("error", (error) => {
                stream.destroy();
                resolve({
                  method,
                  split,
                  truncate,
                  error: {
                    name: error.name,
                    code: error.code ?? null,
                    message: error.message,
                  },
                });
              });
              stream.once("end", () =>
                resolve({
                  method,
                  split,
                  truncate,
                  text: new TextDecoder().decode(new Uint8Array(chunks)),
                }),
              );
              stream.write(encoded.subarray(0, split));
              stream.end(truncate ? undefined : encoded.subarray(split));
            }),
          );
        }
    return out;
  },
  zlibTerminalRaces: async function ({ zlib: z }) {
    const out = [];
    for (const Constructor of ["Deflate", "BrotliCompress", "ZstdCompress"])
      for (const scenario of ["write-destroy", "flush-destroy", "end-write"]) {
        const stream = new z[Constructor](),
          trace = [],
          failure = new Error("controlled-cancel");
        const callback = (name) => (error) =>
          trace.push([name, error?.message ?? null]);
        stream.on("error", callback("error"));
        stream.on("end", () => trace.push(["end", null]));
        stream.on("finish", () => trace.push(["finish", null]));
        const closed = new Promise((resolve) =>
          stream.once("close", () => {
            trace.push(["close", null]);
            resolve();
          }),
        );
        stream.resume();
        if (scenario === "write-destroy") {
          stream.write("payload", callback("write"));
          stream.destroy(failure);
        } else if (scenario === "flush-destroy") {
          stream.write("payload", callback("write"));
          stream.flush(callback("flush"));
          stream.destroy(failure);
        } else {
          stream.end("payload", callback("end-callback"));
          stream.write("late", callback("late-write"));
        }
        await closed;
        await new Promise((resolve) => setTimeout(resolve, 0));
        out.push({
          Constructor,
          scenario,
          trace,
          destroyed: stream.destroyed,
          closed: stream._closed,
        });
      }
    return out;
  },

  zlibFrameBoundaries: async function ({ zlib: z }) {
    const out = {};
    for (const size of [64, 16384, 32769])
      for (const mode of ["valid", "truncated", "concat", "emptybetween"]) {
        const plain = "a".repeat(size),
          v = z.zstdCompressSync(plain),
          input =
            mode === "truncated"
              ? v.subarray(0, v.length - 1)
              : mode === "concat"
                ? new Uint8Array([...v, ...v])
                : v;
        for (const split of [1, 7, input.length]) {
          const key = size + "/" + mode + "/" + split;
          try {
            const n = await new Promise((res, rej) => {
              const s = new z.ZstdDecompress({ chunkSize: 64 });
              let len = 0;
              s.on("data", (v) => (len += v.length));
              s.on("error", rej);
              s.on("end", () => res(len));
              for (let i = 0; i < input.length; i += split) {
                s.write(input.subarray(i, i + split));
                if (mode === "emptybetween") s.write(new Uint8Array(0));
              }
              s.end();
            });
            out[key] = { len: n };
          } catch (e) {
            out[key] = {
              name: e.name,
              message: e.message,
              code: e.code ?? null,
              errno: e.errno ?? null,
            };
          }
        }
      }
    return out;
  },
  zlibDecodeStates: async function ({ zlib: z }) {
    const out = {};
    for (const [decode, encode, ctor] of [
      ["inflate", "deflate", "Inflate"],
      ["gunzip", "gzip", "Gunzip"],
      ["inflateRaw", "deflateRaw", "InflateRaw"],
      ["unzip", "gzip", "Unzip"],
      ["brotliDecompress", "brotliCompress", "BrotliDecompress"],
      ["zstdDecompress", "zstdCompress", "ZstdDecompress"],
    ]) {
      const valid = z[encode + "Sync"]("abcdef");
      const concat = (a, b) => new Uint8Array([...a, ...b]);
      for (const [id, input] of [
        ["empty", new Uint8Array(0)],
        ["garbage", new Uint8Array([97, 98, 99])],
        ["valid", valid],
        ["truncated", valid.subarray(0, valid.length - 1)],
        ["half", valid.subarray(0, Math.floor(valid.length / 2))],
        ["concat", concat(valid, valid)],
        ["trailing", concat(valid, new Uint8Array([97]))],
      ])
        for (const mode of [
          "sync",
          "info",
          "callback",
          "callbackInfo",
          "stream",
        ]) {
          try {
            let v;
            if (mode === "stream")
              v = await new Promise((resolve, reject) => {
                const s = new z[ctor](),
                  chunks = [];
                s.on("data", (c) => chunks.push(...c));
                s.on("error", reject);
                s.on("end", () => resolve(chunks));
                s.end(input);
              });
            else if (mode.startsWith("callback"))
              v = await new Promise((resolve, reject) =>
                z[decode](input, { info: mode === "callbackInfo" }, (e, v) => {
                  if (e) reject(e);
                  else if (mode === "callbackInfo") {
                    resolve(v.buffer);
                    v.engine.close();
                  } else resolve(v);
                }),
              );
            else {
              v = z[decode + "Sync"](input, { info: mode === "info" });
              if (mode === "info") {
                const engine = v.engine;
                v = v.buffer;
                engine.close();
              }
            }
            out[decode + "/" + id + "/" + mode] = {
              ok: true,
              value: Array.from(v),
            };
          } catch (e) {
            out[decode + "/" + id + "/" + mode] = {
              name: e.name,
              message: e.message,
              code: e.code ?? null,
              errno: e.errno ?? null,
            };
          }
        }
    }
    return out;
  },
  zlibCallbackOptions: async function ({ zlib: z }) {
    const out = {};
    for (const method of [
      "deflate",
      "inflate",
      "gzip",
      "gunzip",
      "deflateRaw",
      "inflateRaw",
      "unzip",
      "brotliCompress",
      "brotliDecompress",
      "zstdCompress",
      "zstdDecompress",
    ])
      for (const info of [false, true])
        for (const [id, options] of [
          ["default", {}],
          ["dictionary", { dictionary: "a" }],
          ["flush", { flush: Infinity }],
          ["finishFlush", { finishFlush: -1 }],
          ["chunkSize", { chunkSize: -1 }],
          ["params", { params: { 0: 2147483648 } }],
        ]) {
          let stage = "call";
          let calls = 0;
          const result = await new Promise((resolve) => {
            try {
              z[method]("abc", { ...options, info }, (error, value) => {
                calls++;
                if (error)
                  resolve({
                    stage,
                    name: error.name,
                    message: error.message,
                    code: error.code ?? null,
                  });
                else {
                  resolve({
                    stage,
                    ok: true,
                    length: (info ? value.buffer : value).length,
                    engine: info ? value.engine.constructor.name : null,
                  });
                  if (info) value.engine.close();
                }
              });
              stage = "returned";
            } catch (e) {
              resolve({
                stage,
                name: e.name,
                message: e.message,
                code: e.code ?? null,
              });
            }
          });
          await Promise.resolve();
          out[method + "/" + info + "/" + id] = { ...result, calls };
        }
    return out;
  },
  zlibBufferLifetimes: function ({ zlib: z }) {
    const out = {};
    for (const [encode, decode] of [
      ["deflateSync", "inflateSync"],
      ["brotliCompressSync", "brotliDecompressSync"],
      ["zstdCompressSync", "zstdDecompressSync"],
    ])
      for (const form of ["buffer", "typed", "data"])
        for (const mode of [
          "mutate",
          "detach",
          "shrink",
          "grow",
          "dictionaryMutate",
        ]) {
          const buffer = new ArrayBuffer(3, { maxByteLength: 6 });
          const view = new Uint8Array(buffer);
          view.set([97, 98, 99]);
          const input =
            form === "buffer"
              ? buffer
              : form === "data"
                ? new DataView(buffer)
                : view;
          const dictionary = new Uint8Array([97, 98, 99]);
          const options = {
            dictionary,
            get maxOutputLength() {
              if (mode === "mutate") view[0] = 120;
              if (mode === "detach")
                structuredClone(buffer, { transfer: [buffer] });
              if (mode === "shrink") buffer.resize(1);
              if (mode === "grow") buffer.resize(6);
              if (mode === "dictionaryMutate") dictionary[0] = 120;
              return 1000;
            },
          };
          try {
            const compressed = z[encode](input, options);
            out[encode + "/" + form + "/" + mode] = Array.from(
              z[decode](compressed, { dictionary }),
            );
          } catch (error) {
            out[encode + "/" + form + "/" + mode] = {
              name: error.name,
              message: error.message,
              code: error.code ?? null,
            };
          }
        }
    return out;
  },
  zlibFastOptions: function ({ zlib: z }) {
    const out = {};
    const attempt = (id, fn) => {
      try {
        const v = fn();
        out[id] = { ok: true, type: typeof v, length: v?.length };
      } catch (e) {
        out[id] = { name: e.name, message: e.message, code: e.code ?? null };
      }
    };
    for (const method of [
      "deflateSync",
      "inflateSync",
      "gzipSync",
      "gunzipSync",
      "deflateRawSync",
      "inflateRawSync",
      "unzipSync",
      "brotliCompressSync",
      "brotliDecompressSync",
      "zstdCompressSync",
      "zstdDecompressSync",
    ]) {
      for (const [id, value] of [
        ["string", "a"],
        ["buffer", new Uint8Array([1])],
        ["number", 1],
        ["null", null],
      ])
        attempt(method + "/dictionary/" + id, () =>
          z[method]("abc", { dictionary: value }),
        );
      for (const key of [
        "flush",
        "finishFlush",
        "chunkSize",
        "windowBits",
        "level",
        "memLevel",
        "strategy",
        "maxOutputLength",
      ])
        for (const value of [-1, 0, 1.5, Infinity, "1", null])
          attempt(method + "/" + key + "/" + String(value), () =>
            z[method]("abc", { [key]: value }),
          );
    }
    return out;
  },
  zlibNumericOptions: function ({ zlib: z }) {
    const out = {};
    const attempt = (id, fn) => {
      try {
        const v = fn();
        out[id] = { ok: true, type: typeof v, length: v?.length };
      } catch (e) {
        out[id] = { name: e.name, message: e.message, code: e.code ?? null };
      }
    };
    for (const method of [
      "deflateSync",
      "inflateSync",
      "gzipSync",
      "gunzipSync",
      "deflateRawSync",
      "inflateRawSync",
      "unzipSync",
      "brotliCompressSync",
      "brotliDecompressSync",
      "zstdCompressSync",
      "zstdDecompressSync",
    ]) {
      for (const [id, value] of [
        ["string", "a"],
        ["buffer", new Uint8Array([1])],
        ["number", 1],
        ["null", null],
      ])
        attempt(method + "/dictionary/" + id, () =>
          z[method]("abc", { dictionary: value }),
        );
      for (const key of [
        "flush",
        "finishFlush",
        "chunkSize",
        "windowBits",
        "level",
        "memLevel",
        "strategy",
        "maxOutputLength",
      ])
        for (const value of [
          -0.5,
          NaN,
          -Infinity,
          4294967295,
          4294967296,
          2147483648,
          BigInt(1),
        ])
          attempt(method + "/" + key + "/" + String(value), () =>
            z[method]("abc", { [key]: value }),
          );
    }
    return out;
  },
  zlibOptionOrder: function ({ zlib: z }) {
    const out = {};
    for (const method of [
      "deflateSync",
      "inflateSync",
      "gzipSync",
      "gunzipSync",
      "deflateRawSync",
      "inflateRawSync",
      "unzipSync",
      "brotliCompressSync",
      "brotliDecompressSync",
      "zstdCompressSync",
      "zstdDecompressSync",
    ])
      for (const mode of ["default", "params", "mutate", "dictionary"]) {
        const log = [];
        const input = new Uint8Array([97, 98, 99]);
        const value =
          mode === "params"
            ? {
                params: new Proxy(
                  {},
                  {
                    ownKeys(t) {
                      log.push("params.ownKeys");
                      return Reflect.ownKeys(t);
                    },
                    get(t, p, r) {
                      log.push("params." + String(p));
                      return Reflect.get(t, p, r);
                    },
                  },
                ),
              }
            : mode === "dictionary"
              ? { dictionary: new Uint8Array([97]) }
              : {};
        const options = new Proxy(value, {
          get(t, p, r) {
            log.push(String(p));
            if (mode === "mutate" && p === "chunkSize") input[0] = 120;
            return Reflect.get(t, p, r);
          },
        });
        try {
          const v = z[method](input, options);
          out[method + "/" + mode] = {
            value: Array.from(
              {
                deflateSync: "inflateSync",
                gzipSync: "gunzipSync",
                deflateRawSync: "inflateRawSync",
                brotliCompressSync: "brotliDecompressSync",
                zstdCompressSync: "zstdDecompressSync",
              }[method]
                ? z[
                    {
                      deflateSync: "inflateSync",
                      gzipSync: "gunzipSync",
                      deflateRawSync: "inflateRawSync",
                      brotliCompressSync: "brotliDecompressSync",
                      zstdCompressSync: "zstdDecompressSync",
                    }[method]
                  ](
                    v,
                    mode === "dictionary"
                      ? { dictionary: new Uint8Array([97]) }
                      : {},
                  )
                : v,
            ),
            log,
          };
        } catch (e) {
          out[method + "/" + mode] = {
            name: e.name,
            message: e.message,
            code: e.code ?? null,
            log,
          };
        }
      }
    return out;
  },
  httpUniqueHeaders: async function ({ http: h, cloudflareNode: n }) {
    const result = {};
    for (const uniqueHeaders of [
      undefined,
      [],
      ["X-List", ["Set-Cookie"]],
      "x-list",
      [1],
    ]) {
      let server;
      const id = JSON.stringify(uniqueHeaders) ?? "undefined";
      try {
        server = h.createServer({ uniqueHeaders }, (_req, res) => {
          res.setHeader("x-list", ["a", "b"]);
          res.setHeader("cookie", ["a=1", "b=2"]);
          res.setHeader("set-cookie", ["a=1", "b=2"]);
          res.end("body");
        });
        const response = await n
          .httpServerHandler(server)
          .fetch(new Request("https://test/"));
        result[id] = {
          list: response.headers.get("x-list"),
          cookie: response.headers.get("cookie"),
          cookies: response.headers.getSetCookie(),
          body: await response.text(),
        };
      } catch (error) {
        result[id] = {
          name: error.name,
          code: error.code ?? null,
          // Native TypeError wording differs between JavaScriptCore and V8.
          invalidHeaderMethod: error.message.includes("toLowerCase"),
        };
      } finally {
        server?.close();
      }
    }
    return result;
  },
  httpOptionValidation: function ({ http: h }) {
    const out = {};
    const attempt = (id, fn) => {
      try {
        const v = fn();
        out[id] = {
          ok: true,
          requestTimeout: v.requestTimeout,
          headersTimeout: v.headersTimeout,
          highWaterMark: v.highWaterMark,
          maxTotalSockets: v.maxTotalSockets,
          scheduling: v.scheduling,
        };
      } catch (e) {
        out[id] = { name: e.name, message: e.message, code: e.code ?? null };
      }
    };
    const values = [
      undefined,
      null,
      false,
      true,
      -1,
      0,
      1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      {},
    ];
    for (const field of [
      "maxHeaderSize",
      "insecureHTTPParser",
      "requestTimeout",
      "headersTimeout",
      "keepAliveTimeout",
      "keepAliveTimeoutBuffer",
      "connectionsCheckingInterval",
      "requireHostHeader",
      "joinDuplicateHeaders",
      "rejectNonStandardBodyWrites",
      "highWaterMark",
    ])
      for (let i = 0; i < values.length; i++)
        attempt(`server/${field}/${i}`, () =>
          h.createServer({ [field]: values[i] }),
        );
    for (const field of [
      "scheduling",
      "maxTotalSockets",
      "maxSockets",
      "maxFreeSockets",
      "keepAlive",
      "keepAliveMsecs",
    ])
      for (let i = 0; i < values.length; i++)
        attempt(
          `agent/${field}/${i}`,
          () => new h.Agent({ [field]: values[i] }),
        );
    for (const kind of ["server", "agent"])
      for (const mode of ["defaults", "all", "invalid"]) {
        const log = [];
        const options = new Proxy(
          mode === "defaults"
            ? {}
            : {
                requestTimeout: 1000,
                headersTimeout: mode === "invalid" ? 2000 : 500,
                joinDuplicateHeaders: false,
                maxTotalSockets: 2,
              },
          {
            get(t, p, r) {
              if (typeof p === "string") log.push(p);
              return Reflect.get(t, p, r);
            },
            ownKeys(t) {
              log.push("ownKeys");
              return Reflect.ownKeys(t);
            },
          },
        );
        attempt(`getter/${kind}/${mode}`, () =>
          kind === "server" ? h.createServer(options) : new h.Agent(options),
        );
        out[`getter/${kind}/${mode}`].log = log;
      }
    return out;
  },
  cryptoKdfInputLifetime: async function ({ crypto: c }) {
    const result = {};
    const run = (method, callback, key, salt, info) => {
      const args =
        method === "hkdf"
          ? ["sha256", key, salt, info, 8]
          : method === "scrypt"
            ? [key, salt, 8, { N: 16, r: 1, p: 1 }]
            : [key, salt, 2, 8, "sha256"];
      return callback
        ? new Promise((resolve, reject) =>
            c[method](...args, (error, value) =>
              error ? reject(error) : resolve(value),
            ),
          )
        : c[method + "Sync"](...args);
    };
    const serialize = (value) =>
      Array.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    for (const method of ["hkdf", "scrypt", "pbkdf2"])
      for (const callback of [false, true])
        for (const field of method === "hkdf"
          ? ["key", "salt", "info"]
          : ["key", "salt"])
          for (const mode of ["detachedBuffer", "detachedView"]) {
            const values = {
              key: new Uint8Array([1]),
              salt: new Uint8Array([2]),
              info: new Uint8Array([3]),
            };
            const buffer = values[field].buffer;
            if (mode === "detachedBuffer") values[field] = buffer;
            structuredClone(buffer, { transfer: [buffer] });
            try {
              result[`${method}/${callback}/${field}/${mode}`] = serialize(
                await run(
                  method,
                  callback,
                  values.key,
                  values.salt,
                  values.info,
                ),
              );
            } catch (error) {
              result[`${method}/${callback}/${field}/${mode}`] = {
                name: error.name,
                code: error.code ?? null,
                message: error.message,
              };
            }
          }
    for (const field of ["key", "salt"])
      for (const mode of ["mutate", "detach"])
        for (const callback of [false, true]) {
          const values = {
            key: new Uint8Array([1]),
            salt: new Uint8Array([2]),
            info: new Uint8Array([3]),
          };
          let reads = 0;
          Object.defineProperty(values.info, "byteLength", {
            get() {
              reads++;
              if (mode === "mutate") values[field][0] = 9;
              else
                structuredClone(values[field].buffer, {
                  transfer: [values[field].buffer],
                });
              return 1;
            },
          });
          try {
            result[`hkdfGetter/${field}/${mode}/${callback}`] = {
              bytes: serialize(
                await run(
                  "hkdf",
                  callback,
                  values.key,
                  values.salt,
                  values.info,
                ),
              ),
              reads,
            };
          } catch (error) {
            result[`hkdfGetter/${field}/${mode}/${callback}`] = {
              name: error.name,
              code: error.code ?? null,
              message: error.message,
              reads,
            };
          }
        }
    for (const digest of [
      "SHA256",
      "DSA-SHA",
      "sha256\0junk",
      "sha3-256",
      "bad\0x",
      "bad\nx",
    ]) {
      try {
        result["pbkdfDigest/" + digest] = serialize(
          c.pbkdf2Sync("k", "s", 2, 8, digest),
        );
      } catch (error) {
        result["pbkdfDigest/" + digest] = {
          name: error.name,
          code: error.code ?? null,
          message: error.message,
        };
      }
    }
    return result;
  },
  cryptoX509InputViews: function ({ crypto: c }) {
    const pem =
      "-----BEGIN CERTIFICATE-----\nMIID6DCCAtCgAwIBAgIUFH02wcL3Qgben6tfIibXitsApCYwDQYJKoZIhvcNAQEL\nBQAwejELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMQswCQYDVQQHDAJTRjEPMA0G\nA1UECgwGSm95ZW50MRAwDgYDVQQLDAdOb2RlLmpzMQwwCgYDVQQDDANjYTExIDAe\nBgkqhkiG9w0BCQEWEXJ5QHRpbnljbG91ZHMub3JnMCAXDTIyMDkwMzIxNDAzN1oY\nDzIyOTYwNjE3MjE0MDM3WjB9MQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0ExCzAJ\nBgNVBAcMAlNGMQ8wDQYDVQQKDAZKb3llbnQxEDAOBgNVBAsMB05vZGUuanMxDzAN\nBgNVBAMMBmFnZW50MTEgMB4GCSqGSIb3DQEJARYRcnlAdGlueWNsb3Vkcy5vcmcw\nggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDUVjIK+yDTgnCT3CxChO0E\n37q9VuHdrlKeKLeQzUJW2yczSfNzX/0zfHpjY+zKWie39z3HCJqWxtiG2wxiOI8c\n3WqWOvzVmdWADlh6EfkIlg+E7VC6JaKDA+zabmhPvnuu3JzogBMnsWl68lCXzuPx\ndeQAmEwNtqjrh74DtM+Ud0ulb//Ixjxo1q3rYKu+aaexSramuee6qJta2rjrB4l8\nB/bU+j1mDf9XQQfSjo9jRnp4hiTFdBl2k+lZzqE2L/rhu6EMjA2IhAq/7xA2MbLo\n9cObVUin6lfoo5+JKRgT9Fp2xEgDOit+2EA/S6oUfPNeLSVUqmXOSWlXlwlb9Nxr\nAgMBAAGjYTBfMF0GCCsGAQUFBwEBBFEwTzAjBggrBgEFBQcwAYYXaHR0cDovL29j\nc3Aubm9kZWpzLm9yZy8wKAYIKwYBBQUHMAKGHGh0dHA6Ly9jYS5ub2RlanMub3Jn\nL2NhLmNlcnQwDQYJKoZIhvcNAQELBQADggEBAMM0mBBjLMt9pYXePtUeNO0VTw9y\nFWCM8nAcAO2kRNwkJwcsispNpkcsHZ5o8Xf5mpCotdvziEWG1hyxwU6nAWyNOLcN\nG0a0KUfbMO3B6ZYe1GwPDjXaQnv75SkAdxgX5zOzca3xnhITcjUUGjQ0fbDfwFV5\nix8mnzvfXjDONdEznVa7PFcN6QliFUMwR/h8pCRHtE5+a10OSPeJSrGG+FtrGnRW\nG1IJUv6oiGF/MvWCr84REVgc1j78xomGANJIu2hN7bnD1nEMON6em8IfnDOUtynV\n9wfWTqiQYD5Zifj6WcGa0aAHMuetyFG4lIfMAHmd3gaKpks7j9l26LwRPvI=\n-----END CERTIFICATE-----\n";
    const out = {},
      original = new c.X509Certificate(pem).raw;
    for (const kind of ["typed", "data"])
      for (const property of [
        "buffer",
        "byteOffset",
        "byteLength",
        "detached",
      ]) {
        const bytes = new Uint8Array(original.length + 2);
        bytes.set(original, 1);
        const view =
          kind === "typed"
            ? new Uint8Array(bytes.buffer, 1, original.length)
            : new DataView(bytes.buffer, 1, original.length);
        if (property === "detached")
          structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
        else
          Object.defineProperty(view, property, {
            get() {
              throw Error("shadow " + property);
            },
          });
        try {
          const cert = new c.X509Certificate(view);
          out[kind + "/" + property] = {
            fingerprint: cert.fingerprint256,
            subject: cert.subject,
          };
        } catch (e) {
          out[kind + "/" + property] = {
            name: e.name,
            // inspect embeds the host's intrinsic stack; retain its category and
            // failed property while excluding engine-specific stack text.
            message:
              kind === "data" && property === "detached"
                ? {
                    inspectionByteLengthFailure: String(e.message).includes(
                      "byteLength",
                    ),
                  }
                : e.message,
            code: e.code ?? null,
          };
        }
      }
    return out;
  },
  cryptoKdfInputViews: function ({ crypto: c }) {
    const result = {};
    for (const operation of [
      "pbkdfPassword",
      "pbkdfSalt",
      "scryptPassword",
      "scryptSalt",
      "hkdfKey",
      "hkdfSalt",
      "hkdfInfo",
    ])
      for (const type of ["buffer", "typed", "data"])
        for (const property of ["buffer", "byteOffset", "byteLength"]) {
          const buffer = new Uint8Array([8, 1, 9]),
            value =
              type === "buffer"
                ? buffer.buffer
                : type === "typed"
                  ? new Uint8Array(buffer.buffer, 1, 1)
                  : new DataView(buffer.buffer, 1, 1);
          Object.defineProperty(value, property, {
            get() {
              throw Error("shadow " + property);
            },
          });
          try {
            let out;
            if (operation.startsWith("pbkdf"))
              out = c.pbkdf2Sync(
                operation === "pbkdfPassword" ? value : "p",
                operation === "pbkdfSalt" ? value : "s",
                2,
                8,
                "sha256",
              );
            if (operation.startsWith("scrypt"))
              out = c.scryptSync(
                operation === "scryptPassword" ? value : "p",
                operation === "scryptSalt" ? value : "s",
                8,
                { N: 16, r: 1, p: 1 },
              );
            if (operation.startsWith("hkdf"))
              out = c.hkdfSync(
                "sha256",
                operation === "hkdfKey" ? value : "p",
                operation === "hkdfSalt" ? value : "s",
                operation === "hkdfInfo" ? value : "i",
                8,
              );
            result[`${operation}/${type}/${property}`] = Array.from(
              out instanceof ArrayBuffer ? new Uint8Array(out) : out,
            );
          } catch (e) {
            result[`${operation}/${type}/${property}`] = {
              name: e.name,
              message: e.message,
              code: e.code ?? null,
            };
          }
        }
    for (const digest of ["SHA256", "DSA-SHA", "sha256\0junk", "sha3-256"])
      try {
        result["hkdf/" + digest] = Array.from(
          new Uint8Array(c.hkdfSync(digest, "k", "s", "i", 8)),
        );
      } catch (e) {
        result["hkdf/" + digest] = {
          name: e.name,
          message: e.message,
          code: e.code ?? null,
        };
      }
    return result;
  },
  cryptoKeyDetailsShape: async function ({ crypto: c }) {
    const result = {};
    const record = (name, key) => {
      const detail = key.asymmetricKeyDetails;
      result[name] = Reflect.ownKeys(detail).map((name) => {
        const d = Object.getOwnPropertyDescriptor(detail, name);
        return {
          name: String(name),
          value:
            d.value === undefined
              ? "undefined"
              : typeof d.value === "bigint"
                ? d.value.toString()
                : d.value,
          enumerable: d.enumerable,
          writable: d.writable,
          configurable: d.configurable,
        };
      });
    };
    for (const [algorithm, options] of [
      ["rsa", { modulusLength: 1024 }],
      ["ec", { namedCurve: "prime256v1" }],
      ["ed25519", {}],
      ["x25519", {}],
      ["dh", { group: "modp14" }],
    ]) {
      const pair = c.generateKeyPairSync(algorithm, options);
      for (const kind of ["privateKey", "publicKey"])
        record(`${algorithm}/${kind}`, pair[kind]);
    }
    // Pinned Workers rejects DSA generation; import its public upstream fixture.
    const dsa = c.createPrivateKey(
      "-----BEGIN DSA PRIVATE KEY-----\nMIIB0gIBAAKBiQDp3xGIsNcKZWSpur2Ab2f5rirhu5AsYGLI/XZvzueoO4kLPp3s\nzKHXabBObdxU07kRFkfpV9lftdXT3a6E/Wxb+w2d7g0F7pWTdwpmmofcRtwgbynm\nJKvqWt/OwfVFsdUvvpVci9AxY/5rdM/K54Srp6iSpfteBYKGqCpPnswikND0GxKM\n1MbzAhUAqAPKCZ4hxromirUu33tn3Nhsq20CgYgf0tH2nwzWlPLoN4OJvC5dVLPv\nMRyJTQekW8tR0oY6PeshmZOaoI0L3e/M4KeZ/4qiY7IRNksP2YGJxjfS6W+h+MNj\nPO5r0aYYFYCPQ8JbhBO7l0hdXmkTY3FcdyRHeh2gwe3bBX6Auev2MGgL616Cgd/K\nH8PAX9EHmrNPcQOWHem4KcfJXqouAoGIcZ/4bJurOAw5OL4+5BsE4jfSVFq4nmNl\n+m6Iy6ls3hOHOZ9sJlw0Fi+ZtdeddOTYnIngW/kH09XGoF5JJOaLQv2O4GmZfDfn\nla+vfHZPsOxmYqeEbSwA2pqlhOn/dCshBOymhwNLXp1FJ3JUEyh8i605X06XmWoj\n4ZIu/tr1xbnZDLHuFjBmXAIURbB5/IDf2h0sW+qL5gHFO8bgr+E=\n-----END DSA PRIVATE KEY-----\n",
    );
    record("dsa/privateKey", dsa);
    record("dsa/publicKey", c.createPublicKey(dsa));
    for (const algorithm of [
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      { name: "ECDSA", namedCurve: "P-384" },
      { name: "ECDH", namedCurve: "P-256" },
    ]) {
      const pair = await c.subtle.generateKey(
        algorithm,
        true,
        algorithm.name === "ECDH" ? ["deriveBits"] : ["sign", "verify"],
      );
      for (const kind of ["privateKey", "publicKey"])
        record(`host/${algorithm.name}/${kind}`, c.KeyObject.from(pair[kind]));
    }
    return result;
  },
  cryptoExportSurface: function ({ crypto: c }) {
    const descriptor = Object.getOwnPropertyDescriptor(c.default, "fips");
    let setter;
    try {
      c.default.fips = false;
      setter = "success";
    } catch (error) {
      setter = {
        name: error.name,
        code: error.code ?? null,
        message: error.message,
      };
    }
    return {
      named: Object.keys(c).sort(),
      default: Object.keys(c.default).sort(),
      fips: {
        namedType: typeof c.fips,
        getterType: typeof c.getFips,
        descriptor: {
          get: typeof descriptor?.get,
          set: typeof descriptor?.set,
          enumerable: descriptor?.enumerable,
          configurable: descriptor?.configurable,
        },
        internallyConsistent:
          c.fips === c.getFips() && c.default.fips === c.getFips(),
        setter,
      },
    };
  },
  cryptoKeyInspection: function ({ crypto: c, util }) {
    const pair = c.generateKeyPairSync("rsa", { modulusLength: 1024 });
    const result = {};
    const symbol = Symbol.for("nodejs.util.inspect.custom");
    for (const [name, key] of Object.entries({
      secret: c.createSecretKey("key"),
      private: pair.privateKey,
      public: pair.publicKey,
    })) {
      const prototypes = [];
      let proto = Object.getPrototypeOf(key);
      while (proto !== Object.prototype) {
        prototypes.push(
          Reflect.ownKeys(proto).map((name) => {
            const d = Object.getOwnPropertyDescriptor(proto, name);
            return {
              name: String(name),
              enumerable: d.enumerable,
              configurable: d.configurable,
              writable: d.writable,
              valueType: typeof d.value,
              length:
                typeof d.value === "function" ? d.value.length : undefined,
              get: typeof d.get,
              set: typeof d.set,
            };
          }),
        );
        proto = Object.getPrototypeOf(proto);
      }
      const inspections = [];
      for (const depth of [-1, 0, 1, 2]) {
        const output = key[symbol](depth, { depth });
        inspections.push({
          direct: output === key ? "same-key" : output,
          inspect: util.inspect(key, { depth }),
        });
      }
      result[name] = { prototypes, inspections };
    }
    return result;
  },
  cryptoSubtleDigestViews: async function ({ crypto: c }) {
    const result = {};
    for (const algorithm of ["SHA-1", "SHA-256", "SHA-384", "SHA-512", "MD5"]) {
      for (const mode of [
        "buffer",
        "typed",
        "data",
        "shadow",
        "detached",
        "snapshot",
        "algorithmGetter",
      ]) {
        const backing = new Uint8Array([8, 1, 9]);
        let input =
          mode === "buffer"
            ? backing.buffer
            : mode === "data"
              ? new DataView(backing.buffer, 1, 1)
              : new Uint8Array(backing.buffer, 1, 1);
        const log = [];
        if (mode === "shadow")
          for (const field of ["buffer", "byteOffset", "byteLength"])
            Object.defineProperty(input, field, {
              get() {
                throw new Error("shadow " + field);
              },
            });
        if (mode === "detached")
          structuredClone(backing.buffer, { transfer: [backing.buffer] });
        const name =
          mode === "algorithmGetter"
            ? {
                get name() {
                  log.push("name");
                  structuredClone(backing.buffer, {
                    transfer: [backing.buffer],
                  });
                  return {
                    toString() {
                      log.push("string");
                      return algorithm;
                    },
                  };
                },
              }
            : algorithm;
        try {
          const pending = c.subtle.digest(name, input);
          if (mode === "snapshot") backing.fill(7);
          result[`${algorithm}/${mode}`] = {
            bytes: Array.from(new Uint8Array(await pending)),
            log,
          };
        } catch (error) {
          result[`${algorithm}/${mode}`] = {
            name: error.name,
            message: error.message,
            log,
          };
        }
      }
    }
    return result;
  },
  cryptoSubtleDigest: async function ({ crypto: c }) {
    const subtle = c.subtle;
    const result = {
      surface: {
        length: subtle.digest.length,
        keys: Reflect.ownKeys(subtle.digest),
      },
    };
    try {
      const f = subtle.digest;
      new f();
      result.constructor = "success";
    } catch (error) {
      result.constructor = { name: error.name };
    }
    const cases = [
      ["md5", "MD5"],
      ["case", "md5"],
      ["sha", "SHA-256"],
      ["nul", "MD5\0junk"],
      ["alias", "sha256"],
      ["missing", "missing"],
      ["undefined", undefined],
      ["null", null],
      ["number", 1],
      ["symbol", Symbol("x")],
      ["empty", {}],
      ["nullName", { name: null }],
      ["numberName", { name: 1 }],
      ["undefinedName", { name: undefined }],
      ["symbolName", { name: Symbol("x") }],
      ["array", ["MD5"]],
      ["stringObject", new String("MD5")],
      ["dictionary", { name: "MD5" }],
    ];
    for (const [name, algorithm] of cases) {
      let stage = "call";
      try {
        const p = subtle.digest(algorithm, new Uint8Array([1]));
        stage = "await";
        result[name] = {
          hex: Array.from(new Uint8Array(await p)),
          promise: p instanceof Promise,
        };
      } catch (e) {
        result[name] = {
          stage,
          name: e.name,
          message: e.message,
          code: e.code ?? null,
        };
      }
    }
    for (const [name, data] of [
      ["none", undefined],
      ["null", null],
      ["fake", {}],
      ["view", new Uint8Array([1])],
      ["buffer", new Uint8Array([1]).buffer],
    ]) {
      let stage = "call";
      try {
        const p = subtle.digest("MD5", data);
        stage = "await";
        result["data/" + name] = Array.from(new Uint8Array(await p));
      } catch (e) {
        result["data/" + name] = {
          stage,
          name: e.name,
          message: e.message,
          code: e.code ?? null,
        };
      }
    }
    let stage = "call";
    try {
      const p = subtle.digest.call({}, "MD5", new Uint8Array());
      stage = "await";
      await p;
      result.receiver = "success";
    } catch (e) {
      result.receiver = {
        stage,
        name: e.name,
        message: e.message,
        code: e.code ?? null,
      };
    }
    return result;
  },
  cryptoKeyExportRoundTrips: function ({ crypto: c }) {
    const result = {};
    for (const algorithm of ["rsa", "ec", "ed25519", "x25519"])
      for (const encoding of algorithm === "ec"
        ? ["default", "named", "explicit"]
        : ["default"]) {
        const pair = c.generateKeyPairSync(
          algorithm,
          algorithm === "rsa"
            ? { modulusLength: 1024 }
            : algorithm === "ec"
              ? {
                  namedCurve: "prime256v1",
                  ...(encoding === "default"
                    ? {}
                    : { paramEncoding: encoding }),
                }
              : {},
        );
        for (const kind of ["private", "public"])
          for (const format of ["pem", "der"])
            for (const type of kind === "public"
              ? algorithm === "rsa"
                ? ["pkcs1", "spki"]
                : ["spki"]
              : algorithm === "rsa"
                ? ["pkcs1", "pkcs8"]
                : algorithm === "ec"
                  ? ["sec1", "pkcs8"]
                  : ["pkcs8"])
              for (const cipher of [undefined, "aes-256-cbc", "des-ede3-cbc"]) {
                const name = `${algorithm}/${encoding}/${kind}/${format}/${type}/${cipher}`;
                try {
                  const key = pair[kind + "Key"];
                  const password =
                    cipher !== undefined && kind === "private"
                      ? { passphrase: "pass\0wordé" }
                      : {};
                  const exported = key.export({
                    format,
                    type,
                    cipher,
                    ...password,
                  });
                  const imported = c[
                    kind === "private" ? "createPrivateKey" : "createPublicKey"
                  ]({ key: exported, format, type, ...password });
                  const raw = imported.export({ format: "der", type });
                  const original = key.export({ format: "der", type });
                  result[name] = {
                    ...(algorithm === "ec"
                      ? {
                          originalLength: original.length,
                          importedLength: raw.length,
                        }
                      : {}),
                    equal: imported.equals(key),
                    publicEqual: (kind === "private"
                      ? c.createPublicKey(imported)
                      : imported
                    ).equals(pair.publicKey),
                  };
                } catch (error) {
                  result[name] = {
                    name: error.name,
                    code: error.code ?? null,
                    message: error.message,
                  };
                }
              }
      }
    return result;
  },
  cryptoKeyExportDictionary: function ({ crypto: c }) {
    const pair = c.generateKeyPairSync("rsa", { modulusLength: 1024 }),
      result = {};
    for (const kind of ["public", "private"])
      for (const format of ["jwk", "pem"])
        for (const field of ["type", "format", "cipher", "passphrase"])
          for (const mode of ["trace", "null", "number", "object", "throw"]) {
            const log = [],
              options = {};
            for (const prop of ["type", "format", "cipher", "passphrase"])
              Object.defineProperty(options, prop, {
                enumerable: true,
                configurable: true,
                get() {
                  log.push(prop);
                  if (prop === field) {
                    if (mode === "throw") throw Error("getter " + prop);
                    if (mode === "null") return null;
                    if (mode === "number") return 1;
                    if (mode === "object")
                      return {
                        toString() {
                          log.push("toString " + prop);
                          return prop === "type"
                            ? kind === "private"
                              ? "pkcs8"
                              : "spki"
                            : prop === "format"
                              ? format
                              : "aes-256-cbc";
                        },
                      };
                  }
                  return prop === "type"
                    ? kind === "private"
                      ? "pkcs8"
                      : "spki"
                    : prop === "format"
                      ? format
                      : undefined;
                },
                set(v) {
                  log.push("set " + prop);
                  Object.defineProperty(options, prop, {
                    value: v,
                    writable: true,
                    enumerable: true,
                    configurable: true,
                  });
                },
              });
            let output;
            try {
              const value = pair[kind + "Key"].export(options);
              output =
                typeof value === "string" ? "pem" : (value.kty ?? "buffer");
            } catch (e) {
              output = {
                name: e.name,
                code: e.code ?? null,
                message: e.message,
              };
            }
            result[`${kind}/${format}/${field}/${mode}`] = { log, output };
          }
    return result;
  },
  cryptoKeyExportFormats: function ({ crypto: c }) {
    const result = {};
    const pairs = {
      rsa: c.generateKeyPairSync("rsa", { modulusLength: 1024 }),
      ec: c.generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
      ed25519: c.generateKeyPairSync("ed25519"),
    };
    const run = (name, key, options) => {
      try {
        const v = key.export(options);
        result[name] =
          typeof v === "string"
            ? "pem"
            : v instanceof Uint8Array
              ? "der"
              : (v.kty ?? "object");
      } catch (e) {
        result[name] = {
          name: e.name,
          message: e.message,
          code: e.code ?? null,
        };
      }
    };
    for (const [algorithm, pair] of Object.entries(pairs))
      for (const kind of ["public", "private"]) {
        const key = pair[kind + "Key"];
        for (const format of [undefined, "buffer", "pem", "der", "jwk", "wat"])
          for (const type of [
            undefined,
            "pkcs1",
            "pkcs8",
            "sec1",
            "spki",
            "nope",
          ])
            run(`${algorithm}/${kind}/${format}/${type}`, key, {
              format,
              type,
            });
        for (const cipher of [
          "not-cipher",
          "aes-256-cbc",
          "aes-256-gcm",
          "aes-256-ctr",
          "chacha20-poly1305",
          "AES-256-CBC",
          "aes-256-cbc\0junk",
          "des-ede3-cbc",
        ])
          run(`${algorithm}/${kind}/cipher/${cipher}`, key, {
            format: "pem",
            type: kind === "private" ? "pkcs8" : "spki",
            cipher,
            passphrase: "password",
          });
      }
    return result;
  },
  cryptoPrimeBrands: function ({ crypto: c }) {
    const result = {};
    for (const operation of ["check", "add", "rem"]) {
      for (const kind of [
        "fake",
        "taggedBuffer",
        "taggedView",
        "taggedDataView",
      ]) {
        const bytes = new Uint8Array([
          operation === "check" ? 3 : operation === "add" ? 12 : 11,
        ]);
        const value =
          kind === "fake"
            ? { [Symbol.toStringTag]: "ArrayBuffer" }
            : kind === "taggedBuffer"
              ? bytes.buffer
              : kind === "taggedDataView"
                ? new DataView(bytes.buffer)
                : bytes;
        if (kind !== "fake")
          Object.defineProperty(value, Symbol.toStringTag, { value: "Fake" });
        try {
          const output =
            operation === "check"
              ? c.checkPrimeSync(value)
              : c.generatePrimeSync(8, {
                  bigint: true,
                  add: operation === "add" ? value : 12n,
                  rem: operation === "rem" ? value : 11n,
                });
          result[`${operation}/${kind}`] =
            typeof output === "bigint" ? output % 12n === 11n : output;
        } catch (error) {
          result[`${operation}/${kind}`] = {
            name: error.name,
            code: error.code ?? null,
            message: error.message,
          };
        }
      }
    }
    return result;
  },
  cryptoCipherInputViews: function ({ crypto: c }) {
    const result = {};
    for (const operation of [
      "secretKey",
      "cipherKey",
      "iv",
      "aad",
      "tag",
      "primeAdd",
    ]) {
      for (const type of ["typed", "data"]) {
        for (const property of ["buffer", "byteOffset", "byteLength"]) {
          const view = (input) => {
            const bytes = new Uint8Array(input.length + 2);
            bytes.set(input, 1);
            const value =
              type === "typed"
                ? new Uint8Array(bytes.buffer, 1, input.length)
                : new DataView(bytes.buffer, 1, input.length);
            Object.defineProperty(value, property, {
              get() {
                throw new Error("shadow " + property);
              },
            });
            return value;
          };
          const name = `${operation}/${type}/${property}`;
          try {
            let key = new Uint8Array(16),
              iv = new Uint8Array(12);
            if (operation === "secretKey") {
              result[name] = Array.from(c.createSecretKey(view(key)).export());
              continue;
            }
            if (operation === "primeAdd") {
              const prime = c.generatePrimeSync(8, {
                add: view([12]),
                rem: view([11]),
                bigint: true,
              });
              result[name] = prime % 12n === 11n;
              continue;
            }
            if (operation === "cipherKey") key = view(key);
            if (operation === "iv") iv = view(iv);
            const enc = c.createCipheriv("aes-128-gcm", key, iv);
            enc.setAAD(operation === "aad" ? view([3]) : new Uint8Array([3]));
            const encrypted = enc.update("abc", "utf8");
            enc.final();
            const tag = enc.getAuthTag();
            const dec = c.createDecipheriv("aes-128-gcm", key, iv);
            dec.setAAD(new Uint8Array([3]));
            dec.setAuthTag(operation === "tag" ? view(tag) : tag);
            result[name] = Array.from(dec.update(encrypted));
            dec.final();
          } catch (error) {
            result[name] = {
              name: error.name,
              code: error.code ?? null,
              message: error.message,
            };
          }
        }
      }
    }
    return result;
  },
  cryptoRsaDigestRegistry: function ({ crypto: c }) {
    const pair = c.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const result = {};
    for (const hash of [
      ...c.getHashes(),
      "SHA256",
      "sha256\0ignored",
      "sha3-256",
      "ripemd160",
      "blake2b512",
      "",
      "missing",
    ]) {
      for (const padding of [4, 1, 999]) {
        for (const operation of [
          "publicEncrypt",
          "privateDecrypt",
          "privateEncrypt",
          "publicDecrypt",
        ]) {
          const options = {
            key: operation.startsWith("private")
              ? pair.privateKey
              : pair.publicKey,
            oaepHash: hash,
            padding,
          };
          const name = `${operation}/${padding}/${hash}`;
          try {
            const output = c[operation](options, new Uint8Array([1]));
            result[name] = { length: output.length };
          } catch (error) {
            result[name] = {
              name: error.name,
              code: error.code ?? null,
              message: error.message,
            };
          }
        }
      }
    }
    return result;
  },
  cryptoInputViews: function ({ crypto: c }) {
    const result = {};
    const pair = c.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    for (const operation of [
      "hash",
      "hmacKey",
      "hmacUpdate",
      "cipher",
      "prime",
      "sign",
      "verifySignature",
    ]) {
      for (const type of ["typed", "data"]) {
        for (const property of [
          "none",
          "buffer",
          "byteOffset",
          "byteLength",
          "detached",
        ]) {
          const original =
            operation === "verifySignature"
              ? c.createSign("sha256").update("message").sign(pair.privateKey)
              : new Uint8Array([3]);
          const backing = new Uint8Array(original.length + 2);
          backing.set(original, 1);
          const view =
            type === "typed"
              ? new Uint8Array(backing.buffer, 1, original.length)
              : new DataView(backing.buffer, 1, original.length);
          if (property === "detached")
            structuredClone(backing.buffer, { transfer: [backing.buffer] });
          else if (property !== "none")
            Object.defineProperty(view, property, {
              get() {
                throw new Error("shadow " + property);
              },
            });
          const name = `${operation}/${type}/${property}`;
          try {
            let output;
            if (operation === "hash")
              output = c.createHash("sha256").update(view).digest("hex");
            if (operation === "hmacKey")
              output = c.createHmac("sha256", view).update("a").digest("hex");
            if (operation === "hmacUpdate")
              output = c.createHmac("sha256", "key").update(view).digest("hex");
            if (operation === "cipher") {
              const cipher = c.createCipheriv(
                "aes-128-ctr",
                new Uint8Array(16),
                new Uint8Array(16),
              );
              output = Array.from(cipher.update(view));
              cipher.final();
            }
            if (operation === "prime") output = c.checkPrimeSync(view);
            if (operation === "sign") {
              const signature = c
                .createSign("sha256")
                .update(view)
                .sign(pair.privateKey);
              output = c
                .createVerify("sha256")
                .update(
                  property === "detached"
                    ? new Uint8Array()
                    : new Uint8Array([3]),
                )
                .verify(pair.publicKey, signature);
            }
            if (operation === "verifySignature")
              output = c
                .createVerify("sha256")
                .update("message")
                .verify(pair.publicKey, view);
            result[name] = output;
          } catch (error) {
            result[name] = {
              name: error.name,
              code: error.code ?? null,
              message: error.message,
            };
          }
        }
      }
    }
    return result;
  },
  codecNativeBounds: function ({ zlib: z }) {
    const result = {};
    for (const factory of [
      "createDeflate",
      "createBrotliCompress",
      "createZstdCompress",
    ]) {
      for (const [
        name,
        inputOffset,
        inputLength,
        outputOffset,
        outputLength,
      ] of [
        ["inputExtent", 0, 2, 0, 1],
        ["inputOverflow", 4294967295, 1, 0, 1],
        ["inputOffset", 2, 0, 0, 1],
        ["outputExtent", 0, 1, 0, 2],
        ["outputOverflow", 0, 1, 4294967295, 1],
        ["outputOffset", 0, 1, 2, 0],
        ["negative", 0, -1, 0, 1],
        ["bigintInputOffset", 0n, 1, 0, 1],
        ["bigintInputLength", 0, 1n, 0, 1],
        ["bigintOutputOffset", 0, 1, 0n, 1],
        ["bigintOutputLength", 0, 1, 0, 1n],
        [
          "objectBigInt",
          {
            valueOf() {
              return 0n;
            },
          },
          1,
          0,
          1,
        ],
        [
          "exoticBigInt",
          {
            [Symbol.toPrimitive]() {
              return 0n;
            },
          },
          1,
          0,
          1,
        ],

        ["huge", 0, 4294967296, 0, 1],
        ["nan", 0, NaN, 0, 1],
      ]) {
        const engine = z[factory]();
        engine.on("error", () => {});
        const input = new Uint8Array([65]),
          output = new Uint8Array(1);
        Object.defineProperty(input, "byteLength", { value: 32 });
        Object.defineProperty(output, "byteLength", { value: 32 });
        try {
          engine._handle.writeSync(
            4,
            input,
            inputOffset,
            inputLength,
            output,
            outputOffset,
            outputLength,
          );
          result[factory + "/" + name] = "accepted";
        } catch (e) {
          result[factory + "/" + name] = {
            name: e.name,
            message: e.message,
            code: e.code ?? null,
          };
        } finally {
          engine.destroy();
        }
      }
    }
    return result;
  },

  codecInputForms: async function ({ zlib: z }) {
    const result = {};
    for (const family of ["deflate", "brotliCompress", "zstdCompress"])
      for (const info of [false, true])
        for (const mode of ["sync", "callback"])
          for (const kind of [
            "array",
            "typed",
            "data",
            "shadowBuffer",
            "shadowLength",
            "length0",
            "length2",
            "lengthNegative",
            "lengthFraction",
            "lengthHuge",
            "lengthNaN",
            "detached",
            "null",
            "number",
            "fake",
          ]) {
            let buffer = new ArrayBuffer(3);
            new Uint8Array(buffer).set([8, 1, 9]);
            let input =
              kind === "array" || kind === "detached"
                ? buffer
                : kind === "data"
                  ? new DataView(buffer, 1, 1)
                  : kind === "null"
                    ? null
                    : kind === "number"
                      ? 1
                      : kind === "fake"
                        ? { [Symbol.toStringTag]: "ArrayBuffer" }
                        : new Uint8Array(buffer, 1, 1);
            if (kind === "shadowBuffer")
              Object.defineProperty(input, "buffer", {
                value: new Uint8Array([7]).buffer,
              });
            if (kind === "shadowLength")
              Object.defineProperty(input, "byteLength", {
                get() {
                  throw new Error("shadow length");
                },
              });
            if (kind.startsWith("length"))
              Object.defineProperty(input, "byteLength", {
                value: {
                  length0: 0,
                  length2: 2,
                  lengthNegative: -1,
                  lengthFraction: 1.5,
                  lengthHuge: 4294967296,
                  lengthNaN: NaN,
                }[kind],
              });
            if (kind === "detached")
              structuredClone(buffer, { transfer: [buffer] });
            const key = `${family}/${info}/${mode}/${kind}`;
            const error = (e) => ({
              name: e.name,
              code: e.code ?? null,
              ...(info && kind === "null" && e.name === "TypeError" && !e.code
                ? {}
                : { message: e.message }),
            });
            const decode = (value) => {
              const output = info ? value.buffer : value;
              return Array.from(
                z[
                  family === "deflate"
                    ? "inflateSync"
                    : family === "brotliCompress"
                      ? "brotliDecompressSync"
                      : "zstdDecompressSync"
                ](output),
              );
            };
            try {
              if (mode === "sync")
                result[key] = {
                  stage: "return",
                  value: decode(z[family + "Sync"](input, { info })),
                };
              else
                result[key] = await new Promise((resolve, reject) => {
                  let returned = false;
                  z[family](input, { info }, (e, v) => {
                    try {
                      resolve({
                        stage: "callback",
                        later: returned,
                        ...(e ? { error: error(e) } : { value: decode(v) }),
                      });
                    } catch (failure) {
                      reject(failure);
                    }
                  });
                  returned = true;
                });
            } catch (e) {
              result[key] = { stage: "throw", error: error(e) };
            }
          }
    for (const name of [
      "crc32",
      "deflateSync",
      "brotliCompressSync",
      "zstdCompressSync",
    ])
      for (const input of [
        null,
        undefined,
        1,
        true,
        { [Symbol.toStringTag]: "ArrayBuffer" },
      ]) {
        try {
          result[name + "/invalid/" + String(input)] = {
            value: z[name](input),
          };
        } catch (e) {
          result[name + "/invalid/" + String(input)] = {
            name: e.name,
            message: e.message,
            code: e.code ?? null,
          };
        }
      }
    return result;
  },

  codecInputViews: async function ({ zlib: z }) {
    const result = {},
      attempt = async (name, fn) => {
        try {
          result[name] = await fn();
        } catch (e) {
          result[name] = {
            name: e.name,
            ...(name.startsWith("detached") &&
            name.includes("/stream/") &&
            e.name === "TypeError"
              ? {}
              : { message: e.message }),
            code: e.code ?? null,
          };
        }
      };
    for (const family of ["deflate", "brotliCompress", "zstdCompress"])
      for (const kind of [
        "typed",
        "data",
        "detachedTyped",
        "detachedData",
        "detachedBuffer",
      ])
        for (const shadow of ["none", "buffer", "byteOffset", "byteLength"])
          for (const mode of ["crc32", "sync", "callback", "stream"]) {
            await attempt(`${kind}/${shadow}/${mode}/${family}`, async () => {
              let buffer = new ArrayBuffer(3);
              new Uint8Array(buffer).set([8, 1, 9]);
              let value =
                kind.includes("Data") || kind === "data"
                  ? new DataView(buffer, 1, 1)
                  : kind === "detachedBuffer"
                    ? buffer
                    : new Uint8Array(buffer, 1, 1);
              if (shadow !== "none")
                Object.defineProperty(value, shadow, {
                  get() {
                    throw new Error("shadow " + shadow);
                  },
                });
              if (kind.startsWith("detached"))
                structuredClone(buffer, { transfer: [buffer] });
              if (mode === "crc32") return z.crc32(value);
              if (mode === "sync")
                return Array.from(
                  z[
                    family === "deflate"
                      ? "inflateSync"
                      : family === "brotliCompress"
                        ? "brotliDecompressSync"
                        : "zstdDecompressSync"
                  ](z[family + "Sync"](value)),
                );
              if (mode === "callback") {
                const compressed = await new Promise((resolve, reject) =>
                  z[family](value, (e, r) => (e ? reject(e) : resolve(r))),
                );
                return Array.from(
                  z[
                    family === "deflate"
                      ? "inflateSync"
                      : family === "brotliCompress"
                        ? "brotliDecompressSync"
                        : "zstdDecompressSync"
                  ](compressed),
                );
              }
              const stream =
                  z["create" + family[0].toUpperCase() + family.slice(1)](),
                chunks = [];
              try {
                await new Promise((resolve, reject) => {
                  stream.on("data", (chunk) => chunks.push(chunk));
                  stream.on("end", resolve);
                  stream.on("error", reject);
                  stream.end(value);
                });
              } finally {
                stream.destroy();
              }
              const total = chunks.reduce((n, c) => n + c.length, 0),
                data = new Uint8Array(total);
              let at = 0;
              for (const c of chunks) {
                data.set(c, at);
                at += c.length;
              }
              return Array.from(
                z[
                  family === "deflate"
                    ? "inflateSync"
                    : family === "brotliCompress"
                      ? "brotliDecompressSync"
                      : "zstdDecompressSync"
                ](data),
              );
            });
          }
    return result;
  },
  fsInputViews: async function ({ fs }) {
    const r = {};
    for (const kind of ["typed", "data"])
      for (const property of ["buffer", "byteOffset", "byteLength"])
        for (const name of ["writeFileSync", "writeSync", "readSync"]) {
          const buffer = new ArrayBuffer(3);
          new Uint8Array(buffer).set([8, 1, 9]);
          const view =
            kind === "typed"
              ? new Uint8Array(buffer, 1, 1)
              : new DataView(buffer, 1, 1);
          Object.defineProperty(view, property, {
            get() {
              throw new Error("shadow " + property);
            },
          });
          fs.writeFileSync("/tmp/p", "a");
          const fd = fs.openSync("/tmp/p", "r+");
          try {
            if (name === "writeFileSync") fs.writeFileSync("/tmp/p", view);
            else fs[name](fd, view, 0, 1, 0);
            r[`${kind}/${property}/${name}`] = {
              file: Array.from(fs.readFileSync("/tmp/p")),
              view: Array.from(new Uint8Array(buffer)),
            };
          } catch (e) {
            r[`${kind}/${property}/${name}`] = {
              name: e.name,
              message: e.message,
              code: e.code ?? null,
            };
          } finally {
            fs.closeSync(fd);
          }
        }
    return r;
  },
  fsPromiseWatch: async function ({ fs }) {
    const results = [];
    for (const args of [
      [],
      ["/tmp"],
      [null],
      [1],
      ["/tmp", null],
      ["/tmp", { signal: AbortSignal.abort() }],
    ]) {
      let stage = "call";
      try {
        const iterator = fs.promises.watch(...args);
        stage = "next";
        await iterator.next();
        stage = "return";
        results.push(await iterator.return());
      } catch (e) {
        results.push({
          stage,
          name: e.name,
          message: e.message,
          code: e.code ?? null,
        });
      }
    }
    return results;
  },
  tlsPrototypeContracts: function ({ tls: t }) {
    const r = { prototype: Reflect.ownKeys(t.TLSSocket.prototype).map(String) },
      methods = {
        renegotiate: [[], [{}], [null], [{}, 1], [{}, () => {}]],
        exportKeyingMaterial: [
          [],
          [0, "label"],
          [1, "label"],
          [-1, "label"],
          [1, 2],
          [1, "label", new Uint8Array(1)],
          [1, "label", new ArrayBuffer(1)],
        ],
        setMaxSendFragment: [[], [0], [-1], [1.5], [2147483648], ["1"]],
        setServername: [[], [null], [1], ["name"]],
        setSession: [[], [null], [1], ["session"]],
        disableRenegotiation: [[]],
      };
    for (const name of [
      "getPeerCertificate",
      "getCertificate",
      "getPeerX509Certificate",
      "getX509Certificate",
      "setKeyCert",
      "getCipher",
      "getSharedSigalgs",
      "getEphemeralKeyInfo",
      "getFinished",
      "getPeerFinished",
      "getProtocol",
      "getSession",
      "getTLSTicket",
      "isSessionReused",
      "enableTrace",
    ])
      methods[name] = [[]];
    for (const [name, cases] of Object.entries(methods)) {
      r[name] = [];
      for (const args of cases) {
        const socket = new t.TLSSocket();
        socket.on("error", () => {});
        try {
          const v = socket[name](...args);
          r[name].push({
            value: v === undefined ? "undefined" : v,
            servername: socket.servername ?? null,
          });
        } catch (e) {
          r[name].push({
            name: e.name,
            message: e.message,
            code: e.code ?? null,
          });
        } finally {
          socket.destroy();
        }
      }
    }
    return r;
  },

  cryptoKeyInputOptions: async function ({ crypto }) {
    const result = {},
      attempt = (name, fn) => {
        try {
          result[name] = fn();
        } catch (e) {
          result[name] = {
            name: e.name,
            message: e.message,
            code: e.code ?? null,
          };
        }
      };
    const privateKey = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    }).privateKey;
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }),
      jwk = privateKey.export({ format: "jwk" });
    for (const kind of ["private", "public"]) {
      const method =
        crypto[kind === "private" ? "createPrivateKey" : "createPublicKey"];
      const order = [],
        options = {};
      for (const name of ["key", "encoding", "format", "type", "passphrase"])
        Object.defineProperty(options, name, {
          get() {
            order.push(name);
            return name === "key" ? jwk : undefined;
          },
        });
      attempt(kind + "/order", () => ({ type: method(options).type, order }));
      for (const [name, value] of Object.entries({
        format: null,
        type: null,
        encoding: null,
        passphrase: null,
      }))
        attempt(
          kind + "/null/" + name,
          () => method({ key: pem, [name]: value }).type,
        );
      for (const [name, value] of Object.entries({
        number: 1,
        boolean: true,
        function: () => {},
        string: "",
        symbol: Symbol("x"),
      }))
        attempt(kind + "/key/" + name, () => method({ key: value }).type);
      const data = new TextEncoder().encode(pem),
        shared = new ArrayBuffer(data.length);
      new Uint8Array(shared).set(data);
      attempt(kind + "/arrayBuffer", () => method(shared).asymmetricKeyType);
      attempt(
        kind + "/arrayBufferOptions",
        () => method({ key: shared }).asymmetricKeyType,
      );
    }
    return result;
  },

  cryptoKeyDictionary: async function ({ crypto }) {
    const result = {},
      attempt = (name, fn) => {
        try {
          result[name] = fn();
        } catch (e) {
          result[name] = {
            name: e.name,
            message: e.message,
            code: e.code ?? null,
          };
        }
      };
    const fields = [
        "kty",
        "use",
        "key_ops",
        "alg",
        "ext",
        "crv",
        "x",
        "y",
        "d",
        "n",
        "e",
        "p",
        "q",
        "dp",
        "dq",
        "qi",
        "oth",
        "k",
        "pub",
        "priv",
      ],
      order = [];
    const input = {};
    for (const name of fields)
      Object.defineProperty(input, name, {
        get() {
          order.push(name);
          return { kty: "RSA", n: "AQ", e: "AQAB" }[name];
        },
      });
    attempt("order", () => {
      const key = crypto.createPublicKey({ key: input });
      return { order, key: key.export({ format: "jwk" }) };
    });
    let reads = 0;
    attempt("changing", () => {
      const key = crypto.createPublicKey({
        key: {
          kty: new String("RSA"),
          get n() {
            return ++reads === 1 ? "AQ" : "@@";
          },
          e: "AQAB",
        },
      });
      return { reads, key: key.export({ format: "jwk" }) };
    });
    attempt(
      "unused",
      () =>
        crypto.createPublicKey({
          key: {
            kty: "RSA",
            n: "AQ",
            e: "AQAB",
            get d() {
              throw new Error("unused getter");
            },
          },
        }).type,
    );
    for (const name of ["key_ops", "oth"])
      for (const [label, value] of Object.entries({
        null: null,
        number: 2,
        string: "",
        set: new Set(),
        arraylike: { length: 0 },
        empty: [],
        mixed: [null, undefined, 1, {}, Symbol("x")],
      }))
        attempt(
          name + "/" + label,
          () =>
            crypto.createPublicKey({
              key: { kty: "RSA", n: "AQ", e: "AQAB", [name]: value },
            }).type,
        );
    for (const name of ["kty", "n", "alg", "ext"])
      attempt(
        "symbol/" + name,
        () =>
          crypto.createPublicKey({
            key: { kty: "RSA", n: "AQ", e: "AQAB", [name]: Symbol("x") },
          }).type,
      );
    const ec = {
      crv: "P-256",
      kty: "EC",
      x: "X0mMYR_uleZSIPjNztIkAS3_ud5LhNpbiIFp6fNf2Gs",
      y: "UbJuPy2Xi0lW7UYTBxPK3yGgDu9EAKYIecjkHX5s2lI",
    };
    for (const d of ["", "AA", "AQ", "_w", "_".repeat(43), "A".repeat(86)])
      attempt(
        "scalar/" + d,
        () =>
          crypto
            .createPrivateKey({ key: { ...ec, d } })
            .export({ format: "jwk" }).d,
      );
    return result;
  },

  cryptoKeyParsing: async function ({ crypto, Buffer }) {
    // Public test fixtures from pinned workerd crypto_keys-test.js (Apache-2.0).
    const fixtures = {
      "agent1-cert.pem":
        "-----BEGIN CERTIFICATE-----\nMIID6DCCAtCgAwIBAgIUFH02wcL3Qgben6tfIibXitsApCYwDQYJKoZIhvcNAQEL\nBQAwejELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMQswCQYDVQQHDAJTRjEPMA0G\nA1UECgwGSm95ZW50MRAwDgYDVQQLDAdOb2RlLmpzMQwwCgYDVQQDDANjYTExIDAe\nBgkqhkiG9w0BCQEWEXJ5QHRpbnljbG91ZHMub3JnMCAXDTIyMDkwMzIxNDAzN1oY\nDzIyOTYwNjE3MjE0MDM3WjB9MQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0ExCzAJ\nBgNVBAcMAlNGMQ8wDQYDVQQKDAZKb3llbnQxEDAOBgNVBAsMB05vZGUuanMxDzAN\nBgNVBAMMBmFnZW50MTEgMB4GCSqGSIb3DQEJARYRcnlAdGlueWNsb3Vkcy5vcmcw\nggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDUVjIK+yDTgnCT3CxChO0E\n37q9VuHdrlKeKLeQzUJW2yczSfNzX/0zfHpjY+zKWie39z3HCJqWxtiG2wxiOI8c\n3WqWOvzVmdWADlh6EfkIlg+E7VC6JaKDA+zabmhPvnuu3JzogBMnsWl68lCXzuPx\ndeQAmEwNtqjrh74DtM+Ud0ulb//Ixjxo1q3rYKu+aaexSramuee6qJta2rjrB4l8\nB/bU+j1mDf9XQQfSjo9jRnp4hiTFdBl2k+lZzqE2L/rhu6EMjA2IhAq/7xA2MbLo\n9cObVUin6lfoo5+JKRgT9Fp2xEgDOit+2EA/S6oUfPNeLSVUqmXOSWlXlwlb9Nxr\nAgMBAAGjYTBfMF0GCCsGAQUFBwEBBFEwTzAjBggrBgEFBQcwAYYXaHR0cDovL29j\nc3Aubm9kZWpzLm9yZy8wKAYIKwYBBQUHMAKGHGh0dHA6Ly9jYS5ub2RlanMub3Jn\nL2NhLmNlcnQwDQYJKoZIhvcNAQELBQADggEBAMM0mBBjLMt9pYXePtUeNO0VTw9y\nFWCM8nAcAO2kRNwkJwcsispNpkcsHZ5o8Xf5mpCotdvziEWG1hyxwU6nAWyNOLcN\nG0a0KUfbMO3B6ZYe1GwPDjXaQnv75SkAdxgX5zOzca3xnhITcjUUGjQ0fbDfwFV5\nix8mnzvfXjDONdEznVa7PFcN6QliFUMwR/h8pCRHtE5+a10OSPeJSrGG+FtrGnRW\nG1IJUv6oiGF/MvWCr84REVgc1j78xomGANJIu2hN7bnD1nEMON6em8IfnDOUtynV\n9wfWTqiQYD5Zifj6WcGa0aAHMuetyFG4lIfMAHmd3gaKpks7j9l26LwRPvI=\n-----END CERTIFICATE-----\n",
      "dh_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMIIBPgIBADCCARcGCSqGSIb3DQEDATCCAQgCggEBAP//////////rfhUWKK7Spqv\n3FYgJz088di5xYPOLTaVqeE2QRRkM/vMk53OJJs++X0v42NjDHXY9oGyAq7EYXrT\n3x7V1f1lYSQz9R9fBm7QhWNlVT3tGvO1VxNef1fJNZhPDHDg5ot34qaJ2vPv6HId\n8VihNq3nNTCsyk9IOnl6vAqxgrMk+2HRCKlLssjj+7lq2rdg1/RoHU9Co945TfSu\nVu3nY3K7GQsHp8juCm1wngL84c334uzANATNKDQvYZFy/pzphYP/jk8SMu7ygYPD\n/jsbTG+tczu1/LwuwiAFxY7xg30Wg7LG80omwbLv+ohrQjhhKFyX//////////8C\nAQIEHgIcKNGyhQRxIhVXoyktdymwbN6MgXv85vPax+8eqQ==\n-----END PRIVATE KEY-----\n",
      "dh_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMIICJTCCARcGCSqGSIb3DQEDATCCAQgCggEBAP//////////rfhUWKK7Spqv3FYg\nJz088di5xYPOLTaVqeE2QRRkM/vMk53OJJs++X0v42NjDHXY9oGyAq7EYXrT3x7V\n1f1lYSQz9R9fBm7QhWNlVT3tGvO1VxNef1fJNZhPDHDg5ot34qaJ2vPv6HId8Vih\nNq3nNTCsyk9IOnl6vAqxgrMk+2HRCKlLssjj+7lq2rdg1/RoHU9Co945TfSuVu3n\nY3K7GQsHp8juCm1wngL84c334uzANATNKDQvYZFy/pzphYP/jk8SMu7ygYPD/jsb\nTG+tczu1/LwuwiAFxY7xg30Wg7LG80omwbLv+ohrQjhhKFyX//////////8CAQID\nggEGAAKCAQEA2whDVdYtNbr/isSFdw7rOSdbmcWrxiX6ppqDZ6yp8XjUj3/CEf/P\n60X7HndX+nXD7YaPtVZxktkIpArI7C+AH7fZxBduuv2eLnvYwK82jFHKe7zvfdMr\n26akMCV0kBA3ktgcftHlqYsIj52BaJlG37FRha3SDOL2yJOij3hNQhHCXTWLg7tP\nGtXmD202OoZ6Ll+LxBzBCFnxVauiKnzBGeawy4gDycUEHmq5oDRR68I2gmxmsLg5\nMQVAP5ljp+FEu4+TZm6hR4wQ5PRjCQ+teq+VqMro7EbbvZpn+X9kAgKSl2WDu0fT\nFbUnBn3HPBmUa/Fv/ooXrlckTUDjLkbWZQ==\n-----END PUBLIC KEY-----\n",
      "dsa_private.pem":
        "-----BEGIN DSA PRIVATE KEY-----\nMIIDVwIBAAKCAQEAoSw3Ghf02sMSmd5k2rvSqf6eJPFO7fHDRyvDDbifjO6/BKSI\nkXM43qyCqddC04arKg7wc1QDEQ8gb13pCmnC0RBiljE6ke4yK46Q5JjiEKH9U1eC\nbtTrhcGrLDgwbqvRM06EN6IfAL3OBF6YzS9wn3/EfSwW2Z8gAIkjZrTjEUTV+/gE\nAdfEgd/WAZxcc9zYKOwPy0/LjjldQw5fsPlIEkS1yJFlWMokSsZVYlJLR06h1S4k\nQoE3BqELirH/FQfJ36RMRFsaKZ6nQYS66Qc8rybQw2VlOJsqiRoTSDwREPz6j9oL\nYh1Ee86j5Xt9jbiBrK33UbkTr/jBtO0J2PR0+wIhAIXIexS5LQJPSoi96k6OU4yr\nLLmAIY8gS9mdYTdbpwcdAoIBAQCCN3gTjFiPgBQ/bj/Edp9w90SA+dQ/VnnYDTMc\nz+Mi/8sgtlQ3O9CCFb0327YnOLwvxsmSadT9XrIq1/5jGD2VtjFDVlridjYASrje\nzR2kdr781G+bxtVNQuIOKZl9xqruCmHUSSRL/vuCR6pKsA81ZPfpdcLh3RYYxDIo\nTK6tVX4GrX5bcxGDIUCQiTaqKv9Nzpm1liBLRm6LHczBsFk2OVrRyMsT3gh0J6DS\nUw+dw/Vru1J6glkrr0CxBWoJ65btcqtFyQV/76btor9Qgc/z9suYBoJZ3Ua0yAfv\n3J2ErOs1CAbh4LWNULA9eJObY2R4sAV7Q8wOMT5jmjKo4unpAoIBAQCE1m+DUb9L\nT58u6XV/L1p6K9T2mc6jAmzD51fPiUwsRov9sDGJmSnQjQ5pt3hVp8inVfNkhqOI\n1rpdKmx5W00fPu6VCiPuximuHSNHzJpCAVUrIH8YasS+AurCOwGMdvODLF6dx7yR\nMdxbiszrBry8J0TdvqElHZ1YmQDwoHH7R4pUd31jsk4gnE6pkqLgWwVAy0LXXGsg\n2JfnDvdQY8fIHkuezLdhOyO9pRlXSYv4fLdMaSjHyEcwr2hnm5tm5RsBwM+u0sDc\nyBqUjwoN8NTuLLasfJzzmjeHWDcRGFbzKt/xlUkQ7pf+xdelnLOstuPDGglB1U85\nREhx4rQGKg7nAiA0FX4e4Ms3OXUnmtsTALk5YMiMF3jUp4pRDhHFKBgsYQ==\n-----END DSA PRIVATE KEY-----\n",
      "dsa_private_1025.pem":
        "-----BEGIN DSA PRIVATE KEY-----\nMIIB0gIBAAKBiQDp3xGIsNcKZWSpur2Ab2f5rirhu5AsYGLI/XZvzueoO4kLPp3s\nzKHXabBObdxU07kRFkfpV9lftdXT3a6E/Wxb+w2d7g0F7pWTdwpmmofcRtwgbynm\nJKvqWt/OwfVFsdUvvpVci9AxY/5rdM/K54Srp6iSpfteBYKGqCpPnswikND0GxKM\n1MbzAhUAqAPKCZ4hxromirUu33tn3Nhsq20CgYgf0tH2nwzWlPLoN4OJvC5dVLPv\nMRyJTQekW8tR0oY6PeshmZOaoI0L3e/M4KeZ/4qiY7IRNksP2YGJxjfS6W+h+MNj\nPO5r0aYYFYCPQ8JbhBO7l0hdXmkTY3FcdyRHeh2gwe3bBX6Auev2MGgL616Cgd/K\nH8PAX9EHmrNPcQOWHem4KcfJXqouAoGIcZ/4bJurOAw5OL4+5BsE4jfSVFq4nmNl\n+m6Iy6ls3hOHOZ9sJlw0Fi+ZtdeddOTYnIngW/kH09XGoF5JJOaLQv2O4GmZfDfn\nla+vfHZPsOxmYqeEbSwA2pqlhOn/dCshBOymhwNLXp1FJ3JUEyh8i605X06XmWoj\n4ZIu/tr1xbnZDLHuFjBmXAIURbB5/IDf2h0sW+qL5gHFO8bgr+E=\n-----END DSA PRIVATE KEY-----\n",
      "dsa_private_encrypted.pem":
        "-----BEGIN DSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,FABA263DD471F214EF3E02699B837C20\n\nTj2+4x9MEIaQGFQ4o7hk12MriVYyvLO5aCbqq7LG5uhVk546/+bJc6hewdSwb6oT\nMYPbuV+QTdtqshqFESA0McyGlj4w1tOg5TomP84NTKvwTO1EirVLMukfF3dqaguw\nC117AZJkGbqgbi6lZ2bG0Hta6HRbhI5+ODFtOp3rKQ2KwVmtL7zw6vt3PCISeMHN\nfLqikDc2+YoI9V1FJis9/FATyqV8yrJYYQQpP1RQN+gDY4SSs/eUr+Me7RNy6Lz7\noH0tDaPGbiafwrZe1okksjxT2JQz1Q3hciBPikgdQIoE2NWTUlOeRYX0T0N2n37S\n6Odbcr522e+2XjcLj34Ozthp+Q5mIDcLuakazxkXhq0RyhJ7vo+xA2YiP7Q3vH7g\noAnsJPFNVY6wJhprZi2VofKIUJUiajAXGDVX2yEIG/DOA9rnx0ZP+zopXMi4ptu0\nRzWyAL+P4jn0b8vgPf9CYJmn4VNfOcVmomZ1Bw6hzqTE2FnThJCXU3l2eaC/wcSR\nuMRp8c6IM8AR5DUzUBKIckkvXj1m5iSZoKuR8dB7s9BhrRtBAI7K3G254G06sByv\n0pnft8r+BkMqgdfG4rJQoQJw7tVYln+pL/gYPDuYsqyJ9kFuHDqtBvlozqXY5AL1\nXQaXoD6xMACEoJSIv5y+TzFzXwFQrDW+G1724YOSbiioUfGD0tRfjj2ei63PThQr\nZ50SryfKQQf4UgcJeokMhmRWT2vPXEFWEP1b2FMEQxBy6fyKcqwZBAbhqF6usGEB\nnwr/S1HXQAGEsWoc/Z4yynB7uhOwWu/Vpj+V6B98NmC7EUX15Why8zCsT9gzaIgC\nM6sZafHhcmjfwc+lL9xFlU/wnAOz0LeKZWry3D0sXZn1r2FRlOJdtLLx01Sve/MU\nZRsgEDTkzv8E9dDltMeq8HQDCgLT1USTMWcY1kMELBj7y7ZdCWjH1QhTq2KlId+o\n1X28zJOsOL/XRseUSlpjmSSLRw1QQEypNCY2+tcvViAvn3AifipBbdzUNhvygLhc\na2+5rYsd8BBEFnMJx7lDiyqXGnZkBbhbCSIudppNcjC+akFlFp6fBzkp4mKBuKpc\nhwBBdfqdEyzqu6SVHM8nGV/aDoRuu9shV6MX0y/KnIgLedudn8aN2eLgjR5k1+99\n-----END DSA PRIVATE KEY-----\n",
      "dsa_private_encrypted_1025.pem":
        "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIBvTBXBgkqhkiG9w0BBQ0wSjApBgkqhkiG9w0BBQwwHAQIqTW00yecdxMCAggA\nMAwGCCqGSIb3DQIJBQAwHQYJYIZIAWUDBAEqBBBKgO4UF0LfCkPyS+iCvSrtBIIB\nYD3W6FyEZ97/crnoyRqjPUtr2Mm4KJMtaB5ZiGFzZEzd6AH7N/dbtAAMIibtsjmd\nRYdIptpET6xTpUhM8TvpULyYaZnhZJKTpVUrTVdvFTS3DYDutu7aWRLTrle6LzcY\nXpIppeP8ZmYFdRBQxhF+KoDsP4O0QA+vWl2W2VmRfr+sK9R+qV89w0YMjEWHsYY+\nVZsDbJBGKkj9gzIvxIsRyack/+RsbiSDrh6WTw+D0jrX/IMbgPjvYfBFhpxGC7zR\nhDn9r3JaO2KdHh9kMtvQfshA1n636kb0X6ewY57BhEs3J4hpMg46c6YFry94to24\njxl5KutM0CFea7mYGtNf6WJXBsm7JSW03kjlqYoZGK43KNgZhzKAsXaNkoRkA5cw\nBzGfgmG6dHTpeAY9G4vM4inhCmGFA8Tx189g+xzRv16uFXRb8WFIllne1fEFaXRr\n1Rz2G6SPJkA3fsrl8zUIB0Y=\n-----END ENCRYPTED PRIVATE KEY-----\n",
      "dsa_private_pkcs8.pem":
        "-----BEGIN PRIVATE KEY-----\nMIICZQIBADCCAjoGByqGSM44BAEwggItAoIBAQChLDcaF/TawxKZ3mTau9Kp/p4k\n8U7t8cNHK8MNuJ+M7r8EpIiRczjerIKp10LThqsqDvBzVAMRDyBvXekKacLREGKW\nMTqR7jIrjpDkmOIQof1TV4Ju1OuFwassODBuq9EzToQ3oh8Avc4EXpjNL3Cff8R9\nLBbZnyAAiSNmtOMRRNX7+AQB18SB39YBnFxz3Ngo7A/LT8uOOV1DDl+w+UgSRLXI\nkWVYyiRKxlViUktHTqHVLiRCgTcGoQuKsf8VB8nfpExEWxopnqdBhLrpBzyvJtDD\nZWU4myqJGhNIPBEQ/PqP2gtiHUR7zqPle32NuIGsrfdRuROv+MG07QnY9HT7AiEA\nhch7FLktAk9KiL3qTo5TjKssuYAhjyBL2Z1hN1unBx0CggEBAII3eBOMWI+AFD9u\nP8R2n3D3RID51D9WedgNMxzP4yL/yyC2VDc70IIVvTfbtic4vC/GyZJp1P1esirX\n/mMYPZW2MUNWWuJ2NgBKuN7NHaR2vvzUb5vG1U1C4g4pmX3Gqu4KYdRJJEv++4JH\nqkqwDzVk9+l1wuHdFhjEMihMrq1VfgatfltzEYMhQJCJNqoq/03OmbWWIEtGbosd\nzMGwWTY5WtHIyxPeCHQnoNJTD53D9Wu7UnqCWSuvQLEFagnrlu1yq0XJBX/vpu2i\nv1CBz/P2y5gGglndRrTIB+/cnYSs6zUIBuHgtY1QsD14k5tjZHiwBXtDzA4xPmOa\nMqji6ekEIgIgNBV+HuDLNzl1J5rbEwC5OWDIjBd41KeKUQ4RxSgYLGE=\n-----END PRIVATE KEY-----\n",
      "dsa_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIDSDCCAjoGByqGSM44BAEwggItAoIBAQChLDcaF/TawxKZ3mTau9Kp/p4k8U7t\n8cNHK8MNuJ+M7r8EpIiRczjerIKp10LThqsqDvBzVAMRDyBvXekKacLREGKWMTqR\n7jIrjpDkmOIQof1TV4Ju1OuFwassODBuq9EzToQ3oh8Avc4EXpjNL3Cff8R9LBbZ\nnyAAiSNmtOMRRNX7+AQB18SB39YBnFxz3Ngo7A/LT8uOOV1DDl+w+UgSRLXIkWVY\nyiRKxlViUktHTqHVLiRCgTcGoQuKsf8VB8nfpExEWxopnqdBhLrpBzyvJtDDZWU4\nmyqJGhNIPBEQ/PqP2gtiHUR7zqPle32NuIGsrfdRuROv+MG07QnY9HT7AiEAhch7\nFLktAk9KiL3qTo5TjKssuYAhjyBL2Z1hN1unBx0CggEBAII3eBOMWI+AFD9uP8R2\nn3D3RID51D9WedgNMxzP4yL/yyC2VDc70IIVvTfbtic4vC/GyZJp1P1esirX/mMY\nPZW2MUNWWuJ2NgBKuN7NHaR2vvzUb5vG1U1C4g4pmX3Gqu4KYdRJJEv++4JHqkqw\nDzVk9+l1wuHdFhjEMihMrq1VfgatfltzEYMhQJCJNqoq/03OmbWWIEtGbosdzMGw\nWTY5WtHIyxPeCHQnoNJTD53D9Wu7UnqCWSuvQLEFagnrlu1yq0XJBX/vpu2iv1CB\nz/P2y5gGglndRrTIB+/cnYSs6zUIBuHgtY1QsD14k5tjZHiwBXtDzA4xPmOaMqji\n6ekDggEGAAKCAQEAhNZvg1G/S0+fLul1fy9aeivU9pnOowJsw+dXz4lMLEaL/bAx\niZkp0I0Oabd4VafIp1XzZIajiNa6XSpseVtNHz7ulQoj7sYprh0jR8yaQgFVKyB/\nGGrEvgLqwjsBjHbzgyxence8kTHcW4rM6wa8vCdE3b6hJR2dWJkA8KBx+0eKVHd9\nY7JOIJxOqZKi4FsFQMtC11xrINiX5w73UGPHyB5Lnsy3YTsjvaUZV0mL+Hy3TGko\nx8hHMK9oZ5ubZuUbAcDPrtLA3MgalI8KDfDU7iy2rHyc85o3h1g3ERhW8yrf8ZVJ\nEO6X/sXXpZyzrLbjwxoJQdVPOURIceK0BioO5w==\n-----END PUBLIC KEY-----\n",
      "dsa_public_1025.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIBzjCCATsGByqGSM44BAEwggEuAoGJAOnfEYiw1wplZKm6vYBvZ/muKuG7kCxg\nYsj9dm/O56g7iQs+nezModdpsE5t3FTTuREWR+lX2V+11dPdroT9bFv7DZ3uDQXu\nlZN3Cmaah9xG3CBvKeYkq+pa387B9UWx1S++lVyL0DFj/mt0z8rnhKunqJKl+14F\ngoaoKk+ezCKQ0PQbEozUxvMCFQCoA8oJniHGuiaKtS7fe2fc2GyrbQKBiB/S0faf\nDNaU8ug3g4m8Ll1Us+8xHIlNB6Rby1HShjo96yGZk5qgjQvd78zgp5n/iqJjshE2\nSw/ZgYnGN9Lpb6H4w2M87mvRphgVgI9DwluEE7uXSF1eaRNjcVx3JEd6HaDB7dsF\nfoC56/YwaAvrXoKB38ofw8Bf0Qeas09xA5Yd6bgpx8leqi4DgYwAAoGIcZ/4bJur\nOAw5OL4+5BsE4jfSVFq4nmNl+m6Iy6ls3hOHOZ9sJlw0Fi+ZtdeddOTYnIngW/kH\n09XGoF5JJOaLQv2O4GmZfDfnla+vfHZPsOxmYqeEbSwA2pqlhOn/dCshBOymhwNL\nXp1FJ3JUEyh8i605X06XmWoj4ZIu/tr1xbnZDLHuFjBmXA==\n-----END PUBLIC KEY-----\n",
      "ec_p256_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgDxBsPQPIgMuMyQbx\nzbb9toew6Ev6e9O6ZhpxLNgmAEqhRANCAARfSYxhH+6V5lIg+M3O0iQBLf+53kuE\n2luIgWnp81/Ya1Gybj8tl4tJVu1GEwcTyt8hoA7vRACmCHnI5B1+bNpS\n-----END PRIVATE KEY-----\n",
      "ec_p256_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEX0mMYR/uleZSIPjNztIkAS3/ud5L\nhNpbiIFp6fNf2GtRsm4/LZeLSVbtRhMHE8rfIaAO70QApgh5yOQdfmzaUg==\n-----END PUBLIC KEY-----\n",
      "ec_p384_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMIG2AgEAMBAGByqGSM49AgEGBSuBBAAiBIGeMIGbAgEBBDB3B+4e4C1OUxGftkEI\nGb/SCulzUP/iE940CB6+B6WWO4LT76T8sMWiwOAGUsuZmyKhZANiAASE43efMYmC\n/7Tx90elDGBEkVnOUr4ZkMZrl/cqe8zfVy++MmayPhR46Ah3LesMCNV+J0eG15w0\nIYJ8uqasuMN6drU1LNbNYfW7+hR0woajldJpvHMPv7wlnGOlzyxH1yU=\n-----END PRIVATE KEY-----\n",
      "ec_p384_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEhON3nzGJgv+08fdHpQxgRJFZzlK+GZDG\na5f3KnvM31cvvjJmsj4UeOgIdy3rDAjVfidHhtecNCGCfLqmrLjDena1NSzWzWH1\nu/oUdMKGo5XSabxzD7+8JZxjpc8sR9cl\n-----END PUBLIC KEY-----\n",
      "ec_p521_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMIHuAgEAMBAGByqGSM49AgEGBSuBBAAjBIHWMIHTAgEBBEIAEghuafcab9jXW4gO\nQLeDaKOlHEiskQFjiL8klijk6i6DNOXcFfaJ9GW48kxpodw16ttAf9Z1WQstfzpK\nGUetHImhgYkDgYYABAGixYI8Gbc5zNze6rH2/OmsFV3unOnY1GDqG9RTfpJZXpL9\nChF1dG8HA4zxkM+X+jMSwm4THh0Wr1Euj9dK7E7QZwHd35XsQXgH13Hjc0QR9dvJ\nBWzlg+luNTY8CkaqiBdur5oFv/AjpXRimYxZDkhAEsTwXLwNohSUVMkN8IQtNI9D\naQ==\n-----END PRIVATE KEY-----\n",
      "ec_p521_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQBosWCPBm3Oczc3uqx9vzprBVd7pzp\n2NRg6hvUU36SWV6S/QoRdXRvBwOM8ZDPl/ozEsJuEx4dFq9RLo/XSuxO0GcB3d+V\n7EF4B9dx43NEEfXbyQVs5YPpbjU2PApGqogXbq+aBb/wI6V0YpmMWQ5IQBLE8Fy8\nDaIUlFTJDfCELTSPQ2k=\n-----END PUBLIC KEY-----\n",
      "ec_secp256k1_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMIGEAgEAMBAGByqGSM49AgEGBSuBBAAKBG0wawIBAQQgc34ocwTwpFa9NZZh3l88\nqXyrkoYSxvC0FEsU5v1v4IOhRANCAARw7OEVKlbGFqUJtY10/Yf/JSR0LzUL1PZ1\n4Ol/ErujAPgNwwGU5PSD6aTfn9NycnYB2hby9XwB2qF3+El+DV8q\n-----END PRIVATE KEY-----\n",
      "ec_secp256k1_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEcOzhFSpWxhalCbWNdP2H/yUkdC81C9T2\ndeDpfxK7owD4DcMBlOT0g+mk35/TcnJ2AdoW8vV8Adqhd/hJfg1fKg==\n-----END PUBLIC KEY-----\n",
      "ed25519_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIMFSujN0jIUIdzSvuxka0lfgVVkMdRTuaVvIYUHrvzXQ\n-----END PRIVATE KEY-----\n",
      "ed25519_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAK1wIouqnuiA04b3WrMa+xKIKIpfHetNZRv3h9fBf768=\n-----END PUBLIC KEY-----\n",
      "ed448_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMEcCAQAwBQYDK2VxBDsEOdOtCnu9bDdBqSHNNZ5xoDA5KdLBTUNPcKFaOADNX32s\ndfpo52pCtPqfku/l3/OfUHsF43EfZsaaWA==\n-----END PRIVATE KEY-----\n",
      "ed448_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMEMwBQYDK2VxAzoAoX/ee5+jlcU53+BbGRsGIzly0V+SZtJ/oGXY0udf84q2hTW2\nRdstLktvwpkVJOoNb7oDgc2V5ZUA\n-----END PUBLIC KEY-----\n",
      "rsa_private.pem":
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKCAQEAt9xYiIonscC3vz/A2ceR7KhZZlDu/5bye53nCVTcKnWd2seY\n6UAdKersX6njr83Dd5OVe1BW/wJvp5EjWTAGYbFswlNmeD44edEGM939B6Lq+/8i\nBkrTi8mGN4YCytivE24YI0D4XZMPfkLSpab2y/Hy4DjQKBq1ThZ0UBnK+9IhX37J\nu/ZoGYSlTIGIhzyaiYBh7wrZBoPczIEu6et/kN2VnnbRUtkYTF97ggcv5h+hDpUQ\njQW0ZgOMcTc8n+RkGpIt0/iM/bTjI3Tz/gsFdi6hHcpZgbopPL630296iByyigQC\nPJVzdusFrQN5DeC+zT/nGypQkZanLb4ZspSx9QIDAQABAoIBAQCS2erYu8gyoGPi\n3E/zYgQ6ishFAZWzDWSFubwD5wSm4SSAzvViL/RbO6kqS25xR569DmLRiHzD17VI\nmJMsNECUnPrqR2TL256OJZaXrNHh3I1lUwVhEzjeKMsL4/ys+d70XPXoiocVblVs\nmoDXEIGEqa48ywPvVE3Fngeuxrsq3/GCVBNiwtt0YjAOZxmKEh31UZdHO+YI+wNF\n/Z8KQCPscN5HGlR0SIQOlqMANz49aKStrevdvjS1UcpabzDEkuK84g3saJhcpAhb\npGFmAf5GTjkkhE0rE1qDF15dSqrKGfCFtOjUeK17SIEN7E322ChmTReZ1hYGfoSV\ncdFntUINAoGBAPFKL5QeJ6wZu8R/ru11wTG6sQA0Jub2hGccPXpbnPrT+3CACOLI\nJTCLy/xTKW3dqRHj/wZEe+jUw88w7jwGb1BkWr4BI8tDvY9jQLP1jyuLWRfrxXbp\n4Z0oeBBwBeCI/ZG7FIvdDTqWxn1aj3Tmh6s4ByqEdtwrrrJPcBUNl01fAoGBAMMR\n3RGE/ca6X6xz6kgUD6TtHVhiiRJK1jm/u+q0n7i/MBkeDgTZkHYS7lPc0yIdtqaI\nPlz5yzwHnAvuMrv8LSdkjwioig2yQa3tAij8kXxqs7wN5418DMV2s1OJBrPthYPs\nbv4im2iI8V63JQS4ZMYQbckq8ABYccTpOnxXDy0rAoGBAKkvzHa+QjERhjB9GyoT\n1FhLQIsVBmYSWrp1+cGO9V6HPxoeHJzvm+wTSf/uS/FmaINL6+j4Ii4a6gWgmJts\nI6cqBtqNsAx5vjQJczf8KdxthBYa0sXTrsfktXNJKUXMqIgDtp9vazQ2vozs8AQX\nFPAAhD3SzgkJdCBBRSTt97ZfAoGAWAziKpxLKL7LnL4dzDcx8JIPIuwnTxh0plCD\ndCffyLaT8WJ9lXbXHFTjOvt8WfPrlDP/Ylxmfkw5BbGZOP1VLGjZn2DkH9aMiwNm\nbDXFPdG0G3hzQovx/9fajiRV4DWghLHeT9wzJfZabRRiI0VQR472300AVEeX4vgb\nrDBn600CgYEAk7czBCT9rHn/PNwCa17hlTy88C4vXkwbz83Oa+aX5L4e5gw5lhcR\n2ZuZHLb2r6oMt9rlD7EIDItSs+u21LOXWPTAlazdnpYUyw/CzogM/PN+qNwMRXn5\nuXFFhmlP2mVg2EdELTahXch8kWqHaCSX53yvqCtRKu/j76V31TfQZGM=\n-----END RSA PRIVATE KEY-----\n",
      "rsa_private_2048.pem":
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEArk4OqxBqU5/k0FoUDU7CpZpjz6YJEXUpyqeJmFRVZPMUv/Rc\n7U4seLY+Qp6k26T/wlQ2WJWuyY+VJcbQNWLvjJWks5HWknwDuVs6sjuTM8CfHWn1\n960JkK5Ec2TjRhCQ1KJy+uc3GJLtWb4rWVgTbbaaC5fiR1/GeuJ8JH1Q50lB3mDs\nNGIk1U5jhNaYY82hYvlbErf6Ft5njHK0BOM5OTvQ6BBv7c363WNG7tYlNw1J40du\np9OQPo5JmXN/h+sRbdgG8iUxrkRibuGv7loh52QQgq2snznuRMdKidRfUZjCDGgw\nbgK23Q7n8VZ9Y10j8PIvPTLJ83PX4lOEA37JlwIDAQABAoIBACoL2Ev5lLyBaI+9\n+vJO2nNaL9OKSMu2SJODIJTnWwYUASBg0P3Jir6/r3sgi8IUJkH5UHbD/LrQcPkA\n4X7PU9vEyUsr1efWFIvk7t7JsjOctoVA5z2Mty74arivUIe5PUadvUC6/7Zk0u6A\nCjLuJRmlH7nGNKZk+xrvgWTH+fkgc5ddbFxoGH129RcVC+ePbsi1EF60C9KbJvp1\nxjUJ5cDtNYnZ/g+ULo6ZJjRG5kUCVSI8H/Nc/DmStKsjN0isKpNGofU5ArEwywGC\nCqxz/tr4hT2haAkVEto04ooYpqDUSqGEfPpLWL+CjFNPfCsWJ1tX5LQRvpu6eukd\nFO72oVECgYEA4+Ot7RQtGOtPeaxl3P7sbEzBZk0W/ZhCk+mzE2iYh0QXU44VtjtO\n/9CENajTklckiwlxjqBZ5NO1SiMQKBcmqkoA03x/DEujo2rMVuNPoc6ZYp1Gc4qA\n4ImkMQNsM7Swum42rKE960WoiWW7dsdEAq6vqgeApZlMU8lcKRAlOZkCgYEAw85H\n3bjF7gMatVibsWzj0zp2L4616m2v5Z3YkgohGRAvm1912DI5ku5Nmy9am57Z1EP2\nUtDOxahd/Vf6mK9lR4YEbNW1TenykViQJ6lmljOFUeZEZYYO3O+fthkyN/42l5yn\nMyUANTTb2rvt8amdRr0ARdRqWJmt5NfJzYBV+q8CgYB1ZjuZoQVCiybcRcYMPX/K\noxgW/avUZPYXgRNx8jZxqNBjiRUCVjdybhdOFXU5NI9s2SaZFV56Fd6VHM8b+CFB\nJPKcAMzqpqTccQ5nzJ6fevFl7iP3LekKw53EakD5uiI5SMH92OsvIymZ7sDOhgUx\nZJC2hTrvFLRPjbJerSSgMQKBgAv5iZuduT0dI30DtkHbjvNUF/ZAnA+CNcetJ5mG\n1Q9bVg4CgIqAR9UcjdJ3yurJhDjfDylxa7Pa4CSmRMUhtOfy4kJlr3jcXeFVsTs7\nuPJmpDimBHjRAgew/+t7Dv8tpNkQ04jlMmYOnYN7CspEvUGePW4H15kjjOb563WN\n67QxAoGAdhJPaHVtDBUrobn50ORVkVNJVZPBhEDbR6tNtHsgEevH7iYjxAdxEeUa\nc9S2iV9lir3hkrQceiYWAADcphWfO1HyP5Uld4sJzYiEGbSM7a0zRQjYlQgXFbZo\nSAc6Gok78kwECPwpmeH4lpGVeKNmzEteSBVYxGb9b6C/SSsu7l0=\n-----END RSA PRIVATE KEY-----\n",
      "rsa_private_4096.pem":
        "-----BEGIN RSA PRIVATE KEY-----\nMIIJKAIBAAKCAgEAxeStwofbjtZuol4lwKn1w08AzcSNLHfCqNFHa+W7er8is7LQ\nsPljtPT4yn4lsao83ngHFvSC3tbMiRNDpUHYqH2wBuUkuOmCtYkZLi0307H0CwcV\nV6W5P3tNEt80IJ+PqlRxtTknezUtbOasbIi/aornVWG+psgqDGrFZ4oTsWtiE0Sv\ni7sDqN5E2dijmH/YYnlnwqszgzHdtAnARp1bG34E64sqWCmLoGCfPdHtym/CSdxO\nLOsDV15jrwODZQ/TJZ5thkwKZRxu7g9fwlhA1PiI5WDP4reXNaqa2bSgrzpAljQE\nxYs4N0L7okSVOJQX9BEaoWtq8NLU8MpMdGoHNDU0Xr60Lfr58Z5qn8RGEvlTxoCb\nPJzPV2zgzD/lmEqft6NnfTclveA3sd8xSrOBUn4o3S8hS0b9Su7PBukHjM96/e0R\neoIshSwXlQTLr2Ft8KwupyPm1ltNcTDtjqHcIWU6Bg+kPy9mxSVtGGZYAPtqGzNB\nA/m+oOja/OSPxAblPdln691DaDuZs5nuZCGwGcLaJWgiyoqvXAcyXDZFyH4OZZh8\nrsBLKbnFXHZ/ziG0cAozEygZEPJappw8Lx/ady7WL/SJjxooiKapc7Bnfy8eSLV3\n+XAKxhLW/MQ6ChJ+e/8ExAY02ca4MpCvqwIk9TfV6FM8pWGqHzQFj0v3NL0CAwEA\nAQKCAgBTb8eTbZS09NRQwUFJql9kqbq9B1I+nYAFjbd/Vq1lY5FOEubKt1vCwEbl\nmapq7kwbwJ+8nftP2WEDqouq8chXwialwZdqH4ps4BEt1wLizvUGcUYeXlFs4p/s\nhQ+FccExH8mRjzeGSzWL5PZuDHoogchnx36K83pHIf15Wk5TT+NaHGunjoJMgOqm\nryDK+5xQaL/G5Egj2LKRZksbet0fClMovNRtt5aXWCXL+uc3o0dXvPt5FN2jyLhe\n4ixUQAfWpKWpKgZ3+zUKSpElb/Bl2yRdEiSUgrPOfNAtWmsldnok2mnooHpjUmqm\nUCRaZpZy4YNI6/F6+Gmv3Ju/ubSvHzoxQLlvgUqWAnVshivF1TJImHSIiLIvBKPp\n29SD6maWIT1DC9sKC4E1gq7VO4762l1//zEOAY7XK0Z7LrbZO4WXHnsgFOpGthQ3\ng9Qi/SeM6mb5xEJTBUBTmkhGs1x8jolzca30mqv8T63W4PXkXHmZdK7vyH5useiI\ns0eGUeaYK892WgfxCBo24JCNQiAcH/wTwV4l4yROqeH2V4ShbIYmCzla++7vsPYW\nhAwQR9eH0+4ogTkaMQrm16plZk0ezVX9BKK8KTnd4G9/T18VstQbiowF2/cKnGKC\nOqrmoR2vHOksQdUJVmnwCRqU1symBxhY0GSIps98v+lUYExKQQKCAQEA/uVYE2/H\neNcV/uWAI9LspANXHJE33TFMZ8SuyOYtp3MYJizmQ1uT7Om2LEanDnNiz+fAQhrE\nvo1sDIF9xOAde2qjIH+iDzcLvFPgC3gkQspFjU31M9OO5xAjzBxfL3KDiG2MtmTR\nhNuKJX56eCOqkEp6WKaWOA35ccaKYHxNzMS49weCv95ZPpR9q0J1sgzD7HtVh4yu\nXI01/BC8F0RmYjtsuUo+PmB6sO2K94uqqo0GPUos7Mhgrbff3L36EkOPgmRiA1AV\nZy1sKKxUKspGQ3m1fg+CA/+GZGckvYkVot1lFrwmrS2dok8EhT1HcVJde+++jx7z\nJsRLgFRvKHXklwKCAQEAxsAfxIQjjjKmuyJCzIvxG7lnuzovdy4OEdSuJL4yK5m3\n4BHJHn+yHeRIcrDnJKUTUYffcH/OjOnJS94BA6wH1tEuvGQz6LV6UpwApZ1M/2md\nnP0eC2L2JtSRL8mdxfyqXDloWMpD7rncBZ6ChLEZ6sWYa6WBQTARmPVePyUpNNG2\nqymxN3/vRBGGBunD3j6zX0M0szWK5iU+qsYDy3KzCKG8FU7XxwzRbP7iARRD5Hpt\nZmy2W52EJg1uhmlVXJMm32SEBfrD2oDmlnjAqaZdqi5Mq2e4uB3dhM9RwJppSALG\nBY6k9DeanAFbOlawMJri2pk7B0phCn+DN2pg0+W3ywKCAQBeTwzfZCQxmaMRxGg8\n2PWlWXcJotFAjdTvL95bho6tve/ZcBNiKKf6qB43E40L07VjpyODUdQpjLnFhsO5\n7BH8b+AbTh3v8zXsYDwtAi6oZ56EQavPmR7ubxJPms+9BmmUOLQvZ+39ch0S8lDt\n0oRxDp1l330FEGaSqhrYyCUg9khZXfYKd4IdnWNB0j0pu39iJ9/lXy/EHpsywB5X\nnX8kKUh45fdRrPC4NauNG6fxomwEkUU99oWOwNGbIs87orOeUvXQs/i3TB8QjXI2\nwtBsdsOn+KTqRci7rU3ysp3GvJOCbesBeDcyrnnFsn6Udx0Plgyzd4gPd+FXgeX+\n2l/RAoIBAH81FKAY2xD2RlTb1tlIcGeIQWZKFXs4VPUApP0LZt0VI+UcPRdyL7SG\nGgCeTTLdHQI/7rj4dGEoeRg/3XJWNyY8+KbHk5nMHaCmDJvzlAaduK10LDipfFba\nEpr9dif0Ua15aNn7i4NOHg7Sp0L6f1YOZkHvykzI0VqPIWVVCYyu9TWUF8Mn9SIh\n/SCLmjuy8ed1AlP5Xw9yoyt2VZNvtDtAGTuiHOVfxOL4N/rs149y9HZr+kOlC6G3\nUxhgbqwz2tt8YCvblmNRwURpwRZUTvrPa28Bke713oRUlUSrD9txOwDvjZBpzmEv\nVQ5/0YEqgSvcizVdW8L2XiunwJWfIAUCggEBALr4RF9TYa37CImZOs+vJ8FGRKMz\nh1EUwO2PvuITvkTtu/7E4IjyxAo5dkAokkWQCGABciiDJJEYUWqcUX45qQChOgtm\nNU2od6f9tgyDFxN5KS8cE32NXV3rJXs3bBZmIKLSPETf3uIPuEpFPjpdR5v5jlV+\nTDjH4RrItE3hDCvypTXhXXMmWp3VfYbgEfIP03uR2iIhL+/g3BUqbrywPEsTViSN\nNM/uBDQyamXLXB1bQ2I/Ob41I82PD1iNCqGi7ZvZ3eVYGgUTQyw6Q4O8glTPP9cC\nSFVXwE9gHbLe8TqfTZCWrM6crGX6Bb6hV2tqNsA+7J69U9NGuw5GNqXjafU=\n-----END RSA PRIVATE KEY-----\n",
      "rsa_private_b.pem":
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAyb1grrN+29fxeeEbTaSEja6TKDTpT/WXnqrFCS+h7IYcnDoA\nVwcsPU5FZeUPvLKMzi9NHSJ34LQCurqHgH8X+cw0YT3gdYS/7qoQiXs+zKv615Nc\nttD3xlQLceY+NwznoPXyyZwOeZqyU5Hiqbrqu6hdr6gQYogMNLn2NxBW2pGegd6+\nZGMCX3+/BtMP/6tXmttYjY+yhN2SrGz5cKhWpcHiC6X+B7uCKoKZy+t2jUxYVKUw\nWr1ZuM8kpSnuVCcv1OoMGEimEHA7v/eaF/y+z/VdQ4Y88GhTnVN4KbtgZ+o9Pohj\nxLFU62VeTALixU5mPQKSgSICKfjev0FUUurF6wIDAQABAoIBAQCs11C/PM/iYNfl\nmSSAWAStMrWni/Wc6QhXC2422ZV8hMZ8XwEtjtqrR6UTkLXz8HHMsR/7Zy2X2gJA\no1E2mS0ceoUiDxaA+RRL0W7Lq0j5qBsImZukkdLHG/iWRDJnjenhsParHsYUD6Lb\nELFGw/safjyOI4quMGtsvSqisKAJL5ZCPD5JHLhnNP8HXT6icSZrsqGhunb2tsa+\nOgcx1+bZzqdTsbvXdbw07Lnd/LRU0NDhjeEVl4J2yFNYY+OIj7/qrxSnZnGLLG0Y\nDFxiD+HCMvTBSooqvWI6FAipfyCGjUznGsVaRv7TuzHPuKE4LtbIC/Ac3Q10rKWq\nPmHALir5AoGBAOhGUCToWfYnj2zH0GIZQxnkrv9iRqmdGeCDX6ZM00Bs5tASnRo0\no90UtLbhWjHe1PKRKFyD4I7a8iIWxcWWun2XHgOtItctPN+lbjpTHTyE2yA1iZhe\ndKCV3bAo4t+puKrPkZmaBqFD/fQx7DNxYdRERa1giiZGhlMUN3l7/S21AoGBAN5Y\nnZ68NkTgklk4YBzsxwsMpQbgbihyG79gtDFxWonxZUQ29EsL01yd30pJNhg1LxDN\n0fADfHVzkZ3qYz9knge9a75Yk8UBM3DM+xu+DRkjKhK5mPX5oLvj6061u3Scs6tj\norpU/mV1amz5gqrkefMaelsdHRuGGZQVx9KTV2kfAoGBAN7EAL1E8nK4Qj/r6xkK\nbWZ6ArQABxFJELZYiPWvnLOfPka0c2PctIOmBiOXQa+urMDvIqyH9mhL6Al1mbwE\n8VreAfU4qb+BLW649FyPteyC5r2fWxV9EZGp6fG3ZM9psShw5o1QQaeM1BTNhGFa\nDp9L0x+TBSvsW4t2SjYDCjA5AoGASzxxGWVWd7gFzWrmGuOD9pkwvkLzA3yZJwjx\n8EkK+eJVAeAWic5WluBUzi43v7k/U9BRWYXUd2nDvEuziZ/iWXwfGSmf1umxHlo+\nHgURKZBcjDmBKLpvSSS2WsvjwnHD2hq81ZAtBOfWO0myjWECYuByxqHzV3zo6tLz\n6q0wxsECgYA26twPrAoRqvfvPnNj6o0LrsE39Tj6jHIVijT7Lbcf2xVnaDiQ18PQ\nRC6Tgkz5KZf8GKfMRMA3WopGn9QE2luI4RLIbhLozEDrkk2L7wSYqI9DZ1Hd26wf\nv3+3jdpsXkzHwWYz1a2+FhCF5mJJRQl6kd/B0wu00vdfwviK9OVO7w==\n-----END RSA PRIVATE KEY-----\n",
      "rsa_private_encrypted.pem":
        "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,DB3D20E60E8FDC3356BD79712FF8EF7E\n\nK+vu0U3IFTJBBi6zW5Zng80O1jXq/ZmlOFs/j/SQpPwfW1Do9i/Dwa7ntBlTwrCm\nsd3IIPgu2ikfLwxvbxsZN540oCaCqaZ/bmmyzH3MyVDA9MllUu+X8+Q3ATzcYa9R\nU5XfF5DAXsSRnstCbmKagWVQpO0oX8k3ratfny6Ixq86Y82tK8+o5YiBFq1kqa+9\n4yat7IWQbqV5ifUtUPCHZwEqBt+WKazX05BqERjkckHdpfaDrBvSSPXTwoLm6uRR\nktkUVpO4tHMZ4VlcTfFtpz8gdYYod0nM6vz26hvbESHSwztSgMhmKdsE5eqmYfgu\nF4WkEN4bqAiPjKK3jnUKPt/vg2oKYFQlVYFl9QnBjiRqcQTi3e9lwn1hI7uoMb6g\nHuaCc57JJHPN/ZLP3ts4ZxFbwUjTGioh5Zh6WozG3L3+Ujwq/sDrAskRyzdcuP7I\nRs3oLbHY03OHyg8IbxR5Iu89l6FLqnR45yvbxXtZ7ImGOPM5Z9pB1CzDhGDx2F6g\nJ/Kf/7ZF2DmYUVbVKDfESEDhRfuMAVzhasDPTRqipSA5QvJVQY+J/6QDPrNNmHVB\n4e4ouHIDWERUf0t1Be7THvP3X8OJozj2HApzqa5ZCaJDo8eaL8TCD5uH75ID5URJ\nVscGHaUXT8/sxfHi1x8BibW5W5J/akFsnrnJU/1BZgGznIxjf5tKfHGppSIVdlKP\n3ghYNmEIFPNJ6cxuUA0D2IOV4uO3FTCU6seIzvJhYkmXnticcZYGtmGxXKrodtzS\nJ1YuaNkkO/YRZah285lQ6QCIhCFo4Oa4ILjgoTQISuw7nQj5ESyncauzLUBXKX0c\nXDUej64KNTvVF9UXdG48fYvNmSZWCnTye4UmPu17FmwpVra38U+EdoLyWyMIAI5t\nrP6Hhgc9BxOo41Im9QpTcAPfKAknP8Rbm3ACJG5T9FKq/c29d1E//eFR6SL51e/a\nyWdCgJN/FJOAX60+erPwoVoRFEttAeDPkklgFGdc8F4LIYAig9gEZ92ykFFz3fWz\njIcUVLrL+IokFbPVUBoMihqVyMQsWH+5Qq9wjxf6EDIf0BVtm9U4BJoOkPStFIfF\nKof7OVv7izyL8R/GIil9VQs9ftwkIUPeXx2Hw0bE3HJ3C8K4+mbLg3tKhGnBDU5Z\nXm5mLHoCRBa3ZRFWZtigX7POszdLAzftYo8o65Be4OtPS+tQAORk9gHsXATv7dDB\nOGw61x5KA55LHVHhWaRvu3J8E7nhxw0q/HskyZhDC+Y+Xs6vmQSb4nO4ET4NYX1P\nm3PMdgGoqRDJ2jZw4eoQdRKCM0EHSepSAYpO1tcAXhPZS4ITogoRgPpVgOebEQUL\nnKNeNu/BxMSH/IH15jjDLF3TiEoguF9xdTaCxIBzE1SFpVO0u9m9vXpWdPThVgsb\nVcEI487p7v9iImP3BYPT8ZYvytC26EH0hyOrwhahTvTb4vXghkLIyvPUg1lZHc6e\naPHb2AzYAHLnp/ehDQGKWrCOJ1JE2vBv8ZkLa+XZo7YASXBRZitPOMlvykEyzxmR\nQAmNhKGvFmeM2mmHAp0aC03rgF3lxNsXQ1CyfEdq3UV9ReSnttq8gtrJfCwxV+wY\n-----END RSA PRIVATE KEY-----\n",
      "rsa_private_pkcs8.pem":
        "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQC33FiIiiexwLe/\nP8DZx5HsqFlmUO7/lvJ7necJVNwqdZ3ax5jpQB0p6uxfqeOvzcN3k5V7UFb/Am+n\nkSNZMAZhsWzCU2Z4Pjh50QYz3f0Hour7/yIGStOLyYY3hgLK2K8TbhgjQPhdkw9+\nQtKlpvbL8fLgONAoGrVOFnRQGcr70iFffsm79mgZhKVMgYiHPJqJgGHvCtkGg9zM\ngS7p63+Q3ZWedtFS2RhMX3uCBy/mH6EOlRCNBbRmA4xxNzyf5GQaki3T+Iz9tOMj\ndPP+CwV2LqEdylmBuik8vrfTb3qIHLKKBAI8lXN26wWtA3kN4L7NP+cbKlCRlqct\nvhmylLH1AgMBAAECggEBAJLZ6ti7yDKgY+LcT/NiBDqKyEUBlbMNZIW5vAPnBKbh\nJIDO9WIv9Fs7qSpLbnFHnr0OYtGIfMPXtUiYkyw0QJSc+upHZMvbno4llpes0eHc\njWVTBWETON4oywvj/Kz53vRc9eiKhxVuVWyagNcQgYSprjzLA+9UTcWeB67Guyrf\n8YJUE2LC23RiMA5nGYoSHfVRl0c75gj7A0X9nwpAI+xw3kcaVHRIhA6WowA3Pj1o\npK2t692+NLVRylpvMMSS4rziDexomFykCFukYWYB/kZOOSSETSsTWoMXXl1KqsoZ\n8IW06NR4rXtIgQ3sTfbYKGZNF5nWFgZ+hJVx0We1Qg0CgYEA8UovlB4nrBm7xH+u\n7XXBMbqxADQm5vaEZxw9eluc+tP7cIAI4sglMIvL/FMpbd2pEeP/BkR76NTDzzDu\nPAZvUGRavgEjy0O9j2NAs/WPK4tZF+vFdunhnSh4EHAF4Ij9kbsUi90NOpbGfVqP\ndOaHqzgHKoR23Cuusk9wFQ2XTV8CgYEAwxHdEYT9xrpfrHPqSBQPpO0dWGKJEkrW\nOb+76rSfuL8wGR4OBNmQdhLuU9zTIh22pog+XPnLPAecC+4yu/wtJ2SPCKiKDbJB\nre0CKPyRfGqzvA3njXwMxXazU4kGs+2Fg+xu/iKbaIjxXrclBLhkxhBtySrwAFhx\nxOk6fFcPLSsCgYEAqS/Mdr5CMRGGMH0bKhPUWEtAixUGZhJaunX5wY71Xoc/Gh4c\nnO+b7BNJ/+5L8WZog0vr6PgiLhrqBaCYm2wjpyoG2o2wDHm+NAlzN/wp3G2EFhrS\nxdOux+S1c0kpRcyoiAO2n29rNDa+jOzwBBcU8ACEPdLOCQl0IEFFJO33tl8CgYBY\nDOIqnEsovsucvh3MNzHwkg8i7CdPGHSmUIN0J9/ItpPxYn2VdtccVOM6+3xZ8+uU\nM/9iXGZ+TDkFsZk4/VUsaNmfYOQf1oyLA2ZsNcU90bQbeHNCi/H/19qOJFXgNaCE\nsd5P3DMl9lptFGIjRVBHjvbfTQBUR5fi+BusMGfrTQKBgQCTtzMEJP2sef883AJr\nXuGVPLzwLi9eTBvPzc5r5pfkvh7mDDmWFxHZm5kctvavqgy32uUPsQgMi1Kz67bU\ns5dY9MCVrN2elhTLD8LOiAz8836o3AxFefm5cUWGaU/aZWDYR0QtNqFdyHyRaodo\nJJfnfK+oK1Eq7+PvpXfVN9BkYw==\n-----END PRIVATE KEY-----\n",
      "rsa_private_pkcs8_bad.pem":
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQC33FiIiiexwLe/\nP8DZx5HsqFlmUO7/lvJ7necJVNwqdZ3ax5jpQB0p6uxfqeOvzcN3k5V7UFb/Am+n\nkSNZMAZhsWzCU2Z4Pjh50QYz3f0Hour7/yIGStOLyYY3hgLK2K8TbhgjQPhdkw9+\nQtKlpvbL8fLgONAoGrVOFnRQGcr70iFffsm79mgZhKVMgYiHPJqJgGHvCtkGg9zM\ngS7p63+Q3ZWedtFS2RhMX3uCBy/mH6EOlRCNBbRmA4xxNzyf5GQaki3T+Iz9tOMj\ndPP+CwV2LqEdylmBuik8vrfTb3qIHLKKBAI8lXN26wWtA3kN4L7NP+cbKlCRlqct\nvhmylLH1AgMBAAECggEBAJLZ6ti7yDKgY+LcT/NiBDqKyEUBlbMNZIW5vAPnBKbh\nJIDO9WIv9Fs7qSpLbnFHnr0OYtGIfMPXtUiYkyw0QJSc+upHZMvbno4llpes0eHc\njWVTBWETON4oywvj/Kz53vRc9eiKhxVuVWyagNcQgYSprjzLA+9UTcWeB67Guyrf\n8YJUE2LC23RiMA5nGYoSHfVRl0c75gj7A0X9nwpAI+xw3kcaVHRIhA6WowA3Pj1o\npK2t692+NLVRylpvMMSS4rziDexomFykCFukYWYB/kZOOSSETSsTWoMXXl1KqsoZ\n8IW06NR4rXtIgQ3sTfbYKGZNF5nWFgZ+hJVx0We1Qg0CgYEA8UovlB4nrBm7xH+u\n7XXBMbqxADQm5vaEZxw9eluc+tP7cIAI4sglMIvL/FMpbd2pEeP/BkR76NTDzzDu\nPAZvUGRavgEjy0O9j2NAs/WPK4tZF+vFdunhnSh4EHAF4Ij9kbsUi90NOpbGfVqP\ndOaHqzgHKoR23Cuusk9wFQ2XTV8CgYEAwxHdEYT9xrpfrHPqSBQPpO0dWGKJEkrW\nOb+76rSfuL8wGR4OBNmQdhLuU9zTIh22pog+XPnLPAecC+4yu/wtJ2SPCKiKDbJB\nre0CKPyRfGqzvA3njXwMxXazU4kGs+2Fg+xu/iKbaIjxXrclBLhkxhBtySrwAFhx\nxOk6fFcPLSsCgYEAqS/Mdr5CMRGGMH0bKhPUWEtAixUGZhJaunX5wY71Xoc/Gh4c\nnO+b7BNJ/+5L8WZog0vr6PgiLhrqBaCYm2wjpyoG2o2wDHm+NAlzN/wp3G2EFhrS\nxdOux+S1c0kpRcyoiAO2n29rNDa+jOzwBBcU8ACEPdLOCQl0IEFFJO33tl8CgYBY\nDOIqnEsovsucvh3MNzHwkg8i7CdPGHSmUIN0J9/ItpPxYn2VdtccVOM6+3xZ8+uU\nM/9iXGZ+TDkFsZk4/VUsaNmfYOQf1oyLA2ZsNcU90bQbeHNCi/H/19qOJFXgNaCE\nsd5P3DMl9lptFGIjRVBHjvbfTQBUR5fi+BusMGfrTQKBgQCTtzMEJP2sef883AJr\nXuGVPLzwLi9eTBvPzc5r5pfkvh7mDDmWFxHZm5kctvavqgy32uUPsQgMi1Kz67bU\ns5dY9MCVrN2elhTLD8LOiAz8836o3AxFefm5cUWGaU/aZWDYR0QtNqFdyHyRaodo\nJJfnfK+oK1Eq7+PvpXfVN9BkYw==\n-----END RSA PRIVATE KEY-----\n",
      "rsa_pss_private_2048.pem":
        "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADALBgkqhkiG9w0BAQoEggSoMIIEpAIBAAKCAQEAy4OMdS84PlgI5CRL\nbdbud9Ru7vprFr2YNNUmdT7D3YgApiv8CjzKXLiVDnbMET+lwmtag/EcZsxVCKov\nsu30pYASBriHOiMVYui9+ZaJoQ9yI6lOjG1RbuUBJXNSjHBJxqBqmcgZOb1mdRr/\neXzpAMWJ3hfuLojU2+zUSJ3/rvepepcLFG2q9nA0+PJskJ7Pnh3L0ydnv3U3hduM\nn5OVfm/Jx1FPyZpD184tJff+N+MY3s3hIcfuOnL9Pl4RPGeaTC4T1o460NaG6bG7\nc2Whg6NOaVgaFIaiNbrTTNCpVjeTyalsTXYlQQ3hiKjst0Q7pfFEkJDo8qiqLad1\nMsl59wIDAQABAoIBAQC6G8aqs0/f02nuGDLSc6cH9kCsUlz0ItW6GuJcfdVoFSNi\n0v5d7lGwkSveWk0ryOSw8rOHzUqHx3xLvDZ6jpkXcBMMClu/kq3QEb8JK90YaKOc\ncQvf52h83Pc7ZEatH1KYTcKudwp6fvXfSZ0vYEdD6WG2tHOgIollxSIsdjCHs1qi\n7baNHdK9T4DveuEZNcZ+LraZ1haHmFeqIPcy+KvpGuTaLCg5FPhH2jsIkw9apr7i\niFLi+IJ7S5Bn/8XShmJWk4hPyx0jtIkC5r2iJnHf4x+XYWZfdo7oew3Dg6Pa7T6r\nI164Nnaw0u0LvO4gQdvYaJ/j9A602nHTp7Tsq8chAoGBAOtVHgIqpmdzwR5KjotW\nLuGXDdO9X6Xfge9ca2MlWH1jOj+zqEV7JtrjnZAzzOgP2kgqzpIR71Njs8wkaxTJ\nTle0Ke6R/ghU9YOQgRByKjqJfQXHZnYFPsMg0diNYLroJ4SG8LO4+2SygTYZ4eKL\nqU0bda3QvQ7FL+rTNQBy01b9AoGBAN1jEQI80JxCT7AMvXE6nObIhbkASHte4yOE\n1CBwcOuBEGcuvMOvQVMzKITgea6+kgsu4ids4dM5PTPapQgpKqIIQ2/eSesaf56g\n73clGGSTPHJP0v+EfKg4+GYJf8o2swT0xDHkgWLgjjdsncB9hATc2j6DvHeau18d\npgCLz9kDAoGAXl/SGvhTp2UqayVnKMW1I07agrGNLA4II5+iiS4u4InskCNSNhr/\nKATj6TJ82AuTdCGGmdmLapuvPQzVzI42VsGvlzcA8wJvOwW2XIwMF1GPy8N9eZL8\n6m+89+Uqh4oWXvVmjgx+9JEJdFLI3Xs4t+1tMfll+AhoAPoWZUmnK1kCgYAvEBxR\niXQfg8lE97BeHcO1G/OxfGnsMCPBLT+bFcwrhGhkRv9B6kPM2BdJCB9WEpUhY3oY\nP4FSUdy85UIoFfhGMdOEOJEmNZ/jrPq7LVueJd63vlhwkU2exV2o82QDLNWpvA7p\nPFZ1Gp+hEKoIfaZPElQi7gZmtrIWaksb2pz42QKBgQCct9NP2qJfqeS4206RDnfv\nM238/O2lNhLWdSwY0g+tcN+I1sGs3+4vvrm95cxwAmXZyIM11wjdMcAPNxibodY7\nvufsebPHDBA0j0yuTjGkXefUKd1GdO88i5fppzxB7prDX9//DsWWrFhIMMRNYe0Q\naeHd/NPuHcjZKcnaVBgukQ==\n-----END PRIVATE KEY-----\n",
      "rsa_pss_private_2048_sha1_sha1_20.pem":
        "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQowAASCBKcwggSjAgEAAoIBAQCpdutzsPFQ1100\nouR5aAwYry8aAtG0c+zX9UqNXGCpRDWzPPpXHUZSB1BmTTL4EhK2tkAfblYNqzRu\nCAYlKHbFpFLs2zLEorfp0WsFNPaBHE9JHpLIM4oXxPCUypZ7JAn56ZYonYCZ8Il5\n8SzD9aoF41RTEmpcx3XkL2RQa022RiSccYZKx/yzskUUAdTvTvYyujH1MkvsfVP+\nNs5bRL6IVqowFd3xv6ctvfQMxz0rltgTC+wOm3CFtn+G63y6P/Z0U2DRdacsNkN6\nPFGXAIB0kSvKzs8gVocEBiSwMkcT/KD3R68PY18b2auqaGcm8gA+gaVJ36KAW4dO\nAjbY+YitAgMBAAECggEAfPvfFXln0Ra1gE+vMDdjzITPuWBg57Uj9fbMIEwEYnKT\nJHmRrNRDe9Y3HuxK7hjuQmFSE5xdzUD6rzgtyBP63TOfkV7tJ4dXGxS/2JxCPeDy\nPNxWp18Ttwoh4as0pudikDYN8DCRm3eC/TO5r2EtH6CVHZuUZI8bTMsDMiihrQ8F\nB8+KucBG5DDy/OlDeieAZxZA4Y0/c+W0DNZ/LIPGwaqMzYCSZJXyV0t33HytUwM2\nQZ+RbWqcUcrCI3lFAO8IyEULCi+RnSByZeJ0xwUkdQTI5jT6+G8BrO70Oiab8g+Q\nRx2s7PxWpIMVS7/JD1PsL4hLrVh3uqh8PZl3/FG9IQKBgQDZWkOR2LA+ixmD6XJb\nQ+7zW2guHnK6wDrQFKmBGLaDdAER64WL1Unt6Umu7FPxth2niYMEgRexBgnj5hQN\nLfPYTiIeXs5ErrU96fVQABsV0Hra1M2Rhve5nynjFFpbHjDXtizzLpE30MsC7YkN\nEqD4YYzjWHrbk/UlQ7tx3eAvtQKBgQDHmNM4TRuyH2yaYxDqnho6fgJv7Z4KgbM0\n1wcUxi5kPDQsFtaVOzFhNserzsWvotQjLkC2+CK5qlCdm59ZlpUqszF6+YyUs5Gq\nWmHdqryduT1VxSV/pd6wGEQo27fxFV7LsT1JhVMh9Iri8MK0b1BD6+kVUf5NcKDB\nOd2o8A1gGQKBgA5Y3Pj1mrymJesFL91CYLWDpR7WN7CIG9m8Y2v4G6QVtjRenZQb\nYiPoMErxoqDj6pUyiIl1lADFa0W13ED6dYwjrDDhBTCXb7NEjELZnvATsOhc/6zJ\ngfSowvUQVN6K4aJ7jgAHZOKQT7ZDw7YvMpzyo4AmSQXRgG8TR34+rRu5AoGACApP\n9+SjSPmbFl0HQWw9Aj4xOvEHfMTcwzQmRN/23nLOZzhETJ6lzpS2VmVt8TVN9lzW\nnohAXdpOhQrP0HwQZjfxtlJ3J0ZUh9g8OQG3t2LO5bWbXRkBb3aKyFqRflSuDOaG\n4X9NagC/14R7U2loglPuf71d0SDIWQBLvZJt94ECgYEAnY7aKHnWdLszcB8uyEkJ\nEJkUEaa+K/nTqOzqffZ01cTWJmUG7a2KuvQ+UQM2BHk2+wBmUo45Iz/dyePOJY0B\nFu2agiV4+R4z2XVQnIvXgY5HaPxvLz0THksY/pD58gBmFaLMx4ADEwQ+s4Y2g12H\nABsKNRHfSnKTwOm/dYvcVqs=\n-----END PRIVATE KEY-----\n",
      "rsa_pss_private_2048_sha256_sha256_16.pem":
        "-----BEGIN PRIVATE KEY-----\nMIIE7wIBADA9BgkqhkiG9w0BAQowMKANMAsGCWCGSAFlAwQCAaEaMBgGCSqGSIb3\nDQEBCDALBglghkgBZQMEAgGiAwIBEASCBKkwggSlAgEAAoIBAQDfqNM4C+QtD73i\nILqOkqfV8ha3O19jpX8UujIk1Z72bbbuwEzh0+sBw0dD0N8CgkXnePOEEd6q7HNm\nbyCNqRpDK6NDvaCMDWgEaD/PlHkRntvKh81IXSMC5imjRfOcZIE/Gnw7h8tanab0\nn75+ODvLJrmEWUG2q79Im1mWMx7Spod+Np6XEY+7I7nAUUWivr35Yx5DeyxY8rxF\nGpsLtGsi7JNQO4aHyeBpj8tz0Fhv23uPywE2nGmPHfnkXWbrTcHGbzYBgEbeSH9K\nUkRwczqDXNOPhtfaEHEFTm0MoeKCnJe1VOjSywev77dV1KZfpVh3Kh0ZRQIe9YOV\nJhj4lMx3AgMBAAECggEBAIc+IgK5Bg/NfgeXvNdrjPuM+PlxeHvb3h1dfebSGd5v\nd3elZpgDug6F07kJO2Db/4M5mx7YY2m9swZU2j1u7MeDQqU6rDMkBCruEu/lmtPx\n2Hv+ZD6Gux4MqU7mhKmkCJds34Rr16aCwCsZ0WmnfViZoQKLqnXYIsG31pNBdDjx\ngke0HhX1LkA9yTVwlk8xOaHPqI4KfsFAyoiiHzyttGDexzb1PzmM0pybAPDMhpN/\nwXp2kLjyzmUmPe2Y2yva69WVWo7qS6joKjY75MQ1t20HYgEL69IApvCPu4CANfi9\nj3FAaV/+WrnhKCi6QyUi5PCI/+AJLsjNQmqTXIdBEoECgYEA+XsgFbeZ6+ZzEHa7\nHyFH6kiyBLd0q7w+ZLPsoOmEApDaP3yXSC7eJU7M/tPUPj8VQMMSK2D6fgmUDwhb\n3mEXFZxf67UlPFsFjweYcBihwy4r8QKBwury6dEbHPSUq4mXFJF5XRQdGqRGkr/F\n8OLZ0MwmHLUzczA67PxP/wF8TsECgYEA5YD4RxxJJYfAk1rFbqHRhNB8UeYVL+Wo\nwsRET1JeFg+S5grLGUga+KBB8Jn7Ahaip7MVE0Iud1cgaDi4WBEJsbJ6oJTlHJEg\nJq7QAaBafwjeSCSnaEsVBVNvriy2WF7uAomLSKmW6uSUOBBFFt4+G+akG56EfOPc\n7YKBfsf5ITcCgYBvjVZzX307tfeNTQmuibsWTxsKcN2CTNG5RZpw+PlGDG8KJDOg\n2xQJqoqPBzjH/H0MUC03qE1ZPf8uGZa6gL9JsnpRctYLfselhMfsl5b9JxAO3AgZ\nl+S2GAH/mH1BlmwvjjyuGehJmVrVE1r2sviiHCaOf5dZ0h8HCGrco1VqAQKBgQCf\nfYkMofOTSUvjG2mpAHuCOQCsSaDfsFIfSBXQqgUIf7ouc8HAyAM2VOh+NAPj56cR\ns7opsAxqkvnKc+BoEy8Rdl8RyWeO+qvFNicHelBph9gxeod8SvFIyjsKZ7gwoYf1\n63AIBxMCGeeHLodU5Q10hkv1hau8vv2BcPhdCstu8QKBgQDgO4Rr36Pa5rjbNbGN\nPsJqALjthTeU0yaU8hdC7Hc7B/T6npEIhw3s1eNq7e0eeDltqz7tDnY8qysazbQZ\np1cV5TJ8+gtwGmDoADBnU1NXqX4Squfml6OhNEucpTdjux7JdLVmmQFraOT2Eu5f\n9uuNtA+d8uhBEXhskuvEC552ug==\n-----END PRIVATE KEY-----\n",
      "rsa_pss_private_2048_sha512_sha256_20.pem":
        "-----BEGIN PRIVATE KEY-----\nMIIE5wIBADA4BgkqhkiG9w0BAQowK6ANMAsGCWCGSAFlAwQCA6EaMBgGCSqGSIb3\nDQEBCDALBglghkgBZQMEAgEEggSmMIIEogIBAAKCAQEAvM9NgMCDqy5dqj5Ua2cZ\ncc4zVr+fCF34bZn63OBeYG8RTJKM3j36lO/yamtfDctDhb87b45CS6ipEr8J57I9\nWF55TNngsn6GNpXgwAe0eFXUnKonuqnGEC7x8r3vkAg99PBKhAtFc5oTaaZDAFKM\nzc5dIC/J0Y+kxhqjCPNI0ydQgZmKBrmYjM9cvbOYgRQL10GrWeJ+XHk2E33endaF\n+4dwjgyrzInt/l6OTkiCL8F59J/htk1GPru9BT6w5yOS/vH6q6FD6uizULVznytd\nlHjgnrVaHJmsqVjrYQa9OAZj9GBrTelBWvQ9b6+FBHUFHBp8HSp82lWCZThPrcZ/\nQwIDAQABAoIBADDzUfWic8CKuc/sbviVdzxRKHBCJ9oEeub3d9mR9gXsZcDDcfAg\ng3nfp6q9gZxS6YOga6llaXyyEnuAufGu/UaO38Xz6tR8BxHZ07YViU11ezTOzJQR\ndf82HJZBdf2SlXWOYtNPFMd+16+ZYl+QB19INE6m9Rz2r9KIj2I/qM7NPPVhDRF0\nG4O0Yf2vaPhjoIaewn7xtQ6wmX7pAGcd8dmYEIGGkBi8aY3BVwrRK1X4AmD+oSmE\nwXqR6MQIzD4KdypL4UD1Cb4GoFeVRclXvegOG+EKl0iD+mjTodB4yjoJh98NYe3+\nGtpR/2u3Ltq8RqWpIg8ryShQk/MIqGJ5KpkCgYEA80uNEYWlBt6QGNvVIYrhnw+V\n2nLJWedioKV4H1sr9OLF/7WFOUfsaflpVybnmwfNV15lEyHb/m/sCM9jTrNk1t/q\nqhRnvtmy3kntxWBeoA2o0TRg/XZKWjabZsr/4UE/Ztws2opOvl9x05IYeZlU+PbZ\nB1lX2e+vtMOpllvRr28CgYEAxqtfrYv8brp/fAUqGu/MtdHxQdU1+vE+auN17gam\nZM6ojIeasX4k2z0Rd/+8Dga9wPgO7hjtFZ2NWD5UwfBiw5U2PVZ6bp3iKSBPGHEh\nRsIR+nw8pFIgsQKoYnVK58tEnfQ31GSupKpYybHbaL5SdId+mfXU86SbKX/MefZX\ng20CgYBjn8hAKI2O5ovy4fHALnJ9A5DFRsOUgN8uERPDIz44pLOXJelLr1vreSnd\nehzUqrk20Xxp/S9sXMA2S1XK4EKmikI5KungiJxp0bP/Yprcxzsdj2k34LxJfJrd\n2Lo2rtUbdYUYaBIeek7N58EF6feVit8L11XV9APq7UQAQdD3GQKBgBmxuGIdpLw9\napeDo3pwYS1yxZ0aEi0uXkA8wtfSDFslTy89qogiJGomb8fxT0URIiF+849fseoF\nwm4TQasDiAJ7ndQ5BwSfbsya3R/wIbmhB+o5fy5RYOED0vtI6DMqWumC2GWjz+KE\nFY+gbRwS4V8o1vrajHwmYdrwKGXtskvRAoGADe/EdlCj98r6Zle9giF1C0GDIDTx\n8bR2m+Ogh9ZO218GpDMNaQ/WmbYVPDYMbRSOEA7y2gVkd1OeYhJMF6aYffp3aWhN\nt9g0uojLY0jfEpWBLBQdlYOTl7hOnLWRRcOAKTlHVg+OuD/O/GmdQ2Rg2H/hAWlI\nmuuTQPuQTCV1aTc=\n-----END PRIVATE KEY-----\n",
      "rsa_pss_public_2048.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIBIDALBgkqhkiG9w0BAQoDggEPADCCAQoCggEBAMuDjHUvOD5YCOQkS23W7nfU\nbu76axa9mDTVJnU+w92IAKYr/Ao8yly4lQ52zBE/pcJrWoPxHGbMVQiqL7Lt9KWA\nEga4hzojFWLovfmWiaEPciOpToxtUW7lASVzUoxwScagapnIGTm9ZnUa/3l86QDF\nid4X7i6I1Nvs1Eid/673qXqXCxRtqvZwNPjybJCez54dy9MnZ791N4XbjJ+TlX5v\nycdRT8maQ9fOLSX3/jfjGN7N4SHH7jpy/T5eETxnmkwuE9aOOtDWhumxu3NloYOj\nTmlYGhSGojW600zQqVY3k8mpbE12JUEN4Yio7LdEO6XxRJCQ6PKoqi2ndTLJefcC\nAwEAAQ==\n-----END PUBLIC KEY-----\n",
      "rsa_pss_public_2048_sha1_sha1_20.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQowAAOCAQ8AMIIBCgKCAQEAqXbrc7DxUNddNKLkeWgM\nGK8vGgLRtHPs1/VKjVxgqUQ1szz6Vx1GUgdQZk0y+BIStrZAH25WDas0bggGJSh2\nxaRS7NsyxKK36dFrBTT2gRxPSR6SyDOKF8TwlMqWeyQJ+emWKJ2AmfCJefEsw/Wq\nBeNUUxJqXMd15C9kUGtNtkYknHGGSsf8s7JFFAHU7072Mrox9TJL7H1T/jbOW0S+\niFaqMBXd8b+nLb30DMc9K5bYEwvsDptwhbZ/hut8uj/2dFNg0XWnLDZDejxRlwCA\ndJErys7PIFaHBAYksDJHE/yg90evD2NfG9mrqmhnJvIAPoGlSd+igFuHTgI22PmI\nrQIDAQAB\n-----END PUBLIC KEY-----\n",
      "rsa_pss_public_2048_sha256_sha256_16.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIBUjA9BgkqhkiG9w0BAQowMKANMAsGCWCGSAFlAwQCAaEaMBgGCSqGSIb3DQEB\nCDALBglghkgBZQMEAgGiAwIBEAOCAQ8AMIIBCgKCAQEA36jTOAvkLQ+94iC6jpKn\n1fIWtztfY6V/FLoyJNWe9m227sBM4dPrAcNHQ9DfAoJF53jzhBHequxzZm8gjaka\nQyujQ72gjA1oBGg/z5R5EZ7byofNSF0jAuYpo0XznGSBPxp8O4fLWp2m9J++fjg7\nyya5hFlBtqu/SJtZljMe0qaHfjaelxGPuyO5wFFFor69+WMeQ3ssWPK8RRqbC7Rr\nIuyTUDuGh8ngaY/Lc9BYb9t7j8sBNpxpjx355F1m603Bxm82AYBG3kh/SlJEcHM6\ng1zTj4bX2hBxBU5tDKHigpyXtVTo0ssHr++3VdSmX6VYdyodGUUCHvWDlSYY+JTM\ndwIDAQAB\n-----END PUBLIC KEY-----\n",
      "rsa_pss_public_2048_sha512_sha256_20.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIBTTA4BgkqhkiG9w0BAQowK6ANMAsGCWCGSAFlAwQCA6EaMBgGCSqGSIb3DQEB\nCDALBglghkgBZQMEAgEDggEPADCCAQoCggEBALzPTYDAg6suXao+VGtnGXHOM1a/\nnwhd+G2Z+tzgXmBvEUySjN49+pTv8mprXw3LQ4W/O2+OQkuoqRK/CeeyPVheeUzZ\n4LJ+hjaV4MAHtHhV1JyqJ7qpxhAu8fK975AIPfTwSoQLRXOaE2mmQwBSjM3OXSAv\nydGPpMYaowjzSNMnUIGZiga5mIzPXL2zmIEUC9dBq1niflx5NhN93p3WhfuHcI4M\nq8yJ7f5ejk5Igi/BefSf4bZNRj67vQU+sOcjkv7x+quhQ+ros1C1c58rXZR44J61\nWhyZrKlY62EGvTgGY/Rga03pQVr0PW+vhQR1BRwafB0qfNpVgmU4T63Gf0MCAwEA\nAQ==\n-----END PUBLIC KEY-----\n",
      "rsa_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt9xYiIonscC3vz/A2ceR\n7KhZZlDu/5bye53nCVTcKnWd2seY6UAdKersX6njr83Dd5OVe1BW/wJvp5EjWTAG\nYbFswlNmeD44edEGM939B6Lq+/8iBkrTi8mGN4YCytivE24YI0D4XZMPfkLSpab2\ny/Hy4DjQKBq1ThZ0UBnK+9IhX37Ju/ZoGYSlTIGIhzyaiYBh7wrZBoPczIEu6et/\nkN2VnnbRUtkYTF97ggcv5h+hDpUQjQW0ZgOMcTc8n+RkGpIt0/iM/bTjI3Tz/gsF\ndi6hHcpZgbopPL630296iByyigQCPJVzdusFrQN5DeC+zT/nGypQkZanLb4ZspSx\n9QIDAQAB\n-----END PUBLIC KEY-----\n",
      "rsa_public_2048.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArk4OqxBqU5/k0FoUDU7C\npZpjz6YJEXUpyqeJmFRVZPMUv/Rc7U4seLY+Qp6k26T/wlQ2WJWuyY+VJcbQNWLv\njJWks5HWknwDuVs6sjuTM8CfHWn1960JkK5Ec2TjRhCQ1KJy+uc3GJLtWb4rWVgT\nbbaaC5fiR1/GeuJ8JH1Q50lB3mDsNGIk1U5jhNaYY82hYvlbErf6Ft5njHK0BOM5\nOTvQ6BBv7c363WNG7tYlNw1J40dup9OQPo5JmXN/h+sRbdgG8iUxrkRibuGv7loh\n52QQgq2snznuRMdKidRfUZjCDGgwbgK23Q7n8VZ9Y10j8PIvPTLJ83PX4lOEA37J\nlwIDAQAB\n-----END PUBLIC KEY-----\n",
      "rsa_public_4096.pem":
        "-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAxeStwofbjtZuol4lwKn1\nw08AzcSNLHfCqNFHa+W7er8is7LQsPljtPT4yn4lsao83ngHFvSC3tbMiRNDpUHY\nqH2wBuUkuOmCtYkZLi0307H0CwcVV6W5P3tNEt80IJ+PqlRxtTknezUtbOasbIi/\naornVWG+psgqDGrFZ4oTsWtiE0Svi7sDqN5E2dijmH/YYnlnwqszgzHdtAnARp1b\nG34E64sqWCmLoGCfPdHtym/CSdxOLOsDV15jrwODZQ/TJZ5thkwKZRxu7g9fwlhA\n1PiI5WDP4reXNaqa2bSgrzpAljQExYs4N0L7okSVOJQX9BEaoWtq8NLU8MpMdGoH\nNDU0Xr60Lfr58Z5qn8RGEvlTxoCbPJzPV2zgzD/lmEqft6NnfTclveA3sd8xSrOB\nUn4o3S8hS0b9Su7PBukHjM96/e0ReoIshSwXlQTLr2Ft8KwupyPm1ltNcTDtjqHc\nIWU6Bg+kPy9mxSVtGGZYAPtqGzNBA/m+oOja/OSPxAblPdln691DaDuZs5nuZCGw\nGcLaJWgiyoqvXAcyXDZFyH4OZZh8rsBLKbnFXHZ/ziG0cAozEygZEPJappw8Lx/a\ndy7WL/SJjxooiKapc7Bnfy8eSLV3+XAKxhLW/MQ6ChJ+e/8ExAY02ca4MpCvqwIk\n9TfV6FM8pWGqHzQFj0v3NL0CAwEAAQ==\n-----END PUBLIC KEY-----\n",
      "rsa_public_b.pem":
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyb1grrN+29fxeeEbTaSE\nja6TKDTpT/WXnqrFCS+h7IYcnDoAVwcsPU5FZeUPvLKMzi9NHSJ34LQCurqHgH8X\n+cw0YT3gdYS/7qoQiXs+zKv615NcttD3xlQLceY+NwznoPXyyZwOeZqyU5Hiqbrq\nu6hdr6gQYogMNLn2NxBW2pGegd6+ZGMCX3+/BtMP/6tXmttYjY+yhN2SrGz5cKhW\npcHiC6X+B7uCKoKZy+t2jUxYVKUwWr1ZuM8kpSnuVCcv1OoMGEimEHA7v/eaF/y+\nz/VdQ4Y88GhTnVN4KbtgZ+o9PohjxLFU62VeTALixU5mPQKSgSICKfjev0FUUurF\n6wIDAQAB\n-----END PUBLIC KEY-----\n",
      "x25519_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VuBCIEIJi/yFpueUawC1BkXyWM8ONIBGFjL7UZHrD/Zo/KPDpn\n-----END PRIVATE KEY-----\n",
      "x25519_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VuAyEAaSb8Q+RndwfNnPeOYGYPDUN3uhAPnMLzXyfi+mqfhig=\n-----END PUBLIC KEY-----\n",
      "x448_private.pem":
        "-----BEGIN PRIVATE KEY-----\nMEYCAQAwBQYDK2VvBDoEOLTDbazv6vHZWOmODQ3kk8TUOQgApB4j75rpInT5zSLl\n/xJHK8ixF7f+4uo+mGTCrK1sktI5UmCZ\n-----END PRIVATE KEY-----\n",
      "x448_public.pem":
        "-----BEGIN PUBLIC KEY-----\nMEIwBQYDK2VvAzkAioHSHVpTs6hMvghosEJDIR7ceFiE3+Xccxati64oOVJ7NWjf\nozE7ae31PXIUFq6cVYgvSKsDFPA=\n-----END PUBLIC KEY-----\n",
    };
    const result = {};
    const attempt = (fn) => {
      try {
        return fn();
      } catch (e) {
        return { name: e.name, message: e.message, code: e.code ?? null };
      }
    };
    for (const [name, pem] of Object.entries(fixtures)) {
      for (const kind of ["private", "public"]) {
        result[name + "/" + kind] = attempt(() => {
          const key = crypto[
            kind === "private" ? "createPrivateKey" : "createPublicKey"
          ]({ key: pem, passphrase: "password" });
          const metadata = {
            type: key.type,
            algorithm: key.asymmetricKeyType,
            details: Object.fromEntries(
              Object.entries(key.asymmetricKeyDetails).map(([k, v]) => [
                k,
                typeof v === "bigint" ? String(v) : v,
              ]),
            ),
          };
          const types =
            kind === "private" ? ["pkcs1", "pkcs8", "sec1"] : ["pkcs1", "spki"];
          const formats = {};
          for (const type of types)
            for (const format of ["der", "pem"])
              formats[type + "/" + format] = attempt(() => {
                const encoded = key.export({ type, format });
                const imported = crypto[
                  kind === "private" ? "createPrivateKey" : "createPublicKey"
                ]({ key: encoded, type, format });
                return key.equals(imported);
              });
          return { ...metadata, formats };
        });
      }
    }
    const key = crypto.createPrivateKey(fixtures["rsa_private.pem"]),
      pkcs8 = key.export({ format: "der", type: "pkcs8" });
    result.derTypes = {};
    for (const kind of ["private", "public"])
      for (const type of [undefined, "pkcs1", "pkcs8", "sec1", "spki"])
        result.derTypes[kind + "/" + type] = attempt(
          () =>
            crypto[kind === "private" ? "createPrivateKey" : "createPublicKey"](
              { key: pkcs8, format: "der", type },
            ).asymmetricKeyType,
        );
    return result;
  },
  cryptoJwkInputs: async function ({ crypto }) {
    const result = {};
    for (const kind of ["private", "public"])
      for (const kty of ["RSA", "EC", "OKP", "bad"])
        for (const value of [
          undefined,
          null,
          0,
          true,
          {},
          "",
          "A",
          "AA",
          "AA==",
          "A A",
          "++//",
          "--__",
          "@@",
          "AAA=",
          "AA===",
        ]) {
          const key = {
            kty,
            crv: kty === "EC" ? "P-256" : "Ed25519",
            n: value,
            e: "AQAB",
            x: value,
            y: "AA",
            d: value,
          };
          try {
            const k = crypto[
              kind === "private" ? "createPrivateKey" : "createPublicKey"
            ]({ key });
            result[`${kind}/${kty}/${JSON.stringify(value)}`] = {
              ok: true,
              type: k.asymmetricKeyType,
            };
          } catch (e) {
            result[`${kind}/${kty}/${JSON.stringify(value)}`] = {
              name: e.name,
              message: e.message,
              code: e.code ?? null,
            };
          }
        }
    const jwk = {
      crv: "P-256",
      d: "DxBsPQPIgMuMyQbxzbb9toew6Ev6e9O6ZhpxLNgmAEo",
      kty: "EC",
      x: "X0mMYR_uleZSIPjNztIkAS3_ud5LhNpbiIFp6fNf2Gs",
      y: "UbJuPy2Xi0lW7UYTBxPK3yGgDu9EAKYIecjkHX5s2lI",
    };
    for (const crv of [
      "P-256",
      "prime256v1",
      "secp256k1",
      "bad",
      "P-224",
      undefined,
      null,
    ])
      for (const kind of ["private", "public"]) {
        try {
          result[`${kind}/curve/${crv}`] = crypto[
            kind === "private" ? "createPrivateKey" : "createPublicKey"
          ]({ key: { ...jwk, crv } }).export({ format: "jwk" });
        } catch (e) {
          result[`${kind}/curve/${crv}`] = {
            name: e.name,
            message: e.message,
            code: e.code ?? null,
          };
        }
      }
    return result;
  },
  cryptoHostKeyMetadata: async function ({ crypto }) {
    const result = {};
    for (const algorithm of [
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      { name: "ECDSA", namedCurve: "P-384" },
      { name: "ECDH", namedCurve: "P-256" },
    ]) {
      const pair = await crypto.subtle.generateKey(
        algorithm,
        true,
        algorithm.name === "ECDH" ? ["deriveBits"] : ["sign", "verify"],
      );
      for (const kind of ["privateKey", "publicKey"]) {
        const key = crypto.KeyObject.from(pair[kind]);
        const hostAlgorithm = pair[kind].algorithm;
        hostAlgorithm.name = "fake";
        if (hostAlgorithm.publicExponent) hostAlgorithm.publicExponent.fill(0);
        if (hostAlgorithm.namedCurve) hostAlgorithm.namedCurve = "fake";
        Object.defineProperty(pair[kind], "algorithm", {
          value: {
            name: "RSA-PSS",
            modulusLength: 3,
            publicExponent: new Uint8Array([7]),
          },
          configurable: true,
        });

        result[algorithm.name + "/" + kind] = {
          type: key.type,
          algorithm: key.asymmetricKeyType,
          details: Object.fromEntries(
            Object.entries(key.asymmetricKeyDetails).map(([k, v]) => [
              k,
              typeof v === "bigint" ? String(v) : v,
            ]),
          ),
        };
      }
    }
    return result;
  },

  fsFileHandleInvalidReceivers: async function ({ fs }) {
    const h = await fs.promises.open("/tmp/fh-receivers", "w+");
    const methods = {
      appendFile: ["x"],
      chmod: [0],
      chown: [0, 0],
      datasync: [],
      sync: [],
      read: [new Uint8Array(1)],
      readv: [[]],
      readFile: [],
      readLines: [],
      stat: [],
      truncate: [],
      utimes: [0, 0],
      write: [new Uint8Array(1)],
      writev: [[]],
      writeFile: ["x"],
      close: [],
      readableWebStream: [],
      createReadStream: [],
      createWriteStream: [],
    };
    const attempt = async (fn) => {
      try {
        const value = await fn();
        if (value?.destroy) {
          value.on("error", () => {});
          value.destroy();
        }
        return "accepted";
      } catch (e) {
        return {
          name: e.name,
          code: e.code ?? null,
          ...(e.name === "TypeError" ? {} : { message: e.message }),
        };
      }
    };
    const result = { fake: {}, closed: {} };
    for (const [name, args] of Object.entries(methods))
      result.fake[name] = await attempt(() => h[name].call({}, ...args));
    await h.close();
    for (const [name, args] of Object.entries(methods))
      result.closed[name] = await attempt(() => h[name](...args));
    await fs.promises.unlink("/tmp/fh-receivers");
    return result;
  },
  fsFileHandleLifetime: async function ({ fs }) {
    const path = "/tmp/fh-lifetime";
    await fs.promises.writeFile(path, "original");
    const old = await fs.promises.open(path, "r+"),
      fd = old.fd;
    fs.closeSync(fd);
    const current = await fs.promises.open(path, "r+");
    const error = async (fn) => {
      try {
        return await fn();
      } catch (e) {
        return { name: e.name, code: e.code ?? null };
      }
    };
    const result = {
      reused: fd === current.fd,
      oldStat: await error(() => old.stat()),
      oldRead: await error(() => old.read(new Uint8Array(1))),
    };
    await old.close();
    result.current = (await current.stat()).size;
    await current.close();
    await fs.promises.writeFile(path, "");
    const empty = await fs.promises.open(path, "r"),
      stream = empty.readableWebStream();
    empty.read = () => Promise.reject(new Error("replacement"));
    const read = await stream.getReader().read();
    result.capturedRead = read.done;
    await empty.close();
    await fs.promises.unlink(path);
    return result;
  },
  fsFileHandleSurface: async function ({ fs }) {
    const error = async (fn) => {
      try {
        const value = await fn();
        return { accepted: true, value };
      } catch (e) {
        return e instanceof TypeError
          ? { name: e.name }
          : {
              name: e.name,
              message: e.message,
              code: e.code ?? null,
              syscall: e.syscall ?? null,
            };
      }
    };
    await fs.promises.writeFile("/tmp/handle-surface-a", "one");
    await fs.promises.writeFile("/tmp/handle-surface-b", "second");
    const a = await fs.promises.open("/tmp/handle-surface-a", "r+"),
      b = await fs.promises.open("/tmp/handle-surface-b", "r");
    const result = {};
    try {
      const prototype = Object.getPrototypeOf(a);
      result.own = Reflect.ownKeys(a).map(String);
      result.prototype = Reflect.ownKeys(prototype).map(String);
      result.descriptor = {
        own: Object.hasOwn(a, "fd"),
        get: typeof Object.getOwnPropertyDescriptor(prototype, "fd")?.get,
        set: typeof Object.getOwnPropertyDescriptor(prototype, "fd")?.set,
      };
      result.publicConstructor =
        a.constructor === fs.promises.FileHandle &&
        a instanceof fs.promises.FileHandle;
      result.constructor = {
        name: a.constructor.name,
        length: a.constructor.length,
      };
      result.new = await error(() => new a.constructor());
      result.identity = a.read === a.read && a.read === prototype.read;
      let receiver = false;
      result.chain =
        a.on("test", function () {
          receiver = this === a;
        }) === a;
      a.emit("test");
      result.receiver = receiver;
      result.borrowedStat = (await a.stat.call(b)).size;
      const detached = a.stat;
      result.detached = await error(() => detached());
      result.fake = await error(() => a.stat.call({}));
      result.fakeReadLines = await error(() => a.readLines.call({ fd: a.fd }));
      result.assign = await error(() => {
        a.fd = 12345;
      });
      const written = await a.writeFile("xy");
      result.writeFile = {
        bytesWritten: written.bytesWritten,
        buffer: Array.from(written.buffer),
        plain: Object.getPrototypeOf(written) === Object.prototype,
      };
      const read = await a.read(new Uint8Array(2), 0, 2, 0);
      result.read = {
        bytesRead: read.bytesRead,
        buffer: Array.from(read.buffer),
        plain: Object.getPrototypeOf(read) === Object.prototype,
      };
      result.noBackend = [
        "fs",
        "refs",
        "closePromise",
        "ref",
        "unref",
        "getAsyncId",
      ].map((name) => name in a);
      await a.close();
      result.closedFd = typeof a.fd;
      result.closedStat = await error(() => a.stat());
      result.closedReadLines = await error(() => a.readLines());
      let closed = 0;
      a.on("close", () => closed++);
      await a.close();
      result.repeatClose = closed;
      return result;
    } finally {
      await a.close();
      await b.close();
      await fs.promises.unlink("/tmp/handle-surface-a");
      await fs.promises.unlink("/tmp/handle-surface-b");
    }
  },
  tlsCustomDuplexStates: async function ({ tls: t, classicStreams: s }) {
    const out = {};
    const tick = () => new Promise((r) => setTimeout(r, 15));
    for (const mode of [
      "eof",
      "writeError",
      "parentObserved",
      "directError",
      "destroy",
      "object",
      "encoding",
    ]) {
      const events = [];
      const custom = new s.Duplex({
        allowHalfOpen: true,
        objectMode: mode === "object",
        read() {},
        write(c, e, cb) {
          cb(
            ["writeError", "parentObserved"].includes(mode)
              ? new Error("write fail")
              : undefined,
          );
        },
      });
      custom.on("error", (e) => events.push("customError:" + e.message));
      custom.on("close", () => events.push("customClose"));
      if (mode === "encoding") custom.setEncoding("utf8");
      let wrapped;
      try {
        wrapped = new t.TLSSocket(custom);
        custom.on("error", (e) => events.push("lateCustomError:" + e.message));
        if (mode === "parentObserved")
          wrapped._parentWrap.on("error", (e) =>
            events.push("parentError:" + e.message),
          );
        wrapped.on("error", (e) => events.push("error:" + e.message));
        wrapped.on("close", () => events.push("close"));
        wrapped.on("end", () => events.push("end"));
        wrapped.on("data", (c) => events.push("data:" + String(c)));
        await tick();
        if (mode === "eof") custom.push(null);
        if (["writeError", "parentObserved"].includes(mode))
          wrapped.write("x", (e) => events.push("write:" + e?.message));
        if (mode === "directError") custom.emit("error", new Error("manual"));
        if (mode === "destroy") wrapped.destroy();
        if (mode === "object") custom.push({ x: 1 });
        if (mode === "encoding") custom.push("abc");
        await tick();
        out[mode] = {
          events: [...events],
          destroyed: wrapped.destroyed,
          customDestroyed: custom.destroyed,
        };
      } catch (e) {
        out[mode] = { name: e.name, message: e.message, events: [...events] };
      } finally {
        wrapped?.destroy();
        custom.destroy();
        await tick();
      }
    }
    return out;
  },
  tlsCustomDuplex: async function ({ tls, classicStreams }) {
    const writes = [];
    const custom = new classicStreams.Duplex({
      read() {},
      write(chunk, encoding, callback) {
        writes.push(Array.from(chunk));
        callback();
      },
    });
    const wrapped = new tls.TLSSocket(custom);
    wrapped.on("error", () => {});
    const read = new Promise((resolve) =>
      wrapped.once("data", (chunk) => resolve(Array.from(chunk))),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve, reject) =>
      wrapped.write(new Uint8Array([1, 2]), (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    custom.push(new Uint8Array([3, 4]));
    const data = await read;
    const result = {
      writes,
      data,
      encrypted: wrapped.encrypted,
      authorized: wrapped.authorized,
      secureConnecting: wrapped.secureConnecting,
    };
    wrapped.destroy();
    custom.destroy();
    return result;
  },
  cryptoWebExtensions: async function ({ crypto }) {
    const attempt = async (fn) => {
      try {
        return await fn();
      } catch (e) {
        return { name: e.name, message: e.message, code: e.code ?? null };
      }
    };
    const result = {};
    for (const algorithm of [
      "SHA-1",
      "SHA-256",
      "SHA-384",
      "SHA-512",
      "MD5",
      "crc32",
      "crc32c",
      "crc64nvme",
      "sha-256",
      "SHA-256\0suffix",
      "sha256",
      "MD4",
      null,
      {},
      42,
    ])
      result[String(algorithm)] = await attempt(async () => {
        const d = new crypto.webcrypto.DigestStream(algorithm),
          w = d.getWriter();
        await w.write("1234");
        await w.write(new Uint8Array([53, 54, 55, 56, 57]));
        await w.close();
        return {
          digest: Array.from(new Uint8Array(await d.digest)),
          count: String(d.bytesWritten),
        };
      });
    for (const well of [false, true])
      for (const chunks of [
        ["\ud800"],
        ["\ud800", "\udc00"],
        ["\ud800", new Uint8Array([65]), "\udc00"],
      ])
        result[well + ":" + JSON.stringify(chunks)] = await attempt(
          async () => {
            const d = new crypto.webcrypto.DigestStream("SHA-256", {
                toWellFormed: well,
              }),
              w = d.getWriter(),
              counts = [];
            for (const chunk of chunks) {
              await w.write(chunk);
              counts.push(String(d.bytesWritten));
            }
            await w.close();
            return {
              counts,
              final: String(d.bytesWritten),
              digest: Array.from(new Uint8Array(await d.digest)),
            };
          },
        );
    const d = new crypto.webcrypto.DigestStream("SHA-256");
    const reason = { abort: true },
      rejected = d.digest.catch((e) => e);
    await d.abort(reason);
    result.abort = (await rejected) === reason;
    const disposed = new crypto.webcrypto.DigestStream("SHA-256"),
      writer = disposed.getWriter();
    const disposal = disposed.digest.catch((e) => ({
      name: e.name,
      message: e.message,
    }));
    disposed[Symbol.dispose]();
    disposed[Symbol.dispose]();
    await writer.write("");
    result.disposed = await disposal;
    result.afterDispose = await attempt(() => writer.write("a"));
    for (const [i, value] of [
      null,
      {},
      "a",
      new ArrayBuffer(1),
      new Uint8Array(1),
      new DataView(new ArrayBuffer(1)),
    ].entries())
      result["timing" + i] = await attempt(() =>
        crypto.subtle.timingSafeEqual(value, new Uint8Array(1)),
      );
    result.timingLength = await attempt(() =>
      crypto.subtle.timingSafeEqual(new Uint8Array(1), new Uint8Array(2)),
    );
    result.timingDifferent = crypto.subtle.timingSafeEqual(
      new Uint8Array([1]),
      new Uint8Array([2]),
    );
    const named = function () {};
    Object.defineProperty(named, "name", { value: "SHA-256" });
    result.functionAlgorithm = await attempt(async () => {
      const d = new crypto.webcrypto.DigestStream(named);
      await d.getWriter().close();
      return Array.from(new Uint8Array(await d.digest));
    });
    for (const view of [
      new Uint8Array([1]),
      new DataView(new Uint8Array([1]).buffer),
    ]) {
      Object.defineProperties(view, {
        buffer: { value: new Uint8Array([9]).buffer },
        byteOffset: { value: 0 },
        byteLength: { value: 1 },
      });
      result["shadowCompare:" + view.constructor.name] =
        crypto.subtle.timingSafeEqual(view, new Uint8Array([1]));
      const d = new crypto.webcrypto.DigestStream("crc32"),
        w = d.getWriter();
      await w.write(view);
      await w.close();
      result["shadowDigest:" + view.constructor.name] = Array.from(
        new Uint8Array(await d.digest),
      );
    }
    const detached = new ArrayBuffer(1),
      detachedView = new DataView(detached);
    structuredClone(detached, { transfer: [detached] });
    result.detached = [
      crypto.subtle.timingSafeEqual(detached, new ArrayBuffer(0)),
      crypto.subtle.timingSafeEqual(detachedView, new ArrayBuffer(0)),
    ];
    return result;
  },
  cryptoSignatureParameters: function ({ crypto }) {
    const attempt = (fn) => {
      try {
        return fn();
      } catch (e) {
        return { name: e.name, message: e.message, code: e.code ?? null };
      }
    };
    const data = new Uint8Array([1, 2]);
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
    const privatePem = rsa.privateKey.export({ format: "pem", type: "pkcs8" });
    const publicPem = rsa.publicKey.export({ format: "pem", type: "spki" });
    const signature = crypto.sign("sha256", data, rsa.privateKey);
    const results = [];
    for (const padding of [-1, 0, 1, 2, 3, 4, 5, 6, 99])
      for (const saltLength of [undefined, -3, -2, -1, 0, 32, 95]) {
        const options = { padding, saltLength };
        results.push([
          attempt(
            () =>
              crypto
                .createSign("sha256")
                .update(data)
                .sign({ key: privatePem, ...options }).length,
          ),
          attempt(() =>
            crypto
              .createVerify("sha256")
              .update(data)
              .verify({ key: publicPem, ...options }, signature),
          ),
          attempt(
            () =>
              crypto.sign("sha256", data, { key: privatePem, ...options })
                .length,
          ),
          attempt(() =>
            crypto.verify(
              "sha256",
              data,
              { key: publicPem, ...options },
              signature,
            ),
          ),
        ]);
      }
    const ec = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const ecPrivate = ec.privateKey.export({ format: "pem", type: "pkcs8" }),
      ecPublic = ec.publicKey.export({ format: "pem", type: "spki" });
    for (const padding of [undefined, -1, 3, 99])
      results.push([
        attempt(
          () =>
            crypto
              .createSign("sha256")
              .update(data)
              .sign({ key: ecPrivate, padding }).length > 0,
        ),
        attempt(() =>
          crypto
            .createVerify("sha256")
            .update(data)
            .verify({ key: ecPublic, padding }, new Uint8Array([1])),
        ),
      ]);
    for (const signature of [
      null,
      {},
      [],
      new ArrayBuffer(1),
      new DataView(new ArrayBuffer(1)),
    ])
      results.push(
        attempt(() =>
          crypto
            .createVerify("sha256")
            .update(data)
            .verify(ec.publicKey, signature),
        ),
      );
    for (const type of ["ed25519", "x25519"]) {
      const pair = crypto.generateKeyPairSync(type);
      const signer = crypto.createSign("sha256").update(data);
      results.push(
        attempt(() => signer.sign(pair.privateKey)),
        attempt(() => {
          signer.update(data);
          return true;
        }),
      );
      results.push(
        attempt(() => crypto.sign("sha256", data, pair.privateKey)),
        attempt(() =>
          crypto.verify("sha256", data, pair.publicKey, new Uint8Array(64)),
        ),
      );
    }
    return results;
  },
  cryptoSignatureInventory: function ({ crypto }) {
    const attempt = (fn) => {
      try {
        return fn();
      } catch (e) {
        return { name: e.name, message: e.message, code: e.code ?? null };
      }
    };
    const result = {};
    result.constants = {
      nullPrototype: Object.getPrototypeOf(crypto.constants) === null,
      descriptors: Object.getOwnPropertyDescriptors(crypto.constants),
    };
    for (const algorithm of [
      "sha3-256",
      "ripemd160",
      "blake2b512",
      "DSA-SHA",
      "sha256",
      "SHA256",
      "sha256\0suffix",
    ]) {
      for (const operation of ["createSign", "createVerify"])
        result[operation + ":" + algorithm] = attempt(() => {
          crypto[operation](algorithm);
          return true;
        });
    }
    const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const data = new Uint8Array([1, 2, 3]);
    const signature = crypto.sign("sha256", data, {
      key: pair.privateKey.export({ format: "pem", type: "pkcs8" }),
      dsaEncoding: "ieee-p1363",
    });
    for (const view of [
      signature,
      new DataView(
        signature.buffer,
        signature.byteOffset,
        signature.byteLength,
      ),
      new Uint16Array(
        signature.buffer,
        signature.byteOffset,
        signature.byteLength / 2,
      ),
    ]) {
      result[
        "verify:" + (view === signature ? "Buffer" : view.constructor.name)
      ] = attempt(() =>
        crypto
          .createVerify("sha256")
          .update(data)
          .verify(
            {
              key: pair.publicKey.export({ format: "pem", type: "spki" }),
              dsaEncoding: "ieee-p1363",
            },
            view,
          ),
      );
    }
    for (const algorithm of ["sha3-256", "DSA-SHA", "sha256\0suffix"])
      result["oneShot:" + algorithm] = attempt(
        () => crypto.sign(algorithm, data, pair.privateKey).length > 0,
      );
    const ed = crypto.generateKeyPairSync("ed25519");
    const verifier = crypto.createVerify("sha256").update(data);
    result.ed = attempt(() =>
      verifier.verify(ed.publicKey, new Uint8Array(64)),
    );
    result.afterEd = attempt(() => {
      verifier.update(data);
      return true;
    });
    for (const type of ["pkcs1", "sec1"])
      result["export:" + type] = attempt(
        () => pair.privateKey.export({ format: "der", type }).length,
      );
    result.nulCurve = attempt(() => {
      crypto.createECDH("prime256v1\0suffix");
      return true;
    });
    return result;
  },
  fsReadLinesInventory: async function ({ fs }) {
    const path = "/tmp/read-lines-inventory";
    const attempt = (fn) => {
      try {
        fn();
        return "accepted";
      } catch (e) {
        return { name: e.name, message: e.message, code: e.code ?? null };
      }
    };
    await fs.promises.writeFile(path, "a\nb\n");
    const handle = await fs.promises.open(path, "r");
    try {
      const open = attempt(() => handle.readLines());
      await handle.close();
      return { open, closed: attempt(() => handle.readLines()) };
    } finally {
      await handle.close();
      await fs.promises.unlink(path);
    }
  },
  zlibCrcSeedInventory: function ({ zlib }) {
    return [
      -1,
      4294967296,
      1.5,
      NaN,
      Infinity,
      "1",
      null,
      undefined,
      0,
      4294967295,
    ].map((value) => {
      try {
        return zlib.crc32(new Uint8Array([1, 2]), value);
      } catch (e) {
        return { name: e.name, message: e.message, code: e.code ?? null };
      }
    });
  },

  cryptoDhContracts: function ({ crypto, withRequestScope = (fn) => fn() }) {
    return withRequestScope(() => {
      const attempt = (fn) => {
        try {
          return fn();
        } catch (e) {
          return {
            name: e.name,
            code: e.code ?? null,
            message: e.message.replace(
              /internal error; reference = .*/,
              "internal error",
            ),
          };
        }
      };
      const groups = [
        "modp14",
        "modp15",
        "modp16",
        "modp17",
        "modp18",
        "MODP14",
        "modp14\0suffix",
        "modp5",
        "modp1",
        "invalid",
      ].map((name) =>
        attempt(() => {
          const d = crypto.getDiffieHellman(name);
          return {
            length: d.getPrime().length,
            generator: d.getGenerator("hex"),
            verify: d.verifyError,
            setters: [typeof d.setPublicKey, typeof d.setPrivateKey],
          };
        }),
      );
      const errors = [
        () => crypto.createDiffieHellman(10001),
        () => crypto.createDiffieHellman(8, 100000),
        () => crypto.createDiffieHellman(8, new Uint8Array([2])),
        () => crypto.createDiffieHellman(new Uint8Array(1251)),
        () => crypto.createDiffieHellman(new Uint8Array(0)),
        () => crypto.createDiffieHellman(new Uint8Array([23]), 1),
        () =>
          crypto.createDiffieHellman(new Uint8Array([23]), new Uint8Array([1])),
        () =>
          crypto.createDiffieHellman(
            new Uint8Array([23]),
            new Uint8Array(1251),
          ),
        () => crypto.createDiffieHellman(new Uint8Array([22])),
        () => crypto.createDiffieHellman(new Uint8Array([3])).generateKeys(),
      ].map((fn) =>
        attempt(() => {
          fn();
          return "accepted";
        }),
      );
      const d = crypto.createDiffieHellman(new Uint8Array([23]));
      const before = [
        attempt(() => d.getPublicKey()),
        attempt(() => d.getPrivateKey()),
      ];
      d.setPrivateKey(new Uint8Array([3]));
      const pub = d.generateKeys("hex");
      const peer = crypto.createDiffieHellman(new Uint8Array([23]));
      peer.setPrivateKey(new Uint8Array([4]));
      peer.generateKeys();
      const secret = d.computeSecret(peer.getPublicKey(), undefined, "hex");
      const keyErrors = [
        new Uint8Array(0),
        new Uint8Array([0]),
        new Uint8Array([1]),
        new Uint8Array([23]),
      ].map((key) => [
        attempt(() => d.setPublicKey(key)),
        attempt(() => d.computeSecret(key)),
      ]);
      const numeric = crypto.createDiffieHellman(64);
      const numericResult = {
        length: numeric.getPrime().length,
        generator: numeric.getGenerator("hex"),
        verify: numeric.verifyError,
      };
      const properties = Object.getOwnPropertyNames(
        crypto.DiffieHellman.prototype,
      ).map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          crypto.DiffieHellman.prototype,
          name,
        );
        return [
          name,
          descriptor.enumerable,
          descriptor.configurable,
          descriptor.writable ?? null,
          typeof descriptor.value === "function" ? descriptor.value.name : null,
        ];
      });
      const x = crypto.generateKeyPairSync("x25519"),
        y = crypto.generateKeyPairSync("x25519");
      const xSecret = crypto.diffieHellman({
        publicKey: x.publicKey,
        privateKey: y.privateKey,
      });
      const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-224" });
      const ecResult = attempt(() =>
        crypto.diffieHellman({
          publicKey: ec.publicKey,
          privateKey: ec.privateKey,
        }),
      );
      return {
        groups,
        errors,
        before,
        pub,
        secret,
        verify: d.verifyError,
        keyErrors,
        numericResult,
        properties,
        lengths: [
          crypto.DiffieHellman.length,
          crypto.createDiffieHellman.length,
        ],
        x25519: {
          length: xSecret.length,
          equal: xSecret.equals(
            crypto.diffieHellman({
              publicKey: y.publicKey,
              privateKey: x.privateKey,
            }),
          ),
        },
        ecResult,
      };
    });
  },

  cryptoRandomContracts: async function ({ crypto }) {
    const attempt = (fn) => {
      try {
        return fn();
      } catch (e) {
        return { name: e.name, code: e.code ?? null, message: e.message };
      }
    };
    const fills = [
      () => new Uint8Array(16),
      () => new Uint16Array(8),
      () => new Int32Array(4),
      () => new BigUint64Array(2),
      () => new DataView(new ArrayBuffer(24), 4, 16),
      () => new ArrayBuffer(16),
    ].map((make) => {
      const input = make();
      const result = crypto.randomFillSync(input, 1, 1);
      const whole = new Uint8Array(
        input instanceof ArrayBuffer ? input : input.buffer,
      );
      const start = (input.byteOffset ?? 0) + (input.BYTES_PER_ELEMENT ?? 1);
      const end = start + (input.BYTES_PER_ELEMENT ?? 1);
      return {
        length: result.byteLength,
        offset: result.byteOffset,
        brand: Object.prototype.toString.call(result),
        same: result === input,
        outsideZero: whole.every((v, i) => (i >= start && i < end) || v === 0),
      };
    });
    const errors = [
      () => crypto.randomBytes(-1),
      () => crypto.randomBytes(1.5),
      () => crypto.randomBytes("1"),
      () => crypto.randomFillSync("x"),
      () => crypto.randomFillSync(new Uint8Array(2), -1),
      () => crypto.randomFillSync(new Uint8Array(2), 0, 3),
      () => crypto.randomFill(new Uint8Array(2), 3, () => {}),
      () => crypto.randomFill(new Uint8Array(2), null),
      () => crypto.randomBytes(0, null),
    ].map((fn) => attempt(fn));
    const brandChecks = [
      { [Symbol.toStringTag]: "ArrayBuffer", byteLength: 1 },
      {
        [Symbol.toStringTag]: "DataView",
        byteLength: 1,
        buffer: new ArrayBuffer(1),
        byteOffset: 0,
      },
      Object.defineProperty(new ArrayBuffer(0), Symbol.toStringTag, {
        value: "Object",
      }),
      Object.defineProperty(
        new DataView(new ArrayBuffer(0)),
        Symbol.toStringTag,
        { value: "Object" },
      ),
    ].map((input) => attempt(() => crypto.randomFillSync(input).byteLength));
    const beyond = crypto.randomFillSync(new Uint8Array(2), 3);
    const hostErrors = [
      () => crypto.randomFillSync(new Float32Array(2)),
      () => crypto.randomBytes(65537),
    ].map((fn) => {
      try {
        fn();
        return "accepted";
      } catch (e) {
        return e.name;
      }
    });
    const order = [],
      input = new DataView(new ArrayBuffer(32), 8, 16);
    const callback = await new Promise((resolve) => {
      const result = crypto.randomFill(input, 2, 4, (error, value) => {
        order.push("callback");
        resolve({ error: error?.name ?? null, same: value === input });
      });
      order.push("sync");
      if (result !== undefined)
        throw new Error("randomFill must return undefined");
    });
    const empty = await new Promise((resolve) =>
      crypto.randomBytes(0, (error, value) =>
        resolve({ error: error?.name ?? null, length: value.length }),
      ),
    );
    let detachedName;
    try {
      const get = crypto.webcrypto.getRandomValues;
      get(new Uint8Array(1));
    } catch (e) {
      detachedName = e.name;
    }
    const get = crypto.getRandomValues;
    return {
      fills,
      brandChecks,
      errors,
      hostErrors,
      beyond: beyond.byteLength,
      callback,
      order,
      empty,
      detachedName,
      boundLength: get(new Uint8Array(1)).length,
      aliases: [
        crypto.pseudoRandomBytes === crypto.randomBytes,
        crypto.default.pseudoRandomBytes === crypto.randomBytes,
      ],
      extraAliases: ["prng", "rng", "listCiphers", "createCredentials"].map(
        (name) => [name in crypto, name in crypto.default],
      ),
      aliasError: attempt(() => crypto.pseudoRandomBytes(-1)),
    };
  },

  cryptoWorkLimits: async function ({ crypto }) {
    const attempt = (fn) => {
      try {
        return fn();
      } catch (error) {
        return {
          name: error.name,
          code: error.code ?? null,
          message: error.message,
        };
      }
    };
    const options = [
      { N: 1024, r: 1, p: 32768 },
      { N: 2, r: 1, p: 1048577 },
      { N: 65536, r: 1, p: 1 },
      { N: 16, r: 1, p: 1, maxmem: 1 },
      { N: 16, r: 1, p: 1, maxmem: 4294967296 },
      { N: 16, r: 1, p: 1, maxmem: 4294967295 },
      { N: 16, r: 1, p: 1 },
    ];
    const result = {
      scrypt: options.map((options) =>
        attempt(() => crypto.scryptSync("p", "s", 8, options).toString("hex")),
      ),
      rsa: attempt(() =>
        crypto.generateKeyPairSync("rsa", { modulusLength: 16385 }),
      ),
      dh: attempt(() =>
        crypto.generateKeyPairSync("dh", { prime: new Uint8Array(1025) }),
      ),
    };
    const order = [];
    result.callback = await new Promise((resolve) => {
      crypto.scrypt("p", "s", 8, options[0], (error) => {
        order.push("callback");
        resolve({
          name: error.name,
          code: error.code ?? null,
          message: error.message,
        });
      });
      order.push("returned");
    });
    result.order = order;
    return result;
  },
  cryptoKeygenContracts: async function ({ crypto, util }) {
    const attempt = (fn) => {
      try {
        return fn();
      } catch (error) {
        return {
          name: error.name,
          code: error.code ?? null,
          message: error.message,
        };
      }
    };
    const errors = [
      ["dh", {}],
      ["dh", { prime: "p" }],
      ["dh", { primeLength: -1 }],
      ["dh", { primeLength: 512 }],
      ["dh", { generator: -1 }],
      ["dh", { group: "modp14", primeLength: 512 }],
      ["dh", { group: "modp14", prime: new Uint8Array([3]) }],
      ["dh", { group: "modp14", generator: 2 }],
      ["dh", { prime: new Uint8Array([3]), primeLength: 512 }],
      ["dh", { group: "modp1" }],
      ["dh", { group: "unknown" }],
      ["ed25519", { publicKeyEncoding: "pem" }],
      ["x25519", { privateKeyEncoding: "pem" }],
      ["ed25519", { privateKeyEncoding: { format: "pem", type: "pkcs1" } }],
      [
        "rsa",
        {
          modulusLength: 1024,
          privateKeyEncoding: {
            format: "der",
            type: "pkcs1",
            cipher: "aes-128-cbc",
            passphrase: "pw",
          },
        },
      ],
      [
        "ec",
        {
          namedCurve: "prime256v1",
          privateKeyEncoding: {
            format: "pem",
            type: "pkcs8",
            cipher: "aes-128-cbc",
          },
        },
      ],
    ].map(([type, options]) =>
      attempt(() => {
        crypto.generateKeyPairSync(type, options);
        return "accepted";
      }),
    );
    const rsaBoundaries = [0, 1, 16, 255, 256, 511].map((modulusLength) =>
      attempt(() => {
        crypto.generateKeyPairSync("rsa", { modulusLength });
        return "accepted";
      }),
    );
    const rsaRounded = [513, 520, 639, 640, 1023].map(
      (modulusLength) =>
        crypto.generateKeyPairSync("rsa", { modulusLength }).privateKey
          .asymmetricKeyDetails.modulusLength,
    );
    const rsaExponents = [0, 1, 2, 4].map((publicExponent) =>
      attempt(() => {
        crypto.generateKeyPairSync("rsa", {
          modulusLength: 512,
          publicExponent,
        });
        return "accepted";
      }),
    );
    const smallDh = [0, 1, 2, 3, 5, 23, 37, 255].map((p) =>
      attempt(() => {
        const { publicKey, privateKey } = crypto.generateKeyPairSync("dh", {
          prime: new Uint8Array([p]),
          generator: 2,
        });
        return [
          publicKey.asymmetricKeyType,
          privateKey.asymmetricKeyType,
          crypto.createPublicKey(privateKey).type,
          attempt(
            () => publicKey.export({ type: "spki", format: "der" }).length > 0,
          ),
          attempt(
            () =>
              privateKey.export({ type: "pkcs8", format: "der" }).length > 0,
          ),
        ];
      }),
    );
    const curves = [
      "P-224",
      "P-256",
      "P-384",
      "P-521",
      "prime256v1",
      "prime256v1\0suffix",
      "secp256r1",
      "secp256k1",
      "PRIME256V1",
    ].map((namedCurve) => [
      namedCurve,
      attempt(
        () =>
          crypto.generateKeyPairSync("ec", { namedCurve }).publicKey
            .asymmetricKeyDetails,
      ),
    ]);
    const ecEncoding = ["named", "explicit"].map((paramEncoding) => {
      const { privateKey } = crypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
        paramEncoding,
      });
      const data = privateKey.export({ type: "sec1", format: "der" });
      return {
        paramEncoding,
        length: data.length,
        curveParameter: data
          .toString("hex")
          .includes("a00a06082a8648ce3d030107"),
      };
    });
    const alice = crypto.generateKeyPairSync("dh", { group: "MODP14" });
    const prime = crypto.getDiffieHellman("modp14").getPrime(),
      padded = new Uint8Array(prime.length + 4);
    padded.set(prime, 2);
    const bob = crypto.generateKeyPairSync("dh", {
      prime: new DataView(padded.buffer, 2, prime.length),
      generator: 2,
    });
    const a = crypto.diffieHellman({
        privateKey: alice.privateKey,
        publicKey: bob.publicKey,
      }),
      b = crypto.diffieHellman({
        privateKey: bob.privateKey,
        publicKey: alice.publicKey,
      });
    const mismatchedDh = [
      crypto.generateKeyPairSync("dh", { group: "modp5" }),
      crypto.generateKeyPairSync("dh", { prime, generator: 5 }),
    ].map((peer) =>
      attempt(
        () =>
          crypto.diffieHellman({
            publicKey: alice.publicKey,
            privateKey: peer.privateKey,
          }).length,
      ),
    );
    const clonedDh = crypto
      .diffieHellman({
        publicKey: crypto.createPublicKey(bob.privateKey),
        privateKey: alice.privateKey,
      })
      .equals(a);
    const pair = await util.promisify(crypto.generateKeyPair)("ed25519", {});
    return {
      errors,
      curves,
      ecEncoding,
      rsaBoundaries,
      rsaExponents,
      rsaRounded,
      smallDh,
      mismatchedDh,
      clonedDh,
      dh: {
        type: alice.privateKey.asymmetricKeyType,
        length: a.length,
        equal: a.toString("hex") === b.toString("hex"),
      },
      promisify: [pair.publicKey.type, pair.privateKey.type],
    };
  },

  cryptoCipherAlgorithms: async function ({ crypto }) {
    const results = [];
    for (const name of [
      ...new Set(
        crypto.getCiphers().flatMap((name) => [name, name.toUpperCase()]),
      ),
    ].sort())
      for (const authLengthTag of [undefined, 16, 8, 4, 28]) {
        const info = crypto.getCipherInfo(name),
          result = { name, authLengthTag: authLengthTag ?? null };
        let stage = "construct";
        try {
          const key = new Uint8Array(info.keyLength),
            iv = new Uint8Array(info.ivLength);
          const cipher = crypto.createCipheriv(name, key, iv, {
            authLengthTag,
          });
          stage = "aad";
          try {
            cipher.setAAD("aad", { plaintextLength: 5 });
            result.aad = true;
          } catch (error) {
            result.aad = error.message;
          }
          stage = "update";
          const first = cipher.update("hello", "utf8");
          stage = "final";
          const last = cipher.final();
          stage = "tag";
          const tag = cipher.getAuthTag();
          const ciphertext = new Uint8Array(first.length + last.length);
          ciphertext.set(first);
          ciphertext.set(last, first.length);
          const hex = (value) =>
            Array.from(value, (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("");
          result.data = name.toLowerCase().includes("randnonce")
            ? ciphertext.length
            : hex(ciphertext);
          result.tag = name.toLowerCase().includes("randnonce")
            ? tag.length
            : hex(tag);
          result.secondTag = cipher.getAuthTag().length;
          stage = "decrypt";
          const decipher = crypto.createDecipheriv(name, key, iv, {
            authLengthTag,
          });
          if (tag.length) decipher.setAuthTag(tag);
          if (result.aad === true)
            decipher.setAAD("aad", { plaintextLength: 5 });
          result.plain =
            decipher.update(ciphertext).toString() +
            decipher.final().toString();
          if (tag.length) {
            const invalid = crypto.createDecipheriv(name, key, iv, {
              authLengthTag,
            });
            const damaged = new Uint8Array(tag);
            damaged[0] ^= 1;
            invalid.setAuthTag(damaged);
            if (result.aad === true)
              invalid.setAAD("aad", { plaintextLength: 5 });
            try {
              invalid.update(ciphertext);
              invalid.final();
              result.tamper = "accepted";
            } catch (error) {
              result.tamper = {
                name: error.name,
                code: error.code ?? null,
                message: error.message.replace(
                  /internal error; reference = .*/,
                  "internal error",
                ),
              };
            }
          }
        } catch (error) {
          result.error = {
            stage,
            name: error.name,
            code: error.code ?? null,
            message: error.message.replace(
              /internal error; reference = .*/,
              "internal error",
            ),
          };
        }
        results.push(result);
      }
    return results;
  },
  cryptoCipherStates: async function ({ crypto }) {
    const attempt = (operation) => {
      try {
        const result = operation();
        return result?.byteLength ?? typeof result;
      } catch (error) {
        return {
          name: error.name,
          code: error.code ?? null,
          message: error.message.replace(
            /internal error; reference = .*/,
            "internal error",
          ),
        };
      }
    };
    const result = [];
    for (const name of [
      "aes-128-cbc",
      "aes-128-gcm",
      "chacha20-poly1305",
      "aes-128-eax",
    ]) {
      const info = crypto.getCipherInfo(name),
        key = new Uint8Array(info.keyLength),
        iv = new Uint8Array(info.ivLength);
      const cipher = crypto.createCipheriv(name, key, iv, {
        authLengthTag: 16,
      });
      const row = {
        name,
        before: attempt(() => cipher.getAuthTag()),
        stringInput: attempt(() => cipher.update("abc")),
        aad: attempt(() => cipher.setAAD(new Uint8Array([1, 2, 3]))),
      };
      row.update = attempt(() => cipher.update(new Uint8Array([1, 2, 3])));
      row.secondUpdate = attempt(() => cipher.update(new Uint8Array([4])));
      row.final = attempt(() => cipher.final());
      row.tag = attempt(() => cipher.getAuthTag());
      row.tagAgain = attempt(() => cipher.getAuthTag());
      row.finalAgain = attempt(() => cipher.final());
      row.updateAfterFinal = attempt(() => cipher.update(new Uint8Array()));
      row.aadAfterFinal = attempt(() => cipher.setAAD(new Uint8Array()));
      row.paddingAfterFinal = attempt(() => cipher.setAutoPadding());
      const decipher = crypto.createDecipheriv(name, key, iv, {
        authLengthTag: 16,
      });
      row.stringTag = attempt(() => decipher.setAuthTag("00", "hex"));
      row.missingTag = attempt(() =>
        decipher.update(new Uint8Array([1, 2, 3])),
      );
      row.setTag = attempt(() => decipher.setAuthTag(new Uint8Array(16)));
      row.setTagAgain = attempt(() => decipher.setAuthTag(new Uint8Array(16)));
      row.decryptFinal = attempt(() => decipher.final());
      result.push(row);
    }
    result.push({
      invalidNames: [
        "aes_128_eax",
        "aes-128-eax\0suffix",
        "AES-128-EAX",
        "aes-128-cbc\0suffix",
        "unknown",
      ].map((name) => [
        name,
        attempt(() =>
          crypto.createCipheriv(name, new Uint8Array(16), new Uint8Array(16), {
            authLengthTag: 16,
          }),
        ),
      ]),
    });
    const changingKey = new Uint8Array(16);
    const keyCopy = crypto.createCipheriv(
      "aes-128-cbc",
      changingKey,
      new Uint8Array(16),
      {
        get authLengthTag() {
          changingKey[0] = 1;
          return 16;
        },
      },
    );
    result.push({
      keyCopiedBeforeOptions:
        keyCopy.update("hello", "utf8", "hex") + keyCopy.final("hex"),
    });
    result.push({
      deprecated: ["Cipher", "Decipher", "createCipher", "createDecipher"].map(
        (name) => [name, attempt(() => crypto[name]())],
      ),
    });
    return result;
  },

  cryptoPbkdfContracts: async function ({ crypto }) {
    const attempt = (fn) => {
      try {
        return fn();
      } catch (error) {
        return { name: error.name, code: error.code ?? null };
      }
    };
    const result = { algorithms: [], typed: [], errors: [] };
    for (const name of crypto.getHashes())
      result.algorithms.push([
        name,
        crypto.pbkdf2Sync("pass", "salt", 3, 20, name).toString("hex"),
      ]);
    for (const Constructor of [
      Uint8Array,
      Uint16Array,
      Uint32Array,
      Float32Array,
      Float64Array,
    ]) {
      const value = new Constructor(new ArrayBuffer(16));
      value.set([1, 2]);
      result.typed.push([
        Constructor.name,
        crypto
          .pbkdf2Sync(value, new DataView(value.buffer, 2, 6), 2, 8, "sha256")
          .toString("hex"),
      ]);
    }
    // Half-float bytes are portable; the Float16Array input brand is tested
    // only where the engine provides it, and native evidence records availability.
    const halfBytes = new Uint8Array(16);
    new DataView(halfBytes.buffer).setUint16(0, 0x3c00, true);
    new DataView(halfBytes.buffer).setUint16(2, 0x4000, true);
    result.halfFloatBytes = crypto
      .pbkdf2Sync(
        halfBytes,
        new DataView(halfBytes.buffer, 2, 6),
        2,
        8,
        "sha256",
      )
      .toString("hex");
    if (typeof globalThis.Float16Array === "function") {
      const half = new globalThis.Float16Array(8);
      half.set([1, 2]);
      const actual = crypto
        .pbkdf2Sync(half, new DataView(half.buffer, 2, 6), 2, 8, "sha256")
        .toString("hex");
      if (actual !== result.halfFloatBytes)
        throw new Error(
          "Float16Array PBKDF2 differs from its byte representation",
        );
    }
    for (const args of [
      ["p", "s", 0, 1, "sha1"],
      ["p", "s", 1, 5101, "sha1"],
      ["p", "s", 1, 8161, "sha256"],
      ["p", "s", 1, 0, "sha256"],
      ["p", "s", 1, 1, "unknown"],
    ])
      result.errors.push(
        attempt(() => crypto.pbkdf2Sync(...args).toString("hex")),
      );
    const order = [];
    result.callback = await new Promise((resolve) => {
      crypto.pbkdf2("p", "s", 2, 8, "sha256", (error, value) => {
        order.push("callback");
        resolve(error ? error.name : value.toString("hex"));
      });
      order.push("returned");
    });
    result.order = order;
    result.callbackError = await new Promise((resolve) =>
      crypto.pbkdf2("p", "s", 1, 1, "unknown", (error) =>
        resolve([error.name, error.code ?? null]),
      ),
    );
    const hex = (buffer) =>
      Array.from(new Uint8Array(buffer), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    result.hkdf = crypto
      .getHashes()
      .map((name) => [
        name,
        hex(
          crypto.hkdfSync(
            name,
            crypto.createSecretKey(new Uint8Array([1, 2, 3])),
            "salt",
            "info",
            10,
          ),
        ),
      ]);
    result.hkdfErrors = [
      attempt(() => crypto.hkdfSync("unknown", "p", "s", "i", 1)),
      attempt(() => crypto.hkdfSync("sha1", "p", "s", "i", 5101)),
      attempt(() => crypto.hkdfSync("sha1", "p", "s", new Uint8Array(1025), 1)),
    ];
    return result;
  },
  cryptoDigestContracts: async function ({ crypto }) {
    const attempt = (fn) => {
      try {
        return fn();
      } catch (error) {
        return { name: error.name, code: error.code ?? null };
      }
    };
    const result = { names: crypto.getHashes(), algorithms: [], errors: [] };
    for (const name of result.names) {
      const hash = crypto.createHash(name).update("a");
      const copy = hash.copy();
      result.algorithms.push({
        name,
        hash: hash.update("bc").digest("hex"),
        copy: copy.update("d").digest("hex"),
        hmac: attempt(() =>
          crypto.createHmac(name, "key").update("abc").digest("hex"),
        ),
      });
    }
    for (const name of [
      "ripemd160",
      "sha-256",
      "SHA",
      "ssl3-md5",
      "ssl3-sha1",
      "SHA256",
    ])
      result.errors.push([
        name,
        attempt(() => crypto.createHash(name).digest("hex")),
      ]);
    for (const outputLength of [0, 28, 32, null, -1, "32"])
      result.errors.push(
        attempt(() =>
          crypto.createHash("sha256", { outputLength }).digest("hex"),
        ),
      );
    const hash = crypto.createHash("sha256");
    hash.end("abc");
    result.stream = [hash.read().toString("hex"), hash.digest("hex")];
    result.final = [
      attempt(() => hash.copy()),
      attempt(() => hash.update("x")),
      attempt(() => hash.digest()),
    ];
    const hmac = crypto.Hmac(
      "sha256",
      crypto.createSecretKey(new Uint8Array([1, 2, 3])),
    );
    hmac.end("abc");
    result.hmacStream = [
      hmac.read().toString("hex"),
      hmac.digest("hex"),
      hmac.digest("hex"),
      attempt(() => hmac.update("x")),
    ];
    return result;
  },
  fsIoContracts: async function ({ fs, process }) {
    const path = "/tmp/io-contract",
      result = {};
    fs.writeFileSync(path, "abc");
    const fd = fs.openSync(path, "a+");
    fs.writeFileSync(fd, "def");
    result.full = fs.readFileSync(fd, "utf8");
    result.after = fs.readSync(fd, new Uint8Array(1));
    fs.closeSync(fd);
    fs.closeSync(fd);
    fs.closeSync(123456);
    const callbackFd = await new Promise((resolve, reject) =>
      fs.open(path, fs.constants.O_TRUNC, (error, fd) =>
        error ? reject(error) : resolve(fd),
      ),
    );
    fs.closeSync(callbackFd);
    const promiseHandle = await fs.promises.open(path, fs.constants.O_TRUNC);
    await promiseHandle.close();
    result.readonlyTruncate = fs.readFileSync(path, "utf8");
    process.chdir("/tmp");
    try {
      result.cwd = process.cwd();
      fs.writeFileSync("relative-io", "data");
      result.relative = fs.readFileSync("/tmp/relative-io", "utf8");
    } finally {
      process.chdir("/bundle");
    }
    result.errors = [];
    for (const call of [
      () => fs.writeSync(1, "x", ""),
      () => fs.writeSync(1, new Uint8Array(1), { offset: 2 }),
      () => fs.ftruncateSync(1, -1),
      () => fs.appendFileSync(path, []),
      () => fs.copyFile(path, path, 123),
      () => fs.readFile(path),
    ]) {
      try {
        call();
        result.errors.push(null);
      } catch (error) {
        result.errors.push(error.code);
      }
    }
    result.constants = [
      Object.getPrototypeOf(fs.constants) === null,
      fs.constants.UV_FS_COPYFILE_EXCL,
    ];
    return result;
  },
  fsStreamsAndLinks: async function ({ fs }) {
    const root = "/tmp/streams-links";
    fs.mkdirSync(root);
    const path = root + "/data";
    fs.writeFileSync(path, "abcdef");
    fs.symlinkSync(path, root + "/link");
    fs.cpSync(root + "/link", root + "/copy");
    const result = {
      link: fs.readlinkSync(root + "/copy"),
      text: fs.readFileSync(root + "/copy", "utf8"),
    };
    fs.symlinkSync(root + "/missing", root + "/broken");
    fs.cpSync(root + "/broken", root + "/broken-copy");
    result.broken = fs.realpathSync(root + "/broken-copy");
    const handle = await fs.promises.open(path, "r");
    const stream = handle.createReadStream({
      start: 1,
      end: 3,
      encoding: "utf8",
    });
    let text = "";
    for await (const chunk of stream) text += chunk;
    result.read = [
      text,
      handle.fd === undefined,
      stream.bytesRead,
      stream.closed,
    ];
    const output = fs.createWriteStream(root + "/output");
    const finished = new Promise((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
    });
    output.cork();
    output.write("one");
    output.write("two");
    output.uncork();
    output.end("three");
    await finished;
    result.write = [
      fs.readFileSync(root + "/output", "utf8"),
      output.bytesWritten,
      output.closed,
    ];
    const webHandle = await fs.promises.open(path, "r");
    let webText = "";
    for await (const chunk of webHandle.readableWebStream())
      webText += new TextDecoder().decode(chunk);
    result.web = [webText, webHandle.fd === undefined];
    const aborted = await fs.promises.open(path, "r");
    const closed = new Promise((resolve) => aborted.once("close", resolve));
    const abortedStream = aborted.createReadStream({
      signal: AbortSignal.abort(),
    });
    result.abort = await new Promise((resolve) =>
      abortedStream.once("error", (error) => resolve(error.name)),
    );
    await closed;
    result.closed = aborted.fd === undefined;
    fs.writeFileSync(root + "/%64ata%3f", "encoded");
    result.normalized = fs.readFileSync(root + "/data%3F", "utf8");
    return result;
  },
  fsDevicesAndBounds: async function ({ fs }) {
    const attempt = (fn) => {
      try {
        return fn() ?? null;
      } catch (error) {
        return { name: error.name, code: error.code ?? null };
      }
    };
    const result = { devices: [], limits: [], times: [] };
    for (const name of ["null", "zero", "full", "random"]) {
      const path = "/dev/" + name,
        fd = fs.openSync(path, "r+"),
        buffer = new Uint8Array(4).fill(7);
      const read = fs.readSync(fd, buffer, 0, 4, null),
        stat = fs.fstatSync(fd);
      result.devices.push({
        name,
        read,
        buffer: name === "random" ? "entropy" : Array.from(buffer),
        write: attempt(() => fs.writeSync(fd, "abc")),
        truncate: attempt(() => fs.ftruncateSync(fd, 0)),
        stat: [
          stat.mode,
          stat.dev,
          stat.size,
          stat.isCharacterDevice(),
          stat.isFile(),
          stat.mtimeMs,
        ],
        all: fs.readFileSync(path).length,
      });
      fs.closeSync(fd);
    }
    const path = "/tmp/bounds",
      fd = fs.openSync(path, "w+");
    result.times.push(fs.fstatSync(fd).mtimeMs);
    fs.writeSync(fd, "x");
    result.times.push(fs.fstatSync(fd).mtimeMs);
    fs.futimesSync(fd, 123, 456);
    fs.writeSync(fd, "y");
    result.times.push(fs.fstatSync(fd).mtimeMs);
    result.limits.push(
      attempt(() => fs.writeSync(fd, new Uint8Array(1), 0, 1, 134217728)),
    );
    fs.closeSync(fd);
    result.limits.push(
      attempt(() => fs.openSync("/tmp/" + "a".repeat(4097), "r")),
    );
    result.limits.push(attempt(() => fs.openSync("/a".repeat(49), "r")));
    const blob = fs.openAsBlob(path, { type: "text/plain" });
    result.blob = [
      blob instanceof Blob,
      blob.size,
      blob.type,
      await blob.text(),
    ];
    return result;
  },
  fsDirectoryNavigation: async function ({ fs }) {
    const root = "/tmp/navigation";
    const created = fs.mkdirSync(root + "/a/nested", { recursive: true });
    fs.mkdirSync(root + "/a/nested");
    for (const name of ["a/one", "a/.hidden", "a/nested/two"])
      fs.writeFileSync(root + "/" + name, "data");
    const describe = (entry) => ({
      name:
        typeof entry.name === "string" ? entry.name : Array.from(entry.name),
      parent: entry.parentPath,
      file: entry.isFile(),
      dir: entry.isDirectory(),
      link: entry.isSymbolicLink(),
      instance: entry instanceof fs.Dirent,
    });
    const result = {
      created,
      listing: fs.readdirSync(root, { recursive: true }),
      entries: fs
        .readdirSync(root, { recursive: true, withFileTypes: true })
        .map(describe),
      patterns: [],
    };
    for (const pattern of [
      "**",
      "a/*",
      "a/**",
      "a/{one,nested/**}",
      "a/+(one|nested)",
      "**/.hidden",
      ["a/one", "a/nested/*"],
    ])
      result.patterns.push(fs.globSync(pattern, { cwd: root }));
    result.exclude = fs.globSync("**", {
      cwd: root,
      exclude: ["**/nested/**"],
    });
    result.typed = fs
      .globSync("a/*", { cwd: root, withFileTypes: true })
      .map(describe);
    result.callback = await new Promise((resolve, reject) =>
      fs.glob("a/**", { cwd: root }, (e, value) =>
        e ? reject(e) : resolve(value),
      ),
    );
    result.promise = [];
    for await (const value of fs.promises.glob("a/**", { cwd: root }))
      result.promise.push(value);
    const dir = await fs.promises.opendir(root, { recursive: true });
    result.iterated = [];
    for await (const entry of dir) result.iterated.push(describe(entry));
    result.afterIteration = dir.readSync();
    await dir.close();
    try {
      dir.readSync();
    } catch (error) {
      result.closed = error.code;
    }
    result.encoded = fs.readdirSync(root, "hex");
    result.bundle = fs
      .readdirSync("/bundle/nested", { withFileTypes: true })
      .map(describe);
    for (const options of [
      { encoding: null },
      { recursive: 1 },
      { withFileTypes: 1 },
    ]) {
      try {
        fs.readdirSync(root, options);
        result.patterns.push(null);
      } catch (error) {
        result.patterns.push(error.code);
      }
    }
    return result;
  },
  fsTimes: async function ({ fs }) {
    const readonly = "/bundle/readonly.txt",
      writable = "/tmp/time-file";
    fs.writeFileSync(writable, "x");
    const result = [];
    for (const path of [readonly, writable]) {
      fs.utimesSync(path, 1000, 2000);
      result.push(fs.statSync(path).mtimeMs);
      const fd = fs.openSync(path, "r");
      fs.futimesSync(fd, 3000n, new Date(4000));
      result.push(fs.fstatSync(fd).mtimeMs);
      fs.closeSync(fd);
      const handle = await fs.promises.open(path, "r");
      await handle.utimes(new Date(5000), 6000);
      result.push((await handle.stat()).mtimeMs);
      await handle.close();
      for (const method of ["writeFile", "truncate"]) {
        try {
          await handle[method](method === "writeFile" ? "x" : 0);
          result.push(null);
        } catch (error) {
          result.push(error.code);
        }
      }
      for (const value of [null, {}, true, undefined]) {
        try {
          fs.utimesSync(path, value, 0);
          result.push(null);
        } catch (e) {
          result.push(e.code);
        }
      }
    }
    return result;
  },
  cipherMetadata: async function ({ crypto: c }) {
    const results = [];
    for (const name of [
      "aes-128-cbc",
      "AES-192-CTR",
      "aes-256-gcm",
      "des-ede3-cbc",
      "rc2-cbc",
      "rc4",
      "chacha20-poly1305",
      "aes-128-ccm-matter",
      "unknown",
      419,
      419.8,
      950,
      0,
      NaN,
    ]) {
      for (const options of [
        {},
        { ivLength: 0 },
        { ivLength: 1 },
        { ivLength: 16 },
        { ivLength: -1 },
        { ivLength: NaN },
        { ivLength: "12" },
        { keyLength: 0 },
        { keyLength: 1 },
        { keyLength: 16 },
        { keyLength: 32 },
        null,
        3,
      ]) {
        try {
          results.push(c.getCipherInfo(name, options) ?? null);
        } catch (e) {
          results.push({ error: e.name, code: e.code ?? null });
        }
      }
    }
    for (const input of [null, {}, true, [], undefined]) {
      try {
        results.push(c.getCipherInfo(input) ?? null);
      } catch (e) {
        results.push({ error: e.name, code: e.code ?? null });
      }
    }
    const first = c.getCipherInfo("aes-128-cbc");
    first.keyLength = 999;
    results.push(c.getCipherInfo("aes-128-cbc"));
    return results;
  },
  codecLifecycle: async function ({ zlib: z }) {
    const failure = (error) => ({ name: error.name, code: error.code ?? null });
    const result = { options: [], callbacks: [], lifecycle: [] };
    for (const name of ["brotli", "zstd"]) {
      const Constructor =
        z[name === "brotli" ? "BrotliCompress" : "ZstdCompress"];
      const compress = z[name + "CompressSync"];
      for (const options of [
        { chunkSize: null },
        { chunkSize: NaN },
        { chunkSize: 63 },
        { chunkSize: 64.5 },
        { flush: -1 },
        { flush: 6 },
        { finishFlush: -1 },
        { maxOutputLength: 0 },
        { maxOutputLength: 1 },
        { params: { 999: 1 } },
        { params: { 1: "bad" } },
        { params: { 1: 2, "01": 1 } },
        { params: null },
        null,
        3,
      ]) {
        for (const mode of ["fast", "info", "stream"]) {
          try {
            const value =
              mode === "stream"
                ? new Constructor(options)
                : compress(
                    "hello",
                    mode === "info" ? { ...options, info: true } : options,
                  );
            value.destroy?.();
            result.options.push(null);
          } catch (error) {
            result.options.push(failure(error));
          }
        }
      }
      for (const options of [
        { chunkSize: 63 },
        { chunkSize: NaN },
        { params: null },
        { params: { 999: 1 } },
        {},
      ]) {
        let returned = false;
        const pending = new Promise((resolve) => {
          try {
            z[name + "Compress"]("hello", options, (error) =>
              resolve({
                when: "callback",
                returned,
                error: error ? failure(error) : null,
              }),
            );
          } catch (error) {
            resolve({ when: "throw", returned, error: failure(error) });
          }
        });
        returned = true;
        result.callbacks.push(await pending);
      }
    }
    for (const name of [
      "Deflate",
      "Inflate",
      "Gzip",
      "Gunzip",
      "DeflateRaw",
      "InflateRaw",
      "Unzip",
      "BrotliCompress",
      "BrotliDecompress",
      "ZstdCompress",
      "ZstdDecompress",
    ]) {
      const stream = new z[name]();
      stream.bytesRead = 7;
      const before = [stream.bytesWritten, stream.bytesRead, stream._closed];
      stream.reset();
      const afterReset = [stream.bytesWritten, stream.bytesRead];
      let closes = 0;
      stream.on("close", () => closes++);
      const closed = new Promise((resolve) =>
        stream.close((error) => resolve(error?.code ?? null)),
      );
      stream.destroy();
      const closeCode = await closed;
      let resetError;
      try {
        stream.reset();
      } catch (error) {
        resetError = failure(error);
      }
      result.lifecycle.push({
        name,
        before,
        afterReset,
        closed: stream._closed,
        destroyed: stream.destroyed,
        closes,
        closeCode,
        resetError,
      });
    }
    const unzip = new z.Unzip();
    const decoded = [];
    unzip.on("data", (chunk) => decoded.push(chunk.toString()));
    const write = (input) =>
      new Promise((resolve, reject) =>
        unzip.write(input, (error) => (error ? reject(error) : resolve())),
      );
    await write(z.deflateSync("first"));
    unzip.reset();
    await write(z.gzipSync("second"));
    await write(z.gzipSync("third"));
    unzip.destroy();
    result.resetFormats = decoded.join("");
    return result;
  },

  fsEmbedded: async function ({ fs }) {
    const path = "/bundle/readonly.txt";
    const attempt = (fn) => {
      try {
        return fn() ?? null;
      } catch (error) {
        return { code: error.code };
      }
    };
    const fd = fs.openSync(path, "r");
    const buffer = new Uint8Array(3);
    const read = fs.readSync(fd, buffer, 0, 3, 1);
    const result = {
      read,
      buffer: Array.from(buffer),
      mode: fs.fstatSync(fd).mode,
      write: attempt(() => fs.writeSync(fd, "x")),
      truncate: attempt(() => fs.ftruncateSync(fd, 0)),
    };
    fs.closeSync(fd);
    result.openWrite = attempt(() => fs.openSync(path, "r+"));
    const handle = await fs.promises.open(path, "r");
    result.promiseRead = await handle.readFile("utf8");
    try {
      await handle.truncate(0);
    } catch (error) {
      result.promiseTruncate = error.code;
    }
    await handle.close();
    fs.symlinkSync(path, "/tmp/readonly-link");
    result.link = fs.readlinkSync("/tmp/readonly-link");
    result.linkRead = fs.readFileSync("/tmp/readonly-link", "utf8");
    result.linkMode = fs.statSync("/tmp/readonly-link").mode;
    result.linkAccess = attempt(() =>
      fs.accessSync("/tmp/readonly-link", fs.constants.W_OK),
    );
    result.linkWrite = attempt(() =>
      fs.writeFileSync("/tmp/readonly-link", "changed"),
    );
    let text = "";
    for await (const chunk of fs.createReadStream(path, { start: 1, end: 3 }))
      text += chunk.toString();
    result.stream = text;
    result.content = fs.readFileSync(path, "hex");
    fs.unlinkSync("/tmp/readonly-link");
    fs.linkSync(path, "/tmp/hard-link");
    result.hardRead = fs.readFileSync("/tmp/hard-link", "utf8");
    result.hardWrite = attempt(() =>
      fs.writeFileSync("/tmp/hard-link", "changed"),
    );
    result.hardMetadata = [
      fs.statSync("/tmp/hard-link").nlink,
      fs.statSync("/tmp/hard-link").ino,
      fs.statSync("/tmp/hard-link").mode,
    ];
    await fs.promises.cp("/bundle/nested", "/tmp/copied", { recursive: true });
    result.copied = fs.readFileSync("/tmp/copied/child.txt", "utf8");
    fs.writeFileSync("/tmp/copied/child.txt", "changed copy");
    result.unchanged = fs.readFileSync("/bundle/nested/child.txt", "utf8");
    result.filter = attempt(() =>
      fs.cpSync(path, "/tmp/filtered", { filter: () => true }),
    );
    result.readonlyMutation = attempt(() => fs.writeFileSync(path, "changed"));
    const big = fs.statSync(path, { bigint: true });
    result.bigintMetadata = [
      big.size,
      big.mode,
      big.ino,
      big.nlink,
      big.atimeNs,
    ].map(String);
    return result;
  },

  classicCodecs: async function ({ zlib: z }) {
    const result = { roundtrips: [], validation: [], streams: [] };
    const failure = (error) => ({ name: error.name, code: error.code ?? null });
    const source = new Uint8Array([0, 1, 2, 3, 254, 255]);
    for (const [encode, decode] of [
      ["gzip", "gunzip"],
      ["deflate", "inflate"],
      ["deflateRaw", "inflateRaw"],
    ]) {
      for (const input of [
        source,
        new DataView(source.buffer, 1, 4),
        source.buffer,
        "hello",
      ]) {
        const compressed = z[encode + "Sync"](input);
        result.roundtrips.push(Array.from(z[decode + "Sync"](compressed)));
        const info = z[encode + "Sync"](input, { info: true });
        result.roundtrips.push({
          decoded: Array.from(z[decode + "Sync"](info.buffer)),
          written: info.engine.bytesWritten,
          closed: info.engine._closed,
        });
        let returned = false;
        const done = new Promise((resolve, reject) =>
          z[encode](input, (error, output) =>
            error
              ? reject(error)
              : resolve({
                  async: returned,
                  decoded: Array.from(z[decode + "Sync"](output)),
                }),
          ),
        );
        returned = true;
        result.roundtrips.push(await done);
      }
      for (const info of [false, true]) {
        try {
          z[decode + "Sync"](z[encode + "Sync"]("output exceeds limit"), {
            info,
            maxOutputLength: 3,
          });
          result.validation.push("unexpected success");
        } catch (error) {
          result.validation.push(failure(error));
        }
      }
      const ctor = encode[0].toUpperCase() + encode.slice(1);
      const engine = z["create" + ctor]({ chunkSize: 64 });
      const chunks = [];
      const end = new Promise((resolve, reject) => {
        engine.on("data", (chunk) => chunks.push(chunk));
        engine.on("error", reject);
        engine.on("end", resolve);
      });
      engine.write("first");
      await new Promise((resolve) => engine.flush(resolve));
      await new Promise((resolve) =>
        engine.params(1, z.constants.Z_DEFAULT_STRATEGY, resolve),
      );
      engine.end("second");
      await end;
      const compressed = new Uint8Array(
        chunks.reduce((n, c) => n + c.length, 0),
      );
      let offset = 0;
      for (const chunk of chunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }
      result.streams.push({
        plain: new TextDecoder().decode(z[decode + "Sync"](compressed)),
        written: engine.bytesWritten,
      });
    }
    for (const options of [
      { chunkSize: 63 },
      { chunkSize: NaN },
      { windowBits: 8 },
      { windowBits: 0 },
      { level: 10 },
      { level: null },
      { flush: 6 },
      { maxOutputLength: 0 },
      { maxOutputLength: 3 },
    ]) {
      for (const kind of ["fast", "info", "stream"]) {
        try {
          const value =
            kind === "stream"
              ? z.createGzip(options)
              : z.gzipSync("hello", { ...options, info: kind === "info" });
          value.destroy?.();
          result.validation.push(null);
        } catch (error) {
          result.validation.push(failure(error));
        }
      }
    }
    const compressed = z.deflateSync("dictionary words", {
      dictionary: new Uint8Array([1, 2, 3]),
    });
    result.dictionary = Array.from(
      z.inflateSync(compressed, {
        dictionary: new DataView(new Uint8Array([1, 2, 3]).buffer),
      }),
    );
    result.unzip = Array.from(z.unzipSync(z.gzipSync(source)));
    return result;
  },

  fsAccess: async function ({ fs }) {
    fs.writeFileSync("/tmp/access-contract", "value");
    const results = [];
    for (const path of ["/tmp/access-contract", "/tmp/access-missing"]) {
      for (let mode = 0; mode < 8; mode++) {
        let sync = null;
        try {
          fs.accessSync(path, mode);
        } catch (error) {
          sync = error.code;
        }
        let promise = null;
        try {
          await fs.promises.access(path, mode);
        } catch (error) {
          promise = error.code;
        }
        let returned = false;
        const pending = new Promise((resolve) =>
          fs.access(path, mode, (error) =>
            resolve([error?.code ?? null, returned]),
          ),
        );
        returned = true;
        results.push({ path, mode, sync, promise, callback: await pending });
      }
    }
    const invalid = [];
    for (const mode of [-1, 8, 1.5, "4"]) {
      let callbackCalled = false;
      try {
        fs.access("/tmp/access-contract", mode, () => {
          callbackCalled = true;
        });
      } catch (error) {
        invalid.push([error.name, error.code, callbackCalled]);
      }
    }
    const beforeDeletion = new Promise((resolve) =>
      fs.access("/tmp/access-contract", (error) =>
        resolve(error?.code ?? null),
      ),
    );
    fs.unlinkSync("/tmp/access-contract");
    const beforeCreation = new Promise((resolve) =>
      fs.access("/tmp/access-contract", (error) =>
        resolve(error?.code ?? null),
      ),
    );
    fs.writeFileSync("/tmp/access-contract", "created");
    return {
      results,
      invalid,
      beforeDeletion: await beforeDeletion,
      beforeCreation: await beforeCreation,
    };
  },
  x509: function ({ crypto: c }) {
    const pem =
      "-----BEGIN CERTIFICATE-----\nMIIDhDCCAmygAwIBAgIUdN1my4bhw3mAm+rrvYEZBzi4nuAwDQYJKoZIhvcNAQEL\nBQAwJjESMBAGA1UEAwwJbG9jYWxob3N0MRAwDgYDVQQKDAdXb3JrZXJzMB4XDTI2\nMTAyMjIzMTEyNVoXDTI2MTAyNDIzMTEyNVowJjESMBAGA1UEAwwJbG9jYWxob3N0\nMRAwDgYDVQQKDAdXb3JrZXJzMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC\nAQEAmdA4QcozdOsYQJXG5oDzOJEKHIoyM1HDVXgH2ZWTL0Qm9yJJ02uV55IhW2AY\nshAs1ZROFCae5891g4ohl1H4sFDE5HYuD4BLkh9RY8QcZ7170nA1fnxNfO0K0GZs\nJyCOerlt5fLJjcEQiiyjbs8/2yukxHJraHQIZ1cO/PbWJx9O7iZ5Ru7u2ompDrsz\nzTbVgjI/u4g+sHEf+11me+7WW13Lj4FvpDHZp1K9zoMtOj/ruURVs/5wO3gygNnO\nVVrtNc/0nOU0Qqlqyr0QC9ZkHpn374hL2m0KC9BNixbLdQ+Oy4O406UhQXUGOSPg\ndfN3MBgPJrs1yZ1Io6pL41LWXwIDAQABo4GpMIGmMB0GA1UdDgQWBBSlprvE05R3\nZRC3gulykkeMzbOIZzAPBgNVHRMBAf8EBTADAQH/MFUGA1UdEQROMEyCCWxvY2Fs\naG9zdIIOKi5leGFtcGxlLnRlc3SHBH8AAAGBEXRlc3RAZXhhbXBsZS50ZXN0hhZo\ndHRwczovL2V4YW1wbGUudGVzdC9hMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEF\nBQcDAjANBgkqhkiG9w0BAQsFAAOCAQEAWO4DydLOPOBNyKYw50dBT/UgF9l7zvk+\nl2C7v1dMVCtpKW4egHUjINf+tOHC7PLjMMSKDvM/NGszAePPRSAJzfvoIEF5nahz\nLAzcM3zIdp7vviP1yeSSgJH5QRvo4pMV13K4FHARR5L/ShZqEKvKbVwDCrzymkND\nV5SGa11p5xf0Fm6061vfgBQ85vNFANXByqznGhn9tBRf5pJGBl4cjTJ9WCl8zVCs\n++24wsetgXwxL9O1p+NvfM8SdTVGBSevAA/OAc2Fjoye4oJHH4n3sCsIxoEeRnb4\nZYhC9Q4UwNucHDFJASAMWC5AfX7P+HnaguZXGHsfBrw/39sZFdncwg==\n-----END CERTIFICATE-----\n";
    const privatePem =
      "-----BEGIN PRIVATE KEY-----\nMIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQCZ0DhByjN06xhA\nlcbmgPM4kQocijIzUcNVeAfZlZMvRCb3IknTa5XnkiFbYBiyECzVlE4UJp7nz3WD\niiGXUfiwUMTkdi4PgEuSH1FjxBxnvXvScDV+fE187QrQZmwnII56uW3l8smNwRCK\nLKNuzz/bK6TEcmtodAhnVw789tYnH07uJnlG7u7aiakOuzPNNtWCMj+7iD6wcR/7\nXWZ77tZbXcuPgW+kMdmnUr3Ogy06P+u5RFWz/nA7eDKA2c5VWu01z/Sc5TRCqWrK\nvRAL1mQemffviEvabQoL0E2LFst1D47Lg7jTpSFBdQY5I+B183cwGA8muzXJnUij\nqkvjUtZfAgMBAAECgf8siPZrptQSyRG8lmJJGJoUo5EbjUEG5SHuRhshJdain2Fi\nXTQDAUbTk9qsyLx0Cc9R6i3D0LFeaXIvmqvgIprr+2vAYYKfT7S28Yb2hq6Y1WPW\nUQO5H3/zZ1IraUiG4uR0ZTEVoKP98mieEAgvlMr81UtF0V0uFwZ1kBpkjAE2nGj4\nISzH0MsafINRIYWsJ4cDGJikBY9e0DG2DhG1w4qNmJq+2cWM8+kLVII8V7u97ef1\nWGnSTa3OkmU5wlmUbS3Ju8bAoTkkJ+a49KT3OlKITdF7UKYGG2rseWgZULd5ZSek\nlcnuBAuqD7lJRBbVjI5AFr8fSQU0FzMwrvVAOpECgYEAy4ERAoBZfToz1ILH5u4K\n8N4uZmAafRlVtyPISP1KkSNDQI1gCxuuCsT03lgWOrXKE8gtqICSryMygycBSGni\n3+QUQU61+QnTuslIwTfIZUQG6zTdwEpAmLVJ3KsaaS4rpn3fpq+umPLmZ59h9eJp\nuevxhFv/muWjzRsxxTPsMfECgYEAwX2woht7j6NF9ilSrtSGoESPwCNci431mKJd\no3MOKtjtedYWfycJKUQ+B+do0xd7Y43dTrLcH52ZpvDMsyYg3bP9uWKnvqc4cm8q\ndn4AyYx0W1P4jf8iyLm6yEqif6J6UuLyyoMjsO3b8FBqAHRNdGFIg6f183MYcu4b\ndwUZPU8CgYA68hSiO9kv+7bdnFAY5OSIZmLcRoQFrlv0o0m1UqDRr3wga5LhRNBB\n0FD5QlyV/ugcmMQY5b0XO8O614Z4miscHO19CTaOfzk0Bm+rf+Ps6Spz4KlGtHtH\ngGN3ppwM0VHVdOpeVs7lAJ6ab0Epvr5PGzem1hsQm+m5VGIzM9n7kQKBgFYqY/t8\n46SOoDxEILcMm7tJbP6ygKcBG+rR+4MrXJbGLdMA/Nm5B4JiCoG4ktzWazNlXLWM\nPyyxIVjPiUkKZL52RjpFbdAgZanISY+lAzK+Ip79IQYTJWlgFIbXfc/7CiBZQqfe\niIllE3nMRbhYEpoOLJ28sXGtwqiD0qVJFvlPAoGAaf740rwvulTjEuaMfyaUf95/\n7fiRyD39Ct9GqDLvOiJAyWrVLaRYdV8warqWwwu0KHczAVs+eWe4WhTV7jZvPBLg\nLJcIZuJytVWIYFfSkHgdxk6sFYKCvETi6zgYBREnYkFPYzMdiOX57c2Di8SzAt/T\nUV3iEhCZhSw7+VFVgu8=\n-----END PRIVATE KEY-----\n";
    const cert = new c.X509Certificate(pem),
      key = c.createPrivateKey(privatePem);
    const attempt = (fn) => {
      try {
        return fn() ?? null;
      } catch (error) {
        return { name: error.name, code: error.code, message: error.message };
      }
    };
    const fields = [
      "subject",
      "issuer",
      "subjectAltName",
      "infoAccess",
      "validFrom",
      "validTo",
      "fingerprint",
      "fingerprint256",
      "fingerprint512",
      "keyUsage",
      "serialNumber",
      "ca",
      "issuerCertificate",
    ];
    const padded = new Uint8Array(cert.raw.length + 4);
    padded.set(cert.raw, 2);
    return {
      fields: Object.fromEntries(fields.map((k) => [k, cert[k] ?? null])),
      raw: Array.from(cert.raw),
      pem: cert.toString(),
      json: cert.toJSON(),
      legacy: cert.toLegacyObject(),
      cached:
        cert.raw === cert.raw &&
        cert.publicKey === cert.publicKey &&
        cert.toLegacyObject() === cert.toLegacyObject(),
      publicKey: cert.publicKey.export({ format: "pem", type: "spki" }),
      der: new c.X509Certificate(
        new DataView(padded.buffer, 2, cert.raw.length),
      ).fingerprint,
      issued: cert.checkIssued(cert),
      private: cert.checkPrivateKey(key),
      verified: cert.verify(cert.publicKey),
      wrongKey: cert.checkPrivateKey(
        c.generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey,
      ),
      hosts: [
        "localhost",
        "x.example.test",
        "x.y.example.test",
        "wrong.invalid",
        "localhost\0wrong",
      ].map((n) => attempt(() => cert.checkHost(n))),
      options: [
        { wildcards: false },
        { partialWildcards: false },
        { multiLabelWildcards: true },
        { subject: "never" },
        { subject: "invalid" },
        { wildcards: 0 },
        false,
      ].map((o) => attempt(() => cert.checkHost("x.y.example.test", o))),
      emails: ["test@example.test", "other@example.test"].map((n) =>
        attempt(() => cert.checkEmail(n)),
      ),
      ips: ["127.0.0.1", "127.0.0.2", "::1", "not-ip"].map((n) =>
        attempt(() => cert.checkIP(n)),
      ),
      invalid: [
        () => new c.X509Certificate("bad"),
        () => new c.X509Certificate(new ArrayBuffer(4)),
        () => cert.checkIssued({}),
        () => cert.checkPrivateKey(cert.publicKey),
        () => cert.verify(key),
        () => cert.checkHost(1),
      ].map(attempt),
    };
  },

  x509Ec: function ({ crypto: c }) {
    const pem =
        "-----BEGIN CERTIFICATE-----\nMIIBaDCCAQ6gAwIBAgIUR0JYwBRWD1OQflPk9iq6c8s/90swCgYIKoZIzj0EAwIw\nGjEYMBYGA1UEAwwPZWMuZXhhbXBsZS50ZXN0MB4XDTI2MTAyMzAwNTEyN1oXDTI2\nMTAyNTAwNTEyN1owGjEYMBYGA1UEAwwPZWMuZXhhbXBsZS50ZXN0MFkwEwYHKoZI\nzj0CAQYIKoZIzj0DAQcDQgAE91VvPzxvJu7z28yu3162tL9f1pYoEAEsCbb0dYdG\nUGcUv3zuHz7fhcfqvuzuDnV2Jh8Y8qp+MtGlWxh8fOhYzKMyMDAwHQYDVR0OBBYE\nFAaHxuLK5SXnLdzXW7X0SclrQrvvMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0E\nAwIDSAAwRQIhAOZXfipKh5gsRprMHc/SO3TcjNqBBUSKHwOxr2nqpa1UAiB3ZSBJ\nuNDgK4eNIasqXlmgXmC8M3MD7LdTk0qwUc+fPQ==\n-----END CERTIFICATE-----\n",
      keyPem =
        "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3MCUdaaqmJh19iLT\ny72VTuXH0U44yXi/D5VN89PXA6WhRANCAAT3VW8/PG8m7vPbzK7fXra0v1/WligQ\nASwJtvR1h0ZQZxS/fO4fPt+Fx+q+7O4OdXYmHxjyqn4y0aVbGHx86FjM\n-----END PRIVATE KEY-----\n";
    const cert = new c.X509Certificate(pem),
      raw = new Uint8Array(cert.raw);
    raw[raw.length - 1] ^= 1;
    const damaged = new c.X509Certificate(raw);
    const key = c.createPrivateKey(keyPem);
    return {
      legacy: cert.toLegacyObject(),
      publicKey: cert.publicKey.export({ format: "pem", type: "spki" }),
      usage: cert.keyUsage ?? null,
      subject: cert.subject,
      issued: cert.checkIssued(cert),
      private: cert.checkPrivateKey(key),
      verified: cert.verify(cert.publicKey),
      imported: cert.verify(c.createPublicKey(key)),
      damaged: damaged.verify(cert.publicKey),
      cached: cert.toLegacyObject() === cert.toLegacyObject(),
    };
  },
  x509Names: function ({ crypto: c }) {
    const cert = new c.X509Certificate(
      "-----BEGIN CERTIFICATE-----\nMIICdjCCAhygAwIBAgIUQsn9ZMGrGViSPljhZDsSPq54huQwCgYIKoZIzj0EAwIw\nODEbMBkGA1UEAwwSY2Fmw6kuZXhhbXBsZS50ZXN0MRkwFwYDVQQKDBBXb3JrZXJz\nICsgTmF0aXZlMB4XDTI2MTAyMzAxMDEzOVoXDTI2MTAyNTAxMDEzOVowODEbMBkG\nA1UEAwwSY2Fmw6kuZXhhbXBsZS50ZXN0MRkwFwYDVQQKDBBXb3JrZXJzICsgTmF0\naXZlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBT9EJkWZClxIzvyp7SNufuJF\nEAYD8CzONWw47BsuaZCJElS8JEbVTNC5aWNy45S7IIRj6d4PS/GU6DT1M1sLoaOC\nAQIwgf8wCQYDVR0TBAIwADCBsQYDVR0RBIGpMIGmghJ2YWxpZC5leGFtcGxlLnRl\nc3SCF2NvbW1hLG5hbWUuZXhhbXBsZS50ZXN0hhhodHRwczovL2V4YW1wbGUudGVz\ndC9hLGKHECABDbgAAAAAAAAAAAAAAAGBEXRlc3RAZXhhbXBsZS50ZXN0oCEGCisG\nAQQBgjcUAgOgEwwRdXNlckBleGFtcGxlLnRlc3SkFTATMREwDwYDVQQDDAhEaXIs\nTmFtZTA+BggrBgEFBQcBAQQyMDAwLgYIKwYBBQUHMAGGImh0dHBzOi8vb2NzcC5l\neGFtcGxlLnRlc3QvdmFsaWRhdGUwCgYIKoZIzj0EAwIDSAAwRQIgfppXDfKn85vj\nDm1QS9agAk9W5P8Md841oJ+8nVaAg4ECIQDeXmgVDWiRqusAivE68OEKJB5arucO\nyLzk3hNzHXSQKg==\n-----END CERTIFICATE-----\n",
    );
    const raw = new Uint8Array(cert.raw),
      marker = new TextEncoder().encode("Workers + Native");
    for (let i = 0; i <= raw.length - marker.length; i++)
      if (marker.every((byte, j) => raw[i + j] === byte)) raw[i] = 0;
    const nulNames = new c.X509Certificate(raw).toLegacyObject();
    const attempt = (fn) => {
      try {
        return fn() ?? null;
      } catch (e) {
        return { name: e.name, message: e.message, code: e.code };
      }
    };
    return {
      nulNames,
      receiverChecks: [
        () =>
          Object.getOwnPropertyDescriptor(
            c.X509Certificate.prototype,
            "subject",
          ).get.call({}),
        () =>
          c.X509Certificate.prototype.checkHost.call({}, "valid.example.test"),
      ].map((fn) => {
        try {
          return fn() ?? null;
        } catch (error) {
          return { name: error.name, code: error.code ?? null };
        }
      }),
      cache: {
        raw: cert.raw === cert.raw,
        publicKey: cert.publicKey === cert.publicKey,
        legacy: cert.toLegacyObject() === cert.toLegacyObject(),
      },
      subject: cert.subject,
      san: cert.subjectAltName,
      info: cert.infoAccess,
      ca: cert.ca,
      legacy: cert.toLegacyObject(),
      ip: cert.checkIP("2001:db8::1"),
      names: [{}, { subject: "always" }, { subject: "never" }].map((o) =>
        attempt(() => cert.checkHost("café.example.test", o)),
      ),
      invalid: [
        () => cert.checkEmail("test@example.test", { subject: "invalid" }),
        () =>
          cert.checkHost("valid.example.test", {
            get subject() {
              throw new Error("option-getter");
            },
          }),
        () => cert.checkEmail("a\0b"),
        () => cert.checkIP("127.0.0.1\0evil"),
        () => cert.checkHost("valid.example.test", { partialWildcards: 1 }),
        () =>
          cert.checkHost("valid.example.test", { singleLabelSubdomains: 1 }),
      ].map(attempt),
    };
  },
  certificates: function ({ crypto: c }) {
    const signatures = [
      "MIIBVDCBvjCBnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEAzEBFZlRokWwqjZlV3uIZCb4XHlCRHi11xrIKzd3+zjmeqJdb3UMkZCQH52zU7DO+mfYwD1+pB9QHh0NsLlkUqkc+Ko5k2KHs0EuWL4NoOMf++wiRD39b2XpEyBdI7NYlsfZHhrXihsyVZsNrfXlWv6+gqGvFjh4nXEzZ2+kxfvECAwEAARYacG9ydGFibGUtd29ya2Vycy1jaGFsbGVuZ2UwDQYJKoZIhvcNAQEEBQADgYEAdBV72QBrvJdRpeG7kVjGpPlW8BRVVBO7arGOQjYs6q7W03dkMPj4uzVyGYZLj59eScSYGA7PnyiOGwy5loRIMVPciLK3YKz74auiRz+XUHFJysOK28Y6QPuRr48CRFu8H7e081ZOHkeyhcwRhd7wjEI4ngHoJ3dhqMy0syA5Vi0=",
      "MIIBVDCBvjCBnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEAzEBFZlRokWwqjZlV3uIZCb4XHlCRHi11xrIKzd3+zjmeqJdb3UMkZCQH52zU7DO+mfYwD1+pB9QHh0NsLlkUqkc+Ko5k2KHs0EuWL4NoOMf++wiRD39b2XpEyBdI7NYlsfZHhrXihsyVZsNrfXlWv6+gqGvFjh4nXEzZ2+kxfvECAwEAARYacG9ydGFibGUtd29ya2Vycy1jaGFsbGVuZ2UwDQYJKoZIhvcNAQELBQADgYEAyzRKqH1NI8+WT1sXzMIDzxnPl+GiD9aEsGjRPMZek+NYOxb63DpXBaZ4PcAc7no1nymhoysWxibrj/gJjG2hOUTRkzNamyF4vdRij5FsAtyWMUaV0uDZFkuasiL3R/Q/oh5XEP+uWqlysfeGG+z/JKoWU5nL/Ac2kT4evqx5pMU=",
    ];
    const api = c.Certificate;
    const instance = new api(),
      called = api();
    const describe = (value) => ({
      verified: api.verifySpkac(value),
      publicKey: api.exportPublicKey(value).toString("utf8"),
      challenge: api.exportChallenge(value).toString("hex"),
    });
    const cases = signatures.flatMap((value) => {
      const data = new TextEncoder().encode(value),
        padded = new Uint8Array(data.length + 4);
      padded.set(data, 2);
      const view = new DataView(padded.buffer, 2, data.length);
      const damaged = value.slice(0, -8) + "AAAAAAAA";
      return [
        describe(value),
        describe(data.buffer),
        describe(view),
        describe(value + " \n\r\t"),
        describe(damaged),
        {
          hex: api
            .exportChallenge(
              Array.from(data, (b) => b.toString(16).padStart(2, "0")).join(""),
              "hex",
            )
            .toString("hex"),
          legacy: instance
            .exportPublicKey(data)
            .equals(api.exportPublicKey(data)),
          called: called
            .exportChallenge(data)
            .equals(api.exportChallenge(data)),
          bufferEncoding: api.exportChallenge(value, "buffer").toString("hex"),
        },
      ];
    });
    const invalid = ["", " \n\t", "not-base64", "SPKAC=" + signatures[0]].map(
      describe,
    );
    const errors = [];
    for (const name of ["verifySpkac", "exportPublicKey", "exportChallenge"])
      for (const value of [undefined, null, 42, {}]) {
        try {
          api[name](value);
          errors.push(null);
        } catch (e) {
          errors.push({ name: e.name, code: e.code, message: e.message });
        }
      }
    return {
      cases,
      invalid,
      errors,
      instance: instance instanceof api,
      called: called instanceof api,
      methods: ["verifySpkac", "exportPublicKey", "exportChallenge"].map(
        (n) => instance[n] === api[n],
      ),
    };
  },

  primeNumbers: async function ({ crypto }) {
    const capture = (fn) => {
      try {
        return { value: fn() ?? null };
      } catch (e) {
        return { name: e.name, code: e.code ?? null, message: e.message };
      }
    };
    const candidates = [
      0n,
      1n,
      2n,
      3n,
      4n,
      17n,
      561n,
      1105n,
      18446744073709551557n,
    ];
    const checked = candidates.map((value) => crypto.checkPrimeSync(value));
    const safe = crypto.generatePrimeSync(32, { safe: true, bigint: true });
    const constrained = crypto.generatePrimeSync(32, {
      add: 12n,
      rem: 11n,
      bigint: true,
    });
    const buffer = crypto.generatePrimeSync(32);
    const log = [];
    const async = await new Promise((resolve, reject) => {
      crypto.checkPrime(17n, (error, value) => {
        log.push("callback");
        error ? reject(error) : resolve(value);
      });
      log.push("after");
    });
    const generated = await new Promise((resolve, reject) =>
      crypto.generatePrime(16, { bigint: true }, (error, value) =>
        error ? reject(error) : resolve(crypto.checkPrimeSync(value)),
      ),
    );
    const errors = [
      () => crypto.checkPrimeSync(-1n),
      () => crypto.checkPrimeSync("17"),
      () => crypto.checkPrimeSync(17n, { checks: 65 }),
      () => crypto.checkPrimeSync(17n, { checks: -1 }),
      () => crypto.checkPrimeSync(new Uint8Array(1025)),
      () => crypto.generatePrimeSync(0),
      () => crypto.generatePrimeSync(8193),
      () => crypto.generatePrimeSync(16, { safe: 1 }),
      () => crypto.generatePrimeSync(16, { add: 4n, rem: 3n }),
      () => crypto.generatePrimeSync(2, { add: 12n, rem: 11n }),
    ].map(capture);
    return {
      checked,
      safe:
        crypto.checkPrimeSync(safe) && crypto.checkPrimeSync((safe - 1n) / 2n),
      safeBits: safe.toString(2).length,
      remainder: String(constrained % 12n),
      constrainedBits: constrained.toString(2).length,
      buffer: {
        brand: buffer instanceof ArrayBuffer,
        bytes: buffer.byteLength,
        prime: crypto.checkPrimeSync(buffer),
      },
      async,
      generated,
      log,
      errors,
    };
  },
  asymmetricKeys: async function ({ crypto }) {
    // Disposable fixture keys generated by independent Node crypto, never credentials.
    const fixtures = {
      rsa: {
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nMIICdQIBADANBgkqhkiG9w0BAQEFAASCAl8wggJbAgEAAoGBAKmqearRpQ+76PnZ\nQ8r2aFHbGae4GwWqLQDF15XxwtcDUUTytnIBmpxw8I5cs9YezIh2hZc/lYcW9Gmb\nXBTOaHtDgkR+hXxq1o0awFarEJMFW80w3j+68/syK11IvRhsbcGBQvw15SGoeaHQ\nhvWSN+IiTDKQYeJ328e7yjFh3Ct5AgMBAAECgYBhwVdYlHIGHr6dNhFZX5+7igG+\nINVw7hv/1f3g5urb941brHxyM3phqLDxVXhIZnZyKdfOzVPaAd/Q+TKUylhnvJQz\nf3b2YBdtOz4AIsMPWnTilDRi1Kwu5mvcF5gzlbBsleJMTjRRDWwG1Sxg69Yze/Rh\nnZ8kJTEye7nMaZPAAQJBANo0MndLMjNLLpin925wiDmLO5Vct6GnPGY1gfNbzVXl\n6uUs4oc5XolZDjsW97bYsn+Rip52hX5rqkeNYBncOJECQQDHDfYgGx48qFmb1gRU\nd8ikvDIWk9DurQvnjGcGfWvAzvtyw9ybk0CBpFghrF7izutj+j0VfnFWlNX9e612\nNXhpAkAy1nhvjMh8ZObNUEz4oSVL6uGN8hUih5kt4weM0HWtrqykimmYwcgBzgrf\nv4ElS6WCzUDznH+Lrb/1fb3HKKTRAkAc+QBBDhFpnMtmLlF1BfZTW/0iYiOACfn4\nmuwH+strRfU9cBq1Hkq+U/Br/k3VT27dn3eyoDPY+VLoUU8fLIs5AkAl7rPmRk0W\naVESr8259cVOXJZNfff+NDbTDO88/et+bARWUPPFopAOQhbRaHzoQN05WsAnDSl0\n3R6Dwk53bF0r\n-----END PRIVATE KEY-----\n",
        publicKey:
          "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCpqnmq0aUPu+j52UPK9mhR2xmn\nuBsFqi0AxdeV8cLXA1FE8rZyAZqccPCOXLPWHsyIdoWXP5WHFvRpm1wUzmh7Q4JE\nfoV8ataNGsBWqxCTBVvNMN4/uvP7MitdSL0YbG3BgUL8NeUhqHmh0Ib1kjfiIkwy\nkGHid9vHu8oxYdwreQIDAQAB\n-----END PUBLIC KEY-----\n",
        jwk: {
          kty: "RSA",
          n: "qap5qtGlD7vo-dlDyvZoUdsZp7gbBaotAMXXlfHC1wNRRPK2cgGanHDwjlyz1h7MiHaFlz-Vhxb0aZtcFM5oe0OCRH6FfGrWjRrAVqsQkwVbzTDeP7rz-zIrXUi9GGxtwYFC_DXlIah5odCG9ZI34iJMMpBh4nfbx7vKMWHcK3k",
          e: "AQAB",
          d: "YcFXWJRyBh6-nTYRWV-fu4oBviDVcO4b_9X94Obq2_eNW6x8cjN6Yaiw8VV4SGZ2cinXzs1T2gHf0PkylMpYZ7yUM3929mAXbTs-ACLDD1p04pQ0YtSsLuZr3BeYM5WwbJXiTE40UQ1sBtUsYOvWM3v0YZ2fJCUxMnu5zGmTwAE",
          p: "2jQyd0syM0sumKf3bnCIOYs7lVy3oac8ZjWB81vNVeXq5SzihzleiVkOOxb3ttiyf5GKnnaFfmuqR41gGdw4kQ",
          q: "xw32IBsePKhZm9YEVHfIpLwyFpPQ7q0L54xnBn1rwM77csPcm5NAgaRYIaxe4s7rY_o9FX5xVpTV_XutdjV4aQ",
          dp: "MtZ4b4zIfGTmzVBM-KElS-rhjfIVIoeZLeMHjNB1ra6spIppmMHIAc4K37-BJUulgs1A85x_i62_9X29xyik0Q",
          dq: "HPkAQQ4RaZzLZi5RdQX2U1v9ImIjgAn5-JrsB_rLa0X1PXAatR5KvlPwa_5N1U9u3Z93sqAz2PlS6FFPHyyLOQ",
          qi: "Je6z5kZNFmlREq_NufXFTlyWTX33_jQ20wzvPP3rfmwEVlDzxaKQDkIW0Wh86EDdOVrAJw0pdN0eg8JOd2xdKw",
        },
        signature:
          "VZCB1w22hBa1DrzurqCnmUdaMXCFMWFCPmOg2IKfQGW48EsZCod4GpE07mJATLLjFVgdTppygeOUqvQK85/SD6jo3HNA270/ZANk4exXpj72lQziYslAY7wERfO9xozZwzAd2Mwg/XrUtlT4flGodizI0wCmGsOZ9ToqcSSjFKM=",
      },
      ec: {
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgkzAWEEq6Qf3Q3Zj8\njZzVPzjXi9v1UE4fUvSPCYDzIQ+hRANCAATUyxPEFq8wbhMtrw73FeZ4pAGrhRIV\n33P91jSkmz3i4hqV4Q4p8i4jxCmRxXjS8pmjSzVVtV1haS6lqKB3PqTW\n-----END PRIVATE KEY-----\n",
        publicKey:
          "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1MsTxBavMG4TLa8O9xXmeKQBq4US\nFd9z/dY0pJs94uIaleEOKfIuI8QpkcV40vKZo0s1VbVdYWkupaigdz6k1g==\n-----END PUBLIC KEY-----\n",
        jwk: {
          kty: "EC",
          x: "1MsTxBavMG4TLa8O9xXmeKQBq4USFd9z_dY0pJs94uI",
          y: "GpXhDinyLiPEKZHFeNLymaNLNVW1XWFpLqWooHc-pNY",
          crv: "P-256",
          d: "kzAWEEq6Qf3Q3Zj8jZzVPzjXi9v1UE4fUvSPCYDzIQ8",
        },
        signature:
          "MEYCIQD6Z6h2C9Ph77WTRPSzZiegB6hwdYGLY6piOyWM8h9iAQIhALPJTymfz9UQrYqJTuwvuFk3iM0laFYjEcueJYXPX67X",
      },
      ed25519: {
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIOzFGVeuGidC3g/gfu6BLZHV0nkI1cOdcgJSZndBdLk5\n-----END PRIVATE KEY-----\n",
        publicKey:
          "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAZ9S/SKhncpbOeH+ppPVjBQnZl6SBN+2UCWsZPmqVc7U=\n-----END PUBLIC KEY-----\n",
        jwk: {
          crv: "Ed25519",
          d: "7MUZV64aJ0LeD-B-7oEtkdXSeQjVw51yAlJmd0F0uTk",
          x: "Z9S_SKhncpbOeH-ppPVjBQnZl6SBN-2UCWsZPmqVc7U",
          kty: "OKP",
        },
        signature:
          "2Atk1x63ifZkxT1hOgEN32mT3U4Toiy3+659GbAgKFsMZi6Z2j0ZKTk8DsnXCllDzGB0LJKxnxnQEp0I/tAcCQ==",
      },
      x25519: {
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VuBCIEIFgmCj/A/WL5EEgvvjyCUV0/+K/sxR62Z6WlK/Vz1ydG\n-----END PRIVATE KEY-----\n",
        publicKey:
          "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VuAyEACs62/8koQj99zkBorRDHAvE3uptEtZIjbmL6ogtsRwU=\n-----END PUBLIC KEY-----\n",
        jwk: {
          crv: "X25519",
          d: "WCYKP8D9YvkQSC--PIJRXT_4r-zFHrZnpaUr9XPXJ0Y",
          x: "Cs62_8koQj99zkBorRDHAvE3uptEtZIjbmL6ogtsRwU",
          kty: "OKP",
        },
        signature: null,
        peer: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VuAyEA3lvtx86rEZf58Uf9X9OIEYtpWglahuEwoK3lzb9kxC0=\n-----END PUBLIC KEY-----\n",
        secret:
          "c47b7be86dc7effc5514183876c5377825417f783b1ae4b8f5edd6afcf0c4922",
      },
    };
    const decode = (value) =>
      Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    const data = new TextEncoder().encode("Workers portable key");
    const result = {};
    for (const [type, fixture] of Object.entries(fixtures)) {
      const privateKey = crypto.createPrivateKey(fixture.privateKey);
      const publicKey = crypto.createPublicKey(privateKey);
      const imported = crypto.createPublicKey(fixture.publicKey);
      const jwk = crypto.createPrivateKey({ key: fixture.jwk, format: "jwk" });
      const der = privateKey.export({ format: "der", type: "pkcs8" });
      const roundtrip = crypto.createPrivateKey({
        key: der,
        format: "der",
        type: "pkcs8",
      });
      const details = privateKey.asymmetricKeyDetails;
      const entry = {
        type: privateKey.type,
        algorithm: privateKey.asymmetricKeyType,
        details: JSON.parse(
          JSON.stringify(details, (_, value) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        ),
        publicPem: publicKey.export({ format: "pem", type: "spki" }),
        publicEqual: publicKey.equals(imported),
        jwkEqual: privateKey.equals(jwk),
        derEqual: privateKey.equals(roundtrip),
        publicJwk: publicKey.export({ format: "jwk" }),
        privateJwk: privateKey.export({ format: "jwk" }),
      };
      entry.dhValidation = [
        {},
        { publicKey },
        { publicKey: {}, privateKey },
        { publicKey: privateKey, privateKey },
        { publicKey, privateKey: publicKey },
        { publicKey: fixture.publicKey, privateKey },
        { publicKey, privateKey: fixture.privateKey },
        {
          publicKey,
          privateKey: crypto.createPrivateKey(
            fixtures[type === "rsa" ? "ec" : "rsa"].privateKey,
          ),
        },
      ].map((options) => {
        try {
          crypto.diffieHellman(options);
          return null;
        } catch (e) {
          return { name: e.name, code: e.code ?? null };
        }
      });
      if (type === "x25519") {
        try {
          entry.secret = crypto
            .diffieHellman({
              privateKey,
              publicKey: crypto.createPublicKey(fixture.peer),
            })
            .toString("hex");
        } catch (e) {
          entry.error = { name: e.name, message: e.message };
        }
      } else {
        const algorithm = type === "ed25519" ? null : "sha256";
        const signature = crypto.sign(algorithm, data, privateKey);
        entry.verifies = crypto.verify(algorithm, data, publicKey, signature);
        entry.independent = crypto.verify(
          algorithm,
          data,
          publicKey,
          decode(fixture.signature),
        );
        entry.tampered = crypto.verify(
          algorithm,
          new Uint8Array([0]),
          publicKey,
          signature,
        );
        if (type !== "ed25519") {
          const signer = crypto.createSign("sha256");
          signer.update(data.subarray(0, 3));
          signer.update(data.subarray(3));
          const streamed = signer.sign(privateKey);
          const verifier = crypto.createVerify("sha256");
          verifier.update(data.subarray(0, 5));
          verifier.update(data.subarray(5));
          entry.streaming = {
            valid: verifier.verify(publicKey, streamed),
            independent: crypto
              .createVerify("sha256")
              .update(data)
              .verify(publicKey, decode(fixture.signature)),
            cross: crypto.verify("sha256", data, publicKey, streamed),
            constructor: signer instanceof crypto.Sign,
          };
          if (type === "rsa")
            entry.streaming.signature = streamed.toString("base64");
          const failure = (run) => {
            try {
              run();
              return null;
            } catch (error) {
              return {
                name: error.name,
                message: error.message,
                code: error.code ?? null,
              };
            }
          };
          entry.streaming.errors = [
            failure(() => signer.update(data)),
            failure(() => signer.sign(privateKey)),
            failure(() => verifier.update(data)),
            failure(() => verifier.verify(publicKey, streamed)),
            failure(() => crypto.createSign("not-a-digest")),
            failure(() => crypto.createVerify("not-a-digest")),
          ];
          const encoded = crypto
            .createSign("sha256")
            .update(data)
            .sign({
              key: fixture.privateKey,
              ...(type === "ec"
                ? { dsaEncoding: "ieee-p1363" }
                : { padding: 6, saltLength: 0 }),
            });
          entry.streaming.options = crypto
            .createVerify("sha256")
            .update(data)
            .verify(
              {
                key: fixture.publicKey,
                ...(type === "ec"
                  ? { dsaEncoding: "ieee-p1363" }
                  : { padding: 6, saltLength: 0 }),
              },
              encoded,
            );
        }
        if (type === "ec") {
          const encoded = crypto.sign("sha256", data, {
            key: fixture.privateKey,
            dsaEncoding: "ieee-p1363",
          });
          entry.p1363 = {
            length: encoded.length,
            valid: crypto.verify(
              "sha256",
              data,
              { key: fixture.publicKey, dsaEncoding: "ieee-p1363" },
              encoded,
            ),
          };
        }
        if (type === "rsa") {
          entry.rsaComposition = [false, true].map((wrapped) => {
            try {
              const pub = wrapped ? { key: publicKey } : publicKey;
              const priv = wrapped ? { key: privateKey } : privateKey;
              const encrypted = crypto.publicEncrypt(pub, data);
              const signed = crypto.privateEncrypt(priv, data);
              return [
                crypto.privateDecrypt(priv, encrypted).toString("hex"),
                crypto.publicDecrypt(pub, signed).toString("hex"),
              ];
            } catch (e) {
              return { name: e.name, code: e.code ?? null };
            }
          });
          entry.rsaOptions = [
            { oaepLabel: new Uint8Array([1]) },
            { padding: 4, oaepLabel: new Uint8Array([1]), oaepHash: "sha256" },
            { padding: 4, oaepLabel: new Uint8Array([1]), oaepHash: "sha1" },
            { oaepLabel: 42 },
          ].map((options) => {
            try {
              const encrypted = crypto.publicEncrypt(
                { key: fixture.publicKey, ...options },
                data,
              );
              const decoded = crypto.privateDecrypt(
                { key: fixture.privateKey, ...options },
                encrypted,
              );
              let mismatch;
              try {
                crypto.privateDecrypt(
                  {
                    key: fixture.privateKey,
                    ...options,
                    oaepLabel: new Uint8Array([2]),
                  },
                  encrypted,
                );
                mismatch = null;
              } catch (e) {
                mismatch = { name: e.name, message: e.message };
              }
              return { decoded: decoded.toString("hex"), mismatch };
            } catch (e) {
              return { name: e.name, code: e.code ?? null, message: e.message };
            }
          });
          const signed = crypto.sign("sha256", data, {
            key: fixture.privateKey,
            padding: 6,
            saltLength: 0,
          });
          entry.pss = crypto.verify(
            "sha256",
            data,
            { key: fixture.publicKey, padding: 6, saltLength: 0 },
            signed,
          );
          const passphrase = new Uint8Array([112, 0, 97]);
          entry.encrypted = ["pem", "der"].map((format) => {
            const encrypted = privateKey.export({
              type: "pkcs8",
              format,
              cipher: "aes-256-cbc",
              passphrase,
            });
            return crypto
              .createPrivateKey({
                key: encrypted,
                type: "pkcs8",
                format,
                passphrase,
              })
              .equals(privateKey);
          });
        }

        if (type !== "ec") entry.signature = signature.toString("base64");
        entry.async = await new Promise((resolve, reject) =>
          crypto.sign(algorithm, data, privateKey, (error, signed) =>
            error
              ? reject(error)
              : crypto.verify(
                  algorithm,
                  data,
                  publicKey,
                  signed,
                  (err, valid) => (err ? reject(err) : resolve(valid)),
                ),
          ),
        );
      }
      result[type] = entry;
    }
    result.timing = [
      crypto.timingSafeEqual(data, new Uint8Array(data)),
      crypto.timingSafeEqual(new Uint8Array([1]), new Uint8Array([2])),
    ];
    return result;
  },
  asymmetricGeneration: function ({ crypto }) {
    return ["rsa", "ec", "ed25519", "x25519"].map((type) => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync(
        type,
        type === "rsa"
          ? { modulusLength: 1024 }
          : type === "ec"
            ? { namedCurve: "prime256v1" }
            : {},
      );
      const exported = privateKey.export({ format: "pem", type: "pkcs8" });
      return {
        type,
        privateType: privateKey.type,
        publicType: publicKey.type,
        equal: crypto.createPrivateKey(exported).equals(privateKey),
        publicEqual: crypto.createPublicKey(privateKey).equals(publicKey),
      };
    });
  },

  processConfiguration: function ({ process }) {
    return {
      argv0: process.argv0,
      config: process.config,
      frozen: [
        Object.isFrozen(process.config),
        Object.isFrozen(process.config.variables),
        Object.isFrozen(process.config.target_defaults),
      ],
      undefinedFields: [
        "assert",
        "_channel",
        "_disconnect",
        "_handleQueue",
        "_pendingMessage",
        "_send",
      ].map((name) => [
        name,
        Object.hasOwn(process, name),
        process[name] === undefined,
      ]),
    };
  },
  processEnvironmentFile: function ({ process, fs }) {
    const path = "/tmp/process-environment-contract.env";
    const key = "CF_NATIVE_PROCESS_CONTRACT";
    const before = process.env[key];
    const errors = [];
    try {
      process.env[key] = "old";
      fs.writeFileSync(path, `${key}="new value" # comment\n`);
      const result = process.loadEnvFile(path);
      const loaded = process.env[key];
      process.loadEnvFile(new URL(`file://${path}`));
      for (const value of ["/tmp/no-such-process-env", null]) {
        try {
          process.loadEnvFile(value);
        } catch (e) {
          errors.push([e.name, e.code ?? null, e.message]);
        }
      }
      return { result: result ?? null, loaded, url: process.env[key], errors };
    } finally {
      fs.unlinkSync(path);
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    }
  },
  processStdio: async function ({ process, classicStreams }) {
    const streams = [process.stdin, process.stdout, process.stderr];
    const fields = streams.map((stream) =>
      Object.fromEntries(
        [
          "fd",
          "_type",
          "_isStdio",
          "allowHalfOpen",
          "bufferSize",
          "connecting",
          "readyState",
          "readable",
          "writable",
        ].map((key) => [key, stream[key] ?? null]),
      ),
    );
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push([...chunk]);
    return {
      fields,
      types: [
        process.stdin instanceof classicStreams.Readable,
        process.stdout instanceof classicStreams.Writable,
        process.stderr instanceof classicStreams.Writable,
      ],
      same: process.openStdin() === process.stdin,
      chunks,
    };
  },

  processClock: function ({ process }) {
    const now = Date.now;
    try {
      Date.now = () => 1234567;
      const invalid = [null, 12, [], [1], [1, 2, 3]].map((value) => {
        try {
          return process.hrtime(value);
        } catch (e) {
          return { name: e.name, code: e.code, message: e.message };
        }
      });
      return {
        absolute: process.hrtime(),
        bigint: String(process.hrtime.bigint()),
        delta: process.hrtime([1233, 900000000]),
        invalid,
      };
    } finally {
      Date.now = now;
    }
  },
  processStubs: function ({ process }) {
    const call = (name, args = []) => {
      try {
        return { value: process[name](...args) ?? null };
      } catch (e) {
        return {
          name: e.name,
          code: e.code ?? null,
          message: e.message,
          syscall: e.syscall ?? null,
          errno: e.errno ?? null,
        };
      }
    };
    const simple = [
      "ref",
      "unref",
      "setSourceMapsEnabled",
      "getSourceMapsSupport",
      "setUncaughtExceptionCaptureCallback",
      "hasUncaughtExceptionCaptureCallback",
      "kill",
      "binding",
      "dlopen",
      "getActiveResourcesInfo",
      "memoryUsage",
      "resourceUsage",
      "threadCpuUsage",
      "cpuUsage",
      "_linkedBinding",
      "_getActiveRequests",
      "_getActiveHandles",
      "_kill",
      "constrainedMemory",
      "availableMemory",
      "execve",
      "_fatalException",
      "_tickCallback",
      "_debugProcess",
      "_debugEnd",
      "_startProfilerIdleNotifier",
      "_stopProfilerIdleNotifier",
      "send",
      "uptime",
      "getegid",
      "getgid",
      "geteuid",
      "getuid",
      "getgroups",
    ].map((name) => [name, call(name)]);
    const permissions = [
      "setegid",
      "setgid",
      "seteuid",
      "setuid",
      "setgroups",
      "initgroups",
    ].map((name) => [
      name,
      [0, 1, "0", null, undefined].map((value) => call(name, [value])),
    ]);
    const nested = [
      "permission.has",
      "report.getReport",
      "report.writeReport",
      "finalization.register",
      "finalization.registerBeforeExit",
      "finalization.unregister",
    ].map((path) => {
      const [a, b] = path.split(".");
      try {
        return [path, { value: process[a][b]() ?? null }];
      } catch (e) {
        return [
          path,
          { name: e.name, code: e.code ?? null, message: e.message },
        ];
      }
    });
    const properties = Object.fromEntries(
      [
        "arch",
        "pid",
        "ppid",
        "exitCode",
        "channel",
        "connected",
        "debugPort",
        "noDeprecation",
        "traceDeprecation",
        "throwDeprecation",
        "sourceMapsEnabled",
        "execPath",
        "release",
        "moduleLoadList",
        "_preload_modules",
        "domain",
        "_exiting",
      ].map((name) => [name, process[name] ?? null]),
    );
    return {
      simple,
      permissions,
      nested,
      properties,
      flags: Array.from(process.allowedNodeEnvironmentFlags),
    };
  },
  tlsHelpers: function ({ tls }) {
    const capture = (fn) => {
      try {
        const result = fn();
        return result === undefined ? null : result;
      } catch (e) {
        return { name: e.name, code: e.code ?? null, message: e.message };
      }
    };
    const certificates = [
      ["api.example.com", { subjectaltname: "DNS:*.example.com" }],
      ["nested.api.example.com", { subjectaltname: "DNS:*.example.com" }],
      ["example.com", { subject: { CN: "example.com" } }],
      ["EXAMPLE.COM.", { subjectaltname: "DNS:example.com" }],
      [
        "example.com",
        { subjectaltname: "DNS:other.com", subject: { CN: "example.com" } },
      ],
      ["127.0.0.1", { subjectaltname: "IP Address:127.0.0.1" }],
      ["2001:db8::1", { subjectaltname: "IP Address:2001:0db8:0:0:0:0:0:1" }],
      ["::ffff:192.0.2.1", { subjectaltname: "IP Address:::ffff:c000:201" }],
      ["example.com", { subjectaltname: 'DNS:"bad' }],
      ["example.com", {}],
    ].map(([host, cert]) =>
      capture(() => {
        const e = tls.checkServerIdentity(host, cert);
        return e
          ? {
              name: e.name,
              code: e.code,
              message: e.message,
              reason: e.reason,
              host: e.host,
              sameCert: e.cert === cert,
            }
          : null;
      }),
    );
    const protocols = [
      ["h2", "http/1.1"],
      ["é"],
      new Uint8Array([2, 104, 50]),
      new DataView(new Uint8Array([0, 2, 104, 50, 0]).buffer, 1, 3),
      ["x".repeat(256)],
      null,
    ].map((value) =>
      capture(() => {
        const out = {};
        tls.convertALPNProtocols(value, out);
        return out.ALPNProtocols ? Array.from(out.ALPNProtocols) : null;
      }),
    );
    const unsupported = [
      tls.createServer,
      tls.Server,
      tls.getCiphers,
      tls.createSecurePair,
    ].map((fn) => capture(() => fn()));
    const validations = [
      { enableTrace: true },
      { isServer: true },
      { server: {} },
      { requestCert: true },
      { rejectUnauthorized: false },
      { ALPNProtocols: [] },
      { SNICallback: () => {} },
      { requestOCSP: true },
      { secureContext: {} },
      { pskCallback: () => {} },
      { checkServerIdentity: 123 },
      { checkServerIdentity: () => {} },
    ].map((opts) =>
      capture(() => {
        const socket = new tls.TLSSocket(undefined, opts);
        socket.destroy();
        return null;
      }),
    );
    const ctx = tls.createSecureContext();
    return {
      certificates,
      protocols,
      unsupported,
      validations,
      context: ctx instanceof tls.SecureContext,
      contextValue: ctx.context ?? null,
      constants: [
        tls.CLIENT_RENEG_LIMIT,
        tls.CLIENT_RENEG_WINDOW,
        tls.DEFAULT_CIPHERS,
        tls.DEFAULT_ECDH_CURVE,
        tls.DEFAULT_MIN_VERSION,
        tls.DEFAULT_MAX_VERSION,
        tls.rootCertificates,
      ],
    };
  },
  aliases: function ({ sys, util, types }) {
    return {
      same: sys.default === util.default,
      format: sys.format("%s:%d", "value", 3),
      typesSame: types.default === util.types,
      predicates: [
        types.isMap(new Map()),
        types.isMap({}),
        types.isUint8Array(new Uint8Array()),
        types.isDataView(new DataView(new ArrayBuffer(1))),
        types.isDate(new Date(0)),
        types.isBoxedPrimitive(Object(1n)),
        types.isArrayBufferView(new Uint16Array()),
        types.isArrayBuffer(new ArrayBuffer(1)),
      ],
    };
  },
  consoleStubs: function ({ console: api }) {
    const errors = [];
    for (const name of ["Console", "context", "createTask"]) {
      try {
        api[name]();
        errors.push(null);
      } catch (e) {
        errors.push({ name: e.name, code: e.code, message: e.message });
      }
    }
    return {
      errors,
      defaultIdentity: api.default === globalThis.console,
      prototypes: [
        "log",
        "warn",
        "error",
        "table",
        "context",
        "createTask",
      ].map((n) => api.Console.prototype[n] === api[n]),
    };
  },
  cryptoMetadata: function ({ crypto: c }) {
    const errors = {};
    for (const name of ["setEngine", "setFips"]) {
      try {
        c[name]();
      } catch (error) {
        errors[name] = {
          name: error.name,
          code: error.code,
          message: error.message,
        };
      }
    }
    const curves = c.getCurves();
    const exchanges = curves.map((curve) => {
      const alice = c.createECDH(curve),
        bob = c.createECDH(curve);
      alice.setPrivateKey(
        c.createHash("sha256").update("fixture alice").digest().subarray(0, 16),
      );
      bob.setPrivateKey(
        c.createHash("sha256").update("fixture bob").digest().subarray(0, 16),
      );
      const a = alice.getPublicKey(),
        b = bob.getPublicKey();
      const left = alice.computeSecret(b),
        right = bob.computeSecret(a);
      const converted = ["compressed", "uncompressed", "hybrid"].map(
        (format) => {
          try {
            const encoded = c.ECDH.convertKey(
              a,
              curve,
              undefined,
              undefined,
              format,
            );
            return [
              encoded.toString("hex"),
              bob.computeSecret(encoded).equals(right),
            ];
          } catch (e) {
            return { name: e.name, message: e.message };
          }
        },
      );
      const copy = new c.ECDH(curve);
      const privateBytes = alice.getPrivateKey();
      const setResult = copy.setPrivateKey(
        new DataView(
          privateBytes.buffer,
          privateBytes.byteOffset,
          privateBytes.byteLength,
        ),
      );
      const generated = c.ECDH(curve);
      generated.generateKeys();
      const failures = [];
      for (const run of [
        () => new c.ECDH("not-a-curve"),
        () => new c.ECDH(curve).getPrivateKey(),
        () => new c.ECDH(curve).getPublicKey(),
        () => new c.ECDH(curve).computeSecret(a),
        () => copy.setPrivateKey(new Uint8Array([0])),
        () => copy.computeSecret(new Uint8Array([1])),
        () => c.ECDH.convertKey(new Uint8Array([1]), curve),
      ]) {
        try {
          run();
          failures.push(null);
        } catch (e) {
          failures.push({ name: e.name, message: e.message });
        }
      }
      return {
        curve,
        converted,
        failures,
        instance: copy instanceof c.ECDH,
        setReturnsUndefined: setResult === undefined,
        copied: copy.getPublicKey().equals(a),
        generated: generated
          .computeSecret(a)
          .equals(alice.computeSecret(generated.getPublicKey())),
        empty: c.ECDH.convertKey(new Uint8Array(), "not-a-curve").length,
        bytes: left.length,
        equal: left.equals(right),
        secret: left.toString("hex"),
        publicKey: a.toString("hex"),
      };
    });
    return { curves, exchanges, heap: c.secureHeapUsed(), errors };
  },
  secretKeys: async function ({ crypto: c, types }) {
    const input = new Uint8Array([1, 2, 3, 4]);
    const key = c.createSecretKey(input);
    input.fill(0);
    const raw = key.export();
    raw.fill(0);
    const options = {};
    key.export(options);
    const hmac = c.createHmac("sha256", key).update("fixture").digest("hex");
    const brands = [];
    const streamResults = [];
    const cipherKey = c.createSecretKey(
      c.createHash("sha256").update("cipher key").digest(),
    );
    const iv = c.createHash("sha256").update("iv").digest().subarray(0, 16);
    const cipher = c.createCipheriv("aes-256-cbc", cipherKey, iv);
    for (const value of [
      new c.Hmac("sha256", key),
      c.createHmac("md5", key),
      c.createCipheriv("aes-256-cbc", cipherKey, iv),
      new c.Decipheriv("aes-256-cbc", cipherKey, iv),
    ]) {
      const Class = value.constructor;
      brands.push([
        Class.name,
        Object.getPrototypeOf(value) === Class.prototype,
        value instanceof c.Hmac,
        value instanceof c.Cipheriv,
        value instanceof c.Decipheriv,
      ]);
    }
    for (const algorithm of ["sha256", "sha384", "sha512"]) {
      const instance = c.createHmac(algorithm, key);
      streamResults.push(
        await new Promise((resolve, reject) => {
          instance.on("data", (data) => resolve(data.toString("hex")));
          instance.on("error", reject);
          instance.write("fix");
          instance.end("ture");
        }),
      );
    }
    const streamCipher = c.createCipheriv("aes-256-cbc", cipherKey, iv);
    const streamDecipher = c.createDecipheriv("aes-256-cbc", cipherKey, iv);
    const streamed = new Promise((resolve, reject) => {
      let text = "";
      streamDecipher.setEncoding("utf8");
      streamDecipher.on("data", (chunk) => {
        text += chunk;
      });
      streamDecipher.on("end", () => resolve(text));
      streamDecipher.on("error", reject);
      streamCipher.on("error", reject);
      streamCipher.pipe(streamDecipher);
    });
    streamCipher.write("mes");
    streamCipher.end("sage");
    const encrypted =
      cipher.update("message", "utf8", "hex") + cipher.final("hex");
    const generated = await new Promise((resolve, reject) =>
      c.generateKey("hmac", { length: 9 }, (error, value) =>
        error ? reject(error) : resolve(value.symmetricKeySize),
      ),
    );
    const constructors = [];
    for (const Class of [
      c.KeyObject,
      c.SecretKeyObject,
      c.PublicKeyObject,
      c.PrivateKeyObject,
    ]) {
      try {
        new Class();
        constructors.push(null);
      } catch (e) {
        constructors.push({ name: e.name, message: e.message });
      }
    }
    return {
      type: key.type,
      size: key.symmetricKeySize,
      constructor: key.constructor.name,
      tag: Object.prototype.toString.call(key),
      export: key.export().toString("hex"),
      jwk: key.export({ format: "jwk" }),
      equal: key.equals(c.createSecretKey(new Uint8Array([1, 2, 3, 4]))),
      unequal: key.equals(c.createSecretKey("different")),
      branded: types.isKeyObject(key),
      fake: types.isKeyObject({}),
      options,
      hmac,
      encodedHmac: c
        .createHmac("sha256", "aa", { encoding: "hex" })
        .update("message")
        .digest("hex"),
      brands,
      streamResults,
      streamed: await streamed,
      encrypted,
      generated,
      aes: c.generateKeySync("aes", { length: 192 }).symmetricKeySize,
      constructors,
    };
  },

  cryptoRandom: async function ({ crypto: c }) {
    const values = Array.from({ length: 200 }, () => c.randomInt(-3, 9));
    const asynchronous = await new Promise((resolve, reject) =>
      c.randomInt(1, (err, n) => (err ? reject(err) : resolve(n))),
    );
    const errors = [];
    for (const args of [[0], [3, 3], [1.5], ["x"], [0, 2 ** 48]]) {
      try {
        c.randomInt(...args);
        errors.push(null);
      } catch (e) {
        errors.push({ name: e.name, code: e.code });
      }
    }
    return {
      range: values.every((n) => Number.isInteger(n) && n >= -3 && n < 9),
      asynchronous,
      uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        c.randomUUID(),
      ),
      webcrypto: c.webcrypto === globalThis.crypto,
      subtle: c.subtle === globalThis.crypto.subtle,
      errors,
    };
  },
  cryptoHashKdf: async function ({ crypto: c }) {
    const hex = (value) =>
      Array.from(new Uint8Array(value))
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    const result = {
      hash: c.hash("sha256", "abc"),
      bytes: hex(c.hash("sha256", new Uint8Array([97, 98, 99]), "buffer")),
      hkdf: hex(c.hkdfSync("sha256", "key", "salt", "info", 42)),
      empty: hex(c.hkdfSync("sha256", "", "", "", 0)),
    };
    result.hkdfAsync = await new Promise((resolve, reject) =>
      c.hkdf("sha256", "key", "salt", "info", 42, (e, b) =>
        e ? reject(e) : resolve(hex(b)),
      ),
    );
    result.scrypt = hex(
      c.scryptSync("password", "salt", 32, { N: 16, r: 1, p: 1 }),
    );
    result.scryptAsync = await new Promise((resolve, reject) =>
      c.scrypt(
        "password",
        "salt",
        32,
        { cost: 16, blockSize: 1, parallelization: 1 },
        (e, b) => (e ? reject(e) : resolve(hex(b))),
      ),
    );
    return result;
  },
  cryptoInvalid: function ({ crypto: c }) {
    const errors = [];
    const calls = [
      () => c.hash(3, "x"),
      () => c.hash("sha256", null),
      () => c.hkdfSync("sha256", "a", "b", "c", -1),
      () => c.hkdfSync("sha256", "a", "b", new Uint8Array(1025), 1),
      () => c.scryptSync("a", "b", 16, { N: 3 }),
      () => c.scryptSync("a", "b", 16, { N: 16, cost: 16 }),
      () => c.scryptSync("a", "b", 16, { N: 16, r: 1, maxmem: 1 }),
      () => c.randomUUID({ disableEntropyCache: 1 }),
    ];
    for (const call of calls) {
      try {
        call();
        errors.push(null);
      } catch (e) {
        errors.push({ name: e.name, code: e.code });
      }
    }
    return errors;
  },

  fsWrites: function ({ fs }) {
    const dir = "/tmp/cf-writes";
    fs.mkdirSync(dir, { recursive: true });
    try {
      const wrote = fs.writeFileSync(dir + "/a", "hello");
      const appended = fs.appendFileSync(dir + "/a", " world");
      const fd = fs.openSync(dir + "/a", "r+");
      const bytes = new Uint8Array(5);
      const read = fs.readSync(fd, bytes, 0, 5, 0);
      const written = fs.writeSync(fd, new Uint8Array([72]), 0, 1, 0);
      fs.ftruncateSync(fd, 5);
      const size = fs.fstatSync(fd).size;
      fs.closeSync(fd);
      return {
        wrote,
        appended,
        read,
        written,
        size,
        data: fs.readFileSync(dir + "/a", "utf8"),
        bytes: Array.from(bytes),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  fsDirectories: function ({ fs }) {
    const dir = "/tmp/cf-directories";
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(dir + "/source", "value");
      fs.copyFileSync(dir + "/source", dir + "/copy");
      fs.renameSync(dir + "/copy", dir + "/renamed");
      fs.symlinkSync(dir + "/source", dir + "/link");
      return {
        entries: fs.readdirSync(dir).sort(),
        link: fs.lstatSync(dir + "/link").isSymbolicLink(),
        target: fs.readlinkSync(dir + "/link"),
        resolved: fs.realpathSync(dir + "/link"),
        data: fs.readFileSync(dir + "/link", "utf8"),
        size: fs.statSync(dir + "/renamed").size,
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  fsPromises: async function ({ fs }) {
    const p = fs.promises,
      dir = "/tmp/cf-promises";
    await p.mkdir(dir, { recursive: true });
    try {
      const writes = [];
      for (const data of [
        "abc",
        new Uint8Array([1, 2]),
        new DataView(new Uint8Array([3, 4]).buffer),
      ]) {
        for (const name of ["writeFile", "appendFile"]) {
          const path = dir + "/writes";
          writes.push([name, typeof (await p[name](path, data))]);
          const fd = fs.openSync(path, "w+");
          try {
            writes.push([name + "Fd", typeof (await p[name](fd, data))]);
          } finally {
            fs.closeSync(fd);
          }
        }
      }
      const syncWrites = [
        fs.writeFileSync(dir + "/sync", "abc"),
        fs.appendFileSync(dir + "/sync", "d"),
      ];
      const handle = await p.open(dir + "/file", "w+");
      try {
        const handleWrite = await handle.writeFile("abc");
        const buffer = new Uint8Array(3);
        const read = await handle.read(buffer, 0, 3, 0);
        return {
          writes,
          syncWrites,
          handleWrite: {
            bytesWritten: handleWrite.bytesWritten,
            buffer: Array.from(handleWrite.buffer),
          },
          read: read.bytesRead,
          buffer: Array.from(buffer),
          size: (await handle.stat()).size,
        };
      } finally {
        await handle.close();
      }
    } finally {
      await p.rm(dir, { recursive: true, force: true });
    }
  },
  fsCallbacks: async function ({ fs }) {
    const dir = "/tmp/cf-callbacks";
    fs.mkdirSync(dir, { recursive: true });
    try {
      await new Promise((resolve, reject) =>
        fs.writeFile(dir + "/file", "abc", (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      const data = await new Promise((resolve, reject) =>
        fs.readFile(dir + "/file", "utf8", (error, data) =>
          error ? reject(error) : resolve(data),
        ),
      );
      const errors = [];
      for (const fn of [
        () => fs.watch(dir),
        () => fs.watchFile(dir),
        () => fs.unwatchFile(dir),
        () => fs.readFileSync(dir + "/missing"),
      ]) {
        try {
          fn();
          errors.push(null);
        } catch (e) {
          errors.push(e.code);
        }
      }
      return { data, errors };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  brotli: async function ({ zlib: z }) {
    const text = "hello world hello world hello world";
    const input = new TextEncoder().encode(text);
    const compressed = z.brotliCompressSync(input, {
      params: { [z.constants.BROTLI_PARAM_QUALITY]: 4 },
    });
    const decoded = new TextDecoder().decode(
      z.brotliDecompressSync(compressed),
    );
    const asyncDecoded = await new Promise((resolve, reject) =>
      z.brotliDecompress(compressed, (e, b) =>
        e ? reject(e) : resolve(new TextDecoder().decode(b)),
      ),
    );
    const stream = z.createBrotliCompress({
      params: { [z.constants.BROTLI_PARAM_QUALITY]: 4 },
    });
    const parts = [];
    const done = new Promise((resolve, reject) => {
      stream.on("data", (b) => parts.push(b));
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    stream.write(input.subarray(0, 4));
    stream.end(input.subarray(4));
    await done;
    const joined = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
    let offset = 0;
    for (const b of parts) {
      joined.set(b, offset);
      offset += b.length;
    }
    return {
      decoded,
      asyncDecoded,
      stream: new TextDecoder().decode(z.brotliDecompressSync(joined)),
      crc: z.crc32("hello"),
      incremental: z.crc32("lo", z.crc32("hel")),
    };
  },

  brotliErrors: function ({ zlib: z }) {
    const outcomes = [];
    const compressed = z.brotliCompressSync(new Uint8Array(100));
    for (const run of [
      () => z.brotliDecompressSync(new Uint8Array()),
      () => z.brotliDecompressSync(new Uint8Array([255, 255, 255])),
      () => z.brotliDecompressSync(compressed, { maxOutputLength: 10 }),
    ]) {
      try {
        run();
        outcomes.push("success");
      } catch (error) {
        outcomes.push({
          name: error.name,
          message: error.message,
          code: error.code,
        });
      }
    }
    return outcomes;
  },

  codecProfiles: async function ({ zlib: z }) {
    const input = new TextEncoder().encode("streaming fixture ".repeat(2000));
    const result = {};
    for (const name of ["brotli", "zstd"]) {
      const prefix = name === "brotli" ? "Brotli" : "Zstd";
      const options = {
        chunkSize: 256,
        params: name === "brotli" ? { 0: 1, 1: 4, 2: 20 } : { 100: 5, 201: 1 },
      };
      const compressed = z[name + "CompressSync"](input, options);
      const decoded = z[name + "DecompressSync"](compressed);
      const info = z[name + "CompressSync"](input, { ...options, info: true });
      const stream = z["create" + prefix + "Compress"](options);
      stream.reset();
      const parts = [];
      stream.on("data", (chunk) => parts.push(chunk));
      const done = new Promise((resolve, reject) => {
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      stream.write(input.subarray(0, 17000));
      await new Promise((resolve, reject) => {
        stream.once("error", reject);
        stream.flush(resolve);
      });
      const flushed = parts.length > 0;
      stream.end(input.subarray(17000));
      await done;
      const joined = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
      }
      const decoder = z["create" + prefix + "Decompress"]({ chunkSize: 128 });
      let decodedLength = 0,
        decodedCrc = 0;
      decoder.on("data", (b) => {
        decodedLength += b.length;
        decodedCrc = z.crc32(b, decodedCrc);
      });
      const decoderDone = new Promise((resolve, reject) => {
        decoder.on("end", resolve);
        decoder.on("error", reject);
      });
      for (let i = 0; i < joined.length; i += 7)
        decoder.write(joined.subarray(i, i + 7));
      decoder.end();
      await decoderDone;
      result[name] = {
        length: decoded.length,
        crc: z.crc32(decoded),
        flushed,
        decodedLength,
        decodedCrc,
        bytesWritten: stream.bytesWritten,
        info: {
          type: info.engine.constructor.name,
          bytesWritten: info.engine.bytesWritten,
          roundTrip: z[name + "DecompressSync"](info.buffer).length,
        },
      };
    }
    return result;
  },

  codecErrors: function ({ zlib: z }) {
    const out = {};
    for (const name of ["Brotli", "Zstd"]) {
      const values = [];
      for (const options of [
        { chunkSize: 1 },
        { params: { 999: 1 } },
        { params: { 1: "bad" } },
        { flush: 99 },
        { finishFlush: -1 },
        { maxOutputLength: 0 },
      ]) {
        try {
          const engine = new z[name + "Compress"](options);
          engine.destroy();
          values.push(null);
        } catch (error) {
          values.push({
            name: error.name,
            code: error.code,
            message: error.message,
          });
        }
      }
      out[name] = values;
    }
    return out;
  },

  fsMetadata: async function ({ fs }) {
    const path = "/tmp/metadata";
    fs.writeFileSync(path, "data", { mode: 0o600 });
    const before = fs.statSync(path);
    fs.chmodSync(path, 0);
    await fs.promises.chown(path, 123, 456);
    const handle = await fs.promises.open(path, "r+");
    await handle.chmod(0);
    await handle.chown(123, 456);
    const after = await handle.stat();
    await handle.close();
    fs.mkdirSync("/tmp/metadata-dir", { mode: 0o700 });
    const mode = fs.statSync("/tmp/metadata-dir").mode;
    fs.rmSync(path);
    fs.rmdirSync("/tmp/metadata-dir");
    return {
      before: [before.mode, before.uid, before.gid],
      after: [after.mode, after.uid, after.gid],
      directoryMode: mode,
      statfs: fs.statfsSync("/missing"),
      bigint: Object.values(
        await fs.promises.statfs("/missing", { bigint: true }),
      ).map(String),
    };
  },

  streamCancellation: async function ({
    streams: { ReadableStream, WritableStream },
  }) {
    const tee = [];
    for (const bytes of [false, true])
      for (const reverse of [false, true]) {
        let reason;
        const source = new ReadableStream({
          ...(bytes ? { type: "bytes" } : {}),
          cancel(value) {
            reason = value;
          },
        });
        const pair = source.tee();
        const first = reverse ? 1 : 0,
          second = 1 - first;
        const a = pair[first].getReader().cancel("first");
        const b = pair[second].cancel("last");
        await Promise.all([a, b]);
        tee.push(reason);
      }
    const pipes = [];
    for (const options of [
      {},
      { preventCancel: true },
      { preventAbort: true },
      { preventCancel: true, preventAbort: true },
    ]) {
      const events = [];
      let controller,
        settled = false;
      const source = new ReadableStream({
        start(c) {
          controller = c;
        },
        cancel(reason) {
          events.push(["cancel", reason]);
        },
      });
      const sink = new WritableStream({
        write(value) {
          events.push(["write", value]);
        },
        abort(reason) {
          events.push(["abort", reason]);
        },
      });
      const signal = new AbortController();
      const done = source
        .pipeTo(sink, { ...options, signal: signal.signal })
        .then(
          () => {
            settled = true;
          },
          (reason) => {
            settled = true;
            events.push(["reject", reason]);
          },
        );
      signal.abort("stop");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const before = { settled, events: events.slice() };
      controller.enqueue(1);
      await done;
      pipes.push({
        before,
        events,
        sourceLocked: source.locked,
        sinkLocked: sink.locked,
      });
    }
    return { tee, pipes };
  },

  moduleMetadata: function ({ module: m }) {
    const errors = {};
    for (const name of [
      "register",
      "registerHooks",
      "runMain",
      "syncBuiltinESMExports",
      "wrap",
      "_debug",
      "_findPath",
      "_initPaths",
      "_load",
      "_resolveFilename",
      "_resolveLookupPaths",
      "_nodeModulePaths",
      "findSourceMap",
      "findPackageJSON",
      "setSourceMapsSupport",
      "stripTypeScriptTypes",
      "SourceMap",
    ]) {
      try {
        m[name]();
        errors[name] = null;
      } catch (e) {
        errors[name] = { name: e.name, code: e.code, message: e.message };
      }
    }
    return {
      errors,
      compile: m.enableCompileCache() === undefined,
      dir: m.getCompileCacheDir() === undefined,
      flush: m.flushCompileCache() === undefined,
      maps: m.getSourceMapsSupport(),
      builtin: [
        "crypto",
        "node:crypto",
        "fs/promises",
        "node:test",
        "test",
        "unknown",
      ].map((n) => m.isBuiltin(n)),
    };
  },
  httpInternals: function ({
    httpCommon: c,
    httpOutgoing: o,
    httpServer: s,
    http,
  }) {
    const target = {};
    s.storeHTTPOptions.call(target, {
      requestTimeout: 12000,
      headersTimeout: 5000,
      requireHostHeader: false,
    });
    const errors = [];
    for (const fn of [
      () => s.setupConnectionsTracking(),
      () => s._connectionListener(),
      () =>
        s.storeHTTPOptions.call({}, { requestTimeout: 1, headersTimeout: 2 }),
    ]) {
      try {
        fn();
        errors.push(null);
      } catch (e) {
        errors.push({ name: e.name, code: e.code });
      }
    }
    const closed = [];
    s.httpServerPreClose({
      closeIdleConnections() {
        closed.push(true);
      },
    });
    return {
      tokens: ["X-Test", "bad space", ""].map((n) => c._checkIsHttpToken(n)),
      headers: ["ok", "bad\r\nvalue"].map((n) => c._checkInvalidHeaderChar(n)),
      methods: c.methods === http.METHODS,
      classes:
        o.OutgoingMessage === http.OutgoingMessage && s.Server === http.Server,
      unique: [...o.parseUniqueHeadersOption(["X-A", ["x-a", "X-B"]])],
      none: o.parseUniqueHeadersOption(null),
      target: {
        requestTimeout: target.requestTimeout,
        headersTimeout: target.headersTimeout,
        requireHostHeader: target.requireHostHeader,
      },
      errors,
      closed,
    };
  },
};
