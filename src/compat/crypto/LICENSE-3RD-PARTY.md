# Upstream notices

The net facade, internal implementation, logical port table, error classes and
validators are adapted from Cloudflare workerd tag `v1.20261012.1`:

- `src/node/net.ts`
- `src/node/internal/internal_net.ts`
- `src/node/internal/internal_errors.ts` (required declarations only)
- `src/node/internal/validators.ts` (required declarations only)
- `src/cloudflare/internal/http.ts`

Copyright Cloudflare, Inc.; Apache License 2.0. Node.js/Joyent and Deno MIT
notices are retained in the corresponding source files. Host transport and
module imports are adapted for Capacitor. Public exports remain those of the
pinned workerd module; internal helpers are not added to the public facade.

X509 certificate wrappers and safe name rendering are adapted from
`src/node/internal/crypto_x509.ts` and `src/workerd/api/crypto/x509.c++` at
workerd commit `5358e3d337336eaf696a48bc1563d808b10feba5` (Apache-2.0).

Hash/HMAC and PBKDF2 frontends and digest/KDF test fixtures are adapted from
`src/node/internal/crypto_hash.ts`, `src/node/internal/crypto_pbkdf2.ts` and
`src/workerd/api/node/tests/crypto_{hash,hmac,pbkdf2,hkdf}-test.js` at the same
pinned workerd commit. The Apache-2.0 and Node.js MIT headers are retained.
Imports use the owned adapters. Latin-1 fixture expectations written as literal
caret notation upstream are decoded using independently verified digest bytes;
comments identify those adaptations. Float16 input-brand cases require the
engine's intrinsic; native evidence records its availability.

The Cipheriv/Decipheriv frontend is adapted from `src/node/internal/crypto_cipher.ts`
and lifecycle behavior from `src/workerd/api/node/crypto.c++` at that same workerd
revision. The cipher fixture retains the upstream `crypto_cipher-test.js` notices.
BoringSSL commit `427ec40cc8edc545253289232e885708c409e5ea` supplies the bundled cipher
primitives; its license and bundled third-party notices are in `LICENSE.boringssl`.

PEM/DER key parsing is adapted from `src/ncrypto.cpp` in Node.js ncrypto
`v1.1.4`, the version pinned by workerd. Copyright (c) 2025 Node.js; the MIT
license is retained in `LICENSE.ncrypto`. Parsing uses the bundled BoringSSL
backend before transferring owned key material to the OpenSSL operation backend.
