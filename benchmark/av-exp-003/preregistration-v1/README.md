# AV-EXP-003 immutable preregistration, revision 1

This directory freezes the repair question, dependency-completeness semantics,
boundary taxonomy, adversarial corpus, acceptance criteria, workload metrics,
and stop conditions before repair implementation or repaired benchmark outcomes.

The motivating outcome is not blinded: AV-EXP-002 permanently remains a FAIL.
Its frozen AV2-006 evidence already shows that both AV arms omitted
`pytest:tests/test_imports.py::test_light_imports` because ordinary static
Python evidence and pytest-testmon did not represent the subprocess/child-
interpreter import relationship. AV-EXP-003 does not rewrite, supersede,
delete, or reinterpret that result.

The preregistered repair is generalized. Core selection may not inspect a
repository name, experiment/scenario ID, changed filename, or check name. A
bounded Python adapter may describe real check semantics, but every boundary
classification must include deterministic provenance and an explanation.

FULL remains authoritative for the replay and every adversarial scenario.
Repaired plans remain proposals in `OBSERVE/SHADOW`; this experiment cannot
authorize `TRUSTED_BOUNDED`.

