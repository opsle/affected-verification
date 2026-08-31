# Limitations and non-goals

- The reusable prototype still consumes normalized evidence. AV-EXP-001 adds one narrow benchmark-only Git/catalog/source-graph/Vitest adapter for pinned Zustand; it is not a general or production adapter.
- The component graph and catalog completeness flags are caller claims, not independently attested.
- The selection algorithm uses declared component scope and policy tags. It has no symbol/data-flow analysis, runtime coverage collection, weighted set cover, probabilistic model, or learned judgment.
- Commands are opaque identities. The project does not execute, schedule, cache, distribute, retry, or report CI work.
- `SUFFICIENT_*` means sufficient under the supplied model and policy, not globally safe, formally sound, or mathematically minimal.
- Full catalog selection cannot compensate for an incomplete catalog; that state remains `INSUFFICIENT_EVIDENCE`.
- AV-EXP-001 derives shadow relevance reproducibly from changed outcomes in its frozen full catalog. Other callers can still supply relevance, and one corpus does not validate every catalog or oracle.
- Test execution counts are declared catalog metadata. They are exact relative to input, not observed executions.
- One preregistered real-project shadow benchmark, comparative native arm, synthetic selection-miss corpus, and same-host deterministic replay exist. There is no second ecosystem, historical real-change replay, production-quality adapter, or independent qualifying replication.
- No production trust stage is justified. AV-EXP-001 remains `SHADOW`; any lifecycle promotion is bounded to the verified prototype and frozen benchmark evidence.
- No time, token, monetary, correctness, failure-prevention, or causal savings claim is supported.
- Context Firewall, Decision Evidence, Agent Trajectory Profiler, Gearbox, and Opsle Tasks are external consumers or validators, not dependencies.
