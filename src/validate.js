export const INPUT_SCHEMA = 'opsle.affected-verification.input.v2';
export const PLAN_SCHEMA = 'opsle.affected-verification.plan.v2';
export const SHADOW_INPUT_SCHEMA = 'opsle.affected-verification.shadow-input.v1';
export const SHADOW_OBSERVATION_SCHEMA = 'opsle.affected-verification.shadow-observation.v1';

const CHECK_TYPES = new Set([
  'unit-test',
  'integration-test',
  'end-to-end-test',
  'lint',
  'typecheck',
  'build',
  'compiler',
  'schema',
  'migration',
  'api-contract',
  'security',
  'snapshot',
  'visual',
  'smoke',
  'release',
  'documentation',
  'test-infrastructure',
  'other',
]);
const TEST_CHECK_TYPES = new Set(['unit-test', 'integration-test', 'end-to-end-test']);

const ESCALATIONS = new Set(['NONE', 'BROADEN', 'FULL', 'INVALIDATE']);
const DEPENDENCY_COMPLETENESS = new Set([
  'COMPLETE_FOR_CHECK',
  'COMPLETE_WITH_DECLARED_BOUNDARIES',
  'INCOMPLETE',
  'OPAQUE_BOUNDARY',
  'UNKNOWN',
]);
const DEPENDENCY_MECHANISMS = new Set([
  'DECLARED_SCOPE',
  'STATIC_IMPORT',
  'NATIVE_SELECTOR',
  'RUNTIME_TRACE',
  'COVERAGE',
  'SUBPROCESS',
  'CHILD_INTERPRETER',
  'DYNAMIC_IMPORT',
  'PLUGIN_OR_ENTRY_POINT_DISCOVERY',
  'EXEC_EVAL_OR_CODE_GENERATION',
  'RUNTIME_LOADED_MODULE',
  'REFLECTION_OR_REGISTRATION',
]);
const BOUNDARY_KINDS = new Set([
  'SUBPROCESS',
  'CHILD_INTERPRETER',
  'DYNAMIC_IMPORT',
  'PLUGIN_OR_ENTRY_POINT_DISCOVERY',
  'EXEC_EVAL_OR_CODE_GENERATION',
  'RUNTIME_LOADED_MODULE',
  'REFLECTION_OR_REGISTRATION',
]);
const BOUNDARY_STATUSES = new Set(['OPEN', 'CLOSED', 'IRRELEVANT']);

export class InputError extends Error {
  constructor(issues, code = 'INVALID_INPUT') {
    const sorted = [...new Set(issues)].sort();
    super(sorted.join('; '));
    this.name = 'InputError';
    this.code = code;
    this.issues = sorted;
  }
}

function objectAt(value, path, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${path} must be an object`);
    return {};
  }
  return value;
}

function arrayAt(value, path, issues, { nonempty = false } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return [];
  }
  if (nonempty && value.length === 0) {
    issues.push(`${path} must not be empty`);
  }
  return value;
}

function stringAt(value, path, issues) {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${path} must be a nonempty string`);
    return '';
  }
  return value;
}

function stringArray(value, path, issues) {
  const result = arrayAt(value, path, issues);
  result.forEach((item, index) => stringAt(item, `${path}[${index}]`, issues));
  return result;
}

function rejectUnknownKeys(object, allowed, path, issues) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      issues.push(`${path}.${key} is not allowed`);
    }
  }
}

function uniqueBy(items, key, path, issues) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const value = item?.[key];
    if (typeof value === 'string' && seen.has(value)) {
      issues.push(`${path}[${index}].${key} duplicates ${value}`);
    }
    seen.add(value);
  }
}

