import fs from 'node:fs';
import path from 'node:path';

import { contentIdentity } from '../../src/index.js';

export const TARGET_SHA = '36baa15ff831b939a22bc527cd76ce653ef6f66d';
export const TARGET_URL = 'https://github.com/pallets/click.git';
export const TESTMON_VERSION = '2.2.0';
export const TRUST_STAGE = 'OBSERVE/SHADOW';

export class AV2StateError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'AV2StateError';
    this.code = code;
  }
}

function reject(condition, code, detail) {
  if (condition) throw new AV2StateError(code, detail);
}

export function identityWithout(value, key = 'identity') {
  const copy = structuredClone(value);
  delete copy[key];
  return contentIdentity(copy);
}

export function withIdentity(value, key = 'identity') {
  const copy = structuredClone(value);
  copy[key] = identityWithout(copy, key);
  return copy;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function validateExecutionEnvelope(envelope) {
  reject(envelope.target_sha !== TARGET_SHA, 'TARGET_SHA_MISMATCH', 'target revision is not frozen');
  reject(envelope.python_version !== envelope.expected_python_version, 'PYTHON_VERSION_MISMATCH', 'Python runtime drift');
  reject(envelope.lock_identity !== envelope.expected_lock_identity, 'DEPENDENCY_LOCK_DRIFT', 'uv.lock or pyproject drift');
  reject(envelope.testmon_version !== TESTMON_VERSION, 'SELECTOR_VERSION_MISMATCH', 'pytest-testmon version drift');
  reject(!envelope.testmon_state?.well_formed, 'MALFORMED_SELECTOR_OUTPUT', 'selector output malformed');
  reject(envelope.testmon_state?.stale, 'STALE_TESTMON_STATE', 'selector database is stale');
  reject(envelope.testmon_state?.baseline_sha !== TARGET_SHA, 'WRONG_TESTMON_BASELINE', 'selector database baseline mismatch');
  reject(envelope.catalog_identity !== envelope.expected_catalog_identity, 'CATALOG_MISMATCH', 'catalog identity drift');
  reject(envelope.scenario_identity !== envelope.expected_scenario_identity, 'SCENARIO_MISMATCH', 'scenario identity drift');
  reject(envelope.oracle_revision !== envelope.scenario_revision, 'STALE_ORACLE', 'oracle does not bind the scenario revision');
  reject(envelope.conftest_identity !== envelope.expected_conftest_identity, 'CONFTEST_DRIFT', 'pytest fixture/plugin configuration drift');
  reject(envelope.dynamic_uncertainty && envelope.sufficiency === 'SUFFICIENT_TARGETED' && !envelope.runtime_evidence_complete,
    'DYNAMIC_DEPENDENCY_UNCERTAINTY', 'dynamic dependency uncertainty was treated as safe to skip');
  reject(envelope.trust_stage !== TRUST_STAGE, 'UNSAFE_TRUST_PROMOTION', 'this experiment is shadow only');
  return true;
}

export function validatePlanSkips(plan) {
  reject(!Array.isArray(plan.skipped_checks), 'MALFORMED_PLAN', 'skipped_checks must be an array');
  for (const skipped of plan.skipped_checks) {
    reject(!Array.isArray(skipped.reasons) || skipped.reasons.length === 0,
      'UNEXPLAINED_SKIP', `check ${skipped.id ?? '<unknown>'} has no reason`);
    reject(skipped.reasons.some((reason) => !reason.code || !reason.detail || !reason.evidence_refs?.length),
      'UNEXPLAINED_SKIP', `check ${skipped.id ?? '<unknown>'} has incomplete evidence`);
  }
  reject(plan.argument?.every_skip_explained !== true, 'UNEXPLAINED_SKIP', 'plan does not affirm explained skips');
  return true;
}

export function validateResultBundle(bundle) {
  reject(bundle.schema !== 'opsle.affected-verification.av-exp-002.result.v1', 'RESULT_SCHEMA_MISMATCH', 'unexpected schema');
  reject(bundle.experiment_id !== 'AV-EXP-002', 'RESULT_EXPERIMENT_MISMATCH', 'unexpected experiment');
  reject(bundle.trust_stage !== TRUST_STAGE, 'UNSAFE_TRUST_PROMOTION', 'result trust stage changed');
  reject(bundle.target?.sha !== TARGET_SHA, 'TARGET_SHA_MISMATCH', 'result target changed');
  reject(!Array.isArray(bundle.scenarios) || bundle.scenarios.length < 8 || bundle.scenarios.length > 12,
    'RESULT_SCENARIO_COUNT', 'scenario count is outside the frozen range');
  reject(bundle.scenarios.some((scenario) => !scenario.full_complete), 'FULL_RUN_INCOMPLETE', 'FULL is incomplete');
  reject(bundle.scenarios.some((scenario) => scenario.arms?.AV_CORE?.plan?.argument?.every_skip_explained !== true),
    'UNEXPLAINED_SKIP', 'AV_CORE contains unexplained skips');
  reject(bundle.scenarios.some((scenario) => scenario.arms?.AV_WITH_SELECTOR_EVIDENCE?.plan?.argument?.every_skip_explained !== true),
    'UNEXPLAINED_SKIP', 'AV_WITH_SELECTOR_EVIDENCE contains unexplained skips');
  const expected = identityWithout(bundle, 'result_identity');
  reject(bundle.result_identity !== expected, 'RESULT_TAMPERING', 'semantic result identity mismatch');
  return true;
}

export function normalizeSemanticExecution(execution) {
  return {
    command: execution.command,
    exit_code: execution.exit_code,
    signal: execution.signal,
    timed_out: execution.timed_out,
    stdout_sha256: execution.stdout_sha256,
    stderr_sha256: execution.stderr_sha256,
  };
}
