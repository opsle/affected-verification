import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = fileURLToPath(new URL('../benchmark/av-exp-003/verify-results.mjs', import.meta.url));

test('AV-EXP-003 committed repair evidence verifies and preserves AV-EXP-002 failure', () => {
  const result = spawnSync(process.execPath, [verifier], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AV-EXP-002 FAIL preserved/);
  assert.match(result.stdout, /repaired AV2-006 selected/);
});
