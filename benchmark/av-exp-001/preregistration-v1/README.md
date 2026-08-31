# AV-EXP-001 preregistration v1

Experiment: **Minimum Defensible Verification — Real Repository Shadow
Calibration**

Status at publication: `PREREGISTERED`; no comparative scenario result had
been observed.

This directory freezes the first real-repository Affected Verification
calibration before the change corpus is executed. The target is Zustand at
exact revision `b57db4f86ef179285da216eeb291266da82c361c`. The target remains
read-only upstream and is materialized only in a disposable local clone.

The full catalog is authoritative for every scenario. Affected Verification
and the native Vitest selector only predict plans. Neither selector accepts or
rejects a scenario, and no real CI or branch protection is changed.

Files in this directory are immutable experiment inputs:

- `preregistration.json`: question, arms, metrics, oracle, analysis, and stops;
- `candidate-evaluation.md`: objective selection and rejection record;
- `environment.json`: target, toolchain, host class, and frozen file hashes;
- `catalog.json`: content-addressed full verification universe;
- `native-selector.json`: exact Vitest related-selection contract;
- `policy.json`: Affected Verification evidence and escalation policy;
- `scenarios.json`: scenario identities and materialization metadata;
- `patches/`: compact public-safe patches against the pinned target.

Any harness defect discovered after publication requires a new versioned
preregistration directory. Results may not rewrite this directory.
