import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture } from '../fixtures/scenarios.js';

const bin = fileURLToPath(new URL('../bin/affected-verification.js', import.meta.url));

test('CLI keeps canonical plan on stdout, indicator on stderr, and receipt in sidecar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'affected-verification-'));
  const inputPath = join(dir, 'input.json');
  const receiptPath = join(dir, 'receipt.json');
  writeFileSync(inputPath, JSON.stringify(fixture('isolated-implementation')));
  const result = spawnSync(process.execPath, [bin, 'plan', inputPath, '--receipt', receiptPath], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).schema, 'opsle.affected-verification.plan.v2');
  assert.match(result.stderr, /^\[Affected Verification\]/);
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).schema, 'opsle.value-receipt.v1');
});

test('fixture CLI is deterministic across runs', () => {
  const first = spawnSync(process.execPath, [bin, 'fixture', 'readme-only'], { encoding: 'utf8' });
  const second = spawnSync(process.execPath, [bin, 'fixture', 'readme-only'], { encoding: 'utf8' });
  assert.equal(first.status, 0);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stderr, second.stderr);
});

test('malformed JSON returns a machine-readable error and no success indicator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'affected-verification-'));
  const inputPath = join(dir, 'bad.json');
  writeFileSync(inputPath, '{bad');
  const result = spawnSync(process.execPath, [bin, 'plan', inputPath], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, 'INVALID_JSON');
  assert.equal(result.stderr, '');
});

test('critical metadata returns PLAN_INVALIDATED and no success indicator', () => {
  const result = spawnSync(process.execPath, [bin, 'fixture', 'critical-verification-metadata'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, 'PLAN_INVALIDATED');
  assert.equal(result.stderr, '');
});
