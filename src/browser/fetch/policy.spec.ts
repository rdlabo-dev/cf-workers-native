import {
  defineFeature,
  FeatureImplementation,
} from "cf-workers-native/shared/contracts";
import type { ContractSuite } from "cf-workers-native/shared/contracts/testing";
import type { createFetch } from "./index.js";
import type { Request } from "../request/index.js";

interface API {
  fetch: ReturnType<typeof createFetch>;
  Request: typeof Request;
  baseURL: string;
}
const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};
async function rejects(operation: Promise<unknown>) {
  try {
    await operation;
  } catch {
    return;
  }
  throw new Error("Expected rejection");
}
const stream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("payload"));
      controller.close();
    },
  });
export const fetchPolicyFeature = defineFeature<API>()("web.fetch-policy", [
  "requestHeaders",
  "responseMetadata",
  "immutableHeaders",
  "manualRedirect",
  "followRedirect",
  "cookies",
  "automaticGzip",
  "otherEncodings",
  "manualGzip",
  "requestEncoding",
  "postResponseLoss",
  "abortHeaders",
  "postRedirect",
  "streamRedirect",
  "stream303",
  "bufferReplay",
  "redirectLimit",
  "abortBody",
  "dataURL",
  "cache",
]);
export const fetchPolicyContract: ContractSuite<typeof fetchPolicyFeature> = {
  feature: fetchPolicyFeature,
  cases: {
    async requestHeaders(api) {
      const response = await api.fetch(`${api.baseURL}/inspect`, {
        headers: {
          cookie: "session=local",
          authorization: "Bearer fixture",
          origin: "https://source.invalid",
          host: "custom.invalid",
          "user-agent": "fixture-client",
        },
      });
      const { headers } = (await response.json()) as {
        headers: Record<string, string>;
      };
      equal(
        [
          headers.cookie,
          headers.authorization,
          headers.origin,
          headers.host,
          headers["user-agent"],
          headers["accept-encoding"],
        ],
        [
          "session=local",
          "Bearer fixture",
          "https://source.invalid",
          new URL(api.baseURL).host,
          "fixture-client",
          undefined,
        ],
      );
    },
    async responseMetadata(api) {
      const response = await api.fetch(`${api.baseURL}/get#fragment`);
      equal(
        [
          response.status,
          response.statusText,
          response.url,
          response.redirected,
          response.type,
          await response.text(),
        ],
        [200, "OK", `${api.baseURL}/get`, false, "default", "hello"],
      );
    },
    async immutableHeaders(api) {
      const response = await api.fetch(`${api.baseURL}/get`);
      let failed = false;
      try {
        response.headers.set("x", "y");
      } catch {
        failed = true;
      }
      equal(failed, true);
      await response.body?.cancel();
    },
    async manualRedirect(api) {
      const response = await api.fetch(`${api.baseURL}/redirect`, {
        redirect: "manual",
      });
      equal(
        [
          response.status,
          response.headers.get("location"),
          response.redirected,
        ],
        [302, "/get", false],
      );
      await response.body?.cancel();
    },
    async followRedirect(api) {
      const response = await api.fetch(`${api.baseURL}/redirect`);
      equal(
        [
          response.status,
          response.url,
          response.redirected,
          await response.text(),
        ],
        [200, `${api.baseURL}/get`, true, "hello"],
      );
    },
    async cookies(api) {
      const response = await api.fetch(`${api.baseURL}/cookies`);
      equal(response.headers.getSetCookie(), [
        "a=1; Path=/",
        "b=2; Expires=Wed, 21 Oct 2030 07:28:00 GMT",
      ]);
      await response.body?.cancel();
    },
    async automaticGzip(api) {
      const response = await api.fetch(`${api.baseURL}/gzip`);
      equal(
        [response.headers.get("content-encoding"), await response.text()],
        ["gzip", "compressed body"],
      );
    },
    async otherEncodings(api) {
      equal(
        await (await api.fetch(`${api.baseURL}/brotli`)).text(),
        "compressed body",
      );
      const deflate = new Uint8Array(
        await (await api.fetch(`${api.baseURL}/deflate`)).arrayBuffer(),
      );
      equal([...deflate.slice(0, 2)], [120, 156]);
      const uppercase = new Uint8Array(
        await (await api.fetch(`${api.baseURL}/uppercase-gzip`)).arrayBuffer(),
      );
      equal([...uppercase.slice(0, 2)], [31, 139]);
    },
    async manualGzip(api) {
      const response = await api.fetch(`${api.baseURL}/gzip`, {
        encodeResponseBody: "manual",
      });
      equal(
        [...new Uint8Array(await response.arrayBuffer()).slice(0, 2)],
        [31, 139],
      );
    },
    async requestEncoding(api) {
      const initializer = new api.Request(`${api.baseURL}/gzip`, {
        encodeResponseBody: "manual",
      });
      const encoded = await api.fetch(`${api.baseURL}/gzip`, initializer);
      equal(
        [...new Uint8Array(await encoded.arrayBuffer()).slice(0, 2)],
        [31, 139],
      );
      const request = new api.Request(`${api.baseURL}/gzip`, {
        encodeResponseBody: "manual",
      });
      equal(await (await api.fetch(request)).text(), "compressed body");
      equal(await (await api.fetch(request.clone())).text(), "compressed body");
    },
    async postResponseLoss(api) {
      const operation = crypto.randomUUID();
      const url = `${api.baseURL}/commit-before-disconnect?operation=${operation}`;
      await rejects(api.fetch(url, { method: "POST", body: operation }));
      const receipt = await api.fetch(url);
      equal(await receipt.json(), 1);
    },
    async abortHeaders(api) {
      const controller = new AbortController();
      const pending = api.fetch(`${api.baseURL}/never`, {
        signal: controller.signal,
      });
      const cancel = setTimeout(() => controller.abort(), 20);
      try {
        await rejects(pending);
      } finally {
        clearTimeout(cancel);
      }
    },
    async postRedirect(api) {
      const response = await api.fetch(
        `${api.baseURL}/redirect?status=301&to=/inspect`,
        { method: "POST", body: "payload" },
      );
      const result = (await response.json()) as {
        method: string;
        body: string;
      };
      equal([result.method, result.body], ["GET", ""]);
    },
    async streamRedirect(api) {
      await rejects(
        api.fetch(`${api.baseURL}/redirect?status=301&to=/inspect`, {
          method: "POST",
          body: stream(),
        }),
      );
    },
    async stream303(api) {
      const response = await api.fetch(
        `${api.baseURL}/redirect?status=303&to=/inspect`,
        { method: "POST", body: stream() },
      );
      const result = (await response.json()) as {
        method: string;
        body: string;
      };
      equal([result.method, result.body], ["GET", ""]);
    },
    async bufferReplay(api) {
      const request = new api.Request(
        `${api.baseURL}/redirect?status=307&to=/inspect`,
        { method: "POST", body: "payload" },
      );
      const response = await api.fetch(request);
      const result = (await response.json()) as {
        method: string;
        body: string;
      };
      equal([result.method, result.body], ["POST", "payload"]);
      equal(request.bodyUsed, true);
    },
    async redirectLimit(api) {
      await rejects(api.fetch(`${api.baseURL}/loop`));
    },
    async abortBody(api) {
      const controller = new AbortController();
      const response = await api.fetch(`${api.baseURL}/slow`, {
        signal: controller.signal,
      });
      const reading = response.body!.getReader().read();
      controller.abort();
      await rejects(reading);
    },
    async dataURL(api) {
      const response = await api.fetch(
        "data:text/plain;charset=utf-8,hello%20world",
      );
      equal(
        [response.status, response.url, await response.text()],
        [200, "", "hello world"],
      );
      equal((await api.fetch("data:,body", { method: "HEAD" })).body, null);
    },
    async cache(api) {
      for (const cache of ["no-cache", "no-store"]) {
        const response = await api.fetch(`${api.baseURL}/inspect`, { cache });
        const result = (await response.json()) as {
          headers: Record<string, string>;
        };
        equal(
          [result.headers["cache-control"], result.headers.pragma],
          ["no-cache", "no-cache"],
        );
        const custom = await api.fetch(`${api.baseURL}/inspect`, {
          cache,
          headers: { "cache-control": "max-age=120", pragma: "custom" },
        });
        const preserved = (await custom.json()) as {
          headers: Record<string, string>;
        };
        equal(
          [preserved.headers["cache-control"], preserved.headers.pragma],
          ["max-age=120", "custom"],
        );
      }
    },
  },
};
export class FetchPolicyImplementation extends FeatureImplementation<
  typeof fetchPolicyFeature
> {
  constructor(private readonly api: API) {
    super(fetchPolicyFeature, {
      requestHeaders: { status: "supported" },
      responseMetadata: { status: "supported" },
      immutableHeaders: { status: "supported" },
      manualRedirect: { status: "supported" },
      followRedirect: { status: "supported" },
      cookies: { status: "supported" },
      automaticGzip: { status: "supported" },
      otherEncodings: { status: "supported" },
      manualGzip: { status: "supported" },
      requestEncoding: { status: "supported" },
      postResponseLoss: { status: "supported" },
      abortHeaders: { status: "supported" },
      postRedirect: { status: "supported" },
      streamRedirect: { status: "supported" },
      stream303: { status: "supported" },
      bufferReplay: { status: "supported" },
      redirectLimit: { status: "supported" },
      abortBody: { status: "supported" },
      dataURL: { status: "supported" },
      cache: { status: "supported" },
    });
  }
  create() {
    return this.api;
  }
}
