import { contentIdentity, deepFreeze } from './canonical.js';
import { InputError } from './validate.js';

export const BENCHMARK_RESULT_SCHEMA =
  'opsle.affected-verification.shadow-benchmark-result.v1';

function fail(issues, code = 'INVALID_BENCHMARK_STATE') {
  if (issues.length) throw new InputError(issues, code);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameValues(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function requireNonemptyString(value, path, issues) {
  if (typeof value !== 'string' || value.length === 0) issues.push(`${path} must be a nonempty string`);
}

function requireUnique(values, path, issues) {
  if (!Array.isArray(values)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (new Set(values).size !== values.length) issues.push(`${path} contains duplicates`);
}

export function validateScenarioManifest(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.scenarios)) {
    throw new InputError(['scenario manifest must contain scenarios'], 'INVALID_SCENARIO_MANIFEST');
  }
  const ids = manifest.scenarios.map((scenario) => scenario?.id);
  requireUnique(ids, 'scenario IDs', issues);
  for (const [index, scenario] of manifest.scenarios.entries()) {
    requireNonemptyString(scenario?.id, `scenarios[${index}].id`, issues);
    requireNonemptyString(scenario?.patch_sha256, `scenarios[${index}].patch_sha256`, issues);
    if (!Array.isArray(scenario?.changed_paths) || scenario.changed_paths.length === 0) {
      issues.push(`scenarios[${index}].changed_paths must be nonempty`);
    }
  }
  fail(issues, 'INVALID_SCENARIO_MANIFEST');
  return manifest;
}

export function validateBenchmarkCatalog(catalog) {
  const issues = [];
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.checks)) {
    throw new InputError(['benchmark catalog must contain checks'], 'INVALID_BENCHMARK_CATALOG');
  }
  requireNonemptyString(catalog.identity, 'catalog.identity', issues);
  const ids = catalog.checks.map((check) => check?.id);
  requireUnique(ids, 'catalog check IDs', issues);
  for (const [index, check] of catalog.checks.entries()) {
    requireNonemptyString(check?.id, `catalog.checks[${index}].id`, issues);
    if (!Number.isSafeInteger(check?.test_executions) || check.test_executions < 0) {
      issues.push(`catalog.checks[${index}].test_executions is invalid`);
    }
  }
  fail(issues, 'INVALID_BENCHMARK_CATALOG');
  return catalog;
}

function validateArm(armId, arm, catalogIds, issues) {
  if (!arm || typeof arm !== 'object') {
    issues.push(`arm ${armId} is missing`);
    return;
  }
  const selected = arm.selected_check_ids ?? [];
  const skipped = arm.skipped_checks ?? [];
  requireUnique(selected, `arm ${armId} selected checks`, issues);
  const skippedIds = skipped.map((item) => item?.check_id);
  requireUnique(skippedIds, `arm ${armId} skipped checks`, issues);
  for (const item of skipped) {
    requireNonemptyString(item?.check_id, `arm ${armId} skipped check ID`, issues);
    requireNonemptyString(item?.reason, `arm ${armId} skip reason`, issues);
    if (!Array.isArray(item?.evidence_refs) || item.evidence_refs.length === 0) {
      issues.push(`arm ${armId} skipped check ${item?.check_id ?? '<unknown>'} lacks evidence references`);
    }
  }
  if (!sameValues([...selected, ...skippedIds], catalogIds)) {
    issues.push(`arm ${armId} does not partition the frozen catalog`);
  }
  if (selected.some((id) => skippedIds.includes(id))) {
    issues.push(`arm ${armId} selects and skips the same check`);
  }
}

function derivedMisses(arm, relevantIds) {
  const selected = new Set(arm.selected_check_ids);
  return relevantIds.filter((id) => !selected.has(id)).sort();
}

