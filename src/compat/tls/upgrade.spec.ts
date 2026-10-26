import { afterEach, expect, it, vi } from "vitest";
import { connect as tcp, Socket } from "../net/index.js";
import { connect, TLSSocket } from "./index.js";
import {
  setNativeCall,
  type NativeCall,
} from "../../browser/fetch/native-network.js";
let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function bridge() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const handshake = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const call = vi.fn<NativeCall>(async (_, method) => {
    if (method === "socketStartTls") return handshake;
    if (method === "socketRead" || method === "socketWatch")
      return new Promise(() => {});
    return {};
  });
  restore = setNativeCall(call);
  return { call, resolve, reject };
}
it("holds immediate application writes until the existing connection authenticates", async () => {
  const { call, resolve } = bridge();
  const plain = tcp({ host: "localhost", port: 1234 });
  plain.on("error", () => {});
  await new Promise<void>((yes) => plain.once("connect", yes));
  const tls = connect({ socket: plain, servername: "localhost" });
  const secure = vi.fn();
  tls.on("secureConnect", secure);
  tls.on("error", () => {});
  tls.write("secret");
  await tick();
  expect(
    call.mock.calls.filter(([, m]) => m === "socketStartTls"),
  ).toHaveLength(1);
  expect(call.mock.calls.some(([, m]) => m === "socketWrite")).toBe(false);
  // Workers announces the STARTTLS transition before the record engine is
  // ready. That observable notification must never release application IO.
  expect(secure).toHaveBeenCalledTimes(1);
  const upgradeIndex = call.mock.calls.findIndex(
    ([, method]) => method === "socketStartTls",
  );
  expect(
    call.mock.calls
      .slice(upgradeIndex + 1)
      .some(([, method]) => method === "socketRead"),
  ).toBe(false);
  resolve({});
  await tick();
  expect(tls.authorized).toBe(true);
  expect(call.mock.calls.filter(([, m]) => m === "socketOpen")).toHaveLength(1);
  expect(call.mock.calls.filter(([, m]) => m === "socketWrite")).toHaveLength(
    1,
  );
  tls.destroy();
  plain.destroy();
});
it("never transmits queued application bytes when certificate verification fails", async () => {
  const { call, reject } = bridge();
  const plain = tcp({ host: "localhost", port: 1234 });
  plain.on("error", () => {});
  await new Promise<void>((yes) => plain.once("connect", yes));
  const tls = connect({ socket: plain, servername: "wrong.invalid" });
  const error = new Promise((yes) => tls.once("error", yes));
  tls.write("secret");
  await tick();
  reject(new Error("certificate mismatch"));
  await error;
  await tick();
  expect(call.mock.calls.some(([, m]) => m === "socketWrite")).toBe(false);
  expect(call.mock.calls.some(([, m]) => m === "socketClose")).toBe(true);
  plain.destroy();
});
it("reports Workers STARTTLS readable EOF on authentication failure without reading application bytes", async () => {
  const { call, reject } = bridge();
  const plain = tcp({ host: "localhost", port: 1234 });
  plain.on("error", () => {});
  await new Promise<void>((resolve) => plain.once("connect", resolve));
  const socket = connect({ socket: plain, servername: "wrong.invalid" });
  const errors = vi.fn();
  socket.on("error", errors);
  const ended = new Promise<void>((resolve) => socket.once("end", resolve));
  socket.resume();
  await tick();
  const upgradeIndex = call.mock.calls.findIndex(
    ([, method]) => method === "socketStartTls",
  );
  reject(new Error("certificate mismatch"));
  await ended;
  await tick();
  expect(errors).not.toHaveBeenCalled();
  expect(
    call.mock.calls
      .slice(upgradeIndex + 1)
      .some(
        ([, method]) => method === "socketRead" || method === "socketWrite",
      ),
  ).toBe(false);
  expect(call.mock.calls.some(([, method]) => method === "socketClose")).toBe(
    true,
  );
  plain.destroy();
});
it("upgrades a parent connected after TLS wrapping without opening another connection", async () => {
  const { call, resolve } = bridge();
  const plain = new Socket();
  plain.on("error", () => {});
  const tls = connect({ socket: plain, servername: "localhost" });
  tls.on("error", () => {});
  tls.write("secret");
  await tick();
  expect(call.mock.calls).toHaveLength(0);
  plain.connect({ host: "localhost", port: 1234 });
  await tick();
  expect(
    call.mock.calls.filter(([, m]) => m === "socketStartTls"),
  ).toHaveLength(1);
  resolve({});
  await tick();
  expect(call.mock.calls.filter(([, m]) => m === "socketWrite")).toHaveLength(
    1,
  );
  tls.destroy();
  plain.destroy();
});

it("closes the connection when destroyed during authentication", async () => {
  const { call, resolve } = bridge();
  const plain = tcp({ host: "localhost", port: 1234 });
  plain.on("error", () => {});
  await new Promise<void>((yes) => plain.once("connect", yes));
  const tls = connect({ socket: plain, servername: "localhost" });
  tls.on("error", () => {});
  tls.write("secret");
  await tick();
  expect(() => new TLSSocket(plain, { port: 1234 })).toThrow(
    /unavailable socket/,
  );
  tls.destroy();
  await tick();
  resolve({});
  await tick();
  expect(call.mock.calls.some(([, m]) => m === "socketClose")).toBe(true);
  expect(call.mock.calls.some(([, m]) => m === "socketWrite")).toBe(false);
  plain.destroy();
});

import { Duplex } from "../stream/duplex.js";
it("constructs the Workers custom Duplex wrapper and forwards bytes", async () => {
  const writes: string[] = [];
  const custom = Duplex({
    read() {},
    write(chunk: Uint8Array, _encoding: string, callback: () => void) {
      writes.push(Buffer.from(chunk).toString());
      callback();
    },
  });
  const wrapped = new TLSSocket(custom);
  wrapped.on("error", () => {});
  const data = new Promise<string>((resolve) =>
    wrapped.once("data", (chunk: Uint8Array) =>
      resolve(Buffer.from(chunk).toString()),
    ),
  );
  await tick();
  wrapped.write("outbound");
  custom.push(Buffer.from("inbound"));
  expect(await data).toBe("inbound");
  await tick();
  expect(writes).toEqual(["outbound"]);
  wrapped.destroy();
  custom.destroy();
});
it("custom Duplex EOF emits end before close", async () => {
  const custom = Duplex({
    read() {},
    write(_chunk: unknown, _encoding: unknown, callback: () => void) {
      callback();
    },
  });
  const wrapped = new TLSSocket(custom);
  const events: string[] = [];
  wrapped.on("error", () => {});
  wrapped.on("data", () => {});
  wrapped.on("end", () => events.push("end"));
  wrapped.on("close", () => events.push("close"));
  await tick();
  custom.push(null);
  await tick();
  expect(events).toEqual(["end", "close"]);
  wrapped.destroy();
  custom.destroy();
});
