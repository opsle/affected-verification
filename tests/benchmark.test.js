import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createShadowBenchmarkResult,
  validateScenarioManifest,
  validateShadowBenchmarkResult,
} from '../src/index.js';

function skip(checkId) {
  return {
    check_id: checkId,
    reason: 'outside frozen impact closure',
    evidence_refs: ['impact-evidence', 'catalog'],
  };
}

function validInput() {
  return {
    experiment_id: 'AV-EXP-001',
    benchmark_revision: 'preregistration-sha',
    trust_stage: 'SHADOW',
    target: {
      repository: 'https://example.test/repo.git',
      expected_sha: 'target-sha',
      observed_sha: 'target-sha',
    },
    scenario: {
      id: 'AVS-001',
      identity: 'scenario-identity',
      declared_patch_sha256: 'sha256:patch',
      observed_patch_sha256: 'sha256:patch',
      changed_paths: ['src/a.ts'],
    },
    catalog: {
      identity: 'sha256:catalog',
      checks: [
        { id: 'test:a', type: 'unit-test', test_executions: 2 },
        { id: 'test:b', type: 'unit-test', test_executions: 3 },
        { id: 'check:lint', type: 'lint', test_executions: 0 },
      ],
    },
    observed_catalog_identity: 'sha256:catalog',
    native_selector: {
      declared_identity: 'sha256:native',
      observed_identity: 'sha256:native',
      version: '1.0.0',
    },
    adapter_evidence: { valid: true, dependency_complete: true },
    planner: {
      version: 'planner-sha',
      policy_identity: 'sha256:policy',
      declared_policy_identity: 'sha256:policy',
    },
    baseline: {
      identity: 'sha256:baseline',
      target_sha: 'target-sha',
      catalog_identity: 'sha256:catalog',
      stable: true,
    },
    full_run: {
      scenario_id: 'AVS-001',
      identity: 'sha256:full',
      executed_check_ids: ['test:a', 'test:b', 'check:lint'],
      failed_check_ids: ['test:b'],
      complete: true,
    },
    oracle: {
      identity: 'sha256:oracle',
      scenario_id: 'AVS-001',
      full_run_identity: 'sha256:full',
      baseline_identity: 'sha256:baseline',
      relevant_check_ids: ['test:b'],
      stale: false,
    },
    arms: {
      NATIVE: {
        selected_check_ids: ['test:a'],
        skipped_checks: [skip('test:b'), skip('check:lint')],
        supplied_selection_misses: ['test:b'],
      },
      AV_CORE: {
        plan_identity: 'sha256:plan-core',
        selected_check_ids: ['test:a', 'check:lint'],
        skipped_checks: [skip('test:b')],
        supplied_selection_misses: ['test:b'],
        sufficiency: 'SUFFICIENT_TARGETED',
        uncertainty: { state: 'NONE', reasons: [] },
        escalation: { state: 'NONE', reasons: [] },
        policy_identity: 'sha256:policy',
      },
      AV_WITH_NATIVE_EVIDENCE: {
        plan_identity: 'sha256:plan-native',
        selected_check_ids: ['test:a', 'test:b', 'check:lint'],
        skipped_checks: [],
        supplied_selection_misses: [],
        sufficiency: 'SUFFICIENT_BROADENED',
        uncertainty: { state: 'NONE', reasons: [] },
        escalation: { state: 'BROADENED', reasons: [] },
        policy_identity: 'sha256:policy',
      },
    },
    workload: {
      test_executions_available: 5,
      arms: {
        FULL: { selected: 5, skipped: 0 },
        NATIVE: { selected: 2, skipped: 3 },
        AV_CORE: { selected: 2, skipped: 3 },
        AV_WITH_NATIVE_EVIDENCE: { selected: 5, skipped: 0 },
      },
    },
    evidence_hashes: ['sha256:raw-full', 'sha256:native-output'],
  };
}

function expectStateError(mutator, pattern) {
  const input = validInput();
  mutator(input);
  assert.throws(() => createShadowBenchmarkResult(input), pattern);
}

test('creates and validates an identity-bound SHADOW result', () => {
  const result = createShadowBenchmarkResult(validInput());
  assert.equal(result.trust_stage, 'SHADOW');
  assert.deepEqual(result.arms.NATIVE.selection_misses, ['test:b']);
  assert.deepEqual(result.arms.AV_WITH_NATIVE_EVIDENCE.selection_misses, []);
  assert.equal(validateShadowBenchmarkResult(result), result);
});

test('rejects target SHA mismatch', () => {
  expectStateError((input) => { input.target.observed_sha = 'other'; }, /target SHA mismatch/);
});

test('rejects scenario patch/hash mismatch', () => {
  expectStateError((input) => { input.scenario.observed_patch_sha256 = 'other'; }, /scenario patch\/hash mismatch/);
});

test('rejects catalog drift', () => {
  expectStateError((input) => { input.observed_catalog_identity = 'other'; }, /catalog drift/);
});

test('rejects native selector version drift', () => {
  expectStateError((input) => { input.native_selector.observed_identity = 'other'; }, /native selector version drift/);
});

test('rejects malformed adapter evidence', () => {
  expectStateError((input) => { input.adapter_evidence.valid = false; }, /malformed adapter evidence/);
});

test('denies targeted skipping with incomplete dependency evidence', () => {
  expectStateError((input) => { input.adapter_evidence.dependency_complete = false; }, /targeted skipping denied/);
});

test('rejects incorrect baseline identity', () => {
  expectStateError((input) => { input.baseline.target_sha = 'other'; }, /incorrect baseline identity/);
});

test('rejects stale oracle result', () => {
  expectStateError((input) => { input.oracle.full_run_identity = 'other'; }, /stale oracle result/);
});

test('rejects duplicate scenario identity', () => {
  const scenario = {
    id: 'AVS-001',
    patch_sha256: 'sha256:patch',
    changed_paths: ['src/a.ts'],
  };
  assert.throws(
    () => validateScenarioManifest({ scenarios: [scenario, { ...scenario }] }),
    /scenario IDs contains duplicates/,
  );
});

test('rejects full-run result bound to wrong scenario', () => {
  expectStateError((input) => { input.full_run.scenario_id = 'AVS-999'; }, /full-run result bound to wrong scenario/);
});

test('rejects missing skip reason', () => {
  expectStateError((input) => { input.arms.NATIVE.skipped_checks[0].reason = ''; }, /skip reason/);
});

test('rejects fabricated shadow miss state', () => {
  expectStateError((input) => { input.arms.NATIVE.supplied_selection_misses = []; }, /fabricated shadow miss state/);
});

test('rejects planner policy mismatch', () => {
  expectStateError((input) => { input.planner.policy_identity = 'other'; }, /planner policy mismatch/);
});

test('rejects result tampering', () => {
  const result = structuredClone(createShadowBenchmarkResult(validInput()));
  result.workload.test_executions_available = 999;
  assert.throws(() => validateShadowBenchmarkResult(result), /result tampering/);
});

test('rejects unsafe attempt to mark SHADOW as trusted', () => {
  expectStateError((input) => { input.requested_trust_stage = 'TRUSTED_BOUNDED'; }, /unsafe attempt/);
});
