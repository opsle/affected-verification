# AV-EXP-002 benchmark report

Experiment: **Cross-Ecosystem Minimum Defensible Verification Shadow
Calibration**

## Verdict and claim boundary

The controlled experiment completed, but the safety verdict is **FAIL**.
`AV_CORE` and `AV_WITH_SELECTOR_EVIDENCE` each omitted the same oracle-relevant
pytest node in `AV2-006`. FULL remained authoritative and exposed the miss.

The observed claim is limited to this pinned target, frozen catalog, and
eleven-scenario synthetic corpus. It does not establish general safety,
universal Python support, production readiness, optimality, or causal time or
cost savings. Trust remains `OBSERVE/SHADOW`.

## Provenance

- Starting Affected Verification release:
  `641aee9d29a89e2a8819f00817ccee8e5d234dcb`
- Preregistration commit:
  `f8a183c460535f3352fad2fb4990b0c54818d623`
- Results commit:
  `5d126e0ae17557065b55ab84a46f6a3577a49989`
- Target: `https://github.com/pallets/click.git`
- Target commit: `36baa15ff831b939a22bc527cd76ce653ef6f66d`
- License: BSD-3-Clause
- Catalog:
  `sha256:28ed20abf60e7c785052308298dc6ed647b7a20a737513e8fb3c76aa62d9094c`
- Corpus:
  `sha256:d5bc43405a5ab0ac34feef6d5fd5df111eace7f1a355400f963f8a7d4399640b`
- Baseline:
  `sha256:0b2117b1448acc7e3a12cad1ce480bcd028576bd564cc0da05c7005d090def32`
- Result:
  `sha256:5b3f99bfbebd3a0d061651d66adfb5a6aaef899475c6267cb20e4040e6ed5768`
- Evidence bundle:
  `sha256:435d8e5356ed6868edfc1747523ff75d1b327389bf14cc2675e867e45f4de705`
- Cross-experiment observation:
  `sha256:6ac2695ee80c9cb711e756846dad4c7138a3177c11d733456636259c36948da0`

The original preregistration was pushed before comparative execution and was
not rewritten. Five amendments preserve stopped attempts and repair report
directory creation, pytest/Pyright reporting, catalog-to-planner coverage,
new-path identity, and selector-state exclusion. The only attempt that reached
scenario outcomes before stopping preserved the `AV2-006` miss; no amendment
changed target, corpus, patches, oracle, arms, policy, or analysis rules in
response to that result.

## Target selection and baseline

Selection occurred before comparative outcomes. Click was selected from three
credible Python candidates because it combined a locked environment, broad
project-defined local catalog, fast complete execution, and working
pytest-testmon integration without services or credentials. cattrs was
rejected because its clean test path took 150.69 seconds and typing was
host-version conditional. HTTPX was rejected after 1,418 nodes collected but
no tests executed in 102.34 seconds, and its project dependencies were not
fully locked. Exact candidate SHAs and observations are in
`preregistration-v1/candidate-evaluation.md`.

The host was Linux x86-64 with CPython 3.13.15 and uv 0.12.5. Frozen tools
included pytest 9.0.2, pytest-testmon 2.2.0, Ruff 0.15.9, mypy 1.20.0,
Pyright 1.1.408, Sphinx 9.1.0, and build 1.3.0. The complete catalog contained
2,024 checks: 2,016 non-stress pytest nodes in 34 files plus Ruff lint, Ruff
format, mypy, Pyright, package build, documentation build, lock validation,
and pytest collection.

All three clean repetitions passed the same 2,016 pytest nodes and eight
non-test checks with the same semantic identity. No flake was observed.
Complete-catalog wall time was 20.471–21.974 seconds (`OBSERVED`), obtained by
summing the separately recorded catalog timings; it is telemetry, not a
counterfactual saving.

