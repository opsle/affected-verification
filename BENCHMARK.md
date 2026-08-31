# Benchmark and research record

AV-EXP-001 completed the first preregistered real-repository `SHADOW`
calibration. See [benchmark/av-exp-001/REPORT.md](benchmark/av-exp-001/REPORT.md)
for the bounded result and immutable artifact identities. The method below
remains authoritative for future runs.

## Central question

Can Affected Verification substantially reduce verification workload without increasing undetected regression risk relative to existing full verification?

Correctness and selection-miss evidence are evaluated before computation reduction.

## Arms

For each frozen repository/change fixture where applicable:

1. full verification;
2. native related/affected tooling;
3. Affected Verification using only normalized repository evidence;
4. Affected Verification consuming native tooling as evidence.

Native arms should include the repository's actual Jest, Vitest, Nx, Turbo, testmon, Bazel, Pants, or other selector rather than a synthetic strawman.

## Required freeze before a run

- exact repository and base/target revisions;
- immutable change set and changed-region derivation;
- complete verification catalog and units;
- evidence-provider versions and outputs;
- policy identity and trust stage;
- commands, environment, and deterministic plan outputs;
- full-verification correctness oracle;
- relevance adjudication protocol for full-run failures;
- failure classes, stopping rules, and excluded changes.

## Primary safety metrics

- relevant selection misses found by full/shadow execution;
- incomplete or indeterminate full runs;
- targeted plans that escalated because sufficiency was indefensible;
- false targeted-sufficiency claims discovered by audit;
- correctness-oracle disagreements.

Any relevant selection miss is reported before reduction. “No miss observed” is bounded to the executed corpus and is not proof of safety.

## Workload metrics

- checks available, selected, skipped, and actually executed, partitioned by check type;
- test executions available, selected, skipped, and actually executed;
- computation, latency, and cost only when directly observed in comparable arms;
- uncertainty/escalation frequency by change class;
- marginal reduction from each evidence source by controlled ablation.

Unlike verification types are not added into one deceptive percentage. Counterfactual avoided computation requires controlled comparability; plan counts alone are `EXACT`, not causal savings.

## Secondary questions

- Which evidence sources materially reduce workload?
- How often does uncertainty force escalation?
- Which change classes remain defensibly targetable?
- How frequently do native and composed selectors miss relevant full-run failures?
- Does adding policy and non-test checks produce value above native selectors?

## Experiment sequence

First, freeze a real public repository with a trustworthy full-verification baseline and run in `OBSERVE`/`SHADOW`. Compare plan identities and full outcomes without replacing CI. Only after the oracle, catalog completeness, adapter fidelity, and miss classifications are independently reviewable should a bounded trust decision be considered.

AV-EXP-001 satisfied that first calibration step for Zustand at
`b57db4f86ef179285da216eeb291266da82c361c`. It remains `SHADOW`; its absence
of observed AV misses in ten scenarios is not a bounded-trust decision.
