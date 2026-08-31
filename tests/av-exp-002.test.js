import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TARGET_SHA,
  TESTMON_VERSION,
  TRUST_STAGE,
  validateExecutionEnvelope,
  validatePlanSkips,
  validateResultBundle,
} from '../benchmark/av-exp-002/lib.mjs';
import { contentIdentity, planVerification } from '../src/index.js';

function envelope() {
  return {
    target_sha: TARGET_SHA,
    python_version: '3.13.15', expected_python_version: '3.13.15',
    lock_identity: 'lock', expected_lock_identity: 'lock',
    testmon_version: TESTMON_VERSION,
    testmon_state: { well_formed: true, stale: false, baseline_sha: TARGET_SHA },
    catalog_identity: 'catalog', expected_catalog_identity: 'catalog',
    scenario_identity: 'scenario', expected_scenario_identity: 'scenario',
    oracle_revision: 'revision', scenario_revision: 'revision',
    conftest_identity: 'conftest', expected_conftest_identity: 'conftest',
    dynamic_uncertainty: false, runtime_evidence_complete: false,
    sufficiency: 'FULL_VERIFICATION_REQUIRED', trust_stage: TRUST_STAGE,
  };
}

const invalidCases = [
  ['wrong Python version', (v) => { v.python_version = '3.12.0'; }, 'PYTHON_VERSION_MISMATCH'],
  ['target SHA mismatch', (v) => { v.target_sha = 'bad'; }, 'TARGET_SHA_MISMATCH'],
  ['dependency lock drift', (v) => { v.lock_identity = 'bad'; }, 'DEPENDENCY_LOCK_DRIFT'],
  ['stale testmon state', (v) => { v.testmon_state.stale = true; }, 'STALE_TESTMON_STATE'],
  ['wrong testmon baseline', (v) => { v.testmon_state.baseline_sha = 'bad'; }, 'WRONG_TESTMON_BASELINE'],
  ['selector version mismatch', (v) => { v.testmon_version = '0.0.0'; }, 'SELECTOR_VERSION_MISMATCH'],
  ['malformed selector output', (v) => { v.testmon_state.well_formed = false; }, 'MALFORMED_SELECTOR_OUTPUT'],
  ['dynamic dependency uncertainty', (v) => { v.dynamic_uncertainty = true; v.sufficiency = 'SUFFICIENT_TARGETED'; }, 'DYNAMIC_DEPENDENCY_UNCERTAINTY'],
  ['conftest drift', (v) => { v.conftest_identity = 'bad'; }, 'CONFTEST_DRIFT'],
  ['catalog mismatch', (v) => { v.catalog_identity = 'bad'; }, 'CATALOG_MISMATCH'],
  ['scenario mismatch', (v) => { v.scenario_identity = 'bad'; }, 'SCENARIO_MISMATCH'],
  ['stale oracle', (v) => { v.oracle_revision = 'bad'; }, 'STALE_ORACLE'],
  ['unsafe trust promotion', (v) => { v.trust_stage = 'TRUSTED_BOUNDED'; }, 'UNSAFE_TRUST_PROMOTION'],
];

for (const [name, mutate, code] of invalidCases) {
  test(`AV-EXP-002 rejects ${name}`, () => {
    const value = envelope();
    mutate(value);
    assert.throws(() => validateExecutionEnvelope(value), (error) => error.code === code);
  });
}

test('AV-EXP-002 rejects unexplained skips', () => {
  assert.throws(() => validatePlanSkips({
    skipped_checks: [{ id: 'check:x', reasons: [] }],
    argument: { every_skip_explained: true },
  }), (error) => error.code === 'UNEXPLAINED_SKIP');
});

test('global collection integrity scope covers changed source without forcing every test', () => {
  const input = {
    schema: 'opsle.affected-verification.input.v2',
    change: {
      base_revision: 'base', target_revision: 'patch',
      paths: [{ path: 'src/pkg.py', regions: [], risk_tags: [] }],
    },
    evidence: {
      identity: 'evidence', complete: true,
      providers: [{ id: 'ast', kind: 'python-imports', version: '1', identity: 'graph' }],
      components: [
        { id: 'file:src/pkg.py', dependencies: [] },
        { id: 'testnode:related', dependencies: ['file:src/pkg.py'] },
        { id: 'testnode:unrelated', dependencies: [] },
      ],
      impacts: [{ path: 'src/pkg.py', components: ['file:src/pkg.py'], confidence: 'KNOWN' }],
      check_dependencies: [
        'check:collection', 'pytest:related', 'pytest:unrelated',
      ].map((checkId) => ({
        check_id: checkId,
        completeness: 'COMPLETE_FOR_CHECK',
        mechanisms: [{ kind: 'STATIC_IMPORT', evidence_refs: ['ast'], positive: false }],
        boundaries: [],
        explanation: 'Test fixture static evidence is complete for this check.',
      })),
    },
    catalog: {
      identity: 'catalog', complete: true,
      checks: [
        { id: 'check:collection', type: 'test-infrastructure', command: 'pytest --collect-only', scope: { components: ['*'] }, tags: ['collection'], test_executions: 0 },
        { id: 'pytest:related', type: 'unit-test', command: 'pytest related', scope: { components: ['testnode:related'] }, tags: ['pytest-node'], test_executions: 1 },
        { id: 'pytest:unrelated', type: 'unit-test', command: 'pytest unrelated', scope: { components: ['testnode:unrelated'] }, tags: ['pytest-node'], test_executions: 1 },
      ],
    },
    policy: { identity: 'policy', version: '1', rules: [] },
  };
  const plan = planVerification(input);
  assert.equal(plan.sufficiency, 'SUFFICIENT_TARGETED');
  assert.deepEqual(plan.selected_checks.map((check) => check.id), ['check:collection', 'pytest:related']);
  assert.equal(plan.argument.every_skip_explained, true);
});

function resultBundle() {
  const value = {
    schema: 'opsle.affected-verification.av-exp-002.result.v1',
    experiment_id: 'AV-EXP-002',
    trust_stage: TRUST_STAGE,
    target: { sha: TARGET_SHA },
    scenarios: Array.from({ length: 8 }, (_, index) => ({
      scenario_id: `S${index}`,
      full_complete: true,
      av_core: { plan: { argument: { every_skip_explained: true } } },
      av_with_selector: { plan: { argument: { every_skip_explained: true } } },
      arms: {
        AV_CORE: { plan: { argument: { every_skip_explained: true } } },
        AV_WITH_SELECTOR_EVIDENCE: { plan: { argument: { every_skip_explained: true } } },
      },
    })),
  };
  value.result_identity = contentIdentity(value);
  return value;
}

test('AV-EXP-002 rejects tampered result bundles', () => {
  const value = resultBundle();
  value.target.sha = 'bad';
  assert.throws(() => validateResultBundle(value), (error) => error.code === 'TARGET_SHA_MISMATCH');
});
