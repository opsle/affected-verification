# AV-EXP-001 benchmark amendment 002

Status: harness-only amendment before comparative scenario execution

After amendment 001, three new clean baseline repetitions each completed all
17 catalog checks, passed 224 of 224 tests, and had no failed checks. The gate
still stopped before scenarios because the runner treated Vitest's
`numTotalTestSuites` as a test-file count. Vitest 4.1.10 reported 66 nested
suites and separately emitted 13 per-file `testResults`, matching the frozen
catalog.

Review of the same baseline artifacts also found that raw stdout/stderr hashes
were included in semantic full-run and benchmark-result identities. Raw reports
may contain observed timestamps or durations, so this violated the frozen rule
that semantic identities must not depend on timing.

Amendment:

1. derive the test-file count from normalized `testResults.length` and continue
   requiring exactly 13 frozen file outcomes and 224 test cases;
2. retain and hash raw output as observational evidence, but exclude raw
   evidence hashes from semantic full-run and benchmark-result identities;
3. continue binding command identities, exit states, normalized per-check
   outcomes, catalog, scenario, oracle, planner, policy, and selector identities;
4. retain this stopped baseline attempt under `attempts/harness-defect-002/`;
5. rerun three fresh clean baselines before any scenario.

This amendment does not change any target, catalog, selector, scenario, patch,
oracle, metric, analysis, or stop rule frozen at preregistration.

Amendment identity:
`sha256:51437d6c3bfdd1461a9679a5055ab5c34d9eb603ba95b67f86f8516f8b93a25e`