function validateChange(raw, issues) {
  const change = objectAt(raw, 'change', issues);
  rejectUnknownKeys(change, ['base_revision', 'target_revision', 'identity', 'paths'], 'change', issues);
  stringAt(change.base_revision, 'change.base_revision', issues);
  stringAt(change.target_revision, 'change.target_revision', issues);
  if (change.identity !== undefined) stringAt(change.identity, 'change.identity', issues);
  const paths = arrayAt(change.paths, 'change.paths', issues, { nonempty: true });
  paths.forEach((rawPath, index) => {
    const path = objectAt(rawPath, `change.paths[${index}]`, issues);
    rejectUnknownKeys(path, ['path', 'regions', 'risk_tags'], `change.paths[${index}]`, issues);
    stringAt(path.path, `change.paths[${index}].path`, issues);
    stringArray(path.regions ?? [], `change.paths[${index}].regions`, issues);
    stringArray(path.risk_tags ?? [], `change.paths[${index}].risk_tags`, issues);
  });
  uniqueBy(paths, 'path', 'change.paths', issues);
  return change;
}

function validateEvidence(raw, changedPaths, issues) {
  const evidence = objectAt(raw, 'evidence', issues);
  rejectUnknownKeys(evidence, ['identity', 'complete', 'providers', 'components', 'impacts', 'check_dependencies'], 'evidence', issues);
  stringAt(evidence.identity, 'evidence.identity', issues);
  if (typeof evidence.complete !== 'boolean') issues.push('evidence.complete must be a boolean');
  const providers = arrayAt(evidence.providers, 'evidence.providers', issues, { nonempty: true });
  providers.forEach((rawProvider, index) => {
    const provider = objectAt(rawProvider, `evidence.providers[${index}]`, issues);
    rejectUnknownKeys(provider, ['id', 'kind', 'version', 'identity'], `evidence.providers[${index}]`, issues);
    for (const key of ['id', 'kind', 'version', 'identity']) {
      stringAt(provider[key], `evidence.providers[${index}].${key}`, issues);
    }
  });
  uniqueBy(providers, 'id', 'evidence.providers', issues);

  const components = arrayAt(evidence.components, 'evidence.components', issues, { nonempty: true });
  components.forEach((rawComponent, index) => {
    const component = objectAt(rawComponent, `evidence.components[${index}]`, issues);
    rejectUnknownKeys(component, ['id', 'dependencies'], `evidence.components[${index}]`, issues);
    stringAt(component.id, `evidence.components[${index}].id`, issues);
    stringArray(component.dependencies, `evidence.components[${index}].dependencies`, issues);
  });
  uniqueBy(components, 'id', 'evidence.components', issues);
  const componentIds = new Set(components.map((item) => item.id));
  components.forEach((component) => component.dependencies?.forEach((dependency) => {
    if (!componentIds.has(dependency)) {
      issues.push(`component ${component.id} references unknown dependency ${dependency}`);
    }
  }));

  const impacts = arrayAt(evidence.impacts, 'evidence.impacts', issues);
  impacts.forEach((rawImpact, index) => {
    const impact = objectAt(rawImpact, `evidence.impacts[${index}]`, issues);
    rejectUnknownKeys(impact, ['path', 'components', 'confidence', 'reason'], `evidence.impacts[${index}]`, issues);
    stringAt(impact.path, `evidence.impacts[${index}].path`, issues);
    stringArray(impact.components, `evidence.impacts[${index}].components`, issues);
    if (!['KNOWN', 'UNKNOWN'].includes(impact.confidence)) {
      issues.push(`evidence.impacts[${index}].confidence must be KNOWN or UNKNOWN`);
    }
    if (impact.reason !== undefined) stringAt(impact.reason, `evidence.impacts[${index}].reason`, issues);
    if (impact.confidence === 'KNOWN' && impact.components?.length === 0) {
      issues.push(`evidence.impacts[${index}].components must not be empty when confidence is KNOWN`);
    }
    impact.components?.forEach((component) => {
      if (!componentIds.has(component)) {
        issues.push(`impact for ${impact.path} references unknown component ${component}`);
      }
    });
    if (!changedPaths.has(impact.path)) {
      issues.push(`impact path ${impact.path} is not in the change set`);
    }
  });
  uniqueBy(impacts, 'path', 'evidence.impacts', issues);
  return evidence;
}