pytest-testmon is an ecosystem selector, not a Click-native capability. Its
database was trained from the exact clean target and content-addressed. Click's
default `-m 'not stress'` disables testmon selection by documented testmon
behavior, so the frozen catalog hook excluded the same stress nodes without a
marker expression. The asymmetry is recorded in the preregistration.

## Corpus and oracle

Eleven frozen scenarios include isolated, direct, shared/transitive, test-only,
public-interface typing, lint, package metadata, multi-file, dynamic plugin,
unknown new source, and conftest/configuration changes. They comprise
synthetic faults, a benign synthetic change, and explicit uncertainty cases.

For each scenario, selection was frozen before FULL ran. The oracle is the set
of catalog checks whose clean PASS changed to scenario FAIL. The claim is only
**relevant within the frozen verification catalog**; it is not complete
semantic correctness.

## Safety result

| Arm | Relevant | Selected | Missed | Scenario misses | Full broadening |
|---|---:|---:|---:|---:|---:|
| FULL | 87 | 87 | 0 | 0 | n/a |
| ECOSYSTEM_SELECTOR | 87 | 77 | 10 | 7 | 0 |
| AV_CORE | 87 | 86 | 1 | 1 | 6 |
| AV_WITH_SELECTOR_EVIDENCE | 87 | 86 | 1 | 1 | 5 |

Every observed miss:

- `ECOSYSTEM_SELECTOR`, `AV2-004`: `check:format`, outside the test-only
  selector contract.
- `ECOSYSTEM_SELECTOR`, `AV2-005`: `check:mypy`, outside contract.
- `ECOSYSTEM_SELECTOR`, `AV2-006`: `check:lint`, outside contract.
- `ECOSYSTEM_SELECTOR`, `AV2-006`:
  `pytest:tests/test_imports.py::test_light_imports`, dependency-evidence miss.
- `ECOSYSTEM_SELECTOR`, `AV2-007`: `check:build`, outside contract.
- `ECOSYSTEM_SELECTOR`, `AV2-008`: `check:format`, outside contract.
- `ECOSYSTEM_SELECTOR`, `AV2-009`: `check:mypy`, outside contract.
- `ECOSYSTEM_SELECTOR`, `AV2-010`: `check:format`, `check:lint`, and
  `check:mypy`, all outside contract.
- `AV_CORE`, `AV2-006`:
  `pytest:tests/test_imports.py::test_light_imports`, planner/adapter miss.
- `AV_WITH_SELECTOR_EVIDENCE`, `AV2-006`: the same pytest node,
  planner/adapter miss.

The fault added a disallowed runtime import to `src/click/parser.py`. The
relevant test launches a subprocess, instruments Python imports, and imports
the public `click` package; neither the static import graph nor testmon linked
that behavior to the changed module. AV incorrectly declared dependency
evidence complete and gave the skip reason `OUTSIDE_TRANSITIVE_IMPACT_SET`.
Selector evidence could not repair a test the selector also omitted. This is
not evidence of a testmon contract defect.

Fail-closed behavior did work elsewhere. `AV2-010` combined an unknown new
source path with missing selector state, and `AV2-011` changed conftest; both AV
arms required FULL with uncertainty present. In `AV2-009`, runtime selector
evidence compensated for static dynamic-plugin uncertainty: `AV_CORE`
broadened to FULL while `AV_WITH_SELECTOR_EVIDENCE` selected 1,839 nodes and
all three oracle-relevant checks.

## Workload result

These are exact proposal counts over eleven scenarios. Each scenario has
2,016 available pytest nodes, 34 test files, and one check in each non-test
class. Counts across unlike classes are not combined into one percentage.

