import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { opaqueBoundaryScenarios, opaqueFixture } from '../fixtures/opaque-boundaries.js';
import { buildValueReceipt, contentIdentity, operatorIndicator, planVerification } from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const detector = fileURLToPath(new URL('../tools/python-check-boundaries.py', import.meta.url));

function detect(symbol) {
  const result = spawnSync('python3', [
    detector,
    '--root', root,
    '--check-file', 'benchmark/av-exp-003/fixtures/python/checks.py',
    '--symbol', symbol,
    '--provider-id', 'python-boundary-inspector',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

for (const scenario of opaqueBoundaryScenarios) {
  test(`${scenario.id} full oracle remains authoritative and repaired plan has no miss`, () => {
    const plan = planVerification(scenario.input);
    const selected = plan.selected_checks.map((item) => item.id);
    assert.deepEqual(selected, scenario.expected_selected);
    assert.deepEqual(
      scenario.oracle_relevant.filter((checkId) => !selected.includes(checkId)),
      [],
    );
    assert.deepEqual(
      [...plan.selected_checks, ...plan.skipped_checks].map((item) => item.id).sort(),
      scenario.input.catalog.checks.map((item) => item.id).sort(),
    );
  });
}

test('subprocess and child-interpreter boundaries have deterministic provenance', () => {
  const first = detect('subprocess_check');
  const second = detect('subprocess_check');
  assert.deepEqual(first, second);
  assert.equal(first.assessment.completeness, 'OPAQUE_BOUNDARY');
  assert.deepEqual(
    [...new Set(first.assessment.boundaries.map((item) => item.kind))].sort(),
    ['CHILD_INTERPRETER', 'SUBPROCESS'],
  );
  assert.ok(first.assessment.boundaries.every((item) =>
    item.source.path && item.source.line > 0 && item.source.construct));
});

test('dynamic imports are classified separately from ordinary static checks', () => {
  assert.equal(detect('dynamic_check').assessment.completeness, 'OPAQUE_BOUNDARY');
  assert.equal(detect('ordinary_check').assessment.completeness, 'COMPLETE_FOR_CHECK');
});

test('multiple absence sources do not imply dependency completeness', () => {
  const input = opaqueFixture('AV3-006');
  const assessment = input.evidence.check_dependencies.find(
    (item) => item.check_id === 'boundary.observe',
  );
  assessment.mechanisms = [
    { kind: 'STATIC_IMPORT', evidence_refs: ['boundary-inspector'], positive: false },
    { kind: 'NATIVE_SELECTOR', evidence_refs: ['native-selector'], positive: false },
  ];
  const plan = planVerification(input);
  assert.equal(plan.dependency_completeness.agreement_implies_completeness, false);
  assert.ok(plan.selected_checks.some((item) => item.id === 'boundary.observe'));
});

test('ordinary complete evidence supports a safe unrelated skip', () => {
  const plan = planVerification(opaqueFixture('AV3-004'));
  const skipped = plan.skipped_checks.find((item) => item.id === 'boundary.observe');
  assert.equal(skipped.dependency_completeness.state, 'COMPLETE_FOR_CHECK');
  assert.equal(skipped.dependency_completeness.action, 'SKIP');
  assert.equal(plan.argument.every_skip_dependency_complete, true);
});

test('open boundary forces only its check rather than the full catalog', () => {
  const plan = planVerification(opaqueFixture('AV3-001'));
  assert.deepEqual(plan.dependency_completeness.forced_check_ids, ['boundary.observe']);
  assert.equal(plan.escalation.state, 'BROADENED');
  assert.ok(plan.skipped_checks.some((item) => item.id === 'unrelated.unit'));
  const forced = plan.selected_checks.find((item) => item.id === 'boundary.observe');
  assert.equal(forced.dependency_completeness.forced_selection, true);
  assert.ok(forced.reasons.some((item) => item.code === 'OPAQUE_BOUNDARY_FORCED_SELECTION'));
});

test('structural decision is invariant under repository-like identity renaming', () => {
  const original = planVerification(opaqueFixture('AV3-001'));
  const renamed = opaqueFixture('AV3-001');
  renamed.change.paths[0].path = 'lib/completely-different-name.py';
  renamed.evidence.impacts[0].path = renamed.change.paths[0].path;
  renamed.change.target_revision = 'renamed-target';
  renamed.evidence.identity = 'sha256:renamed';
  const mapping = new Map([
    ['changed', 'alpha'], ['boundary', 'beta'], ['unrelated', 'gamma'],
    ['changed.unit', 'check-a'], ['boundary.observe', 'check-b'], ['unrelated.unit', 'check-c'],
  ]);
  renamed.evidence.components.forEach((item) => { item.id = mapping.get(item.id); });
  renamed.evidence.impacts[0].components = ['alpha'];
  renamed.catalog.checks.forEach((item) => {
    item.id = mapping.get(item.id);
    item.scope.components = item.scope.components.map((value) => mapping.get(value));
  });
  renamed.evidence.check_dependencies.forEach((item) => { item.check_id = mapping.get(item.check_id); });
  const repaired = planVerification(renamed);
  assert.equal(repaired.selected_checks.length, original.selected_checks.length);
  assert.deepEqual(
    repaired.selected_checks.map((item) => item.reasons.map((reason) => reason.code).join(',')).sort(),
    original.selected_checks.map((item) => item.reasons.map((reason) => reason.code).join(',')).sort(),
  );
});

test('core contains no target, scenario, path, or check-name special case', () => {
  const core = ['planner.js', 'validate.js'].map((name) =>
    readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')).join('\n');
  for (const forbidden of ['pallets/click', 'test_light_imports', 'AV2-006', 'parser.py']) {
    assert.equal(core.includes(forbidden), false);
  }
});

test('malformed and unsupported boundary evidence is rejected', () => {
  const malformed = opaqueFixture('AV3-001');
  delete malformed.evidence.check_dependencies[1].boundaries[0].source;
  assert.throws(() => planVerification(malformed), /source must be an object/);

  const unsupported = opaqueFixture('AV3-001');
  unsupported.evidence.check_dependencies[1].boundaries[0].kind = 'MAGIC_RUNTIME';
  assert.throws(() => planVerification(unsupported), /kind is unsupported/);
});

test('plan identity binds completeness and remains deterministic', () => {
  const input = opaqueFixture('AV3-001');
  const first = planVerification(input);
  assert.deepEqual(first, planVerification(structuredClone(input)));
  assert.equal(first.plan_identity, contentIdentity({ ...first, plan_identity: undefined }));
  const changed = opaqueFixture('AV3-001');
  changed.evidence.check_dependencies[1].boundaries[0].status = 'CLOSED';
  changed.evidence.check_dependencies[1].completeness = 'COMPLETE_WITH_DECLARED_BOUNDARIES';
  assert.notEqual(planVerification(changed).plan_identity, first.plan_identity);
});

test('Visible Value exposes safety cost as exact counts with retained skips', () => {
  const plan = planVerification(opaqueFixture('AV3-001'));
  const receipt = buildValueReceipt(plan);
  const measurements = Object.fromEntries(receipt.measurements.map((item) => [item.id, item]));
  assert.equal(measurements.dependency_safety_checks_added.result, 1);
  assert.equal(measurements.dependency_safety_checks_added.class, 'EXACT');
  assert.equal(measurements.dependency_safety_test_executions_added.result, 1);
  assert.equal(measurements.checks_skipped.result, 1);
  assert.match(operatorIndicator(plan), /dependency safety additions: 1 checks\/1 test executions/);
  assert.doesNotMatch(operatorIndicator(plan), /failure prevented|system safe/i);
});
