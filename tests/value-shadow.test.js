import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildValueReceipt,
  classifyShadow,
  operatorIndicator,
  planVerification,
} from '../src/index.js';
import { fixture } from '../fixtures/scenarios.js';
import { tamperPlan } from '../fixtures/negative-cases.js';

function fullRun(plan, failures = []) {
  return {
    schema: 'opsle.affected-verification.shadow-input.v1',
    change_identity: plan.change.identity,
    executed_check_ids: [...plan.selected_checks, ...plan.skipped_checks].map((item) => item.id),
    failures,
  };
}

test('Visible Value calculations are exact for the large unrelated suite', () => {
  const plan = planVerification(fixture('unrelated-large-suite'));
  const receipt = buildValueReceipt(plan);
  const values = Object.fromEntries(receipt.measurements.map((item) => [item.id, item.result]));
  assert.equal(values.checks_available, 4);
  assert.equal(values.checks_selected, 3);
  assert.equal(values.checks_skipped, 1);
  assert.equal(values.test_executions_available, 1043);
  assert.equal(values.test_executions_selected, 14);
  assert.equal(values.test_executions_skipped, 1029);
  assert.equal(values.test_execution_reduction, '1029/1043');
  assert.equal(receipt.schema, 'opsle.value-receipt.v1');
  assert.equal(receipt.evidence[0].locator, plan.plan_identity);
});

test('operator indicator never aggregates unlike checks into its test percentage', () => {
  const plan = planVerification(fixture('unrelated-large-suite'));
  assert.equal(
    operatorIndicator(plan),
    '[Affected Verification] Selected tests: 14/1043; other checks: 1 lint, 1 typecheck; skipped tests: 1029; test-execution reduction: 98.7%; sufficiency: SUFFICIENT_TARGETED; impact uncertainty: none',
  );
});

test('receipt exposes no unmeasured time token cost or correctness savings', () => {
  const receipt = buildValueReceipt(planVerification(fixture('isolated-implementation')));
  assert.ok(receipt.limitations[0].includes('No time, token, cost, correctness'));
  assert.ok(receipt.measurements.every((item) => !['token', 'usd', 'millisecond'].includes(item.unit)));
});

test('shadow mode classifies a relevant skipped failure as a selection miss', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  const observation = classifyShadow(plan, fullRun(plan, [{
    check_id: 'unrelated.large-suite',
    relevant: true,
    reason: 'Full execution exposed a regression causally linked to the change.',
  }]));
  assert.equal(observation.classification, 'SELECTION_MISS');
  assert.deepEqual(observation.selection_misses, [{
    check_id: 'unrelated.large-suite',
    exact_miss_reason: 'Full execution exposed a regression causally linked to the change.',
  }]);
});

test('shadow mode classifies a complete clean run as no miss', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  assert.equal(classifyShadow(plan, fullRun(plan)).classification, 'NO_SELECTION_MISS');
});

test('failure in a selected check is not a selection miss', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  const observation = classifyShadow(plan, fullRun(plan, [{
    check_id: 'isolated.unit', relevant: true, reason: 'Selected check failed.',
  }]));
  assert.equal(observation.classification, 'NO_SELECTION_MISS');
  assert.deepEqual(observation.selection_misses, []);
});

test('irrelevant skipped failure is recorded but not misclassified as a miss', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  const observation = classifyShadow(plan, fullRun(plan, [{
    check_id: 'unrelated.large-suite', relevant: false, reason: 'Known unrelated flaky failure.',
  }]));
  assert.equal(observation.classification, 'NO_SELECTION_MISS');
  assert.equal(observation.full_run_failures.length, 1);
});

test('incomplete full execution is indeterminate', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  const shadow = fullRun(plan);
  shadow.executed_check_ids.pop();
  assert.equal(classifyShadow(plan, shadow).classification, 'INDETERMINATE_FULL_RUN_INCOMPLETE');
});

test('shadow observation identity is stable', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  assert.deepEqual(classifyShadow(plan, fullRun(plan)), classifyShadow(plan, fullRun(plan)));
});

test('shadow input rejects unknown checks and mismatched changes', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  const shadow = fullRun(plan);
  shadow.change_identity = 'wrong';
  shadow.executed_check_ids.push('unknown');
  assert.throws(() => classifyShadow(plan, shadow), /shadow executed unknown check unknown; shadow.change_identity does not match plan/);
});

test('shadow input rejects a tampered plan identity', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  assert.throws(
    () => classifyShadow(tamperPlan(plan), fullRun(plan)),
    (error) => error.code === 'TAMPERED_PLAN' && error.issues.includes('plan identity does not match canonical content'),
  );
});

test('shadow input rejects malformed plan structure', () => {
  assert.throws(
    () => classifyShadow(null, {}),
    (error) => error.code === 'TAMPERED_PLAN' && error.issues.includes('plan must be an object'),
  );
});
