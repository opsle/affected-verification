# AV-EXP-001 benchmark report

Experiment: **Minimum Defensible Verification — Real Repository Shadow
Calibration**

## Verdict and claim boundary

The controlled benchmark completed without a design-invalidating defect.
Affected Verification selected all eight checks that the frozen full-catalog
oracle identified as relevant in this ten-scenario corpus. The native Vitest
related-test arm selected six of eight and omitted two relevant non-test
checks. Full verification remained authoritative for every scenario.

This is a `SHADOW` calibration result. It does not establish general safety,
correctness equivalence, causal time or cost savings, or production trust. The
precise safety claim is: **no Affected Verification selection miss was
observed in this frozen calibration corpus**.

## Provenance

- Starting release: `12076522c9b82501794d816f1fcc0b7775fad6e1`
- Preregistration commit: `0544362d7659093b7f0b4f89ee8f68023fd269c3`
- Target: `https://github.com/pmndrs/zustand.git`
- Target commit: `b57db4f86ef179285da216eeb291266da82c361c`
- License: MIT
- Catalog: `sha256:8c5b224deaa7077690341248a18a2155310e2b16072e1607a9b4cd546e3a0914`
- Baseline: `sha256:8844d3be4b27f9abd9bab7c6b04d34fc6a1e7cfe36a21e6deec2b315633d3465`
- Result summary: `sha256:68b8582a9ce7b86bfa5431d89d2dea07f8c34b88d1d0350bab25c99fa5b236df`
- Analysis: `sha256:c431d8849edce79d6121a290f49288ed2710e406600d8b66d3588e6b82c73a1d`
- Evidence bundle: `sha256:1e176b7a40b5f16451797d87784f560f932b686f2fe261731526709331ff1172`

The original preregistration is immutable. Three versioned amendments preserve
the initial failed attempts: worktree dependency preparation, Vitest JSON
report interpretation and timing-excluded semantic identities, and output-path
normalization. None changed the target, corpus, oracle, arms, selection policy,
metrics, or analysis rules.

## Target, environment, and baseline

Zustand was selected after evaluating Redux Toolkit and Immer against the
preregistered criteria. It offered a pinned pnpm lockfile and toolchain, a
bounded primary CI catalog, enumerated Vitest checks, and Vitest's supported
`related` selector. Redux Toolkit's multi-matrix/package surface and Immer's
built-artifact, Flow, and performance workflow ambiguity made them less
suitable for this first bounded calibration; they were not benchmarked.

The benchmark ran on Linux x86-64 with Node 24.20.0 and pnpm 11.3.0. Frozen
target tools included Vitest 4.1.10, TypeScript 6.0.3, ESLint 9.39.4, Prettier
3.9.6, and Rollup 4.62.4. Exact environment and source hashes are in the
preregistration.

The full catalog contained 17 compatible check units: 13 test-file checks
representing 224 test executions, plus format, typecheck, lint, and build.
Three clean baseline repetitions passed all checks with the same semantic
outcome and no observed flaky check. Full-catalog wall time was 29.329–32.807
seconds across the three repetitions (`OBSERVED`).

## Corpus and oracle

The corpus contains ten frozen scenarios: six deterministic synthetic faults
and four synthetic benign change shapes. It covers isolated and direct changes,
reverse/transitive dependencies, shared code, test-only changes,
configuration, dependency/build metadata, public contracts, multi-file
changes, and deliberately incomplete impact evidence. Each scenario binds its
base SHA, patch hash, changed paths, classification, setup, and materialization
procedure. No selector input contains the full-run outcome.

For each scenario, the oracle first relies on the passing clean baseline,
materializes the frozen patch, executes all 17 frozen catalog checks, and marks
as relevant the checks whose outcome changed because of that scenario. The
claim is only **relevant within this frozen verification catalog**; the catalog
does not prove complete software correctness.

## Arms and safety result

`FULL` ran every catalog check and remained authoritative. `NATIVE` used
Vitest 4.1.10 `related` with the actual changed paths. `AV_CORE` used normalized
Git change, catalog, package/source import graph, and policy evidence.
`AV_WITH_NATIVE_EVIDENCE` additionally consumed native related-test output as
one evidence source.

| Selector | Relevant | Selected | Missed | Scenario misses | Full escalations |
|---|---:|---:|---:|---:|---:|
| FULL | 8 | 8 | 0 | 0 | n/a |
| NATIVE | 8 | 6 | 2 | 2 | 0 |
| AV_CORE | 8 | 8 | 0 | 0 | 3 |
| AV_WITH_NATIVE_EVIDENCE | 8 | 8 | 0 | 0 | 3 |

