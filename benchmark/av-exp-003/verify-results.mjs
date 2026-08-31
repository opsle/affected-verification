#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { contentIdentity, planVerification } from '../../src/index.js';
import { opaqueBoundaryScenarios } from '../../fixtures/opaque-boundaries.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'results-v1');
const preregDir = path.join(here, 'preregistration-v1');
const av2SummaryPath = path.resolve(here, '../av-exp-002/results-v1/summary.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

const prereg = readJson(path.join(preregDir, 'manifest.json'));
for (const [name, expected] of Object.entries(prereg.files)) {
  requireValue(sha256File(path.join(preregDir, name)) === expected, `preregistration drift: ${name}`);
}

const manifest = readJson(path.join(resultsDir, 'evidence-manifest.json'));
const manifestIdentity = manifest.identity;
delete manifest.identity;
requireValue(contentIdentity(manifest) === manifestIdentity, 'evidence manifest identity mismatch');
for (const item of manifest.files) {
  requireValue(sha256File(path.join(resultsDir, item.path)) === item.sha256, `result drift: ${item.path}`);
}

const summary = readJson(path.join(resultsDir, 'summary.json'));
const resultIdentity = summary.result_identity;
delete summary.result_identity;
requireValue(contentIdentity(summary) === resultIdentity, 'summary identity mismatch');
requireValue(summary.trust_stage === 'OBSERVE/SHADOW', 'trust stage changed');
requireValue(summary.lifecycle === 'VERIFIED', 'lifecycle changed');
requireValue(summary.historical_result.verdict === 'FAIL', 'AV-EXP-002 failure not preserved');
requireValue(summary.historical_result.preserved === true, 'AV-EXP-002 preservation not explicit');
requireValue(summary.known_replay.old_av_exp_002 === 'MISS', 'historical miss rewritten');
requireValue(summary.known_replay.repaired_av_exp_003 === 'SELECTED', 'known repair replay not selected');
requireValue(summary.known_replay.core_selected && summary.known_replay.with_selector_selected, 'one repaired AV arm still misses');

const frozenAv2 = readJson(av2SummaryPath);
requireValue(
  frozenAv2.result_identity === summary.historical_result.result_identity,
  'preserved AV-EXP-002 result identity drifted',
);
requireValue(frozenAv2.safety.AV_CORE.misses === 1, 'frozen AV-EXP-002 core miss changed');
requireValue(frozenAv2.safety.AV_WITH_SELECTOR_EVIDENCE.misses === 1, 'frozen AV-EXP-002 selector arm miss changed');

for (const scenario of opaqueBoundaryScenarios) {
  const stored = summary.adversarial.find((item) => item.scenario_id === scenario.id);
  requireValue(stored, `missing adversarial scenario ${scenario.id}`);
  requireValue(stored.full_oracle.complete, `incomplete full oracle ${scenario.id}`);
  requireValue(
    stored.full_oracle.executed_check_ids.length === scenario.input.catalog.checks.length,
    `full oracle catalog omission ${scenario.id}`,
  );
  requireValue(stored.misses.length === 0, `selection miss ${scenario.id}`);
  requireValue(
    JSON.stringify(stored.plan) === JSON.stringify(planVerification(scenario.input)),
    `nondeterministic stored plan ${scenario.id}`,
  );
}

const matrix = readJson(path.join(resultsDir, 'repair-regression-matrix.json'));
const matrixIdentity = matrix.identity;
delete matrix.identity;
requireValue(contentIdentity(matrix) === matrixIdentity, 'regression matrix identity mismatch');
for (const arm of Object.values(matrix.av_exp_001.arms)) {
  requireValue(arm.repaired_relevant_misses === 0, 'AV-EXP-001 gained a repair miss');
}
for (const arm of Object.values(matrix.av_exp_002.aggregate)) {
  requireValue(arm.repaired_relevant_misses === 0, 'AV-EXP-002 replay retains a repaired miss');
  requireValue(
    arm.repaired_tests_selected - arm.prior_tests_selected === arm.additional_tests_due_to_repair,
    'AV-EXP-002 workload delta mismatch',
  );
}
requireValue(matrix.av_exp_003.new_misses.length === 0, 'AV-EXP-003 adversarial miss');
requireValue(matrix.av_exp_003.targeted_scenarios_retained === 10, 'targeted precision control regressed');
requireValue(matrix.av_exp_003.additional_tests_due_to_repair === 7, 'AV-EXP-003 precision cost drifted');

process.stdout.write(`PASS: AV-EXP-003 ${resultIdentity}; AV-EXP-002 FAIL preserved; repaired AV2-006 selected; 0 regression misses\n`);
