#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildValueReceipt,
  contentIdentity,
  planVerification,
} from '../../src/index.js';
import { opaqueBoundaryScenarios } from '../../fixtures/opaque-boundaries.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const preregDir = path.join(here, 'preregistration-v1');
const av1Dir = path.join(repoRoot, 'benchmark/av-exp-001/results-v2');
const av2Dir = path.join(repoRoot, 'benchmark/av-exp-002/results-v1');
const av2Prereg = path.join(repoRoot, 'benchmark/av-exp-002/preregistration-v1');
const targetRoot = path.resolve(process.argv[2] ?? '');
const outputDir = process.argv[3] ? path.resolve(process.argv[3]) : path.join(here, 'results-v1');
const targetSha = '36baa15ff831b939a22bc527cd76ce653ef6f66d';

if (!process.argv[2]) throw new Error('usage: node run.mjs TARGET_CLICK_REPOSITORY [OUTPUT_DIR]');
if (fs.existsSync(outputDir)) throw new Error(`output already exists: ${outputDir}`);

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

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${commandName} failed (${result.status}): ${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

function verifyPreregistration() {
  const manifest = readJson(path.join(preregDir, 'manifest.json'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (sha256File(path.join(preregDir, name)) !== expected) {
      throw new Error(`preregistration drift: ${name}`);
    }
  }
  return manifest;
}

function checkCatalogInput() {
  const catalog = readJson(path.join(av2Prereg, 'catalog.json'));
  return catalog.checks
    .filter((check) => check.verification_class === 'PYTEST_NODE')
    .map((check) => {
      const nodeid = check.id.slice('pytest:'.length);
      const pathPart = nodeid.split('::')[0];
      const symbolPart = nodeid.slice(nodeid.indexOf('::') + 2)
        .split('[')[0]
        .split('::')
        .at(-1);
      return { check_id: check.id, path: pathPart, symbol: symbolPart };
    });
}

function detectBoundaries() {
  const actualSha = command('git', ['rev-parse', 'HEAD'], { cwd: targetRoot });
  if (actualSha !== targetSha) throw new Error(`Click target SHA mismatch: ${actualSha}`);
  const detector = path.join(repoRoot, 'tools/python-check-boundaries.py');
  const raw = command('python3', [
    detector,
    '--root', targetRoot,
    '--checks-json', '-',
    '--provider-id', 'python-boundary-inspector',
  ], { input: JSON.stringify(checkCatalogInput()) });
  const result = JSON.parse(raw);
  if (result.schema !== 'opsle.affected-verification.python-check-boundary-catalog.v1') {
    throw new Error('unexpected boundary catalog schema');
  }
  return {
    ...result,
    target: { repository: 'https://github.com/pallets/click.git', sha: targetSha },
    opaque_check_ids: result.assessments
      .filter((item) => item.completeness === 'OPAQUE_BOUNDARY')
      .map((item) => item.check_id)
      .sort(),
  };
}

function adversarialResults() {
  return opaqueBoundaryScenarios.map((scenario) => {
    const plan = planVerification(scenario.input);
    const selected = plan.selected_checks.map((item) => item.id);
    const all = scenario.input.catalog.checks.map((item) => item.id).sort();
    const misses = scenario.oracle_relevant.filter((checkId) => !selected.includes(checkId));
    const priorSelected = scenario.input.catalog.checks
      .filter((check) => check.scope.components.includes('changed'))
      .map((check) => check.id)
      .sort();
    return {
      scenario_id: scenario.id,
      full_oracle: {
        complete: true,
        executed_check_ids: all,
        relevant_check_ids: scenario.oracle_relevant,
      },
      prior_selected_check_ids: priorSelected,
      repaired_selected_check_ids: selected,
      repaired_skipped_check_ids: plan.skipped_checks.map((item) => item.id),
      additional_check_ids: selected.filter((checkId) => !priorSelected.includes(checkId)),
      misses,
      plan,
      workload: {
        prior_tests_selected: priorSelected.length,
        repaired_tests_selected: selected.length,
        additional_tests_due_to_repair: selected.length - priorSelected.length,
        tests_still_skipped: plan.skipped_checks.length,
        non_test_check_differences: 0,
        full_verification_escalations: plan.escalation.state === 'FULL' ? 1 : 0,
      },
    };
  });
}

function replayAv1() {
  const analysis = readJson(path.join(av1Dir, 'analysis.json'));
  const workload = analysis.workload.aggregate_across_10_scenarios;
  return {
    experiment_id: 'AV-EXP-001',
    replay_basis: analysis.analysis_identity,
    method: 'Frozen full-oracle and selector evidence replay; repair is monotonic and no Python opaque-boundary adapter applies.',
    scenarios: analysis.corpus.scenarios,
    arms: Object.fromEntries(['AV_CORE', 'AV_WITH_NATIVE_EVIDENCE'].map((arm) => [arm, {
      historical_relevant_misses: analysis.safety[arm].missed_relevant_checks,
      repaired_relevant_misses: analysis.safety[arm].missed_relevant_checks,
      prior_tests_selected: workload[arm].test_executions.selected,
      repaired_tests_selected: workload[arm].test_executions.selected,
      additional_tests_due_to_repair: 0,
      tests_still_skipped: workload[arm].test_executions.skipped,
      non_test_check_differences: 0,
      full_verification_escalations: analysis.safety[arm].escalations,
    }])),
  };
}

function replayAv2(boundaryEvidence) {
  const opaque = new Set(boundaryEvidence.opaque_check_ids);
  const arms = ['AV_CORE', 'AV_WITH_SELECTOR_EVIDENCE'];
  const aggregate = Object.fromEntries(arms.map((arm) => [arm, {
    historical_relevant_misses: 0,
    repaired_relevant_misses: 0,
    prior_tests_selected: 0,
    repaired_tests_selected: 0,
    additional_tests_due_to_repair: 0,
    tests_still_skipped: 0,
    non_test_check_differences: 0,
    full_verification_escalations: 0,
  }]));
  const scenarios = [];
  for (const name of fs.readdirSync(path.join(av2Dir, 'scenarios')).filter((item) => item.endsWith('.json')).sort()) {
    const historical = readJson(path.join(av2Dir, 'scenarios', name));
    if (!historical.full_complete) throw new Error(`incomplete frozen FULL oracle: ${historical.scenario_id}`);
    const scenario = {
      scenario_id: historical.scenario_id,
      original_relevant_check_ids: historical.oracle.relevant_check_ids,
      full_oracle_complete: historical.full_complete,
      arms: {},
    };
    for (const arm of arms) {
      const prior = new Set(historical.arms[arm].selected_check_ids);
      const repaired = new Set([...prior, ...opaque]);
      const historicalMisses = historical.oracle.relevant_check_ids.filter((id) => !prior.has(id));
      const repairedMisses = historical.oracle.relevant_check_ids.filter((id) => !repaired.has(id));
      const additions = [...opaque].filter((id) => !prior.has(id)).sort();
      const priorTestCount = historical.workload[arm].pytest_nodes.selected;
      const repairedTestCount = priorTestCount + additions.length;
      scenario.arms[arm] = {
        historical_misses: historicalMisses,
        repaired_misses: repairedMisses,
        additional_check_ids: additions,
        prior_tests_selected: priorTestCount,
        repaired_tests_selected: repairedTestCount,
        additional_tests_due_to_repair: additions.length,
        tests_still_skipped: historical.workload[arm].pytest_nodes.available - repairedTestCount,
        non_test_check_differences: 0,
        full_verification_escalations: historical.arms[arm].plan.escalation.state === 'FULL' ? 1 : 0,
      };
      aggregate[arm].historical_relevant_misses += historicalMisses.length;
      aggregate[arm].repaired_relevant_misses += repairedMisses.length;
      aggregate[arm].prior_tests_selected += priorTestCount;
      aggregate[arm].repaired_tests_selected += repairedTestCount;
      aggregate[arm].additional_tests_due_to_repair += additions.length;
      aggregate[arm].tests_still_skipped += historical.workload[arm].pytest_nodes.available - repairedTestCount;
      aggregate[arm].full_verification_escalations += scenario.arms[arm].full_verification_escalations;
    }
    scenarios.push(scenario);
  }
  return {
    experiment_id: 'AV-EXP-002',
    replay_basis: readJson(path.join(av2Dir, 'summary.json')).result_identity,
    preserved_historical_verdict: 'FAIL',
    method: 'Frozen complete FULL-oracle replay; repaired selection is the monotonic union of historical AV selection and deterministic open-boundary selections.',
    scenarios,
    aggregate,
  };
}

const preregistration = verifyPreregistration();
const boundaryEvidence = detectBoundaries();
const adversarial = adversarialResults();
const av1 = replayAv1();
const av2 = replayAv2(boundaryEvidence);
const known = av2.scenarios.find((item) => item.scenario_id === 'AV2-006');
const knownCheck = 'pytest:tests/test_imports.py::test_light_imports';
const knownAssessment = boundaryEvidence.assessments.find((item) => item.check_id === knownCheck);
if (!knownAssessment || knownAssessment.completeness !== 'OPAQUE_BOUNDARY') {
  throw new Error('known AV2-006 boundary was not detected');
}

const regressionMatrix = {
  schema: 'opsle.affected-verification.repair-regression-matrix.v1',
  experiment_id: 'AV-EXP-003',
  av_exp_001: av1,
  av_exp_002: av2,
  av_exp_003: {
    scenarios: adversarial.length,
    prior_tests_selected: adversarial.reduce((sum, item) => sum + item.workload.prior_tests_selected, 0),
    repaired_tests_selected: adversarial.reduce((sum, item) => sum + item.workload.repaired_tests_selected, 0),
    additional_tests_due_to_repair: adversarial.reduce((sum, item) => sum + item.workload.additional_tests_due_to_repair, 0),
    tests_still_skipped: adversarial.reduce((sum, item) => sum + item.workload.tests_still_skipped, 0),
    non_test_check_differences: 0,
    full_verification_escalations: adversarial.reduce((sum, item) => sum + item.workload.full_verification_escalations, 0),
    targeted_scenarios_retained: adversarial.filter((item) => item.repaired_skipped_check_ids.length > 0).length,
    broadened_scenarios: adversarial.filter((item) => item.additional_check_ids.length > 0).length,
    new_misses: adversarial.flatMap((item) => item.misses.map((check_id) => ({ scenario_id: item.scenario_id, check_id }))),
  },
};
regressionMatrix.identity = contentIdentity(regressionMatrix);

const summary = {
  schema: 'opsle.affected-verification.av-exp-003.result.v1',
  experiment_id: 'AV-EXP-003',
  title: 'Opaque Dependency Boundary Repair',
  trust_stage: 'OBSERVE/SHADOW',
  lifecycle: 'VERIFIED',
  preregistration_commit: '7aa4d13e42d6a547973d7f2a6b330821145cedc2',
  preregistration_manifest: contentIdentity(preregistration),
  historical_result: {
    experiment_id: 'AV-EXP-002',
    verdict: 'FAIL',
    result_identity: av2.replay_basis,
    preserved: true,
  },
  known_replay: {
    scenario_id: 'AV2-006',
    check_id: knownCheck,
    old_av_exp_002: 'MISS',
    repaired_av_exp_003: 'SELECTED',
    core_selected: known.arms.AV_CORE.repaired_misses.includes(knownCheck) === false,
    with_selector_selected: known.arms.AV_WITH_SELECTOR_EVIDENCE.repaired_misses.includes(knownCheck) === false,
    reason: 'OPAQUE_BOUNDARY: deterministic Python inspection found SUBPROCESS and CHILD_INTERPRETER boundaries; skip completeness is not defensible.',
    provenance: knownAssessment.boundaries,
  },
  adversarial,
  regression_matrix_identity: regressionMatrix.identity,
  acceptance: {
    known_replay_selected: true,
    adversarial_misses: regressionMatrix.av_exp_003.new_misses.length,
    av_exp_001_new_misses: Object.values(av1.arms).reduce((sum, item) => sum + item.repaired_relevant_misses, 0),
    av_exp_002_new_misses: Object.values(av2.aggregate).reduce((sum, item) => sum + item.repaired_relevant_misses, 0),
    target_specific_core_rules: 0,
    full_oracle_complete_scenarios: adversarial.filter((item) => item.full_oracle.complete).length,
  },
  claim_limit: 'Observed on frozen repair and regression corpora in SHADOW only; no general failure-prevention, dynamic-dependency solution, safety, causal-savings, or production-trust claim.',
};
summary.result_identity = contentIdentity(summary);

writeJson(path.join(outputDir, 'boundary-evidence.json'), boundaryEvidence);
writeJson(path.join(outputDir, 'repair-regression-matrix.json'), regressionMatrix);
for (const item of adversarial) {
  writeJson(
    path.join(outputDir, 'value-receipts', `${item.scenario_id}.json`),
    buildValueReceipt(item.plan, { runId: item.scenario_id }),
  );
}
writeJson(path.join(outputDir, 'summary.json'), summary);

const files = [];
for (const relative of [
  'boundary-evidence.json',
  'repair-regression-matrix.json',
  'summary.json',
  ...adversarial.map((item) => `value-receipts/${item.scenario_id}.json`),
]) {
  files.push({ path: relative, sha256: sha256File(path.join(outputDir, relative)) });
}
const manifest = {
  schema: 'opsle.affected-verification.evidence-manifest.v1',
  experiment_id: 'AV-EXP-003',
  files,
};
manifest.identity = contentIdentity(manifest);
writeJson(path.join(outputDir, 'evidence-manifest.json'), manifest);

process.stdout.write(`${JSON.stringify({
  result_identity: summary.result_identity,
  regression_matrix_identity: regressionMatrix.identity,
  evidence_manifest_identity: manifest.identity,
  known_replay: summary.known_replay.repaired_av_exp_003,
  adversarial_misses: summary.acceptance.adversarial_misses,
}, null, 2)}\n`);
