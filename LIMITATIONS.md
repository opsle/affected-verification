# Limitations and non-goals

- The reusable prototype still consumes normalized evidence. AV-EXP-001, AV-EXP-002, and AV-EXP-003 add narrow benchmark-only adapters and repair evidence; none is a general or production adapter.
- The component graph and catalog completeness flags are caller claims, not independently attested.
- The selection algorithm uses declared component scope and policy tags. It has no symbol/data-flow analysis, runtime coverage collection, weighted set cover, probabilistic model, or learned judgment.
- Commands are opaque identities. The project does not execute, schedule, cache, distribute, retry, or report CI work.
- `SUFFICIENT_*` means sufficient under the supplied model and policy, not globally safe, formally sound, or mathematically minimal.
- Full catalog selection cannot compensate for an incomplete catalog; that state remains `INSUFFICIENT_EVIDENCE`.
- AV-EXP-001 and AV-EXP-002 derive shadow relevance reproducibly from changed outcomes in their frozen full catalogs. Other callers can still supply relevance, and two corpora do not validate every catalog or oracle.
- Test execution counts are declared catalog metadata. They are exact relative to input, not observed executions.
- Two preregistered real-project shadow benchmarks exist in JavaScript and Python. AV-EXP-002 permanently remains a FAIL after exposing one runtime/subprocess import miss. AV-EXP-003 observed that plan v2 selects the known check and ten generalized repair cases, but does not erase the miss or solve dynamic dependencies generally.
- The bounded Python inspector detects a conservative subset of source-visible boundaries. It does not trace imports across child processes, prove plugin/reflection behavior, or infer closure without identified metadata.
- No production trust stage is justified. All experiments remain `SHADOW`; AV-EXP-003 is a defect repair and cannot authorize `TRUSTED_BOUNDED`.
- No time, token, monetary, correctness, failure-prevention, or causal savings claim is supported.
- Context Firewall, Decision Evidence, Agent Trajectory Profiler, Gearbox, and Opsle Tasks are external consumers or validators, not dependencies.