function validateCheckDependencies(evidence, catalog, issues) {
  const providerIds = new Set((evidence.providers ?? []).map((item) => item.id));
  const checkIds = new Set((catalog.checks ?? []).map((item) => item.id));
  const assessments = arrayAt(
    evidence.check_dependencies,
    'evidence.check_dependencies',
    issues,
    { nonempty: true },
  );
  assessments.forEach((rawAssessment, index) => {
    const path = `evidence.check_dependencies[${index}]`;
    const assessment = objectAt(rawAssessment, path, issues);
    rejectUnknownKeys(
      assessment,
      ['check_id', 'completeness', 'mechanisms', 'boundaries', 'explanation'],
      path,
      issues,
    );
    stringAt(assessment.check_id, `${path}.check_id`, issues);
    if (!checkIds.has(assessment.check_id)) {
      issues.push(`${path}.check_id references unknown check ${assessment.check_id}`);
    }
    if (!DEPENDENCY_COMPLETENESS.has(assessment.completeness)) {
      issues.push(`${path}.completeness is unsupported`);
    }
    stringAt(assessment.explanation, `${path}.explanation`, issues);

    const mechanisms = arrayAt(
      assessment.mechanisms,
      `${path}.mechanisms`,
      issues,
      { nonempty: true },
    );
    mechanisms.forEach((rawMechanism, mechanismIndex) => {
      const mechanismPath = `${path}.mechanisms[${mechanismIndex}]`;
      const mechanism = objectAt(rawMechanism, mechanismPath, issues);
      rejectUnknownKeys(mechanism, ['kind', 'evidence_refs', 'positive'], mechanismPath, issues);
      if (!DEPENDENCY_MECHANISMS.has(mechanism.kind)) {
        issues.push(`${mechanismPath}.kind is unsupported`);
      }
      if (typeof mechanism.positive !== 'boolean') {
        issues.push(`${mechanismPath}.positive must be a boolean`);
      }
      const refs = stringArray(mechanism.evidence_refs, `${mechanismPath}.evidence_refs`, issues);
      if (refs.length === 0) issues.push(`${mechanismPath}.evidence_refs must not be empty`);
      refs.forEach((ref) => {
        if (!providerIds.has(ref)) issues.push(`${mechanismPath}.evidence_refs references unknown provider ${ref}`);
      });
    });
    uniqueBy(mechanisms, 'kind', `${path}.mechanisms`, issues);

    const boundaries = arrayAt(assessment.boundaries, `${path}.boundaries`, issues);
    boundaries.forEach((rawBoundary, boundaryIndex) => {
      const boundaryPath = `${path}.boundaries[${boundaryIndex}]`;
      const boundary = objectAt(rawBoundary, boundaryPath, issues);
      rejectUnknownKeys(
        boundary,
        ['id', 'kind', 'status', 'relevant', 'explanation', 'evidence_refs', 'source'],
        boundaryPath,
        issues,
      );
      stringAt(boundary.id, `${boundaryPath}.id`, issues);
      if (!BOUNDARY_KINDS.has(boundary.kind)) issues.push(`${boundaryPath}.kind is unsupported`);
      if (!BOUNDARY_STATUSES.has(boundary.status)) issues.push(`${boundaryPath}.status is unsupported`);
      if (typeof boundary.relevant !== 'boolean') issues.push(`${boundaryPath}.relevant must be a boolean`);
      stringAt(boundary.explanation, `${boundaryPath}.explanation`, issues);
      const refs = stringArray(boundary.evidence_refs, `${boundaryPath}.evidence_refs`, issues);
      if (refs.length === 0) issues.push(`${boundaryPath}.evidence_refs must not be empty`);
      refs.forEach((ref) => {
        if (!providerIds.has(ref)) issues.push(`${boundaryPath}.evidence_refs references unknown provider ${ref}`);
      });
      const source = objectAt(boundary.source, `${boundaryPath}.source`, issues);
      rejectUnknownKeys(source, ['path', 'line', 'construct'], `${boundaryPath}.source`, issues);
      stringAt(source.path, `${boundaryPath}.source.path`, issues);
      stringAt(source.construct, `${boundaryPath}.source.construct`, issues);
      if (!Number.isSafeInteger(source.line) || source.line < 1) {
        issues.push(`${boundaryPath}.source.line must be a positive safe integer`);
      }
      if (boundary.status === 'OPEN' && boundary.relevant !== true) {
        issues.push(`${boundaryPath} OPEN boundary must be relevant`);
      }
      if (boundary.status === 'IRRELEVANT' && boundary.relevant !== false) {
        issues.push(`${boundaryPath} IRRELEVANT boundary must not be relevant`);
      }
    });
    uniqueBy(boundaries, 'id', `${path}.boundaries`, issues);

    const open = boundaries.filter((item) => item?.status === 'OPEN' && item?.relevant === true);
    if (assessment.completeness === 'OPAQUE_BOUNDARY' && open.length === 0) {
      issues.push(`${path} OPAQUE_BOUNDARY requires a relevant OPEN boundary`);
    }
    if (['COMPLETE_FOR_CHECK', 'COMPLETE_WITH_DECLARED_BOUNDARIES'].includes(assessment.completeness)
      && (open.length > 0 || mechanisms.length === 0)) {
      issues.push(`${path} complete evidence requires mechanisms and no relevant OPEN boundary`);
    }
    if (assessment.completeness === 'COMPLETE_WITH_DECLARED_BOUNDARIES'
      && boundaries.filter((item) => item?.relevant === true).length === 0) {
      issues.push(`${path} COMPLETE_WITH_DECLARED_BOUNDARIES requires a relevant declared boundary`);
    }
  });
  uniqueBy(assessments, 'check_id', 'evidence.check_dependencies', issues);
  for (const checkId of [...checkIds].sort()) {
    if (!assessments.some((item) => item?.check_id === checkId)) {
      issues.push(`evidence.check_dependencies is missing check ${checkId}`);
    }
  }
  return assessments;
}