Every observed selection miss:

- `NATIVE`, `AVS-003`: omitted relevant `check:lint`.
- `NATIVE`, `AVS-008`: omitted relevant `check:typecheck`.

The misses demonstrate the boundary of a tests-only native selector; they are
not characterized as Vitest defects. Both AV arms added the four policy-required
non-test checks in every scenario and selected both relevant checks. AV
broadened for public-contract changes in AVS-003 and AVS-008. It required the
full catalog for verification metadata/configuration in AVS-006 and AVS-007,
and for deliberately incomplete dependency evidence in AVS-010. Aggressive
targeted selection was therefore denied in the uncertainty scenario.

## Workload result

These are `EXACT` plan counts aggregated over ten scenarios. Unlike units are
kept separate and the counts are not correctness, cost, or causal savings.

| Arm | Test files selected / available | Test executions selected / available | Non-test checks selected / available |
|---|---:|---:|---:|
| FULL | 130 / 130 | 2,240 / 2,240 | 40 / 40 |
| NATIVE | 70 / 130 | 1,358 / 2,240 | 0 / 40 |
| AV_CORE | 89 / 130 | 1,640 / 2,240 | 40 / 40 |
| AV_WITH_NATIVE_EVIDENCE | 89 / 130 | 1,640 / 2,240 | 40 / 40 |

AV proposed skipping 41 of 130 test-file executions and 600 of 2,240 test
executions while retaining every oracle-relevant check observed in the corpus.
Native evidence did not change AV's test count in this corpus. Native selected
fewer tests in AVS-006 and AVS-010 because AV correctly broadened under policy
or uncertainty. Per-scenario counts and every skip explanation are preserved
in `results-v2/scenarios/`.

Scenario full-catalog time was 29.088–33.442 seconds and native selection time
was 1.716–5.683 seconds (`OBSERVED`). They are telemetry, not a causal
time-saved estimate.

## Shadow evidence, visibility, and reproducibility

Every result binds the experiment, benchmark revision, target and scenario,
catalog, planner and policy, native selector, four arm selections, full oracle,
misses, workload, uncertainty, evidence hashes, and result identity. The
validator rejects target, patch, catalog, selector, baseline, oracle, policy,
scenario, skip-reason, trust-state, and result tampering, including attempts to
represent `SHADOW` as trusted.

Twenty `opsle.value-receipt.v1` records provide one concise Affected
Verification indicator per AV arm and scenario. Test/check counts are `EXACT`;
wall time is `OBSERVED`. Raw full-run outputs remain in `results-v2/raw/` even
though the published summary reduces what an operator needs to inspect. Thus
Affected Verification answers what should run, while the Context Firewall
pattern answers what result should be shown; output reduction never changes
oracle truth.

The deterministic reproduction command is:

```bash
npm run benchmark:av-exp-001
```

It prepares the exact target in disposable storage, validates identity,
installs locked dependencies, validates the catalog, materializes each patch,
runs native and AV selection, executes the full catalog, computes relevance,
and emits results. A second clean run at a different result path reproduced the
baseline, all ten scenario, summary, and analysis identities exactly. This was
a same-host, same-implementation replay, not an independent qualifying
replication. Raw bundle identities intentionally include variable observed
timing and output locations.

## Opsle mechanisms and decision

Actually exercised implementations: Affected Verification planning and
evidence validation; Visible Value receipts and the authoritative receipt
validator. The Context Firewall separation was exercised as a manual artifact
pattern: raw truth was retained while summaries constrained supervising
context. Decision Evidence concepts were implemented through content-addressed
bindings and validation, but its separate runtime was not invoked. Agent
Trajectory Profiler, Gearbox, and Opsle Tasks were not used. No Codex child
agents or external model/provider workloads were used.

Affected Verification remains `OBSERVE/SHADOW`. This one-repository,
one-ecosystem, synthetic-fault-heavy corpus and same-host replay do not justify
`TRUSTED_BOUNDED`. The evidence can support lifecycle `VERIFIED` for the narrow,
revision-bound prototype and benchmark artifacts if all release and program
gates pass; it cannot support a higher stage.

Exactly one next execution: preregister and run a second public-repository
shadow calibration in a different ecosystem with a meaningful native selector
and the same full-catalog oracle discipline. Do not begin it as part of this
experiment.
