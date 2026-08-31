import { contentIdentity, deepFreeze } from './canonical.js';
import { InputError, PLAN_SCHEMA, SHADOW_OBSERVATION_SCHEMA, validateShadowInput } from './validate.js';

function validatePlanIntegrity(plan) {
  const issues = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new InputError(['plan must be an object'], 'TAMPERED_PLAN');
  }
  if (plan.schema !== PLAN_SCHEMA) issues.push(`plan.schema must be ${PLAN_SCHEMA}`);
  if (!plan.change || typeof plan.change.identity !== 'string') issues.push('plan.change.identity must be a string');
  if (!plan.provenance || typeof plan.provenance.policy_identity !== 'string' || typeof plan.provenance.policy_version !== 'string') {
    issues.push('plan provenance policy identity and version are required');
  }
  if (!Array.isArray(plan.selected_checks) || !Array.isArray(plan.skipped_checks)) {
    issues.push('plan selected_checks and skipped_checks must be arrays');
  } else {
    const ids = [];
    for (const [kind, checks] of [['selected', plan.selected_checks], ['skipped', plan.skipped_checks]]) {
      for (const check of checks) {
        if (!check || typeof check.id !== 'string') issues.push(`${kind} check id must be a string`);
        else ids.push(check.id);
        if (!Array.isArray(check?.reasons) || check.reasons.length === 0) issues.push(`${kind} check ${check?.id ?? '<unknown>'} must have reasons`);
      }
    }
    if (new Set(ids).size !== ids.length) issues.push('plan check ids must be unique across selected and skipped sets');
  }
  const expectedIdentity = contentIdentity({ ...plan, plan_identity: undefined });
  if (plan.plan_identity !== expectedIdentity) issues.push('plan identity does not match canonical content');
  if (issues.length) throw new InputError(issues, 'TAMPERED_PLAN');
}

export function classifyShadow(plan, rawShadow) {
  validatePlanIntegrity(plan);
  const shadow = validateShadowInput(rawShadow, plan);
  const selected = new Set(plan.selected_checks.map((item) => item.id));
  const skipped = new Set(plan.skipped_checks.map((item) => item.id));
  const known = new Set([...selected, ...skipped]);
  const executed = new Set(shadow.executed_check_ids);
  const fullRunComplete = [...known].every((id) => executed.has(id));
  const misses = shadow.failures
    .filter((failure) => skipped.has(failure.check_id) && failure.relevant)
    .map((failure) => ({
      check_id: failure.check_id,
      exact_miss_reason: failure.reason,
    }))
    .sort((a, b) => a.check_id.localeCompare(b.check_id));
  const classification = misses.length
    ? 'SELECTION_MISS'
    : fullRunComplete
      ? 'NO_SELECTION_MISS'
      : 'INDETERMINATE_FULL_RUN_INCOMPLETE';
  const withoutIdentity = {
    schema: SHADOW_OBSERVATION_SCHEMA,
    observation_identity: null,
    plan_identity: plan.plan_identity,
    planner_schema: plan.schema,
    policy_identity: plan.provenance.policy_identity,
    policy_version: plan.provenance.policy_version,
    change_identity: plan.change.identity,
    predicted_selected_check_ids: [...selected].sort(),
    predicted_skipped_check_ids: [...skipped].sort(),
    full_run_executed_check_ids: [...executed].sort(),
    full_run_failures: [...shadow.failures].sort((a, b) => a.check_id.localeCompare(b.check_id)),
    selection_misses: misses,
    full_run_complete: fullRunComplete,
    classification,
  };
  return deepFreeze({
    ...withoutIdentity,
    observation_identity: contentIdentity({ ...withoutIdentity, observation_identity: undefined }),
  });
}
