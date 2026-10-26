# Additional compatibility profiles

These adapters target workerd 1.20261012.1, compatibility date 2026-10-17.
`demo/tests/experiments/node-compat/expansion-contracts.probe.mjs` compares the
same operations in workerd, Chromium and WebKit, with both bundlers and both
page and Dedicated Worker execution. The native runner uses an installed npm
package and the same workerd expectations. These operation tests do not certify
whole modules.

Implemented profiles include console's Workers stubs, sys aliasing, public
util/types predicates, crypto random integers/UUIDs/Web Crypto exports,
Hash/HMAC/PBKDF2/HKDF/scrypt, the four Workers ECDH curves, crypto engine/secure-heap stubs,
writable memory-backed /tmp, module metadata, HTTP internal
helpers, adapter-owned secret and asymmetric KeyObjects, prime generation and
checking, incremental signatures, Certificate SPKAC and X509Certificate operations,
zlib/Brotli/Zstd codecs and CRC32, and cipher metadata lookup.
Additional profiles cover process resource/permission/report stubs, its pinned
wall-clock hrtime behavior, and TLS hostname/ALPN/options contracts. Native runs
also test real TLS exchange and hostname mismatch rejection.

Custom Duplex wrapping follows Workers' stream behavior, including byte
forwarding, EOF and error cleanup. This path does not perform a TLS handshake or
encrypt the custom Duplex's bytes. Authenticated TLS/STARTTLS requires the native
socket transport; wrapping an arbitrary stream does not provide that security.
The custom byte-stream adapter uses owned BYOB streams on both WebViews.

The SDK starts a fresh /tmp volume for each local fetch dispatch. Handles opened
inside that request retain their volume; embedded bundle assets stay read-only.
Standalone imports outside SDK dispatch share a fallback volume. Copying embedded files to /tmp preserves immutable embedded bytes. Permission
changes are validated no-ops and statfs returns the pinned Workers zero values.
Embedded files support read-only descriptors, FileHandles, streams and links; copies into /tmp are writable and independent. Numeric file timestamps use milliseconds; embedded timestamps remain unchanged. Watching files is unsupported in Workers too. Directory iteration, recursive listings, glob patterns, device files, symlink copying,
Monotonically allocated descriptors, byte streams and stream fd/custom-fs options follow the pinned Workers
profile. File sizes are capped at 128 MiB and paths at 4096 bytes/48 segments.
`process.cwd()` and `process.chdir()` use the request-local virtual directory;
streams retain the creating request's filesystem when external callbacks deliver
chunks. FileHandle byte streams use the owned Web Streams implementation,
including on WebViews without native BYOB support. These profiles do not certify
every filesystem operation. The vendored upstream fixtures in `src/compat/fs`
retain their license headers and run with `npx vitest run src/compat/fs/directory.spec.ts
src/compat/fs/glob.spec.ts src/compat/fs/writable.spec.ts`; the zlib integration fixture
also exercises a host stream crossing into the request-local filesystem.

FileHandles expose owned prototype methods and EventEmitter behavior. Their
backend and originating volume are private; the `fd` getter cannot be assigned,
and borrowed methods use their actual receiver. Closed handles reject operations
with Workers' EBADF contract. Descriptor numbers are never reused within a
volume, so a stale handle cannot access a later file. Closing a handle drops its
retained volume reference; finalization also releases an abandoned descriptor.
`readableWebStream()` captures `read` when created. The upstream and additional
receiver/lifetime tests run with `npx vitest run src/compat/fs/file-handle.spec.ts
src/compat/fs/directory.spec.ts`.
`fs.promises.watch()` throws Workers' `Not implemented` error at invocation,
before returning a Promise or iterator. File writes consume the intrinsic view
extent; the positional read/write frontends retain their observable property
access, as in Workers.

zlib 1.3.1, Brotli 1.1.0 and Zstd 1.5.7 use bundled, synchronously initialized WebAssembly.
The profile covers parameters, synchronous/callback operations, incremental
streams, flush/reset, byte accounting and output limits for synchronous
processing. Streaming output is not cumulatively capped by maxOutputLength.
Fast compression helpers, their callbacks and CRC32 consume intrinsic byte
ranges, including detached views as empty input. Stream frontends retain the
Workers property-access behavior. Owned bindings validate input and output
slices against their intrinsic extents before entering Wasm, including uint32
overflow and `info: true` calls with shadowed byte lengths. Numeric conversion
rejects BigInt, including objects coercing to BigInt. Shared-memory and
cross-realm helper checks run in Node; ordinary browser/native contracts do not
claim SharedArrayBuffer availability.
The pinned source revisions and artifact hashes accompany the codecs; rebuild
with scripts/build-native-codecs.mjs or scripts/build-native-zlib.mjs and the pinned Emscripten SDK. Gzip/deflate and Brotli/Zstd streams use the pinned Workers stream lifecycle. The comparative cases include constructor validation, callback timing, reset, close, byte accounting, dictionaries and output limits; whole-module acceptance remains a separate gate.
Scrypt uses a synchronous JavaScript backend, including for callback completion,
so large parameters can block the WebView. Cost and maxmem validation follow the
pinned Workers limits, including its 1048576 cost ceiling.

