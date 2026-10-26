# Contributing

## Formatting

Run `npm run format` from the repository root before submitting changes. `npm run format:check` checks the same files without modifying them and is required by the library CI job. Use the exact Prettier version in the root package; the demo uses the same configuration. Markdown prose keeps intentional line breaks (`proseWrap: "preserve"`). Generated files, native project scaffolding and upstream license text are excluded in `.prettierignore`.

## Complete compatibility units only

New compatibility implementations must be completed before merge or release unless an explicitly authorized release exception applies. A useful subset, a working framework demo, or passing tests for selected methods does not establish whole-module completion. Release exceptions cover [the current PR #72 candidate](#pr-72-scoped-release-exception) and existing implementations in [0.1.0 Preview and its explicitly authorized 0.1.1, 0.1.2, 0.1.3 and 0.1.4 follow-ups](#010-preview-exception).

For Node.js compatibility, the acceptance unit is a module, including its Workers
exports, subpaths and observable behavior. For a binding or Web API, define the
named API unit before implementation. Do not redefine the unit around the methods
that happen to work. Large units may be developed in several commits or draft PRs,
but incomplete implementation PRs must not be merged into main unless covered by
an explicitly authorized release exception.

The target is Cloudflare Workers, not every API available in a Node.js process.
Pin the workerd version, compatibility date and flags. An operation unsupported
by that Workers baseline must reproduce its actual rejection, no-op or stub
behavior; it must not be omitted from testing.

## Supported execution environments

The current execution targets are Capacitor iOS and Android WebViews, in both
direct and Dedicated Worker execution. Ordinary browsers, Electron and Tauri are
future targets. This does not reduce the Workers API surface of a completed unit.

Chromium/WebKit tests verify JavaScript behavior, public imports, build integration,
global initialization and bridge protocols. Contracts requiring native network
privileges run against workerd and real iOS/Android transports with the same
expectations, in both execution modes. Browser mocks are not evidence of native
transport compatibility. Every operation must have an explicit verification target;
CORS, headers, cookies, redirects, streaming and cancellation must not be excluded.

## Acceptance gate

A compatibility implementation is ready to merge only when all of these are true:

- The baseline's exports, subpaths, signatures and relevant prototype methods
  have been inventoried, with no unresolved coverage decisions.
- Every required operation is implemented. There are no project-specific
  unsupported cases, skipped tests, TODO implementations, placeholder successes
  or empty exports standing in for required behavior.
- The same behavioral contracts pass against workerd and the local implementation.
  Contracts cover normal behavior, invalid input, errors, state, concurrency,
  cancellation and cleanup wherever applicable. Workers' own unsupported behavior
  is tested as an expected result, not skipped.
- Public imports and globals work before application evaluation in both Vite and
  esbuild, in-page and in a Dedicated Worker. Vite development startup, production
  builds and an independently installed npm tarball are verified.
- The relevant contracts pass on iOS and Android WebViews. Logs or screenshots
  identify the tested revision, platform and results. Passing an early subset of
  a native run is not a completed run.
- CI must pass before release; pending CI does not block merging. Manager and independent acceptance reviews have no
  outstanding required changes. Reviewers check coverage completeness as well as
  test results; CI cannot prove a missing contract exists.
- Documentation describes current API behavior, the pinned baseline, limitations
  and reproduction commands. Keep completion reports, review history and test-run
  evidence in PRs and generated artifacts, not accumulating in README or docs.

Only then may the inventory say **Complete**. Until then, use **In progress**,
**Unverified**, or **Not implemented**, and identify the remaining work.

## Work in progress

Except for an explicitly authorized release exception, keep incomplete compatibility work on a development branch or draft PR. Do not
activate it in a merged build alias, public export or default runtime path, and do
not ship it behind an experimental flag as a substitute for finishing it. Design
notes and reproducible experiments can be reviewed independently without adding
unfinished production behavior.

### PR #72 scoped release exception

The maintainer explicitly authorized preparing one release of the existing
implementation in PR #72 while retaining incomplete compatibility as **In progress**.
This exception is scoped to the implementation at
`7d205ddd0714787b057c715cca1b421ec81a305a`, its release documentation, and fixes for
regressions found while validating that same scope. It does not authorize adding
new API scope or apply automatically to later releases.

For this candidate, unresolved implementation and operation-coverage items do not
by themselves prevent release readiness. They must remain visible in the
[compatibility guide](docs/compatibility.md) and release notes. Missing APIs,
unverified operations and known engine/host differences remain distinct; none is
promoted to **Complete** or described as technically impossible merely to release.
The whole-module acceptance gate above remains the criterion for **Complete**.

Release readiness under this exception requires passing the existing required
contracts, public imports/types, independent package acceptance and applicable
iOS/Android page and Dedicated Worker scenarios. Verify that the evidence matches
the candidate's implementation; do not reuse evidence across runtime changes.
Known failures in those required scenarios must be fixed, not relabeled as
unfinished work or skipped. Preserve failed CI attempts and disclose unresolved
test infrastructure instability even when an unchanged rerun passes.
Manager and independent acceptance review must assess this scoped readiness and
the accuracy of the limitations. Store results in the PR and generated artifacts.

This is an exception to the completeness gate, not a publication action. Version
selection, PR publication/status changes, merge, tag push and package publication
still follow the maintainer's explicit authorization and the CI release workflow.

### Explicit WebSocket attachment representation boundary

The WebView WebSocket attachment implementation may use a documented canonical
serialization representation for its 16,384-byte limit. This is an explicitly
authorized boundary: V8 can serialize arrays with identical observable values
and properties to different lengths depending on its private packed/holey storage
representation, which JavaScriptCore cannot inspect or reproduce.

This exception covers only limit decisions and reported byte lengths that depend
on engine-private representation. It does not waive snapshot isolation, cyclic
references, supported value types, validation, ordinary size-limit enforcement,
or any other WebSocket API, network behavior, or native acceptance requirement.
See the [scope and reproducible boundary probe](src/browser/websocket/README.md).
The canonical representation must be documented and verified before acceptance;
this exception does not itself certify the current implementation.

### Explicit WebView events profile

The approved events work targets the current WebView architecture with documented
engine boundaries, rather than replacing the engine to seek unrestricted Workers
equivalence. The events adapter and its process event/warning/nextTick integration
may be accepted against the [WebView events profile](src/compat/events/README.md).
This is a scoped exception to unrestricted whole-module equivalence above, not a
blanket exception for new incomplete Node modules. Keep the existing process and
async-hooks limitations visible. Require the shared behavioral contracts, public
Vite/esbuild imports, an independently installed tarball, and iOS/Android page and
Dedicated Worker evidence for this profile. Do not label the complete Node
compatibility inventory or unrestricted Workers behavior **Complete** as a result.
Publishing and release authorization remain separate.

### 0.1.0 Preview exception

0.1.0 Preview may include existing compatibility implementations with the limitations documented in the [compatibility inventory](docs/compatibility.md). Their inclusion does not establish complete module compatibility or certify untested behavior. Keep missing exports, unsupported operations and verification boundaries visible; a passing application scenario does not make its dependencies complete.

This exception applies only to existing implementations in 0.1.0 Preview. It does not permit new incomplete compatibility units, bypass required CI or application acceptance, or automatically extend to subsequent releases. New compatibility implementations must satisfy the acceptance gate above. Except for the explicitly authorized 0.1.1, 0.1.2, 0.1.3 and 0.1.4 follow-ups below, existing incomplete units remain completion debt and must be completed and verified, or excluded, before a subsequent release includes them.

### 0.1.1 Preview follow-up

0.1.1 is explicitly authorized to retain the existing compatibility limitations documented in the inventory, provided its changes pass regression checks and required CI. This is a version-specific continuation of the Preview scope, not a claim that incomplete modules are complete. Keep known failures and unverified behavior visible in release notes. It does not authorize new incomplete compatibility units or extend the exception to later versions.

### 0.1.2 Preview follow-up

`cf-workers-native@0.1.2` Preview is explicitly authorized with the current limitations documented in the [compatibility inventory](docs/compatibility.md). This version-specific exception retains existing incomplete compatibility implementations; it does not certify complete Workers or Node.js compatibility, authorize new incomplete units, bypass required regression checks or CI, or extend to later releases. Keep unsupported behavior and verification boundaries visible.

### 0.1.3 Preview follow-up

`cf-workers-native@0.1.3` is authorized as a CI-published continuation of the existing Preview, retaining the limitations in the [compatibility inventory](docs/compatibility.md). Its runtime implementation is unchanged from 0.1.2. This version-specific exception does not authorize new incomplete compatibility units or bypass regression checks and CI.

### 0.1.4 follow-up

`cf-workers-native@0.1.4` is authorized to retain the documented compatibility
limits. It updates onboarding, release tooling and native verification; SDK runtime
sources are unchanged from 0.1.3. Existing limitations remain in the compatibility
inventory. This exception does not authorize new incomplete implementations or
bypass regression checks and CI.

## Layout and tests

Keep runtime implementations in `src/compat/<module>/index.ts`, `src/browser/<module>/index.ts`, or
`src/cloudflare/apis/<module>/index.ts`
according to API ownership, with contracts/tests in the adjacent `index.spec.ts`.
Cloud resource adapters and execution policy belong in `src/cloudflare/bindings`; cross-domain
installation/codecs belong in `src/shared`. Application execution belongs in
`src/cloudflare/workers` and browser host mechanisms in `src/browser`, build tooling in `src/tooling`, and the reusable feature/contract host
in `src/shared/contracts`. See the [source layout](src/README.md). Subpaths and dependency declarations belong to
that module directory. `demo/tests/` owns environment runners, not copies of
module behavior. Production compilation excludes specs. Consumer tests may copy
test contracts, but must resolve implementations from the packed package.

See [compatibility limits](docs/compatibility.md) and the [contract API](docs/contracts.md).

Global APIs follow the same module ownership rule: Fetch, Headers, Request,
Response, AbortSignal, encoding and structuredClone keep their own behavior
contracts. `globals` tests cover installation, ownership, conflicts, rollback
and restoration, not a combined API behavior suite. API-specific installation
regressions live beside that API (for example, `abort/installation.spec.ts`).
Environment runners may share setup, but expose each API as a separate named
test; a single passing “globals” result must not stand in for individual APIs.

## CI and regression protection

The `CI` check aggregates library, the compatibility matrix, bindings,
streams-fallback, package and upstream jobs. The main branch ruleset is disabled so `npm run release` can push the version
commit and tag directly. CI is not a merge status requirement.
Publishing still requires successful Compatibility for the release commit.
Workflow configuration is in [ci.yml](.github/workflows/ci.yml); CodeQL is separate.

For a main push, the workflow compares its Git tree with the source actually
checked out by the latest applicable PR Compatibility run. Matching successful
results are reused without executing the full suites again. If that PR run is
still running, main waits for its result; an applicable failed run fails the gate.
Missing or unverifiable evidence, different source contents, or no applicable PR
requires the ordinary full CI run. The source record is tied to the run and
attempt, so an earlier successful attempt cannot replace a newer result.
Ordinary full runs require every job to succeed; skipped or cancelled suites are
accepted only when the main gate has explicitly validated successful reuse.

Library checks include types, adjacent contracts and reproducible URL generation.
Integration checks use pinned local workerd, Chromium/WebKit, both build tools,
forced stream fallbacks and a fresh installed tarball. The upstream job clones
the pinned official Hono sample. Selected third-party fixtures also build and run
through the public API on independent Android emulator jobs. iOS, live cloud-service
checks and physical-device validation remain separate from required CI; see the
[native test procedure](demo/tests/README.md).
The document suite's explicit WebKit comparison differences are documented in
[compatibility limits](docs/compatibility.md); they are not successful behaviors.

Require every case in a claimed-supported profile to pass, including cleanup.
`assertContract` alone permits partial coverage and is insufficient for acceptance.
The independent feature/case list in `demo/tests/validation/expected-cases.json`
guards against silent case removal; changes require review. Shared builtin
registration lives in `src/tooling/shared.ts`, not separate Vite/esbuild lists.
Keep exploratory probes outside required acceptance; use `test:node-boundaries`
in the demo when investigating engine differences. Never promote a probe result
or a namespace match to full behavioral support.

## npm releases

All 0.x versions are implicitly Preview releases, including plain versions published to `latest`. Use the plain version (for example, `0.1.4`) as the GitHub release title; do not repeat a Preview label in release notes. Document concrete changes and compatibility limits there. The npm dist-tag selects the installation channel; `latest` does not imply production stability. Publish release versions through the GitHub Actions Release workflow from the exact CI-passing main commit, rather than from a local npm session.

| Trigger                                                                   | npm dist-tag | Version                                    |
| ------------------------------------------------------------------------- | ------------ | ------------------------------------------ |
| Maintainer comments `/beta` on a CI-passing PR                            | `beta`       | `<base>-beta.pr<PR>.sha<12-character SHA>` |
| PR merged into `main`, after Compatibility succeeds for that merge commit | `beta`       | `<base>-beta.pr<PR>.sha<12-character SHA>` |
| Release tag such as `v0.1.3`                                              | `latest`     | `0.1.3`                                    |
| Prerelease/revision tag such as `v0.2.0-rc.1`                             | `next`       | `0.2.0-rc.1`                               |

Direct pushes and PR branches do not automatically publish beta packages. A newer main commit supersedes an older beta candidate. Beta and next releases do not change `latest`.

Use the same `np` entry point as the other repositories, from a clean, up-to-date
`main` checkout:

```sh
git switch main
git pull --ff-only
npm run release
# Or select the increment without the version-selection prompt:
npm run release -- patch
```

`np --no-tests --no-publish --branch main` selects the version, creates the version
commit and Git tag, and pushes them. It never publishes to npm locally. Android's
source publication version is read from `package.json`, so no separate Gradle
version edit is needed. The tag-triggered Release workflow waits for Compatibility
to succeed on that exact main commit, then builds and publishes with Trusted
Publishing and provenance. Failed or missing CI prevents publication. The workflow
revalidates the candidate before publishing; local `--no-tests` does not bypass CI.

A plain version such as `0.1.3` goes to `latest`; a prerelease version such as
`0.2.0-rc.1` goes to `next`. Existing versions and tags are immutable. If a release
version was already prepared and merged through a PR, wait for that main commit's
CI and push its matching tag instead of asking `np` to bump it again. Never retarget
an existing release tag.

The [release workflow](.github/workflows/release.yml) builds without npm publishing credentials, then publishes the resulting tarball in a separate job with lifecycle scripts disabled. It uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) rather than an npm token. Configure the npm package's Trusted Publisher once with GitHub owner `rdlabo-dev`, repository `cf-workers-native`, workflow filename `release.yml`, no environment name, and permission to publish directly. No `NPM_TOKEN` secret is required.

