#!/usr/bin/env node
import assert from 'node:assert/strict';
import { InputError, buildValueReceipt, planVerification } from '../src/index.js';
import { scenarios } from '../fixtures/scenarios.js';
import { negativeCases } from '../fixtures/negative-cases.js';

let passed = 0;
for (const scenario of scenarios) {
  if (scenario.expected_error) {
    assert.throws(
      () => planVerification(scenario.input),
      (error) => error instanceof InputError && error.code === scenario.expected_error,
    );
  } else {
    const plan = planVerification(scenario.input);
    assert.equal(plan.sufficiency, scenario.expected_sufficiency);
    assert.ok(plan.skipped_checks.every((check) => check.reasons.length > 0));
    assert.equal(buildValueReceipt(plan).schema, 'opsle.value-receipt.v1');
  }
  passed += 1;
}
for (const negative of negativeCases) {
  assert.throws(
    () => planVerification(negative.input),
    (error) => error instanceof InputError && error.code === negative.expected_error,
  );
  passed += 1;
}
process.stdout.write(`PASS: ${passed} synthetic conformance scenarios\n`);
