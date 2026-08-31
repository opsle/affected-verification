#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildValueReceipt,
  contentIdentity,
  validateShadowBenchmarkResult,
} from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const resultsDir = path.join(here, 'results-v2');
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'preregistration-v1', 'catalog.json'), 'utf8'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(file) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}

function durationSummary(values) {
  return {
    count: values.length,
    minimum_ms: Math.min(...values),
    median_ms: median(values),
    maximum_ms: Math.max(...values),
    class: 'OBSERVED',
    claim_limit: 'Direct wall-clock observations only; no causal time-saved claim.',
  };
}

function receiptFor(result, armId) {
  const arm = result.arms[armId];
  const selected = new Set(arm.selected_check_ids);
  const plan = {
    plan_identity: arm.plan_identity,
    provenance: {
      verification_catalog_identity: result.verification_catalog_identity,
      policy_identity: result.planner.policy_identity,
    },
    selected_checks: catalog.checks.filter((check) => selected.has(check.id)).map((check) => ({
      id: check.id,
      type: check.type,
      test_executions: check.test_executions,
    })),
    skipped_checks: catalog.checks.filter((check) => !selected.has(check.id)).map((check) => ({
      id: check.id,
      type: check.type,
      test_executions: check.test_executions,
    })),
    sufficiency: arm.sufficiency,
    uncertainty: arm.uncertainty,
  };
  const receipt = buildValueReceipt(plan, {
    mechanismRevision: result.planner.version,
    runId: `${result.scenario.id}:${armId}`,
  });
  receipt.run.repository = 'https://github.com/pmndrs/zustand.git';
  receipt.run.task_classification = 'AV-EXP-001_CALIBRATION_SHADOW';
  receipt.limitations.push('The authoritative FULL arm still executed; this receipt describes a predicted plan only.');
  return receipt;
}

const scenarioDir = path.join(resultsDir, 'scenarios');
const results = fs.readdirSync(scenarioDir).sort().map((name) => {
  const result = readJson(path.join(scenarioDir, name));
  validateShadowBenchmarkResult(result);
  return result;
});
const summary = readJson(path.join(resultsDir, 'summary.json'));

for (const result of results) {
  for (const armId of ['AV_CORE', 'AV_WITH_NATIVE_EVIDENCE']) {
    writeJson(path.join(resultsDir, 'value-receipts', `${result.scenario.id}-${armId}.json`), receiptFor(result, armId));
  }
}

const armIds = ['FULL', 'NATIVE', 'AV_CORE', 'AV_WITH_NATIVE_EVIDENCE'];
const workload = Object.fromEntries(armIds.map((armId) => [armId, {
  test_files: { available: 0, selected: 0, skipped: 0 },
  test_executions: { available: 0, selected: 0, skipped: 0 },
  non_test_checks: { available: 0, selected: 0, skipped: 0 },
}]));
for (const result of results) {
  for (const armId of armIds) {
    const value = result.workload.arms[armId];
    for (const unit of ['test_files', 'test_executions']) {
      for (const field of ['available', 'selected', 'skipped']) workload[armId][unit][field] += value[unit][field];
    }
    for (const typeValue of Object.values(value.non_test_checks)) {
      for (const field of ['available', 'selected', 'skipped']) workload[armId].non_test_checks[field] += typeValue[field];
    }
  }
}

const baselineTotals = fs.readdirSync(path.join(resultsDir, 'baseline'))
  .filter((name) => /^baseline-\d+\.json$/.test(name))
  .sort()
  .map((name) => sum(readJson(path.join(resultsDir, 'baseline', name)).observed_durations_ms.map((item) => item.duration_ms)));
const fullTotals = fs.readdirSync(path.join(resultsDir, 'full')).sort()
  .map((name) => sum(readJson(path.join(resultsDir, 'full', name)).observed_durations_ms.map((item) => item.duration_ms)));
const nativeDurations = results.map((result) => {
  const record = readJson(path.join(resultsDir, 'raw', result.scenario.id, `${result.scenario.id}-native.execution.json`));
  return record.duration_ms_observed;
});