function validateCatalog(raw, componentIds, issues) {
  const catalog = objectAt(raw, 'catalog', issues);
  rejectUnknownKeys(catalog, ['identity', 'complete', 'checks'], 'catalog', issues);
  stringAt(catalog.identity, 'catalog.identity', issues);
  if (typeof catalog.complete !== 'boolean') issues.push('catalog.complete must be a boolean');
  const checks = arrayAt(catalog.checks, 'catalog.checks', issues, { nonempty: true });
  checks.forEach((rawCheck, index) => {
    const check = objectAt(rawCheck, `catalog.checks[${index}]`, issues);
    rejectUnknownKeys(check, ['id', 'type', 'command', 'scope', 'tags', 'test_executions', 'cost'], `catalog.checks[${index}]`, issues);
    stringAt(check.id, `catalog.checks[${index}].id`, issues);
    if (!CHECK_TYPES.has(check.type)) issues.push(`catalog.checks[${index}].type is unsupported`);
    stringAt(check.command, `catalog.checks[${index}].command`, issues);
    stringArray(check.tags, `catalog.checks[${index}].tags`, issues);
    if (!Number.isSafeInteger(check.test_executions) || check.test_executions < 0) {
      issues.push(`catalog.checks[${index}].test_executions must be a nonnegative safe integer`);
    }
    if (!TEST_CHECK_TYPES.has(check.type) && check.test_executions !== 0) {
      issues.push(`catalog.checks[${index}] non-test check cannot declare test executions`);
    }
    const scope = objectAt(check.scope, `catalog.checks[${index}].scope`, issues);
    rejectUnknownKeys(scope, ['components'], `catalog.checks[${index}].scope`, issues);
    const scoped = stringArray(scope.components, `catalog.checks[${index}].scope.components`, issues);
    if (scoped.length === 0) issues.push(`catalog.checks[${index}].scope.components must not be empty`);
    scoped.forEach((component) => {
      if (component !== '*' && !componentIds.has(component)) {
        issues.push(`check ${check.id} references unknown component ${component}`);
      }
    });
    if (check.cost !== undefined) {
      const cost = objectAt(check.cost, `catalog.checks[${index}].cost`, issues);
      rejectUnknownKeys(cost, ['value', 'unit'], `catalog.checks[${index}].cost`, issues);
      if (!Number.isFinite(cost.value) || cost.value < 0) issues.push(`catalog.checks[${index}].cost.value must be finite and nonnegative`);
      stringAt(cost.unit, `catalog.checks[${index}].cost.unit`, issues);
    }
  });
  uniqueBy(checks, 'id', 'catalog.checks', issues);
  return catalog;
}

