import test from 'node:test';
import assert from 'node:assert/strict';
import { contentIdentity, InputError, planVerification } from '../src/index.js';
import { fixture, scenarios } from '../fixtures/scenarios.js';
import { negativeCases } from '../fixtures/negative-cases.js';

for (const scenario of scenarios) {
  test(`fixture: ${scenario.id}`, () => {
    if (scenario.expected_error) {
      assert.throws(
        () => planVerification(scenario.input),
        (error) => error instanceof InputError && error.code === scenario.expected_error,
      );
      return;
    }
    const plan = planVerification(scenario.input);
    assert.equal(plan.sufficiency, scenario.expected_sufficiency);
    assert.equal(plan.argument.unknown_is_safe_to_skip, false);
    assert.equal(plan.argument.every_skip_explained, true);
  });
}

for (const negative of negativeCases) {
  test(`negative fixture: ${negative.id}`, () => {
    assert.throws(
      () => planVerification(negative.input),
      (error) => error instanceof InputError && error.code === negative.expected_error,
    );
  });
}

test('identical input produces an identical deterministic plan', () => {
  const input = fixture('isolated-implementation');
  assert.deepEqual(planVerification(input), planVerification(structuredClone(input)));
});

test('unrelated checks are skipped with exact reasons', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  const skipped = plan.skipped_checks.find((item) => item.id === 'unrelated.large-suite');
  assert.deepEqual(skipped.reasons.map((item) => item.code), ['OUTSIDE_TRANSITIVE_IMPACT_SET']);
});

test('direct affected checks are selected', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  assert.deepEqual(
    plan.selected_checks.map((item) => item.id),
    ['isolated.unit', 'project.lint', 'project.typecheck'],
  );
});

test('reverse dependencies broaden the selected components and checks', () => {
  const plan = planVerification(fixture('reverse-dependent'));
  assert.deepEqual(plan.affected_components, [
    { id: 'consumer', direct: false, via_dependencies: ['feature'] },
    { id: 'feature', direct: true, via_dependencies: [] },
  ]);
  assert.ok(plan.selected_checks.some((item) => item.id === 'consumer.integration'));
});

test('shared component policy broadens deterministically', () => {
  const plan = planVerification(fixture('shared-common'));
  assert.equal(plan.escalation.state, 'BROADENED');
  assert.deepEqual(plan.risk.matched_policy_rules, ['shared-boundary']);
  assert.ok(plan.selected_checks.some((item) => item.id === 'subsystem-a.integration'));
  assert.ok(plan.selected_checks.some((item) => item.id === 'subsystem-b.integration'));
});

test('global policy selects the full catalog', () => {
  const plan = planVerification(fixture('global-configuration'));
  assert.equal(plan.skipped_checks.length, 0);
  assert.equal(plan.escalation.state, 'FULL');
  assert.equal(plan.selected_checks.length, fixture('global-configuration').catalog.checks.length);
});

test('incomplete impact evidence never claims targeted sufficiency', () => {
  const plan = planVerification(fixture('incomplete-dependency-graph'));
  assert.equal(plan.sufficiency, 'FULL_VERIFICATION_REQUIRED');
  assert.equal(plan.uncertainty.state, 'PRESENT');
  assert.ok(plan.uncertainty.reasons.includes('DEPENDENCY_EVIDENCE_INCOMPLETE'));
  assert.equal(plan.skipped_checks.length, 0);
});

test('unknown changed path fails closed', () => {
  const plan = planVerification(fixture('unknown-changed-file'));
  assert.equal(plan.sufficiency, 'FULL_VERIFICATION_REQUIRED');
  assert.deepEqual(plan.uncertainty.reasons, ['UNKNOWN_IMPACT:mystery/generated.xyz']);
  assert.equal(plan.skipped_checks.length, 0);
});

test('incomplete catalog is insufficient even when all known checks are selected', () => {
  const input = fixture('isolated-implementation');
  input.catalog.complete = false;
  const plan = planVerification(input);
  assert.equal(plan.sufficiency, 'INSUFFICIENT_EVIDENCE');
  assert.equal(plan.skipped_checks.length, 0);
  assert.ok(plan.uncertainty.reasons.includes('VERIFICATION_CATALOG_INCOMPLETE'));
});

