# Amendment 005: Selector State Exclusion

## Preserved preregistration

The immutable preregistration remains commit
`f8a183c` and is not rewritten.

## Observed harness defect

After Amendment 004, the strict changed-path identity check treated the
pytest-testmon working database `.testmondata` as a scenario change. The first
scenario stopped before selector execution, AV planning, or the FULL oracle.
Three clean baseline repetitions and selector baseline training had completed.

## Methodology repair

The change-set adapter now excludes only `.testmondata`, the separately
identity-bound selector working state. Other untracked paths remain visible so
the preregistered unknown/new-source-path scenario is represented correctly.

No target, catalog, corpus, patch, oracle rule, benchmark arm, AV policy,
analysis rule, or previously observed AV miss is changed.
