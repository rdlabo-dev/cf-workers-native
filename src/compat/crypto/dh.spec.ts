import { test, expect, expectTypeOf } from "vitest";
import { runWithRequestScope } from "../../shared/request-scope.js";
// @ts-expect-error Pinned upstream JavaScript fixture.
import * as fixtures from "./upstream-dh.fixture.mjs";
for (const [name, fixture] of Object.entries(fixtures))
  test(
    "pinned Workers DH: " + name,
    () =>
      runWithRequestScope(() => (fixture as { test: () => unknown }).test()),
    30000,
  );

import { Buffer } from "node:buffer";
import {
  DiffieHellman,
  DiffieHellmanGroup,
  createDiffieHellman,
  ECDH,
} from "./index.js";
test("DH requires request scope for numeric generation", () => {
  expect(() => createDiffieHellman(64)).toThrow(
    new Error("DiffieHellman key generation requires an active request"),
  );
});
test("DH and ECDH consumer declarations", () => {
  const d = DiffieHellman(new Uint8Array([23]));
  expectTypeOf(d.getPrime()).toEqualTypeOf<Buffer>();
  expectTypeOf(d.getPrime("hex")).toEqualTypeOf<string>();
  const ec = ECDH("prime256v1");
  expectTypeOf(ec.generateKeys()).toEqualTypeOf<Buffer>();
  expectTypeOf(ec.getPublicKey("hex")).toEqualTypeOf<string>();
  expectTypeOf(ec.getPrivateKey(undefined)).toEqualTypeOf<Buffer>();
  expectTypeOf(d.getPrime(undefined)).toEqualTypeOf<Buffer>();
  expectTypeOf(
    ECDH.convertKey(ec.getPublicKey(), "prime256v1"),
  ).toEqualTypeOf<Buffer>();
  expectTypeOf(
    ECDH.convertKey(ec.getPublicKey(), "prime256v1", undefined, "hex"),
  ).toEqualTypeOf<string>();
});
function invalidGroup(group: DiffieHellmanGroup) {
  // @ts-expect-error Fixed groups do not expose setters.
  group.setPrivateKey(new Uint8Array([2]));
}
void invalidGroup;
