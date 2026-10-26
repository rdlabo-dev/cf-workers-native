# WebSocket candidate and scoped attachment boundary

This directory is an implementation candidate on the development branch. The
public globals and `node:http` use the same endpoint implementation. It has not
passed whole-module acceptance.

## Approved representation boundary

Workers limits serialized attachments to 16,384 bytes, including serialization
overhead. V8's private array storage representation can change that overhead even
when array contents and own properties are identical. JavaScriptCore cannot
inspect the original V8 storage representation.

The approved exception permits a documented canonical serialization representation
for attachment size accounting. Only acceptance at the size boundary and reported
serialized byte lengths that depend on engine-private representation may differ.
It does not permit ignoring the limit, measuring JSON text, truncating data, or
silently dropping supported value types.

Attachment accounting uses version-15 wire tags, varint lengths and object
references. Arrays with all own indices use dense encoding; arrays with holes use
sparse encoding. Numbers use signed 32-bit integer encoding where possible and
double encoding otherwise. Strings use Latin-1 where possible and aligned UTF-16
otherwise. BigInt digits occupy whole 64-bit words. Workers host objects retain
their pinned serialization layouts. Values are cloned before accounting, and
failed writes preserve the previous attachment. Shared-memory attachments retain
Workers' deserialization rejection, including buffers originating in WebAssembly.
Opaque shared Wasm memories use the current page count as their canonical maximum
for size accounting; the declared maximum is not exposed by the JavaScript API.
A bare shared buffer uses the ordinary shared-buffer reference layout because its
Wasm backing-store origin is private. These choices affect only the serialized
size boundary. Wasm modules and shared memories still reject deserialization,
and unsupported objects such as CryptoKey, FormData and WebSocketPair reject
serialization, as they do in the pinned Workers profile.
This exception alone does not make the candidate ready to publish.

The pinned workerd 1.20261012.1 / compatibility date 2026-10-17 probe demonstrates
the boundary with `[array, "x".repeat(16363)]`:

| Array construction                             | Observable contents           | Workers result         |
| ---------------------------------------------- | ----------------------------- | ---------------------- |
| `[1, 2, 3]`                                    | `[1, 2, 3]`, own keys `0,1,2` | Accepted               |
| `new Array(3)`, then assign all three elements | Same                          | Rejected: 16,390 bytes |

Increasing the string to 16,384 characters produces reported sizes of 16,406 and
16,412 bytes respectively. This is a representation-dependent six-byte difference,
not a general allowance for six-byte errors.

Reproduce from the repository root:

```sh
node --test demo/tests/experiments/node-compat/websocket-attachment-boundary.probe.mjs
```

The shared probe also retains ordinary string and ArrayBuffer limit checks, preservation
of the previous attachment after an oversized write, snapshot isolation and
cyclic references. The endpoint tests execute that same behavioral contract.
The native implementation must separately pass shared contracts for supported
types, validation, cloning, ordinary limits and independent deserialization.

## Remaining acceptance requirements

The representation exception does not cover WebSocket API omissions, event types
or ordering, TLS authentication, network lifecycle behavior, or public package
wiring. Existing native comparison failures remain failures. Acceptance still
requires the installed package on iOS and Android, in page and Dedicated Worker
contexts, plus the full module review required by CONTRIBUTING.md.
