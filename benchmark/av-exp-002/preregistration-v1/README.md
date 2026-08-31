# AV-EXP-002 immutable preregistration, revision 1

This directory freezes the target, toolchain, selector baseline contract,
complete local catalog, eleven-scenario corpus, exact patches, oracle, four
arms, policy, metrics, stop rules, and cross-experiment normalization before
comparative outcomes.

The target is `pallets/click` at
`36baa15ff831b939a22bc527cd76ce653ef6f66d`. pytest-testmon is an established
ecosystem selector, not a repository-native Click capability. Its arm is named
`ECOSYSTEM_SELECTOR` and remains tests-only.

The catalog adapter excludes stress-marked nodes exactly as Click's default
pytest configuration does. This is necessary because pytest-testmon documents
that `-m` disables affected selection. The adapter does not add policy checks
or non-test responsibilities to pytest-testmon.

FULL is authoritative. Every scenario still runs the complete frozen catalog.
The only relevance claim is “relevant within the frozen verification catalog.”
Revision 1 must not be rewritten after outcomes. A result-affecting harness
defect requires a preserved, versioned amendment.

## Bounded reproduction

Fetch Click so the exact commit exists, then invoke the reviewed repository
script with the local Click repository path:

```bash
./benchmark/av-exp-002/reproduce.sh \
  /path/to/click
```

The script validates identities, creates a detached target worktree, installs
from the frozen lock plus three exact benchmark-tool pins, trains the selector
database, runs three clean FULL repetitions, proposes all shadow arms before
each oracle, executes FULL for all scenarios, and verifies the semantic and raw
evidence manifests.
