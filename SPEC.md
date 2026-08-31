# Affected Verification specification

Status: normative prototype contract
Plan identity: `opsle.affected-verification.plan.v2`
Input identity: `opsle.affected-verification.input.v2`

## 1. Canonical definition

Affected Verification deterministically selects the smallest verification workload whose sufficiency can be defended from the available change-impact, dependency, coverage, policy, and risk evidence.

“Smallest” is bounded by the normalized evidence and configured policy. This contract rejects the universal claim that a planner can prove the mathematically minimum number of checks needed for every program and change.

## 2. Inputs

One input object contains:

- a base revision, target revision, and nonempty changed-path list, with optional changed regions and explicit risk tags;
- versioned evidence providers, a component dependency graph, path-to-component impact claims, an explicit graph-completeness bit, and one check-level dependency-completeness assessment per catalog check;
- a complete-or-incomplete verification catalog;
- an identified, versioned policy containing deterministic matching and escalation rules.

A verification catalog entry has a stable check ID, check type, literal command identity, component scope, tags, and a nonnegative integer count of test executions when the entry is a test check. Optional cost metadata is descriptive only in v1 and never drives selection.

Each check-level assessment declares mechanisms, boundary records, evidence references, provenance, an explanation, and one of `COMPLETE_FOR_CHECK`, `COMPLETE_WITH_DECLARED_BOUNDARIES`, `INCOMPLETE`, `OPAQUE_BOUNDARY`, or `UNKNOWN`. Evidence agreement is separate from evidence completeness. Git, Nx, Turbo, Jest, Vitest, testmon, coverage, CODEOWNERS, schema tools, and source-graph integrations belong in replaceable adapters that produce this normalized format.

## 3. Verification is broader than tests

V2 recognizes unit, integration, end-to-end, lint, typecheck, build, compiler, schema, migration, API-contract, security, snapshot, visual, smoke, release, documentation, and test-infrastructure checks, plus an explicit `other` type. A check is an indivisible catalog entry. The planner does not schedule or execute it.

## 4. Deterministic planning

For valid input, the reference planner:

1. maps known changed paths to directly affected components;
2. walks reverse dependencies to a fixed point;
3. matches identified policy rules;
4. selects checks whose declared scope intersects the affected closure;
5. adds all checks carrying tags required by matched policy rules and refuses sufficiency if any required tag has no catalogued check;
6. selects a check when positive evidence identifies it or its dependency completeness is `INCOMPLETE`, `OPAQUE_BOUNDARY`, or `UNKNOWN`;
7. broadens to the complete catalog when global impact is unknown or incomplete;
8. skips only checks whose dependency mechanisms and boundaries are complete enough for that decision;
9. hashes canonical input and canonical plan content with SHA-256.

Inputs, checks, providers, rules, components, dependencies, selections, skips, and reasons are sorted where order is not semantic. The same input yields byte-equivalent canonical output and the same plan identity.

V2 does not solve weighted set cover and does not choose among alternative commands. If a future catalog expresses equally sufficient alternatives, its policy must define a deterministic tie-break or the planner must report ambiguity. It must not silently use ambient timing or model judgment.

## 5. Sufficiency and escalation states

`SUFFICIENT_TARGETED`
: Complete impact and catalog evidence supports the targeted selection and every affected component has catalog coverage.

`SUFFICIENT_BROADENED`
: The targeted closure is complete, but matched risk or policy rules add verification beyond direct scope.

`FULL_VERIFICATION_REQUIRED`
: A matched policy requires all catalogued checks, or incomplete/unknown impact makes targeted sufficiency indefensible and the catalog is declared complete.

`INSUFFICIENT_EVIDENCE`
: Even selecting every known check cannot establish sufficiency, including when the verification catalog is incomplete or an affected component has no catalog coverage.

`INVALID_INPUT`
: The input is malformed, contradictory, numerically impossible, references unknown entities, duplicates identity-bearing evidence, or is invalidated by policy. CLI errors use `opsle.affected-verification.error.v1`, exit 2, and emit no success indicator or value receipt. Policy invalidation uses the more specific code `PLAN_INVALIDATED` while retaining the `INVALID_INPUT` semantics.

The invariants are `UNKNOWN != SAFE TO SKIP` and `NO PROOF OF COMPLETENESS != PROOF OF NO DEPENDENCY`. Unknown or incomplete global impact selects the full known catalog. Unknown, incomplete, or opaque evidence local to one otherwise unrelated check selects that check; it does not imply FULL unless catalog or policy evidence independently requires it.

## 6. Selection and skip arguments

Every selected check contains one or more reason records with a stable code, exact detail, and evidence references. Every skipped check must do the same and expose a complete check-level dependency argument. V2 emits `OUTSIDE_TRANSITIVE_IMPACT_SET` only when scope misses the complete affected closure, no matched policy requires the check, and dependency completeness independently permits the skip.

“Not selected” is not a reason. An implementation must fail conformance if a skipped check has no reason.

## 7. Plan contract

The plan contains:

- schema and deterministic plan identity;
- base, target, change identity, paths, and supported changed regions;
- input, evidence, catalog, policy, and provider identities;
- direct and reverse-dependent affected components;
- check-level mechanisms, boundaries, completeness, evidence coverage, provenance, action, and forced-selection state;
- selected and skipped checks with rationale;
- risk tags and matched policy rules;
- uncertainty and escalation states;
- sufficiency classification and the bounded claim.

The exact structural profile is [schemas/plan-v2.schema.json](schemas/plan-v2.schema.json). Plan v1 remains historical and is not rewritten. `plan_identity` is SHA-256 over canonical plan content with that field omitted. `change.identity` is caller supplied or deterministically derived. Provider identities are recorded, not independently attested.

## 8. Visible Value

The planner can emit an `opsle.value-receipt.v1` sidecar. Exact measurements are catalog checks available, selected, and skipped; declared test executions available, selected, and skipped; and the rational test-execution reduction. Unlike verification types are not collapsed into a workload percentage. Counts are planning output, not observed execution.

The receipt also reports exact check and test-execution additions caused by dependency-safety forced selection. It explicitly makes no time, token, cost, correctness, failure-prevention, or causal savings claim. Canonical plan JSON stays on stdout and the named operator indicator stays on stderr.

## 9. Failure behavior and compatibility

Unknown fields are rejected in the normalized input. Duplicate provider, component, impact, check, rule, executed-check, or failure identities are rejected. Unknown graph edges, scopes, and shadow checks are rejected. Negative, noninteger, unsafe-integer, nonfinite, or semantically incompatible numeric values are rejected. Nonempty matcher dimensions within one policy rule compose conjunctively; values inside one dimension are alternatives.

Compatibility is exact by schema identity. Plan/input v2 is the opaque-boundary safety repair; v1 artifacts remain immutable historical evidence. No external package or repository is a runtime dependency.
