# AV-EXP-002 amendment 003: planner catalog coverage scope

Status: methodology repair after the first two comparative scenarios; their
original outcomes are preserved and excluded from final analysis.

The first comparative attempt completed the three stable baselines and
selector training, then ran AV2-001 and AV2-002. Both AV plans reported
`INSUFFICIENT_EVIDENCE` and selected all 2,024 checks. The cause was independent
of either oracle outcome: the benchmark adapter mapped each pytest node only to
its node component and each non-test check only to a synthetic check component.
No catalog entry claimed coverage of changed source-file components, so the
core planner correctly emitted `NO_VERIFICATION_COVERAGE` and failed closed.

This was not the preregistered intended evidence model. The frozen catalog
already contains `check:pytest-collection`, and the frozen policy requires it
for every change. Its responsibility is global collection integrity for the
selected pytest workload. The repair maps only this existing check to the
planner's wildcard component scope. That supplies catalog coverage without
selecting unrelated pytest nodes. A conformance test proves that a related test
is selected, an unrelated test is skipped with explanation, and targeted
sufficiency is reachable only with all skips explained.

Preserved evidence is under `attempts/planner-adapter-defect-003/`, including
the clean baselines, selector baseline, and both invalid scenario results.

No target, catalog unit, scenario, patch, selector output, oracle definition,
policy requirement, metric, analysis rule, or trust stage changes. The repair
does not use the observed relevant-check sets to tune selection. Final analysis
will rerun from clean baseline and excludes this invalid attempt.

The original preregistration commit `f8a183c` remains immutable.
