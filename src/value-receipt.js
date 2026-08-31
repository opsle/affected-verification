const RECEIPT_SCHEMA = 'opsle.value-receipt.v1';

function measurement({ id, baseline, result, delta, unit, direction, operatorDisplay, limitation = [] }) {
  return {
    aggregation: { safe: unit === 'count', method: unit === 'count' ? 'SUM' : null },
    baseline,
    class: 'EXACT',
    delta,
    derivation: null,
    direction,
    evidence_refs: ['verification_plan'],
    id,
    limitations: limitation,
    operator_display: operatorDisplay,
    result,
    source_verification: 'VERIFIED',
    unit,
  };
}

function isTest(check) {
  return ['unit-test', 'integration-test', 'end-to-end-test'].includes(check.type);
}

export function buildValueReceipt(plan, { mechanismRevision = null, runId = null } = {}) {
  const all = [...plan.selected_checks, ...plan.skipped_checks];
  const availableTests = all.filter(isTest).reduce((sum, item) => sum + item.test_executions, 0);
  const selectedTests = plan.selected_checks.filter(isTest).reduce((sum, item) => sum + item.test_executions, 0);
  const skippedTests = availableTests - selectedTests;
  const ratio = availableTests === 0 ? null : `${skippedTests}/${availableTests}`;
  return {
    schema: RECEIPT_SCHEMA,
    mechanism: {
      id: 'opsle.affected-verification',
      name: 'Affected Verification',
      version: '0.1.0',
      revision: mechanismRevision,
    },
    run: { id: runId, repository: null, task_classification: null, work_classification: 'DETERMINISTIC_VERIFICATION_PLANNING' },
    operation: {
      id: plan.plan_identity,
      name: 'verification-planning',
      configuration_id: plan.provenance.verification_catalog_identity,
      policy_id: plan.provenance.policy_identity,
    },
    measurements: [
      measurement({ id: 'checks_available', baseline: null, result: all.length, delta: null, unit: 'count', direction: 'NEUTRAL', operatorDisplay: false }),
      measurement({ id: 'checks_selected', baseline: null, result: plan.selected_checks.length, delta: null, unit: 'count', direction: 'LOWER_IS_VALUE', operatorDisplay: true }),
      measurement({ id: 'checks_skipped', baseline: null, result: plan.skipped_checks.length, delta: null, unit: 'count', direction: 'HIGHER_IS_VALUE', operatorDisplay: true }),
      measurement({ id: 'test_executions_available', baseline: null, result: availableTests, delta: null, unit: 'count', direction: 'NEUTRAL', operatorDisplay: false }),
      measurement({ id: 'test_executions_selected', baseline: null, result: selectedTests, delta: null, unit: 'count', direction: 'LOWER_IS_VALUE', operatorDisplay: true }),
      measurement({ id: 'test_executions_skipped', baseline: null, result: skippedTests, delta: null, unit: 'count', direction: 'HIGHER_IS_VALUE', operatorDisplay: true }),
      measurement({
        id: 'test_execution_reduction',
        baseline: null,
        result: ratio,
        delta: null,
        unit: 'ratio',
        direction: 'HIGHER_IS_VALUE',
        operatorDisplay: true,
        limitation: availableTests === 0
          ? ['Unavailable because no test executions are declared.']
          : ['Computed only across catalog entries measured in test executions; unlike verification types are not combined.'],
      }),
    ],
    evidence: [{ id: 'verification_plan', kind: 'CONTENT_HASH', locator: plan.plan_identity, trust: 'VERIFIED' }],
    limitations: [
      'No time, token, cost, correctness, or causal savings claim is made.',
      'Counts describe the configured catalog and declared test executions, not observed execution.',
      'A skipped check count is value only within the plan sufficiency and uncertainty classification.',
    ],
    extensions: {
      sufficiency: plan.sufficiency,
      impact_uncertainty: plan.uncertainty.state,
      selected_by_type: Object.fromEntries(
        [...new Set(plan.selected_checks.map((item) => item.type))].sort().map((type) => [
          type,
          plan.selected_checks.filter((item) => item.type === type).length,
        ]),
      ),
    },
  };
}

export function operatorIndicator(plan) {
  const all = [...plan.selected_checks, ...plan.skipped_checks];
  const availableTests = all.filter(isTest).reduce((sum, item) => sum + item.test_executions, 0);
  const selectedTests = plan.selected_checks.filter(isTest).reduce((sum, item) => sum + item.test_executions, 0);
  const skippedTests = availableTests - selectedTests;
  const other = Object.entries(plan.selected_checks.filter((item) => !isTest(item)).reduce((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, {})).sort().map(([type, count]) => `${count} ${type}`).join(', ') || 'none';
  const reduction = availableTests === 0 ? 'n/a' : `${((skippedTests / availableTests) * 100).toFixed(1)}%`;
  return `[Affected Verification] Selected tests: ${selectedTests}/${availableTests}; other checks: ${other}; skipped tests: ${skippedTests}; test-execution reduction: ${reduction}; sufficiency: ${plan.sufficiency}; impact uncertainty: ${plan.uncertainty.state.toLowerCase()}`;
}