const perScenario = Object.fromEntries(results.map((result) => [result.scenario.id, {
  relevant_check_ids: result.oracle.relevant_check_ids,
  NATIVE: {
    selected_test_executions: result.workload.arms.NATIVE.test_executions.selected,
    skipped_test_executions: result.workload.arms.NATIVE.test_executions.skipped,
    selection_misses: result.arms.NATIVE.selection_misses,
  },
  AV_CORE: {
    selected_test_executions: result.workload.arms.AV_CORE.test_executions.selected,
    skipped_test_executions: result.workload.arms.AV_CORE.test_executions.skipped,
    sufficiency: result.arms.AV_CORE.sufficiency,
    escalation: result.arms.AV_CORE.escalation,
    selection_misses: result.arms.AV_CORE.selection_misses,
  },
  AV_WITH_NATIVE_EVIDENCE: {
    selected_test_executions: result.workload.arms.AV_WITH_NATIVE_EVIDENCE.test_executions.selected,
    skipped_test_executions: result.workload.arms.AV_WITH_NATIVE_EVIDENCE.test_executions.skipped,
    sufficiency: result.arms.AV_WITH_NATIVE_EVIDENCE.sufficiency,
    escalation: result.arms.AV_WITH_NATIVE_EVIDENCE.escalation,
    selection_misses: result.arms.AV_WITH_NATIVE_EVIDENCE.selection_misses,
  },
}]));

const analysisWithoutIdentity = {
  schema: 'opsle.affected-verification.shadow-benchmark-analysis.v1',
  experiment_id: 'AV-EXP-001',
  summary_identity: summary.summary_identity,
  target: summary.target,
  corpus: {
    scenarios: results.length,
    synthetic_faults: 6,
    synthetic_benign_change_shapes: 4,
    scenarios_with_relevant_failures: summary.scenarios_with_relevant_failures,
    relevant_checks: 8,
  },
  safety: summary.selector_results,
  workload: {
    class: 'EXACT',
    units_not_combined: true,
    aggregate_across_10_scenarios: workload,
    per_scenario: perScenario,
    claim_limit: 'Proposed plan counts only; no correctness, cost, or causal savings claim.',
  },
  behavior: {
    av_full_escalations: results.filter((result) => result.arms.AV_CORE.escalation?.state === 'FULL').map((result) => result.scenario.id),
    av_policy_broadened: results.filter((result) => result.arms.AV_CORE.escalation?.state === 'BROADENED').map((result) => result.scenario.id),
    av_insufficient_evidence: results.filter((result) => result.arms.AV_CORE.sufficiency === 'INSUFFICIENT_EVIDENCE').map((result) => result.scenario.id),
    native_test_selection_narrower_than_av: results.filter((result) => result.workload.arms.NATIVE.test_executions.selected < result.workload.arms.AV_CORE.test_executions.selected).map((result) => result.scenario.id),
    av_core_test_selection_narrower_than_native: results.filter((result) => result.workload.arms.AV_CORE.test_executions.selected < result.workload.arms.NATIVE.test_executions.selected).map((result) => result.scenario.id),
    native_evidence_changed_av_test_count: results.filter((result) => result.workload.arms.AV_CORE.test_executions.selected !== result.workload.arms.AV_WITH_NATIVE_EVIDENCE.test_executions.selected).map((result) => result.scenario.id),
    av_added_non_test_policy_checks_to_native: results.map((result) => result.scenario.id),
  },
  runtime_observed: {
    baseline_full_catalog: durationSummary(baselineTotals),
    scenario_full_catalog: durationSummary(fullTotals),
    native_selector_execution: durationSummary(nativeDurations),
  },
  trust_decision: {
    stage: 'SHADOW',
    decision: 'REMAIN_SHADOW',
    reason: 'First calibration, synthetic faults, one repository and ecosystem, and no independent qualifying replication do not justify bounded trust.',
  },
};
const analysis = {
  ...analysisWithoutIdentity,
  analysis_identity: contentIdentity({ ...analysisWithoutIdentity, runtime_observed: undefined }),
};
writeJson(path.join(resultsDir, 'analysis.json'), analysis);

const bundleFiles = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (!full.endsWith('evidence-manifest.json')) bundleFiles.push(full);
  }
}
collect(resultsDir);
const files = Object.fromEntries(bundleFiles.sort().map((file) => [
  path.relative(resultsDir, file).split(path.sep).join('/'),
  sha256File(file),
]));
const manifestWithoutIdentity = {
  schema: 'opsle.affected-verification.evidence-bundle-manifest.v1',
  semantic_summary_identity: summary.summary_identity,
  semantic_analysis_identity: analysis.analysis_identity,
  files,
  timing_note: 'Evidence bundle hashes may vary when raw observed telemetry varies; semantic summary and analysis identities exclude timing.',
};
writeJson(path.join(resultsDir, 'evidence-manifest.json'), {
  ...manifestWithoutIdentity,
  evidence_bundle_identity: contentIdentity(manifestWithoutIdentity),
});

console.log(JSON.stringify({
  summary_identity: summary.summary_identity,
  analysis_identity: analysis.analysis_identity,
  evidence_bundle_identity: readJson(path.join(resultsDir, 'evidence-manifest.json')).evidence_bundle_identity,
}, null, 2));