test('uncovered affected component is insufficient even with a complete catalog', () => {
  const input = fixture('isolated-implementation');
  input.catalog.checks = input.catalog.checks.filter((check) => !check.scope.components.includes('isolated'));
  const plan = planVerification(input);
  assert.equal(plan.sufficiency, 'INSUFFICIENT_EVIDENCE');
  assert.ok(plan.uncertainty.reasons.includes('NO_VERIFICATION_COVERAGE:isolated'));
  assert.equal(plan.skipped_checks.length, 0);
});

test('known impact cannot assert an empty component set', () => {
  const input = fixture('isolated-implementation');
  input.evidence.impacts[0].components = [];
  assert.throws(() => planVerification(input), /must not be empty when confidence is KNOWN/);
});

test('unsatisfied policy requirement is insufficient and fails closed', () => {
  const input = fixture('authentication-boundary');
  input.catalog.checks.forEach((check) => {
    check.tags = check.tags.filter((tag) => tag !== 'security-boundary');
  });
  const plan = planVerification(input);
  assert.equal(plan.sufficiency, 'INSUFFICIENT_EVIDENCE');
  assert.ok(plan.uncertainty.reasons.includes('POLICY_REQUIREMENT_UNSATISFIED:security-boundary:security-boundary'));
  assert.equal(plan.skipped_checks.length, 0);
});

test('every skipped check has a nonempty evidence-backed reason', () => {
  const plan = planVerification(fixture('readme-only'));
  for (const check of plan.skipped_checks) {
    assert.ok(check.reasons.length > 0);
    assert.ok(check.reasons.every((item) => item.code && item.detail && item.evidence_refs.length));
  }
});

test('duplicate impact evidence is rejected instead of merged optimistically', () => {
  const input = fixture('isolated-implementation');
  input.evidence.impacts.push({ ...input.evidence.impacts[0], components: ['unrelated'] });
  assert.throws(
    () => planVerification(input),
    (error) => error instanceof InputError && error.issues.some((item) => item.includes('duplicates')),
  );
});

test('duplicate provider evidence is rejected', () => {
  const input = fixture('isolated-implementation');
  input.evidence.providers.push({ ...input.evidence.providers[0] });
  assert.throws(() => planVerification(input), /duplicates synthetic-graph/);
});

test('unknown component dependency is rejected', () => {
  const input = fixture('isolated-implementation');
  input.evidence.components[0].dependencies.push('missing');
  assert.throws(() => planVerification(input), /unknown dependency missing/);
});

test('malformed schema and unknown fields are rejected', () => {
  const input = fixture('isolated-implementation');
  input.schema = 'wrong';
  input.unsafe = true;
  assert.throws(
    () => planVerification(input),
    (error) => error.issues.length === 2 && error.issues[0].includes('must be opsle') && error.issues[1].includes('not allowed'),
  );
});

test('negative numeric inputs are rejected', () => {
  const input = fixture('isolated-implementation');
  input.catalog.checks[0].test_executions = -1;
  assert.throws(() => planVerification(input), /nonnegative safe integer/);
});

test('unsafe integer inputs are rejected', () => {
  const input = fixture('isolated-implementation');
  input.catalog.checks[1].test_executions = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => planVerification(input), /nonnegative safe integer/);
});

test('non-test checks cannot disguise test execution counts', () => {
  const input = fixture('isolated-implementation');
  input.catalog.checks[0].test_executions = 1;
  assert.throws(() => planVerification(input), /non-test check cannot declare test executions/);
});

test('test-infrastructure checks cannot declare test executions', () => {
  const input = fixture('isolated-implementation');
  const check = input.catalog.checks.find((item) => item.type === 'test-infrastructure');
  check.test_executions = 1;
  assert.throws(() => planVerification(input), /non-test check cannot declare test executions/);
});

test('plan identity and provenance hash are stable and content-bound', () => {
  const input = fixture('isolated-implementation');
  const plan = planVerification(input);
  const withoutIdentity = { ...plan, plan_identity: undefined };
  assert.equal(plan.plan_identity, contentIdentity(withoutIdentity));
  assert.equal(plan.provenance.input_hash, contentIdentity(input));
  const changed = fixture('isolated-implementation');
  changed.change.target_revision = 'different-target';
  assert.notEqual(planVerification(changed).plan_identity, plan.plan_identity);
});

test('selected and skipped arrays are immutable', () => {
  const plan = planVerification(fixture('isolated-implementation'));
  assert.throws(() => plan.selected_checks.push({}), TypeError);
  assert.throws(() => plan.skipped_checks[0].reasons.push({}), TypeError);
});