Hash and HMAC use the owned OpenSSL backend, including incremental input,
Hash copying, stream finalization and repeated-digest behavior. `getHashes()`
returns the pinned 17 names, including MD4, MD5-SHA1 and the RSA/DSA aliases.
PBKDF2 and HKDF use the same digest mapping and preserve the pinned Workers
limit of 255 digest blocks. Callback completion is asynchronous, while the
underlying derivation runs synchronously; high PBKDF2 iteration counts can block
the WebView. The upstream digest/KDF fixtures run with
`npx vitest run src/compat/crypto/hash.spec.ts src/compat/crypto/hash-types.spec.ts`.
Native measurements record whether the engine provides `Float16Array`.
Where absent, its input brand is unverified; equivalent half-float bytes are
still tested as a byte-array input. This does not certify complete crypto input
coverage on that engine.

`crypto.webcrypto.DigestStream` uses the owned incremental digest backend for
SHA-1/256/384/512 and MD5, plus CRC32/CRC32C/CRC64NVME. Its string input follows
Workers' WTF-8 behavior by default; `toWellFormed` carries a trailing high
surrogate across string writes. Digest promises, byte counts, abort and disposal
follow the pinned runtime. `crypto.subtle.timingSafeEqual` uses the Wasm native
comparison primitive and intrinsic BufferSource extents. These extensions retain
the host Crypto/SubtleCrypto objects and their existing WebCrypto operations.
The tests are `src/compat/crypto/digest-stream.spec.ts` and the shared
`cryptoWebExtensions` case.

Signature digest aliases, constant descriptors, binary signature views and
failure states are compared with Workers. Streaming RSA padding/salt options
apply to the streaming signature API; the pinned one-shot implementation
validates their frontend types but does not apply them. This distinction is
intentional. The strict consumer declarations and parameter matrix cover both
forms; they do not certify every key import/export option.

Random bytes and fills use the pinned Workers frontend and host cryptographic
entropy. `pseudoRandomBytes` is the same function as `randomBytes`. Sync fills
return the selected subview; callback fills return the original input. Workers'
byte-length validation and typed-array element slicing are preserved, including
its host Web Crypto quota and rejection of floating-point arrays. Input brands
are checked with intrinsic accessors, not `Symbol.toStringTag`. Host Web Crypto
brand-error wording varies by engine; shared contracts verify the error class.
The upstream random/prime fixtures and consumer declaration checks run with
`npx vitest run src/compat/crypto/random.spec.ts`.

