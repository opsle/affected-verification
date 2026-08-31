# AV-EXP-002 amendment 004: added-path change identity

Status: methodology repair after AV2-001 through AV2-009; all original outcomes
are preserved and excluded from final analysis.

The repaired run completed stable baselines, selector training, and scenarios
AV2-001 through AV2-009. AV2-010 then stopped before any arm or FULL execution
at the changed-path identity gate. Its patch adds a new source file. `git apply`
materialized that file as untracked, while the adapter enumerated only
`git diff --name-only`, which does not list untracked paths.

Repair: form the changed-path identity from the union of tracked
`git diff --name-only` paths and `??` paths from
`git status --porcelain --untracked-files=all`. The exact union must still equal
the preregistered scenario path list before selector or planner execution.

No target, catalog, scenario, patch, selector output, oracle definition,
selection policy, metric, analysis rule, or trust stage changes. In particular,
the observed AV2-006 miss remains unmodified and will be rerun and reported.
Preserved evidence is under `attempts/change-identity-defect-004/`.

The original preregistration commit `f8a183c` remains immutable.
