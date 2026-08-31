# AV-EXP-001 benchmark amendment 003

Status: semantic-identity amendment after first complete shadow run

The first complete result bundle and an immediate second clean reproduction had
identical baseline pass states, normalized check outcomes, relevance sets,
selector selections, misses, workloads, planner version, and policy behavior.
Their semantic identities differed because the full-run command record included
the absolute Vitest `--outputFile` path. The published run wrote inside the
repository while the reproduction wrote under `/tmp`.

Amendment:

1. preserve exact commands and absolute output locators in raw execution
   evidence;
2. normalize only the semantic command token to `--outputFile=<artifact>`;
3. preserve the first complete bundle under
   `attempts/semantic-identity-defect-003/`;
4. publish the corrected benchmark revision as `results-v2/`;
5. rerun the complete baseline and scenario corpus, then run a second complete
   reproduction and require identical semantic baseline, scenario, analysis,
   and summary identities.

No target, catalog, selector, scenario, patch, oracle, metric, analysis, stop,
selection, workload, or trust rule changes. The first complete outcome remains
evidence but its path-dependent identities are superseded.

Amendment identity:
`sha256:44f420409b719b5ddfaac04928e215572873475c8d8e720e4755e043b878dfde`