Adapter-created secret keys support copied raw/JWK export, equality, generation,
HMAC, HKDF and symmetric ciphers. KeyObject.from can retain a host CryptoKey, but
synchronous extraction of its opaque key material is unavailable. Its public
algorithm metadata is copied through intrinsic getters when the KeyObject is
created. On WebKit, a host key's algorithm object can already have been mutated
before that conversion; its original metadata cannot then be recovered through
the public synchronous API. Transparent Proxy arrays are also indistinguishable
from ordinary arrays in JavaScript, while Workers rejects them in JWK dictionaries.
These remain observable engine boundaries, not whole-module acceptance.
RSA, EC, Ed25519 and X25519 key generation and owned key operations use
bundled OpenSSL 3.5.9 WebAssembly. PEM/DER import first uses the pinned BoringSSL
and ncrypto parsing rules, including unsupported key types, encoding selection,
encrypted input and certificate public keys. PEM/DER export uses the same
BoringSSL writer and ncrypto encoding choices, after the Workers frontend and
native dictionary option conversions. EC encoding flags survive the canonical
key transfer. Plain and encrypted PKCS8/PKCS1/SEC1/SPKI outputs are checked by
re-importing and comparing key material. Temporary private DER copies are
cleared after transfer. JWK import preserves dictionary getter order, snapshots
array lengths, validates base64url and EC private scalar bounds, and accepts
Workers' curve aliases. DSA metadata and the JWK export rejection are preserved.
SharedArrayBuffer input is checked separately on hosts with shared memory;
the ordinary browser profile does not provide that constructor, and the native
key contracts use ArrayBuffer rather than claiming shared-memory coverage.
RSA/EC streaming and one-shot signatures
are compared with Workers and independent test signatures. This covers selected
algorithms and operations, not the whole crypto module. Generation validates encoding
options before allocating keys, preserves RSA's 16384-bit limit and 128-bit size
rounding, and matches EC curve aliases and SEC1 parameter flags. DH custom-prime
generation and shared-secret calculation use the pinned BoringSSL backend,
including small primes and rejection of mismatched parameters. Workers' DH key
export rejection is preserved. The upstream key-generation and scrypt fixtures
run with `npx vitest run src/compat/crypto/kdf-limits.spec.ts`.
The DiffieHellman and DiffieHellmanGroup frontend uses the same BoringSSL backend
for parameter checking, key generation, setters and padded shared secrets.
Fixed groups are modp14 through modp18; their pinned `verifyError` is 8, including
BoringSSL's generator-suitability flag. Numeric parameter generation requires an
active local request, including when crypto is first dynamically imported within
that request. The request marker is initialized at dispatch, without changing
host globals merely by importing the dispatcher. Safe-prime generation is
synchronous and can occupy the WebView for a long time. Workers' per-request
CPU/memory limit-enforcer cancellation is not implemented; the maximum prime
size alone does not provide that protection. The DH/ECDH upstream fixtures and
consumer declaration checks run with `npx vitest run src/compat/crypto/dh.spec.ts`.
Remaining key import/export and other crypto error contracts still need work. Cipheriv/Decipheriv use the same pinned BoringSSL revision as Workers. Their
frontend preserves Workers' `authLengthTag` option spelling, AEAD's one-update
limit, early authentication-tag requirements, tag consumption and buffer copies.
The listed classic and AEAD cipher names have shared algorithm/state contracts;
metadata lookup still does not certify every option or the entire crypto module.
The separate cipher Wasm and provenance are in `crypto/native-cipher.*`.
Rebuild with `node scripts/build-native-cipher.mjs` after checking out the pinned
BoringSSL commit into `artifacts/upstream/boringssl` and installing Emscripten
4.0.20 at the pinned SDK revision. The script uses CMake 4.2.0 and Ninja 1.13.0
from a Python venv at `artifacts/toolchains/boringssl-build` (install with
`python3 -m venv artifacts/toolchains/boringssl-build` then that venv's
`pip install cmake==4.2.0 ninja==1.13.0`). `--link-only` requires libraries
previously built with those settings. No FIPS certification is claimed.
X509Certificate parses PEM/DER, exposes certificate fields and legacy objects,
extracts RSA/EC public keys, checks names and issuers, and verifies signatures
with certificate public keys. The pinned Workers runtime returns false for
matching imported/generated private keys and public keys used by these X509
checks; the adapter preserves this conservative result. It also preserves the
pinned runtime's refusal to match partial or multiple DNS labels with a wildcard,
and its ignored subject-always/single-label-subdomain options. These are Workers profile limits, not Node
semantics or a claim that the keys do not match.
Certificate SPKAC operations preserve the pinned Workers rejection of MD5
signatures while verifying SHA-256 signatures and extracting public keys and
challenges. Invalid SPKAC data returns false or empty buffers, as in Workers.
The pinned revisions and hashes are in crypto/native-crypto.build.json; rebuild
with scripts/build-native-crypto.mjs and the pinned Emscripten SDK. Entropy comes
from the host crypto.getRandomValues; there is no noncryptographic fallback.
Direct Node TLS is implemented and tested through the native transport.
Existing native sockets can upgrade on the same TCP connection. Application
writes wait for authenticated TLS; hostname mismatch or cancellation closes
the connection without sending queued application bytes. Native acceptance
exchanges a plaintext upgrade command followed by TLS, checks connection counts
and tests page and Dedicated Worker modes on both OSes. Custom Duplex wrapping
forwards bytes as in Workers and does not itself encrypt them. iOS upgrades use the existing OpenSSL Wasm backend with memory
BIOs on the original TCP connection; SecTrust must authenticate the peer chain
and hostname before the connection opens or application data is exposed. Android
uses the existing Netty channel with the platform SSLEngine. Native tests cover
TLS 1.2 and 1.3, including repeated write-half-close followed by response reads.
Full TLS class and
HTTP internal state contracts remain open.
Consult the generated completion report for remaining work.

Hash, HMAC, cipher data/IV/AAD/tag, streaming signature and prime native
boundaries read intrinsic BufferSource extents, including detached empty inputs.
Secret-key construction retains the Workers JavaScript frontend's observable
buffer/offset/length copy, so a shadow getter may reject before native processing.
RSA encrypt/decrypt digest names use the pinned Workers digest registry, including
its aliases, case handling and NUL termination. OpenSSL-only digest names are
rejected through the same native error path.

`crypto.subtle.digest` preserves host SubtleCrypto identity while using the
Workers registry (SHA-1, SHA-256, SHA-384, SHA-512 and MD5), conversion order,
promise rejection and intrinsic input extents. Bare SharedArrayBuffer is rejected;
views over shared memory are accepted where the host exposes shared memory.
Other standard SubtleCrypto operations still use the host implementation and
remain subject to the operation-level compatibility inventory.

Workers reports `fips=true` because of its own crypto backend. The owned WebView
backends do not run in a validated FIPS mode: `fips` and `getFips()` report false.
This is an explicit capability difference, not Workers FIPS equivalence.
`setFips`, assignment to default-export `fips`, and `setEngine` retain Workers'
unsupported-operation behavior. Surface contracts check names and descriptors;
the local capability value is asserted separately from Workers behavior.

For focused diagnosis, set `NODE_COMPAT_CASES` to a comma-separated list when
running `expansion-contracts.probe.mjs`. Focused output goes to
`demo/artifacts/node-inventory/targeted/` and does not replace the full baseline
used by native acceptance. Omit this variable for the required complete run.
