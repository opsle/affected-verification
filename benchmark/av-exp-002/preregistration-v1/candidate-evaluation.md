# AV-EXP-002 candidate evaluation

Selection occurred before any comparative scenario outcome. The criteria were
ecosystem difference, project-defined verification breadth, deterministic
setup, practical FULL execution, selector compatibility, and absence of
services or credentials. No candidate was ranked by expected AV performance.

| Candidate | Exact SHA | License | Runtime | Tests and clean observation | Locally relevant catalog | pytest-testmon | Setup | Decision |
|---|---|---|---|---|---|---|---|---|
| `pallets/click` | `36baa15ff831b939a22bc527cd76ce653ef6f66d` | BSD-3-Clause | Python >=3.10; observed CPython 3.13.15 | 2,016 active non-stress nodes; 1,991 passed, 24 skipped, 1 xfailed in 4.93 s (`OBSERVED`) | pytest, Ruff lint/format, mypy, Pyright, Sphinx docs, wheel/sdist build, lock validation | 2.2.0 loaded and trained successfully. The target's `-m 'not stress'` disables selection by documented contract, so a frozen hook performs the identical stress-node exclusion without `-m`. | `uv.lock`; `uv sync --locked`; no credentials/services | **Selected** because the complete catalog is broad, fast, pinned, and selector-compatible after a narrow catalog adapter. |
| `python-attrs/cattrs` | `f2e42f3c69dabd48dd1a5b8fb1aad9c1d39c339a` | MIT | Python >=3.10; observed CPython 3.13.15 | Project test path: 988 nodes; 973 passed, 15 xfailed in 150.69 s (`OBSERVED`). Unscoped pytest also included benchmarks and took 232.26 s. | pytest/hypothesis, Ruff, package checks, docs; typing is specially configured for CPython 3.14 | Plugin compatibility was plausible, but the much longer suite and version-conditional typing weakened the bounded comparison. | `uv.lock`, all extras required for complete collection | Rejected before benchmarking because repeated FULL plus selector training would be materially less practical and typing was host-version conditional. |
| `encode/httpx` | `b5addb64f0161ff6bfe94c124ef76f6a1fba5254` | BSD-3-Clause | Python >=3.9; observed CPython 3.14.7 | 1,418 nodes collected. A clean full run remained in session setup and executed no tests after 102.34 s, then was stopped (`OBSERVED`). | pytest/coverage, Ruff, mypy, package and docs build | Not advanced to database training after the practical clean-run gate failed. | Tools pinned in `requirements.txt`, but project dependencies intentionally resolve latest rather than from a lock | Rejected before benchmarking because clean FULL was not practical/stable enough and installation was not fully locked. |

The selected catalog's approximate one-shot clean wall time during
reconnaissance was under 20 seconds across tests, lint, format, both type
checkers, package build, docs build, and lock validation. The formal baseline
uses three fresh complete repetitions and supersedes this reconnaissance
estimate.
