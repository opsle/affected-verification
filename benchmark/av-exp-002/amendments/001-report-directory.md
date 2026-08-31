# AV-EXP-002 amendment 001: create report directory before pytest

Status: methodology repair before comparative outcomes.

The first post-preregistration attempt stopped during the frozen-catalog
preflight. `pytest_av_catalog.py` was instructed to write its machine report
under `results-v1/raw/preflight`, but `run.mjs` created that directory only
after pytest returned, while persisting stdout and stderr. Pytest collected the
catalog and then raised `FileNotFoundError` from the report hook. Exit 1 was
rejected by the preflight gate. No clean baseline, selector database, scenario
patch, benchmark arm, or oracle result executed.

Preserved evidence is under
`attempts/harness-defect-001/raw/preflight/`. The execution record reports exit
1 and binds stdout and stderr. The stderr contains the exact missing report
path and traceback.

Repair:

- create the scenario raw directory before starting pytest;
- set `PYTHONDONTWRITEBYTECODE=1` for the external pytest adapter so execution
  does not create generated cache files in this repository;
- make no change to the target, catalog, corpus, patches, oracle, arms, policy,
  metrics, selector baseline, analysis rules, or trust stage.

The original preregistration commit `f8a183c` remains immutable. This amendment
does not interpret or respond to comparative outcomes because none existed.