function validatePolicy(raw, issues) {
  const policy = objectAt(raw, 'policy', issues);
  rejectUnknownKeys(policy, ['identity', 'version', 'rules'], 'policy', issues);
  stringAt(policy.identity, 'policy.identity', issues);
  stringAt(policy.version, 'policy.version', issues);
  const rules = arrayAt(policy.rules, 'policy.rules', issues);
  rules.forEach((rawRule, index) => {
    const rule = objectAt(rawRule, `policy.rules[${index}]`, issues);
    rejectUnknownKeys(rule, ['id', 'match', 'escalation', 'required_check_tags'], `policy.rules[${index}]`, issues);
    stringAt(rule.id, `policy.rules[${index}].id`, issues);
    if (!ESCALATIONS.has(rule.escalation)) issues.push(`policy.rules[${index}].escalation is invalid`);
    stringArray(rule.required_check_tags, `policy.rules[${index}].required_check_tags`, issues);
    const match = objectAt(rule.match, `policy.rules[${index}].match`, issues);
    rejectUnknownKeys(match, ['path_globs', 'risk_tags', 'component_ids'], `policy.rules[${index}].match`, issues);
    const matcherCount = ['path_globs', 'risk_tags', 'component_ids']
      .map((key) => stringArray(match[key] ?? [], `policy.rules[${index}].match.${key}`, issues).length)
      .reduce((sum, count) => sum + count, 0);
    if (matcherCount === 0) issues.push(`policy.rules[${index}].match must contain at least one matcher`);
  });
  uniqueBy(rules, 'id', 'policy.rules', issues);
  return policy;
}

export function validateInput(input) {
  const issues = [];
  const root = objectAt(input, 'input', issues);
  rejectUnknownKeys(root, ['schema', 'change', 'evidence', 'catalog', 'policy'], 'input', issues);
  if (root.schema !== INPUT_SCHEMA) issues.push(`input.schema must be ${INPUT_SCHEMA}`);
  const change = validateChange(root.change, issues);
  const changedPaths = new Set((change.paths ?? []).map((item) => item.path));
  const evidence = validateEvidence(root.evidence, changedPaths, issues);
  const componentIds = new Set((evidence.components ?? []).map((item) => item.id));
  const catalog = validateCatalog(root.catalog, componentIds, issues);
  validateCheckDependencies(evidence, catalog, issues);
  validatePolicy(root.policy, issues);
  if (issues.length) throw new InputError(issues);
  return root;
}

export function validateShadowInput(input, plan) {
  const issues = [];
  const root = objectAt(input, 'shadow', issues);
  rejectUnknownKeys(root, ['schema', 'change_identity', 'executed_check_ids', 'failures'], 'shadow', issues);
  if (root.schema !== SHADOW_INPUT_SCHEMA) issues.push(`shadow.schema must be ${SHADOW_INPUT_SCHEMA}`);
  if (root.change_identity !== plan.change.identity) issues.push('shadow.change_identity does not match plan');
  const known = new Set([...plan.selected_checks, ...plan.skipped_checks].map((item) => item.id));
  const executed = stringArray(root.executed_check_ids, 'shadow.executed_check_ids', issues);
  if (new Set(executed).size !== executed.length) issues.push('shadow.executed_check_ids contains duplicates');
  executed.forEach((id) => {
    if (!known.has(id)) issues.push(`shadow executed unknown check ${id}`);
  });
  const failures = arrayAt(root.failures, 'shadow.failures', issues);
  failures.forEach((rawFailure, index) => {
    const failure = objectAt(rawFailure, `shadow.failures[${index}]`, issues);
    rejectUnknownKeys(failure, ['check_id', 'relevant', 'reason'], `shadow.failures[${index}]`, issues);
    stringAt(failure.check_id, `shadow.failures[${index}].check_id`, issues);
    if (typeof failure.relevant !== 'boolean') issues.push(`shadow.failures[${index}].relevant must be a boolean`);
    stringAt(failure.reason, `shadow.failures[${index}].reason`, issues);
    if (!executed.includes(failure.check_id)) issues.push(`failure ${failure.check_id} was not executed`);
  });
  uniqueBy(failures, 'check_id', 'shadow.failures', issues);
  if (issues.length) throw new InputError(issues);
  return root;
}
