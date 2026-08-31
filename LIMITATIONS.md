# Limitations and non-goals

- The prototype consumes synthetic normalized evidence; it has no Git, graph, coverage, ownership, schema, Nx, Turbo, Jest, Vitest, or testmon adapter.
- The component graph and catalog completeness flags are caller claims, not independently attested.
- The selection algorithm uses declared component scope and policy tags. It has no symbol/data-flow analysis, runtime coverage collection, weighted set cover, probabilistic model, or learned judgment.
- Commands are opaque identities. The project does not execute, schedule, cache, distribute, retry, or report CI work.
- `SUFFICIENT_*` means sufficient under the supplied model and policy, not globally safe, formally sound, or mathematically minimal.
- Full catalog selection cannot compensate for an incomplete catalog; that state remains `INSUFFICIENT_EVIDENCE`.
- Shadow relevance is caller supplied. A robust real benchmark needs an independent, reproducible relevance oracle.
- Test execution counts are declared catalog metadata. They are exact relative to input, not observed executions.
- No real-project benchmark, comparative baseline, selection-miss corpus, computation measurement, or independent reproduction exists.
- No production trust stage is justified. This repository is at most `PROTOTYPED`.
- No time, token, monetary, correctness, failure-prevention, or causal savings claim is supported.
- Context Firewall, Decision Evidence, Agent Trajectory Profiler, Gearbox, and Opsle Tasks are external consumers or validators, not dependencies.
