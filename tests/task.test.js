import test from 'node:test';
import assert from 'node:assert/strict';
import { planTaskVerification } from '../src/index.js';

function request(paths = [{ path: 'src/a.js', regions: [], risk_tags: [] }]) {
  const dependency = {
    completeness: 'COMPLETE_FOR_CHECK',
    mechanisms: [{ kind: 'DECLARED_SCOPE', positive: false }],
    boundaries: [],
    explanation: 'The base manifest declares complete scope for this check.',
  };
  return {
    schema: 'opsle.affected-verification.task-request.v1',
    task: { id: 'task-7', execution_id: 'task-7-attempt-11' },
    repository: { identity: 'https://github.com/example/repo.git', base_revision: 'base', target_revision: 'tree:target' },
    change: { identity: 'sha256:change', paths },
    manifest: {
      schema: 'opsle.affected-verification.manifest.v1',
      source_path: '.opsle/affected-verification.json',
      source_identity: 'sha256:manifest',
      evidence_complete: true,
      catalog_complete: true,
      components: [
        { id: 'a', dependencies: [], path_globs: ['src/a.js'], risk_tags: [] },
        { id: 'b', dependencies: ['a'], path_globs: ['src/b.js'], risk_tags: [] },
        { id: 'unrelated', dependencies: [], path_globs: ['src/unrelated.js'], risk_tags: [] },
      ],
      checks: [
        { id: 'a.test', type: 'unit-test', command: 'node --test a.test.js', scope: { components: ['a'] }, tags: [], test_executions: 1, dependency },
        { id: 'b.test', type: 'integration-test', command: 'node --test b.test.js', scope: { components: ['b'] }, tags: [], test_executions: 1, dependency },
        { id: 'unrelated.test', type: 'unit-test', command: 'node --test unrelated.test.js', scope: { components: ['unrelated'] }, tags: [], test_executions: 1, dependency },
      ],
      policy: { version: '1', rules: [] },
    },
  };
}

test('task contract maps exact changed paths and reverse dependents to executable guidance', () => {
  const decision = planTaskVerification(request());
  assert.equal(decision.schema, 'opsle.affected-verification.task-plan.v1');
  assert.deepEqual(decision.impacts[0].components, ['a']);
  assert.deepEqual(decision.plan.affected_components.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(decision.plan.selected_checks.map((item) => item.id), ['a.test', 'b.test']);
  assert.deepEqual(decision.plan.skipped_checks.map((item) => item.id), ['unrelated.test']);
});

test('task contract returns explicit uncertainty for an unowned changed path', () => {
  const decision = planTaskVerification(request([{ path: 'unknown.file', regions: [], risk_tags: [] }]));
  assert.equal(decision.plan.sufficiency, 'FULL_VERIFICATION_REQUIRED');
  assert.deepEqual(decision.plan.uncertainty.reasons, ['UNKNOWN_IMPACT:unknown.file']);
  assert.equal(decision.plan.skipped_checks.length, 0);
});

test('task contract represents a repository without automated checks', () => {
  const value = request([{ path: 'README.md', regions: [], risk_tags: [] }]);
  value.manifest.components = [{ id: 'docs', dependencies: [], path_globs: ['README.md'], risk_tags: ['documentation'] }];
  value.manifest.checks = [];
  const decision = planTaskVerification(value);
  assert.equal(decision.plan.sufficiency, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(decision.plan.selected_checks, []);
  assert.ok(decision.plan.uncertainty.reasons.includes('NO_VERIFICATION_COVERAGE:docs'));
});
