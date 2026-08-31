const components = [
  { id: 'docs', dependencies: [] },
  { id: 'isolated', dependencies: [] },
  { id: 'isolated-tests', dependencies: [] },
  { id: 'feature', dependencies: [] },
  { id: 'consumer', dependencies: ['feature'] },
  { id: 'shared', dependencies: [] },
  { id: 'subsystem-a', dependencies: ['shared'] },
  { id: 'subsystem-b', dependencies: ['shared'] },
  { id: 'global-config', dependencies: [] },
  { id: 'auth', dependencies: ['shared'] },
  { id: 'database', dependencies: [] },
  { id: 'test-infrastructure', dependencies: [] },
  { id: 'unrelated', dependencies: [] },
];

const codeComponents = components
  .map((item) => item.id)
  .filter((id) => !['docs', 'global-config', 'unrelated'].includes(id));

const checks = [
  { id: 'docs.validate', type: 'documentation', command: 'node tools/docs-check.js', scope: { components: ['docs'] }, tags: ['documentation'], test_executions: 0 },
  { id: 'config.validate', type: 'build', command: 'node tools/config-check.js', scope: { components: ['global-config'] }, tags: ['global'], test_executions: 0 },
  { id: 'isolated.unit', type: 'unit-test', command: 'node --test tests/isolated.test.js', scope: { components: ['isolated'] }, tags: ['direct'], test_executions: 14 },
  { id: 'isolated.test-file', type: 'unit-test', command: 'node --test tests/isolated.test.js', scope: { components: ['isolated-tests'] }, tags: ['test-change'], test_executions: 1 },
  { id: 'feature.unit', type: 'unit-test', command: 'node --test tests/feature.test.js', scope: { components: ['feature'] }, tags: ['direct'], test_executions: 6 },
  { id: 'consumer.integration', type: 'integration-test', command: 'node --test tests/consumer.test.js', scope: { components: ['consumer'] }, tags: ['dependent'], test_executions: 4 },
  { id: 'shared.unit', type: 'unit-test', command: 'node --test tests/shared.test.js', scope: { components: ['shared'] }, tags: ['shared'], test_executions: 10 },
  { id: 'subsystem-a.integration', type: 'integration-test', command: 'node --test tests/subsystem-a.test.js', scope: { components: ['subsystem-a'] }, tags: ['subsystem'], test_executions: 8 },
  { id: 'subsystem-b.integration', type: 'integration-test', command: 'node --test tests/subsystem-b.test.js', scope: { components: ['subsystem-b'] }, tags: ['subsystem'], test_executions: 8 },
  { id: 'auth.unit', type: 'unit-test', command: 'node --test tests/auth.test.js', scope: { components: ['auth'] }, tags: ['security-boundary'], test_executions: 5 },
  { id: 'auth.security', type: 'security', command: 'node tools/security-check.js', scope: { components: ['auth'] }, tags: ['security-boundary'], test_executions: 0 },
  { id: 'database.schema', type: 'schema', command: 'node tools/schema-check.js', scope: { components: ['database'] }, tags: ['migration'], test_executions: 0 },
  { id: 'database.migration', type: 'migration', command: 'node tools/migration-check.js', scope: { components: ['database'] }, tags: ['migration'], test_executions: 0 },
  { id: 'database.integration', type: 'integration-test', command: 'node --test tests/migration.test.js', scope: { components: ['database'] }, tags: ['migration'], test_executions: 7 },
  { id: 'test-infrastructure.self', type: 'test-infrastructure', command: 'node --test tests/harness.test.js', scope: { components: ['test-infrastructure'] }, tags: ['test-infrastructure'], test_executions: 0 },
  { id: 'project.typecheck', type: 'typecheck', command: 'node tools/typecheck.js', scope: { components: codeComponents }, tags: ['code-quality'], test_executions: 0 },
  { id: 'project.lint', type: 'lint', command: 'node tools/lint.js', scope: { components: codeComponents }, tags: ['code-quality'], test_executions: 0 },
  { id: 'release.smoke', type: 'smoke', command: 'node tools/smoke.js', scope: { components: ['consumer', 'auth', 'database'] }, tags: ['release'], test_executions: 0 },
  { id: 'unrelated.large-suite', type: 'end-to-end-test', command: 'node --test tests/unrelated/**/*.test.js', scope: { components: ['unrelated'] }, tags: ['unrelated'], test_executions: 1029 },
];

const rules = [
  { id: 'global-configuration', match: { path_globs: ['config/**'], risk_tags: [], component_ids: [] }, escalation: 'FULL', required_check_tags: [] },
  { id: 'security-boundary', match: { path_globs: [], risk_tags: ['security-boundary'], component_ids: [] }, escalation: 'BROADEN', required_check_tags: ['security-boundary'] },
  { id: 'database-migration', match: { path_globs: [], risk_tags: ['migration'], component_ids: [] }, escalation: 'BROADEN', required_check_tags: ['migration'] },
  { id: 'shared-boundary', match: { path_globs: [], risk_tags: [], component_ids: ['shared'] }, escalation: 'BROADEN', required_check_tags: ['subsystem'] },
  { id: 'verification-metadata', match: { path_globs: ['verification/**'], risk_tags: [], component_ids: [] }, escalation: 'INVALIDATE', required_check_tags: [] },
];

