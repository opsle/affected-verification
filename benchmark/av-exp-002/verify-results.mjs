#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  identityWithout,
  readJson,
  validatePlanSkips,
  validateResultBundle,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const preregDir = path.join(here, 'preregistration-v1');
const resultsDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'results-v1');

function sha256File(file) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

const preregManifest = readJson(path.join(preregDir, 'manifest.json'));
if (preregManifest.identity !== identityWithout(preregManifest)) throw new Error('preregistration manifest identity mismatch');
for (const [name, expected] of Object.entries(preregManifest.files)) {
  if (sha256File(path.join(preregDir, name)) !== expected) throw new Error(`preregistration file mismatch: ${name}`);
}

const bundle = readJson(path.join(resultsDir, 'summary.json'));
validateResultBundle(bundle);
for (const scenario of bundle.scenarios) {
  validatePlanSkips(scenario.arms.AV_CORE.plan);
  validatePlanSkips(scenario.arms.AV_WITH_SELECTOR_EVIDENCE.plan);
  const file = readJson(path.join(resultsDir, 'scenarios', `${scenario.scenario_id}.json`));
  if (JSON.stringify(file) !== JSON.stringify(scenario)) throw new Error(`scenario summary mismatch: ${scenario.scenario_id}`);
}

const evidence = readJson(path.join(resultsDir, 'evidence-manifest.json'));
if (evidence.identity !== identityWithout(evidence)) throw new Error('evidence manifest identity mismatch');
for (const [name, expected] of Object.entries(evidence.files)) {
  if (sha256File(path.join(resultsDir, name)) !== expected) throw new Error(`evidence file mismatch: ${name}`);
}
const present = [];
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name !== 'evidence-manifest.json') present.push(path.relative(resultsDir, full).split(path.sep).join('/'));
  }
}
visit(resultsDir);
if (JSON.stringify(present.sort()) !== JSON.stringify(Object.keys(evidence.files).sort())) throw new Error('evidence manifest file set mismatch');

console.log(JSON.stringify({
  verified: true,
  experiment_id: bundle.experiment_id,
  result_identity: bundle.result_identity,
  evidence_bundle_identity: evidence.identity,
  scenarios: bundle.scenarios.length,
  av_core_misses: bundle.safety.AV_CORE.misses,
  av_with_selector_misses: bundle.safety.AV_WITH_SELECTOR_EVIDENCE.misses,
}, null, 2));
