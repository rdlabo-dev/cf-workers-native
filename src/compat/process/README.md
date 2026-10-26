# Workers process adapter

Targets workerd `1.20261012.1`, compatibility date `2026-10-17`, with the
repository's pinned Node compatibility profile. This is not a host OS process.

The adapter provides Workers metadata and stubs, event delivery, warning and
microtask scheduling, request-local working directories, frozen configuration,
environment-file loading through the virtual filesystem, and standard streams.
Standard input reads EOF. Standard output/error use virtual descriptors 1 and 2.
Environment-file loading updates the shared environment object and can overwrite
existing values, matching the pinned implementation.

`abort`, `reallyExit` and `getBuiltinModule` remain missing. Terminating a Workers
request cannot be replaced by a catchable exception or closing an unrelated
WebView. Builtin lookup needs a complete registry and must preserve module
identity. These are open implementation/host integration work, not accepted
unsupported stubs. Native stack inspection retains the documented
[events profile boundary](../events/README.md).

The shared process cases in `../expansion/index.spec.mjs` compare scheduling,
metadata/stubs, configuration, environment loading and standard input. They do
not certify the entire process module or all standard output/error behavior.
