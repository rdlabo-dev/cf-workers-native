# Test execution cost

Reduce repeated work while preserving regression guarantees. A smaller test count
or a faster single CI run is not sufficient evidence of an improvement.

## Reuse after merge

Main can reuse the latest successful PR Compatibility result when its Git tree
matches the source actually tested by that run. The workflow verifies a source
record tied to the run and attempt. A still-running applicable PR run is awaited;
a failed result blocks release. Missing evidence or changed contents falls back
to full CI. This avoids a second identical test run without caching test outputs
or removing coverage. CI is a release condition, not a required merge check.

## Required coverage and isolation

Short suites with matching Node versions share setup and run sequentially:

- Node 22: build-tools, minvoice/authentication, upstream OpenNext.
- Node 24.21.0: Void, pknotes.

The workers and void-and-pknotes suites each typecheck the demo before fixture
preparation, covering Node 22 and 24.21.0 respectively. The library and
authentication fixture have their own TypeScript projects and checks.

Grouping these five suites into two jobs removes three setup sequences. Every
original test/preparation command remains in its original order within its suite.
Each shell step fails on the first failing command. A failure may prevent later
suites in its group from running, but cannot produce a passing CI result.

Browser engines, packed consumers, workerd, native scenarios, matrix
`fail-fast: false`, and the final all-jobs-success gate remain required. Unit,
final-bundle, browser, and native checks protect different failure boundaries;
remove equivalent assertions only when the remaining check preserves the same
guarantee.

No fixture artifact or compiled output is cached or shared between jobs. Each job
checks out its own source, installs dependencies, and builds the library. Upstream
preparations recreate their application outputs. Mutable OpenNext builds, test
databases, and native emulators must retain isolation.

The npm download cache does not replace installation, compilation, or execution.
Source and configuration changes are rebuilt on every run; dependency installation
resolves the current manifests even when downloaded packages are reused. This applies to full runs; validated result reuse after merge does not reinstall or rebuild.

## Verification

Run affected command sequences in order with their matching Node versions, plus
`actionlint .github/workflows/ci.yml`, when changing grouping. Required CI must
continue to execute every retained coverage boundary and reject test failures.
Local validation establishes shared-checkout correctness, not hosted-runner timing.

## Measurement and acceptance

Use existing job/step timestamps and lightweight measurements. Record product
revision, workload, Node versions, runner image, actual cache hits/misses, failures,
and cancelled runs. A run requested as warm is not a warm observation unless its
cache restores are verified. Keep measurement workflows out of production CI.

Report trigger-to-required-CI completion separately from summed job execution
time. Record scheduling delays separately; the final aggregation job's dependency
wait is not runner queue time. Compare affected work separately from unrelated
long-running jobs, and retain all observations rather than selecting fast runs.

Budget measurement effort. Cache isolation must fit the available storage; avoid
creating a large cache copy for every unrelated job. Limit cleanup to caches created
by the experiment. Do not add timing-only tests or a benchmarking service.

Accept an execution-cost change when redundant work is demonstrably removed,
regression guarantees and failure gates are preserved, and observations and their
limits are documented. Establish a baseline-derived target before measurement,
but distinguish a target from a measured or repeatable result. A stable global
speedup requires comparable repeated observations; it is not a prerequisite for
accepting verified removal of redundant work. If conditions prevent that claim,
report it as unproven and stop measurements that do not inform the decision.

[Issue #52 and its measurement evidence](https://github.com/rdlabo-dev/cf-workers-native/issues/52#issuecomment-6283412842)
record the baseline, commands, observations, and acceptance decision. The original
same-image repeated-comparison condition was not fully met. Its replacement accepts
the verified removal of three setup sequences and preserved coverage without
claiming stable achievement of the estimated 234 runner-second target or a global
wall-clock improvement. This avoids making further costly CI repetition a condition
of accepting an already verified reduction in work.