| Arm | Pytest nodes selected / available | Nodes skipped | Test files selected / available | Files skipped |
|---|---:|---:|---:|---:|
| FULL | 22,176 / 22,176 | 0 (0.00%) | 374 / 374 | 0 (0.00%) |
| ECOSYSTEM_SELECTOR | 6,385 / 22,176 | 15,791 (71.21%) | 134 / 374 | 240 (64.17%) |
| AV_CORE | 19,459 / 22,176 | 2,717 (12.25%) | 329 / 374 | 45 (12.03%) |
| AV_WITH_SELECTOR_EVIDENCE | 19,282 / 22,176 | 2,894 (13.05%) | 326 / 374 | 48 (12.83%) |

| Non-test class | FULL | ECOSYSTEM_SELECTOR | AV_CORE | AV_WITH_SELECTOR_EVIDENCE |
|---|---:|---:|---:|---:|
| Format | 11 / 11 | 0 / 11 | 11 / 11 | 11 / 11 |
| Lint | 11 / 11 | 0 / 11 | 11 / 11 | 11 / 11 |
| Test infrastructure | 11 / 11 | 0 / 11 | 11 / 11 | 11 / 11 |
| mypy | 11 / 11 | 0 / 11 | 10 / 11 | 10 / 11 |
| Pyright | 11 / 11 | 0 / 11 | 10 / 11 | 10 / 11 |
| Docs build | 11 / 11 | 0 / 11 | 6 / 11 | 5 / 11 |
| Lock validation | 11 / 11 | 0 / 11 | 6 / 11 | 5 / 11 |
| Package build | 11 / 11 | 0 / 11 | 6 / 11 | 5 / 11 |

Every AV skip has an evidence reference, policy state, and uncertainty state.
Conformance tests reject a targeted plan containing an unexplained skip. The
counts demonstrate proposed workload omission, not safety or causal savings;
the observed AV miss prevents a positive sufficiency conclusion.

## Cross-ecosystem interpretation

Concepts that generalized unchanged were the frozen catalog abstraction,
content-bound evidence, policy escalation, per-skip explanation, explicit
uncertainty, FULL fallback, shadow oracle, and Visible Value receipt. The
normalized model represented Python checks without changing the core plan
schema.

Ecosystem-specific work remained material: Python AST/import extraction,
pytest node identities, conftest/fixture treatment, the stress-node catalog
adapter, testmon database lifecycle, dynamic imports, subprocess imports, and
runtime plugin discovery. This is not a universal Python adapter.

AV-EXP-001's most important failed assumption was that a syntactically complete
static import graph plus native selector evidence was adequate to label impact
evidence complete. Python runtime and subprocess behavior disproved that in
`AV2-006`. Unlike AV-EXP-001's 8/8 AV result, AV-EXP-002 observed 86/87. The
experiments are not aggregated into a general recall claim; Vitest files,
pytest nodes, cross-ecosystem wall time, and unlike non-test classes remain
non-comparable.

## Reproduction, Opsle use, and lifecycle

The bounded reproduction entrypoint is:

```bash
./benchmark/av-exp-002/reproduce.sh \
  /path/to/pallets-click
```

It validates the pinned target and environment, trains selector state, runs all
four arms in shadow, executes FULL, emits the semantic identities, and verifies
the bundle. `verify-results.mjs` independently rejected tampering in the
published result. Operational timing is intentionally excluded from semantic
identity.

Actual Opsle implementations exercised: Affected Verification planning and
validation, shadow observation, Visible Value receipts, and receipt
validation. Manual approximations: Context Firewall-style raw/summary
separation and Decision Evidence-style content bindings; their separate
runtimes were not invoked. Native Codex facilities: one interactive session,
shell execution, Git, and patch editing. No child agents, Gearbox, Agent
Trajectory Profiler, Tasks runtime, external model, or provider workload was
used.

Lifecycle remains `VERIFIED`; trust remains `OBSERVE/SHADOW`. The substantive
selection miss, synthetic corpus, single target, benchmark-only adapters, and
lack of historical replay or independent qualifying replication prevent any
higher claim. Exactly one next execution: **selection-miss repair**. It must be
separately preregistered and is not begun here.
