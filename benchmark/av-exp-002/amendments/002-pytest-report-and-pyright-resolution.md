# AV-EXP-002 amendment 002: pytest report state and Pyright source resolution

Status: methodology repair during clean baseline qualification, before selector
training or comparative outcomes.

After Amendment 001, preflight succeeded and clean baseline repetition 1 ran.
The fail-closed stability gate rejected it for two adapter/invocation defects:

1. `pytest_runtest_logreport` tried to read `report.config`, but pytest 9's
   `TestReport` has no `config` attribute. Pytest raised an internal error and
   returned exit 3 after collection, before running tests.
2. Direct Pyright `--verifytypes click` did not resolve uv's editable source
   mapping and reported an empty package. Running the frozen command with
   `PYTHONPATH=<target>/src` resolved the same pinned source and returned the
   expected 100% type-completeness result.

The other clean checks (Ruff lint, Ruff format, mypy, build, docs, and lock)
passed. Preserved evidence is under `attempts/harness-defect-002/`. No selector
database, scenario patch, comparative arm, or oracle result executed.

Repair:

- store pytest outcomes in adapter module state initialized at session start;
- pass `PYTHONPATH=<target>/src` only to the frozen Pyright invocation;
- treat pytest exits other than 0 (clean) or 1 (test failures) as incomplete
  FULL execution and fail the collection/infrastructure check;
- make no change to target, test-node catalog, corpus, patches, arms, oracle,
  selection policy, metrics, analysis rules, or trust stage.

The original preregistration commit `f8a183c` remains immutable. This repair
responds only to clean-baseline harness evidence, not comparative outcomes.
