# Affected Verification

Affected Verification deterministically selects the smallest verification workload whose sufficiency can be defended from the available change-impact, dependency, coverage, policy, and risk evidence.

The operative claim is **minimum defensible verification**, not mathematical global minimality. Unknown impact is never permission to skip work.

This repository contains a dependency-free Node.js 20 prototype. It consumes normalized change, impact, verification-catalog, and policy data and emits an `opsle.affected-verification.plan.v1` argument containing selected checks, skipped checks, exact reasons, provenance hashes, uncertainty, escalation, and sufficiency. It plans work; it does not run CI.

## Try it

```bash
node bin/affected-verification.js \
  fixture unrelated-large-suite \
  --receipt /tmp/av-receipt.json
```

Canonical plan JSON is written to stdout. The `opsle.value-receipt.v1` is written only to the requested sidecar, and one `[Affected Verification]` indicator is written to stderr. The fixture reports exactly 14 of 1,043 test executions selected, 1,029 skipped, plus one lint and one typecheck; the test-execution reduction is an `EXACT` calculation, not a time, cost, token, or correctness claim.

```bash
npm run verify
```

## Contract and evidence

- [SPEC.md](SPEC.md) — normative prototype contract and sufficiency states
- [PRIOR_ART.md](PRIOR_ART.md) — source-linked reconciliation with existing selectors
- [ARCHITECTURE.md](ARCHITECTURE.md) — adapters, project boundaries, shadow mode, and trust ramp
- [BENCHMARK.md](BENCHMARK.md) — controlled research plan; no results are claimed
- [LIMITATIONS.md](LIMITATIONS.md) — current claim ceiling and non-goals
- [fixtures/scenarios.js](fixtures/scenarios.js) and [fixtures/negative-cases.js](fixtures/negative-cases.js) — twelve positive/boundary scenarios plus explicit conflicting, malformed, impossible, and tampered cases
- [schemas/plan-v1.schema.json](schemas/plan-v1.schema.json) — plan shape

## Status

This is a narrow research prototype, not a trusted replacement for full verification. It has not been benchmarked on a real repository, and it has no production adapters.

Apache-2.0.