function input({ path, component, riskTags = [], complete = true, confidence = 'KNOWN', target }) {
  const checkDependencies = checks.map((check) => ({
    check_id: check.id,
    completeness: 'COMPLETE_FOR_CHECK',
    mechanisms: [{ kind: 'DECLARED_SCOPE', evidence_refs: ['synthetic-graph'], positive: false }],
    boundaries: [],
    explanation: 'Synthetic fixture declares complete check-local scope coverage.',
  }));
  return {
    schema: 'opsle.affected-verification.input.v2',
    change: {
      base_revision: 'base000000000000000000000000000000000000',
      target_revision: target,
      paths: [{ path, regions: [], risk_tags: riskTags }],
    },
    evidence: {
      identity: `evidence:${target}`,
      complete,
      providers: [{ id: 'synthetic-graph', kind: 'NORMALIZED_FIXTURE', version: '1.0.0', identity: 'sha256:fixture-provider' }],
      components,
      impacts: [{ path, components: component ? [component] : [], confidence, reason: confidence === 'KNOWN' ? 'Synthetic path ownership' : 'No defensible owner mapping' }],
      check_dependencies: checkDependencies,
    },
    catalog: { identity: 'catalog:synthetic-v1', complete: true, checks },
    policy: { identity: 'policy:synthetic-v1', version: '1.0.0', rules },
  };
}

const largeSkipInput = input({
  path: 'src/isolated-large.js',
  component: 'isolated',
  target: 'target-large-skip',
});
largeSkipInput.catalog = {
  identity: 'catalog:synthetic-large-suite-v1',
  complete: true,
  checks: checks.filter((check) => [
    'isolated.unit',
    'project.lint',
    'project.typecheck',
    'unrelated.large-suite',
  ].includes(check.id)),
};
largeSkipInput.evidence.check_dependencies = largeSkipInput.evidence.check_dependencies
  .filter((item) => largeSkipInput.catalog.checks.some((check) => check.id === item.check_id));

export const scenarios = [
  {
    id: 'readme-only',
    description: 'README-only change selects documentation validation and no code regression suite.',
    expected_sufficiency: 'SUFFICIENT_TARGETED',
    input: input({ path: 'README.md', component: 'docs', target: 'target-readme' }),
  },
  {
    id: 'isolated-implementation',
    description: 'Isolated implementation change selects direct tests and code checks.',
    expected_sufficiency: 'SUFFICIENT_TARGETED',
    input: input({ path: 'src/isolated.js', component: 'isolated', target: 'target-isolated' }),
  },
  {
    id: 'reverse-dependent',
    description: 'Feature change selects feature and reverse-dependent consumer verification.',
    expected_sufficiency: 'SUFFICIENT_TARGETED',
    input: input({ path: 'src/feature.js', component: 'feature', target: 'target-dependent' }),
  },
  {
    id: 'shared-common',
    description: 'Shared module change broadens through multiple dependent subsystems.',
    expected_sufficiency: 'SUFFICIENT_BROADENED',
    input: input({ path: 'src/shared.js', component: 'shared', target: 'target-shared' }),
  },
  {
    id: 'global-configuration',
    description: 'Global configuration policy requires the full catalog.',
    expected_sufficiency: 'FULL_VERIFICATION_REQUIRED',
    input: input({ path: 'config/runtime.json', component: 'global-config', riskTags: ['global'], target: 'target-config' }),
  },
  {
    id: 'authentication-boundary',
    description: 'Authentication change triggers security-policy broadening.',
    expected_sufficiency: 'SUFFICIENT_BROADENED',
    input: input({ path: 'src/auth/session.js', component: 'auth', riskTags: ['security-boundary'], target: 'target-auth' }),
  },
  {
    id: 'database-migration',
    description: 'Migration change selects schema, migration, and integration checks.',
    expected_sufficiency: 'SUFFICIENT_BROADENED',
    input: input({ path: 'migrations/0042.sql', component: 'database', riskTags: ['migration'], target: 'target-db' }),
  },
  {
    id: 'incomplete-dependency-graph',
    description: 'Incomplete graph cannot claim targeted sufficiency and fails closed to the full catalog.',
    expected_sufficiency: 'FULL_VERIFICATION_REQUIRED',
    input: input({ path: 'src/isolated.js', component: 'isolated', complete: false, target: 'target-incomplete' }),
  },
  {
    id: 'unknown-changed-file',
    description: 'Unknown path ownership conservatively requires the full catalog.',
    expected_sufficiency: 'FULL_VERIFICATION_REQUIRED',
    input: input({ path: 'mystery/generated.xyz', component: null, confidence: 'UNKNOWN', target: 'target-unknown' }),
  },
  {
    id: 'test-file-only',
    description: 'Test-only change selects the corresponding test-specific check.',
    expected_sufficiency: 'SUFFICIENT_TARGETED',
    input: input({ path: 'tests/isolated.test.js', component: 'isolated-tests', riskTags: ['test-only'], target: 'target-test' }),
  },
  {
    id: 'unrelated-large-suite',
    description: 'Fourteen related test executions are selected while 1,029 unrelated executions are defensibly skipped.',
    expected_sufficiency: 'SUFFICIENT_TARGETED',
    input: largeSkipInput,
  },
  {
    id: 'critical-verification-metadata',
    description: 'Changing the catalog invalidates a plan based on that catalog.',
    expected_error: 'PLAN_INVALIDATED',
    input: input({ path: 'verification/catalog.json', component: 'test-infrastructure', target: 'target-metadata' }),
  },
];

export function fixture(id) {
  return structuredClone(scenarios.find((item) => item.id === id)?.input);
}
