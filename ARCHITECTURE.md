# Architecture and boundaries

```text
change + normalized evidence + catalog + policy
                       |
                       v
          deterministic verification planner
                       |
                       v
     plan: selected + skipped + argument + state
                       |
        execution belongs to an external system
```

## Core and adapters

The core owns validation, reverse-impact closure, deterministic policy matching, fail-closed escalation, selection/skip arguments, canonical hashing, Visible Value planning counts, and shadow-result classification.

Adapters may translate Git diffs, package/project graphs, imports, coverage, test selectors, CODEOWNERS, schemas, or declared critical boundaries into normalized input. V1 implements no production adapter. This prevents the core from embedding Nx, Turbo, Jest, Vitest, testmon, or any one repository layout.

The verification catalog is the planner's universe. It is not a scheduler. Commands are opaque identities; the planner never shells out to them.

## Independence from Gearbox

Affected Verification owns the question: “What is the minimum defensible verification workload for this change under current evidence and policy?” Gearbox may ask that question and choose where or how to execute the returned work. Gearbox does not own the theory, catalog, or planner.

The prototype has no Gearbox dependency and is independently usable by people, coding agents, CI, PR bots, Opsle Tasks, or other tooling.

## Context Firewall boundary

Affected Verification decides **what should execute**. After execution, Context Firewall decides **what result should enter model context**. For example, the planner may require 17 of 1,000 tests; after those run, Context Firewall may retain only aggregate success plus one failure. Neither mechanism substitutes for the other.

## Decision Evidence and Trajectory boundaries

Decision Evidence may later validate change identity, evidence provenance, plan identity, selected/skip arguments, and execution-result bindings. Agent Trajectory Profiler may measure planned selections, actual executions, shadow comparisons, and observed latency/cost when genuinely recorded. V1 records compatible identities but creates no cross-repository package coupling.

## Shadow observations

`classifyShadow` first recomputes and verifies the plan identity, then compares a predicted plan with an externally supplied full-run record. Its durable observation binds:

- plan, change, policy, and planner schema identities;
- predicted selected and skipped check IDs;
- full-run executed IDs and failures;
- whether full execution was complete;
- relevant failures in skipped checks and their exact supplied reason;
- `SELECTION_MISS`, `NO_SELECTION_MISS`, or `INDETERMINATE_FULL_RUN_INCOMPLETE`.

A selection miss occurs only when a check omitted by the targeted plan fails in full execution and that failure is classified as relevant to the change. Relevance is an external oracle claim in v1; the classifier records it and does not infer causality.

No telemetry service exists. The fixture-level classifier proves the observation contract only.

## Trust ramp

`OBSERVE`
: Generate plans for inspection; existing verification remains authoritative.

`SHADOW`
: Generate targeted plans while full verification runs; retain complete, identity-bound miss observations.

`TRUSTED_BOUNDED`
: Permit targeted plans only for repository-specific low-risk classes whose impact/catalog completeness, policy behavior, miss history, oracle quality, and rollback path are defended.

`TRUSTED_POLICY`
: Extend authority to additional explicitly bounded classes only after their evidence is comparable and their promotion criteria are met.

Promotion depends on evidence quality and coverage, not an arbitrary run count. Critical/global classes may permanently require full verification. A miss, evidence drift, adapter change, catalog drift, policy change, or loss of shadow completeness can demote trust.
