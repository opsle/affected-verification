# AV-EXP-003 benchmark report

## Verdict

**PASS**, within the preregistered defect-repair claim only. The known AV2-006
check is selected by generalized check-level dependency-completeness evidence,
all ten adversarial cases have zero selection misses, and frozen AV-EXP-001 and
AV-EXP-002 replays have zero repaired AV misses. AV-EXP-002 permanently remains
a **FAIL**.

FULL remained authoritative. Lifecycle remains `VERIFIED`; trust remains
`OBSERVE/SHADOW`. No targeted plan became authoritative.

## Root cause and repair

AV-EXP-002's Python adapter treated a complete ordinary static graph as
complete dependency evidence for every check. In AV2-006,
`test_light_imports` launched a child Python interpreter through
`subprocess.Popen`; neither static imports nor pytest-testmon represented the
runtime import relationship. Agreement among two incomplete absence sources
was therefore mistaken for skip sufficiency.

Plan v2 requires one dependency-completeness assessment per check. A check can
be skipped only in `COMPLETE_FOR_CHECK` or
`COMPLETE_WITH_DECLARED_BOUNDARIES`; `INCOMPLETE`, `OPAQUE_BOUNDARY`, and
`UNKNOWN` force that check's selection. Positive native evidence can select a
check but does not manufacture completeness. Every assessment exposes
mechanisms, boundaries, evidence coverage, unresolved mechanisms, source
provenance, action, and explanation.

The bounded Python inspector uses AST evidence and optional explicit metadata.
It distinguishes subprocess, child interpreter, dynamic import, plugin/entry-
point discovery, exec/eval/code generation, and runtime module loading. Generic
reflection/registration remains metadata-driven because mere API presence is
not enough to classify every use equivalently. No LLM or runtime tracer is
used.

## AV2-006 replay

| Arm | Old AV-EXP-002 | AV-EXP-003 replay | Test checks added |
|---|---:|---:|---:|
| AV_CORE | miss | selected | 1 |
| AV_WITH_SELECTOR_EVIDENCE | miss | selected | 1 |

The detector found `SUBPROCESS` and `CHILD_INTERPRETER` boundaries at
`tests/test_imports.py:70`. The plan reason is
`OPAQUE_BOUNDARY_FORCED_SELECTION`; no Click, scenario, changed-path, or test-
name rule exists in core.

## Generalization and precision

All ten preregistered adversarial cases passed: subprocess, dynamic import,
plugin/registry discovery, ordinary static import, irrelevant subprocess,
incomplete metadata, native-selector miss, native positive selection,
exec/eval/code generation, and a closed declared boundary.

Across those ten cases, repaired plans selected 17 test checks versus 10 before
the repair: 7 additional checks, 13 checks still skipped, 7 scenarios broadened,
10/10 scenarios still targeted, and zero FULL escalations. The ordinary static,
irrelevant-subprocess, and closed-boundary controls added zero checks.

Frozen-corpus replay produced:

| Corpus / arm | Prior selected | Repaired selected | Added | Still skipped | Repaired misses |
|---|---:|---:|---:|---:|---:|
| AV-EXP-001 AV_CORE | 1,640 | 1,640 | 0 | 600 | 0 |
| AV-EXP-001 AV_WITH_NATIVE | 1,640 | 1,640 | 0 | 600 | 0 |
| AV-EXP-002 AV_CORE | 19,459 | 19,465 | 6 | 2,711 | 0 |
| AV-EXP-002 AV_WITH_SELECTOR | 19,282 | 19,289 | 7 | 2,887 | 0 |

Units are test executions/checks within each frozen corpus arm. Non-test check
differences were zero. The repair is monotonic in these replays: it adds open-
boundary checks to historical AV selections and never removes a selected check.

## Visible Value and claim limits

Each plan receipt now reports `dependency_safety_checks_added` and
`dependency_safety_test_executions_added` as `EXACT`, alongside verification
selected and skipped. For AV2-006, “1 additional check selected” is exact and
“the known frozen regression check is now selected” is observed. This report
does not claim a general failure was prevented or that the system is safe.

Result identity:
`sha256:03b2f7d6a380c84f6a1749531067cf8b87404c879f42380de8f07cce48251519`.
Regression matrix identity:
`sha256:7260c2d3476a6e78323e75d36c54c8409ea4cb18fa3a8f9a76b5533e1df08615`.

## Opsle dogfooding

**ACTUAL OPSLE IMPLEMENTATION**: Affected Verification plan v2, SHADOW result
discipline, and `opsle.value-receipt.v1` ran. The released Visible Value
measurement classes constrained the claims and receipts.

**MANUAL APPROXIMATION**: frozen prior-corpus replay and the repair-regression
matrix approximate a future reusable replay/trajectory facility. No Agent
Trajectory Profiler implementation was claimed.

**NATIVE CODEX FACILITY**: isolated Git worktree, reviewed patch application,
deterministic shell verification, and Graphify code-relationship inspection.
No Codex child or external model/provider workload ran.

## Remaining limits

The inspector is a bounded static classifier, not universal dynamic analysis.
It does not close child-process boundaries, trace imports across processes, or
prove reflection/plugin behavior complete. Explicit project metadata may close
a detected boundary when provenance supports that claim; a future child-
process import tracer could be an evidence provider, but none was built here.

Exactly one next execution: preregister a bounded child-process import-tracing
evidence-provider experiment to test whether selected opaque checks can regain
precision without weakening the fail-closed rule.