### PR beta requests

After Compatibility succeeds for an open, non-draft PR targeting main, a repository admin or maintainer can post a comment containing exactly `/beta`. This also supports fork PRs. The request publishes that PR head to `beta` without merging it; it never updates `latest`.

The workflow checks the requester's current permission, the PR head and its CI again in the publishing job. A PR updated after the comment requires successful CI and a fresh `/beta`; queued comments do not authorize newer changes. PRs modifying `.github/workflows/` or `.github/scripts/` must merge those changes before using this command. The candidate is built in the read-only job; its source and lifecycle scripts are never executed in the OIDC publishing job.

The command becomes available after `release.yml` lands on main. A failed request can be inspected in the Release workflow's Actions log; it does not publish when CI is pending or failed.

### Local CI bootstrap release

A maintainer can prepare a `beta` package from any committed branch when CI needs
an npm artifact before merge or Trusted Publishing setup. This local path does
not require main or successful remote CI; it does not alter the GitHub release gates.
Review the local build/test results before publishing the candidate.

```sh
npm run release:prepare
```

The command requires a clean checkout, builds with the ordinary `prepack` hook,
and stages a tarball under `artifacts/npm/<full-commit-SHA>/`. Its version is
`<base>-beta.local.sha<12-character-SHA>` and its dist-tag is `beta`. The source
`package.json` and Git tags are unchanged. `release.json` records the source
branch/commit and tarball SHA-256. Preparation does not publish or use npm credentials.

The command prints the exact `npm publish <tarball> --ignore-scripts --access public
--tag beta --registry https://registry.npmjs.org` invocation. After reviewing the
artifact, use your local npm account (`npm login` if needed) with permission to
publish `cf-workers-native`, and run that printed command. Append `--dry-run` to
inspect it without publishing. Complete npm's authentication/2FA prompts when
requested; keep credentials outside the repository. Local publication does not
use the workflow's OIDC identity or its `--provenance` option.

This publishes only the npm package. It does not deploy a Worker, push a Git tag,
merge a PR, or publish Android Maven artifacts. The new npm name must be available
to your account; preparation and dry-run do not prove publication permission.
Use the exact printed version in CI installs rather than a moving `beta` tag.
Already published versions cannot be replaced; commit changes and prepare a new
candidate. This does not update `latest`.