export function createShadowBenchmarkResult(input) {
  const issues = [];
  requireNonemptyString(input?.experiment_id, 'experiment_id', issues);
  requireNonemptyString(input?.benchmark_revision, 'benchmark_revision', issues);
  if (input?.trust_stage !== 'SHADOW') issues.push('benchmark trust stage must remain SHADOW');
  if (input?.requested_trust_stage && input.requested_trust_stage !== 'SHADOW') {
    issues.push('unsafe attempt to mark SHADOW result as trusted');
  }

  const target = input?.target ?? {};
  if (target.expected_sha !== target.observed_sha) issues.push('target SHA mismatch');
  const scenario = input?.scenario ?? {};
  if (scenario.declared_patch_sha256 !== scenario.observed_patch_sha256) issues.push('scenario patch/hash mismatch');

  const catalog = validateBenchmarkCatalog(input?.catalog ?? {});
  const catalogIds = catalog.checks.map((check) => check.id).sort();
  if (catalog.identity !== input?.observed_catalog_identity) issues.push('catalog drift');

  const nativeSelector = input?.native_selector ?? {};
  if (nativeSelector.declared_identity !== nativeSelector.observed_identity) {
    issues.push('native selector version drift');
  }
  if (input?.adapter_evidence?.valid !== true) issues.push('malformed adapter evidence');

  const planner = input?.planner ?? {};
  if (planner.policy_identity !== planner.declared_policy_identity) issues.push('planner policy mismatch');

  const baseline = input?.baseline ?? {};
  requireNonemptyString(baseline.identity, 'baseline.identity', issues);
  if (baseline.target_sha !== target.expected_sha || baseline.catalog_identity !== catalog.identity || baseline.stable !== true) {
    issues.push('incorrect baseline identity');
  }

  const fullRun = input?.full_run ?? {};
  if (fullRun.scenario_id !== scenario.id) issues.push('full-run result bound to wrong scenario');
  if (fullRun.complete !== true || !sameValues(fullRun.executed_check_ids ?? [], catalogIds)) {
    issues.push('full-run result is incomplete');
  }
  requireUnique(fullRun.failed_check_ids ?? [], 'full-run failed checks', issues);

  const oracle = input?.oracle ?? {};
  if (oracle.stale === true || oracle.scenario_id !== scenario.id
      || oracle.full_run_identity !== fullRun.identity
      || oracle.baseline_identity !== baseline.identity) {
    issues.push('stale oracle result');
  }
  const relevantIds = sortedUnique(oracle.relevant_check_ids ?? []);
  if (relevantIds.some((id) => !(fullRun.failed_check_ids ?? []).includes(id))) {
    issues.push('oracle relevant check is not a full-run failure');
  }

  const inputArms = input?.arms ?? {};
  const armIds = ['NATIVE', 'AV_CORE'];
  if (inputArms.AV_WITH_NATIVE_EVIDENCE) armIds.push('AV_WITH_NATIVE_EVIDENCE');
  for (const armId of armIds) {
    validateArm(armId, inputArms[armId], catalogIds, issues);
    if (armId.startsWith('AV_')) {
      if (inputArms[armId]?.policy_identity !== planner.policy_identity) {
        issues.push(`arm ${armId} policy identity mismatch`);
      }
      if (input?.adapter_evidence?.dependency_complete === false
          && !sameValues(inputArms[armId]?.selected_check_ids ?? [], catalogIds)) {
        issues.push(`arm ${armId} targeted skipping denied for incomplete dependency evidence`);
      }
    }
    const derived = derivedMisses(inputArms[armId] ?? { selected_check_ids: [] }, relevantIds);
    if (inputArms[armId]?.supplied_selection_misses
        && !sameValues(inputArms[armId].supplied_selection_misses, derived)) {
      issues.push(`arm ${armId} fabricated shadow miss state`);
    }
  }
  fail(issues);

  const arms = {
    FULL: {
      selected_check_ids: catalogIds,
      skipped_checks: [],
      selection_misses: [],
    },
  };
  for (const armId of armIds) {
    const arm = inputArms[armId];
    arms[armId] = {
      plan_identity: arm.plan_identity ?? null,
      selected_check_ids: [...arm.selected_check_ids].sort(),
      skipped_checks: [...arm.skipped_checks]
        .map((item) => ({
          check_id: item.check_id,
          reason: item.reason,
          evidence_refs: [...item.evidence_refs].sort(),
        }))
        .sort((a, b) => a.check_id.localeCompare(b.check_id)),
      sufficiency: arm.sufficiency ?? null,
      uncertainty: arm.uncertainty ?? null,
      escalation: arm.escalation ?? null,
      selection_misses: derivedMisses(arm, relevantIds),
    };
  }

  const withoutIdentity = {
    schema: BENCHMARK_RESULT_SCHEMA,
    result_identity: null,
    experiment_id: input.experiment_id,
    benchmark_revision: input.benchmark_revision,
    trust_stage: 'SHADOW',
    target: {
      repository: target.repository,
      sha: target.expected_sha,
    },
    scenario: {
      id: scenario.id,
      identity: scenario.identity,
      patch_sha256: scenario.declared_patch_sha256,
      changed_paths: [...scenario.changed_paths].sort(),
    },
    verification_catalog_identity: catalog.identity,
    planner: {
      version: planner.version,
      policy_identity: planner.policy_identity,
    },
    native_selector: {
      identity: nativeSelector.declared_identity,
      version: nativeSelector.version,
    },
    baseline_identity: baseline.identity,
    full_run: {
      identity: fullRun.identity,
      executed_check_ids: [...fullRun.executed_check_ids].sort(),
      failed_check_ids: [...fullRun.failed_check_ids].sort(),
      complete: true,
    },
    oracle: {
      identity: oracle.identity,
      relevant_check_ids: relevantIds,
      claim: 'Relevant within this frozen verification catalog.',
    },
    arms,
    workload: input.workload,
    evidence_hashes: [...input.evidence_hashes].sort(),
  };
  const result = {
    ...withoutIdentity,
    result_identity: contentIdentity({ ...withoutIdentity, result_identity: undefined }),
  };
  return deepFreeze(result);
}

export function validateShadowBenchmarkResult(result) {
  const issues = [];
  if (result?.schema !== BENCHMARK_RESULT_SCHEMA) issues.push('benchmark result schema mismatch');
  if (result?.trust_stage !== 'SHADOW') issues.push('unsafe attempt to mark SHADOW result as trusted');
  const expectedIdentity = contentIdentity({ ...result, result_identity: undefined });
  if (result?.result_identity !== expectedIdentity) issues.push('result tampering');
  const catalogIds = result?.arms?.FULL?.selected_check_ids ?? [];
  const relevantIds = result?.oracle?.relevant_check_ids ?? [];
  for (const armId of ['NATIVE', 'AV_CORE', 'AV_WITH_NATIVE_EVIDENCE']) {
    const arm = result?.arms?.[armId];
    if (!arm) continue;
    validateArm(armId, arm, catalogIds, issues);
    if (!sameValues(arm.selection_misses ?? [], derivedMisses(arm, relevantIds))) {
      issues.push(`arm ${armId} fabricated shadow miss state`);
    }
  }
  fail(issues, 'INVALID_SHADOW_RESULT');
  return result;
}
