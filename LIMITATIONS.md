# Limitations and non-goals

- The reusable prototype still consumes normalized evidence. AV-EXP-001 and AV-EXP-002 add narrow benchmark-only adapters for pinned Zustand and Click; neither is a general or production adapter.
- The component graph and catalog completeness flags are caller claims, not independently attested.
- The selection algorithm uses declared component scope and policy tags. It has no symbol/data-flow analysis, runtime coverage collection, weighted set cover, probabilistic model, or learned judgment.
- Commands are opaque identities. The project does not execute, schedule, cache, distribute, retry, or report CI work.
- `SUFFICIENT_*` means sufficient under the supplied model and policy, not globally safe, formally sound, or mathematically minimal.
- Full catalog selection cannot compensate for an incomplete catalog; that state remains `INSUFFICIENT_EVIDENCE`.
- AV-EXP-001 and AV-EXP-002 derive shadow relevance reproducibly from changed outcomes in their frozen full catalogs. Other callers can still supply relevance, and two corpora do not validate every catalog or oracle.
- Test execution counts are declared catalog metadata. They are exact relative to input, not observed executions.
- Two preregistered real-project shadow benchmarks exist in JavaScript and Python. AV-EXP-002 exposed one AV miss for a runtime/subprocess import test that both the static graph and pytest-testmon omitted. There is no historical real-change replay, production-quality adapter, or independent qualifying replication.
- No production trust stage is justified. Both experiments remain `SHADOW`; AV-EXP-002's observed miss blocks a positive cross-ecosystem sufficiency claim.
- No time, token, monetary, correctness, failure-prevention, or causal savings claim is supported.
- Context Firewall, Decision Evidence, Agent Trajectory Profiler, Gearbox, and Opsle Tasks are external consumers or validators, not dependencies.
