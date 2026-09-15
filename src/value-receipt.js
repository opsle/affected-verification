import { contentIdentity } from './canonical.js';

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
  const dependencyForced = plan.selected_checks.filter(
    (item) => item.dependency_completeness?.forced_selection,
  );
  const dependencyForcedTests = dependencyForced
    .filter(isTest)
    .reduce((sum, item) => sum + item.test_executions, 0);
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
      measurement({ id: 'dependency_safety_checks_added', baseline: 0, result: dependencyForced.length, delta: dependencyForced.length, unit: 'count', direction: 'NEUTRAL', operatorDisplay: true }),
      measurement({ id: 'dependency_safety_test_executions_added', baseline: 0, result: dependencyForcedTests, delta: dependencyForcedTests, unit: 'count', direction: 'NEUTRAL', operatorDisplay: true }),
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
      dependency_completeness: plan.dependency_completeness,
      selected_by_type: Object.fromEntries(
        [...new Set(plan.selected_checks.map((item) => item.type))].sort().map((type) => [
          type,
          plan.selected_checks.filter((item) => item.type === type).length,
        ]),
      ),
    },
  };
}

export function buildShadowValueReceipt(plan, shadow, {
  mechanismRevision,
  mechanismVersion,
  runId,
  repository,
  taskId,
  attemptId,
  executionId,
  generation,
  trustStage,
  decisionIdentity,
  manifest,
  authoritativeResults,
} = {}) {
  if (!mechanismRevision || !mechanismVersion || !runId || !repository
    || !taskId || !attemptId || !executionId || !generation
    || !decisionIdentity || !manifest || !Array.isArray(authoritativeResults)) {
    throw new Error('A production shadow receipt requires complete execution and mechanism identity.');
  }
  if (shadow?.plan_identity !== plan.plan_identity) {
    throw new Error('Shadow result does not match the verification plan.');
  }
  const all = [...plan.selected_checks, ...plan.skipped_checks];
  const availableTests = all.filter(isTest).reduce((sum, item) => sum + item.test_executions, 0);
  const selectedTests = plan.selected_checks.filter(isTest).reduce((sum, item) => sum + item.test_executions, 0);
  const proposedSkippedTests = availableTests - selectedTests;
  const proposedSkippedChecks = plan.skipped_checks.length;
  const broadening = plan.sufficiency === 'SUFFICIENT_BROADENED'
    || plan.sufficiency === 'FULL_VERIFICATION_REQUIRED'
    || plan.sufficiency === 'INSUFFICIENT_EVIDENCE'
    || plan.dependency_completeness?.forced_check_ids?.length > 0;
  const evidence = [
    { id: 'verification_plan', kind: 'CONTENT_HASH', locator: plan.plan_identity, trust: 'VERIFIED' },
    { id: 'shadow_result', kind: 'CONTENT_HASH', locator: shadow.observation_identity, trust: 'VERIFIED' },
  ];
  const measured = input => measurement({
    ...input,
    limitation: input.limitation ?? [],
  });
  const measurements = [
    measured({ id: 'checks_proposed_selected', baseline: null, result: plan.selected_checks.length,
      delta: null, unit: 'count', direction: 'NEUTRAL', operatorDisplay: true }),
    measured({ id: 'checks_proposed_skipped', baseline: null, result: proposedSkippedChecks,
      delta: null, unit: 'count', direction: 'NEUTRAL', operatorDisplay: true }),
    measured({ id: 'test_executions_available', baseline: null, result: availableTests,
      delta: null, unit: 'count', direction: 'NEUTRAL', operatorDisplay: false }),
    measured({ id: 'test_executions_proposed_selected', baseline: null, result: selectedTests,
      delta: null, unit: 'count', direction: 'NEUTRAL', operatorDisplay: true }),
    measured({ id: 'test_executions_proposed_skipped', baseline: null, result: proposedSkippedTests,
      delta: null, unit: 'count', direction: 'NEUTRAL', operatorDisplay: true }),
    measurement({ id: 'full_catalog_checks_executed', baseline: null,
      result: shadow.full_run_executed_check_ids.length, delta: null, unit: 'count',
      direction: 'PROTECTION_SIGNAL', operatorDisplay: true }),
    measurement({ id: 'shadow_misses', baseline: null, result: shadow.selection_misses.length,
      delta: null, unit: 'count', direction: 'PROTECTION_SIGNAL', operatorDisplay: true }),
    measurement({ id: 'full_verification_authoritative', baseline: null, result: true,
      delta: null, unit: 'boolean', direction: 'PROTECTION_SIGNAL', operatorDisplay: true }),
    measured({ id: 'broadening_or_escalation', baseline: null, result: broadening,
      delta: null, unit: 'boolean', direction: 'PROTECTION_SIGNAL', operatorDisplay: false }),
  ];
  for (const item of measurements.slice(5)) item.evidence_refs = ['shadow_result'];
  const selectedByType = Object.fromEntries(
    [...new Set(plan.selected_checks.map((item) => item.type))].sort().map((type) => [
      type,
      plan.selected_checks.filter((item) => item.type === type).length,
    ]),
  );
  return {
    schema: RECEIPT_SCHEMA,
    mechanism: {
      id: 'opsle.affected-verification',
      name: 'Affected Verification',
      version: mechanismVersion,
      revision: mechanismRevision,
    },
    run: {
      id: runId,
      repository,
      task_classification: `task-${taskId}`,
      work_classification: 'DETERMINISTIC_VERIFICATION_SHADOW',
    },
    operation: {
      // The observation identity deliberately stays stable when the same plan
      // and results are reproduced. A receipt operation is one execution of
      // that observation, so include its execution generation to keep retries
      // distinct within the same Visible Value run.
      id: contentIdentity({ execution_id: executionId, generation,
        observation_identity: shadow.observation_identity }),
      name: 'verification-shadow',
      configuration_id: plan.provenance.verification_catalog_identity,
      policy_id: plan.provenance.policy_identity,
    },
    measurements,
    evidence,
    limitations: [
      'Full verification remained authoritative; proposed skips were not execution savings.',
      'No time, token, cost, correctness, avoided-execution, or causal savings claim is made.',
      'A shadow miss is a failed check that the targeted plan proposed skipping; full results remain authoritative.',
    ],
    extensions: {
      affected_verification: {
        trust_stage: trustStage,
        authoritative_verification: 'FULL',
        task: { id: taskId, attempt_id: attemptId, execution_id: executionId, generation },
        mechanism: { packaged_revision: mechanismRevision },
        source: {
          repository,
          base_revision: plan.change.base_revision,
          target_revision: plan.change.target_revision,
          change_identity: plan.change.identity,
        },
        manifest,
        plan: {
          identity: plan.plan_identity,
          decision_identity: decisionIdentity,
          sufficiency: plan.sufficiency,
          uncertainty: plan.uncertainty,
          dependency_completeness: plan.dependency_completeness,
          selected_check_ids: plan.selected_checks.map((item) => item.id),
          skipped_check_ids: plan.skipped_checks.map((item) => item.id),
          selected_by_type: selectedByType,
          selected_test_executions: selectedTests,
          available_test_executions: availableTests,
          proposed_skipped_test_executions: proposedSkippedTests,
        },
        policy: {
          identity: plan.provenance.policy_identity,
          revision: plan.provenance.policy_version,
        },
        catalog: { identity: plan.provenance.verification_catalog_identity },
        shadow,
        authoritative_results: authoritativeResults,
      },
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
  const dependencyForced = plan.selected_checks.filter(
    (item) => item.dependency_completeness?.forced_selection,
  );
  const dependencyForcedTests = dependencyForced
    .filter(isTest)
    .reduce((sum, item) => sum + item.test_executions, 0);
  const opaque = dependencyForced.filter(
    (item) => item.dependency_completeness.state === 'OPAQUE_BOUNDARY',
  ).length;
  return `[Affected Verification] Selected tests: ${selectedTests}/${availableTests}; other checks: ${other}; skipped tests: ${skippedTests}; dependency safety additions: ${dependencyForced.length} checks/${dependencyForcedTests} test executions; opaque boundaries selected: ${opaque}; test-execution reduction: ${reduction}; sufficiency: ${plan.sufficiency}; impact uncertainty: ${plan.uncertainty.state.toLowerCase()}`;
}
