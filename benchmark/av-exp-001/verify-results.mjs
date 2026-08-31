#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  contentIdentity,
  validateShadowBenchmarkResult,
} from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const resultsDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, 'results-v2');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const summary = readJson(path.join(resultsDir, 'summary.json'));
assert(
  summary.summary_identity === contentIdentity({ ...summary, summary_identity: undefined }),
  'summary identity mismatch',
);

const scenarioFiles = fs.readdirSync(path.join(resultsDir, 'scenarios')).sort();
assert(scenarioFiles.length === 10, 'expected ten scenario results');
for (const name of scenarioFiles) {
  const result = readJson(path.join(resultsDir, 'scenarios', name));
  validateShadowBenchmarkResult(result);
  assert(summary.scenario_result_identities[result.scenario.id] === result.result_identity, `${name} summary binding mismatch`);
  for (const entry of result.evidence_hashes) {
    const separator = entry.indexOf('=sha256:');
    assert(separator > 0, `${name} malformed evidence hash`);
    const file = entry.slice(0, separator);
    const expected = entry.slice(separator + 1);
    assert(sha256File(path.join(repoRoot, file)) === expected, `${name} raw evidence mismatch: ${file}`);
  }
}

for (const name of fs.readdirSync(path.join(resultsDir, 'full')).sort()) {
  const value = readJson(path.join(resultsDir, 'full', name));
  const semantic = structuredClone(value);
  delete semantic.identity;
  delete semantic.observed_durations_ms;
  delete semantic.evidence_files;
  delete semantic.test_count;
  delete semantic.test_file_count;
  assert(value.identity === contentIdentity(semantic), `${name} full-run identity mismatch`);
}

for (const name of fs.readdirSync(path.join(resultsDir, 'oracle')).sort()) {
  const value = readJson(path.join(resultsDir, 'oracle', name));
  const semantic = structuredClone(value);
  delete semantic.identity;
  assert(value.identity === contentIdentity(semantic), `${name} oracle identity mismatch`);
}

const baseline = readJson(path.join(resultsDir, 'baseline', 'baseline-summary.json'));
const baselineSemantic = structuredClone(baseline);
delete baselineSemantic.identity;
delete baselineSemantic.observed_durations_ms;
assert(baseline.identity === contentIdentity(baselineSemantic), 'baseline identity mismatch');
assert(summary.baseline_identity === baseline.identity, 'summary baseline binding mismatch');

const analysis = readJson(path.join(resultsDir, 'analysis.json'));
assert(
  analysis.analysis_identity === contentIdentity({
    ...analysis,
    analysis_identity: undefined,
    runtime_observed: undefined,
  }),
  'analysis identity mismatch',
);
assert(analysis.summary_identity === summary.summary_identity, 'analysis summary binding mismatch');

const receipts = fs.readdirSync(path.join(resultsDir, 'value-receipts')).sort();
assert(receipts.length === 20, 'expected twenty AV Visible Value receipts');
for (const name of receipts) {
  const receipt = readJson(path.join(resultsDir, 'value-receipts', name));
  assert(receipt.schema === 'opsle.value-receipt.v1', `${name} receipt schema mismatch`);
  assert(receipt.mechanism.id === 'opsle.affected-verification', `${name} mechanism mismatch`);
}

const reproduction = readJson(path.join(resultsDir, 'reproduction.json'));
assert(reproduction.result === 'PASS', 'reproduction did not pass');
assert(Object.values(reproduction.checks).every(Boolean), 'reproduction identity equality failed');

const manifest = readJson(path.join(resultsDir, 'evidence-manifest.json'));
for (const [name, expected] of Object.entries(manifest.files)) {
  assert(sha256File(path.join(resultsDir, name)) === expected, `evidence manifest mismatch: ${name}`);
}
const manifestSemantic = structuredClone(manifest);
delete manifestSemantic.evidence_bundle_identity;
assert(
  manifest.evidence_bundle_identity === contentIdentity(manifestSemantic),
  'evidence bundle identity mismatch',
);

console.log(JSON.stringify({
  result: 'PASS',
  scenarios: scenarioFiles.length,
  receipts: receipts.length,
  baseline_identity: baseline.identity,
  summary_identity: summary.summary_identity,
  analysis_identity: analysis.analysis_identity,
  evidence_bundle_identity: manifest.evidence_bundle_identity,
}, null, 2));
