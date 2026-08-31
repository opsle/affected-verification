import { fixture } from './scenarios.js';

function conflictingImpact() {
  const input = fixture('isolated-implementation');
  input.evidence.impacts.push({ ...input.evidence.impacts[0], components: ['unrelated'] });
  return input;
}

function impossibleTestCount() {
  const input = fixture('isolated-implementation');
  input.catalog.checks[0].test_executions = -1;
  return input;
}

function unknownDependency() {
  const input = fixture('isolated-implementation');
  input.evidence.components[0].dependencies.push('missing-component');
  return input;
}

export const negativeCases = [
  { id: 'duplicate-conflicting-impact', expected_error: 'INVALID_INPUT', input: conflictingImpact() },
  { id: 'impossible-negative-test-count', expected_error: 'INVALID_INPUT', input: impossibleTestCount() },
  { id: 'unknown-component-dependency', expected_error: 'INVALID_INPUT', input: unknownDependency() },
];

export function tamperPlan(plan) {
  const tampered = structuredClone(plan);
  tampered.selected_checks[0].command = 'changed-after-planning';
  return tampered;
}

