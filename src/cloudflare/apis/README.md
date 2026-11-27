# Workers-specific runtime APIs

Cloudflare-owned runtime APIs are separate from Web standards and Node modules.
A local module resolving successfully is not proof of full API compatibility.

| API                                     | Local implementation                                                     | Status / boundary                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare:node`                       | `cloudflare-node/`                                                       | HTTP/connection bridge helpers; existing [Node compatibility status](../../../docs/compatibility.md) applies                                                           |
| `cloudflare:workers`                    | `cloudflare-workers/`                                                    | Partial: request-scoped `env` during direct and isolated dispatch and a DurableObject constructor shell; not a complete module or local Durable Objects implementation |
| ExecutionContext                        | `src/cloudflare/workers/runtime.ts`, `src/browser/isolated/transport.ts` | Existing request-runtime behavior; `passThroughOnException` unsupported; no complete API certification                                                                 |
| Cache API                               | None                                                                     | Not implemented                                                                                                                                                        |
| HTMLRewriter                            | None                                                                     | Not implemented                                                                                                                                                        |
| WorkerEntrypoint / RPC                  | None locally                                                             | Not implemented locally; calls inside a remotely dispatched HTTP handler stay on Workers                                                                               |
| Scheduled / queue / workflow lifecycles | None locally                                                             | Run on the deployed Worker; not simulated in Capacitor                                                                                                                 |

ExecutionContext remains owned by request execution rather than being extracted
into a disconnected API stub. The inherited `cloudflare:workers` partial adapter
is completion debt, not a newly completed unit. Do not add empty implementation
folders for unsupported APIs.

Cloud resource bindings and remote dispatch are tracked in
[bindings](../bindings/README.md), independently of local runtime compatibility.
