import { contentIdentity, deepFreeze } from './canonical.js';
import { globMatches, planVerification } from './planner.js';
import { InputError } from './validate.js';

export const TASK_REQUEST_SCHEMA = 'opsle.affected-verification.task-request.v1';
export const TASK_MANIFEST_SCHEMA = 'opsle.affected-verification.manifest.v1';
export const TASK_PLAN_SCHEMA = 'opsle.affected-verification.task-plan.v1';

function object(value, path, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${path} must be an object`);
    return {};
  }
  return value;
}

function array(value, path, issues) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return [];
  }
  return value;
}

function text(value, path, issues) {
  if (typeof value !== 'string' || !value.trim()) issues.push(`${path} must be a nonempty string`);
  return value;
}

function exactKeys(value, allowed, path, issues) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${path}.${key} is not allowed`);
  }
}

function taskInput(request) {
  const issues = [];
  const root = object(request, 'request', issues);
  exactKeys(root, ['schema', 'task', 'repository', 'change', 'manifest'], 'request', issues);
  if (root.schema !== TASK_REQUEST_SCHEMA) issues.push(`request.schema must be ${TASK_REQUEST_SCHEMA}`);

  const task = object(root.task, 'request.task', issues);
  exactKeys(task, ['id', 'execution_id'], 'request.task', issues);
  text(task.id, 'request.task.id', issues);
  text(task.execution_id, 'request.task.execution_id', issues);

  const repository = object(root.repository, 'request.repository', issues);
  exactKeys(repository, ['identity', 'base_revision', 'target_revision'], 'request.repository', issues);
  text(repository.identity, 'request.repository.identity', issues);
  text(repository.base_revision, 'request.repository.base_revision', issues);
  text(repository.target_revision, 'request.repository.target_revision', issues);

  const change = object(root.change, 'request.change', issues);
  exactKeys(change, ['identity', 'paths'], 'request.change', issues);
  text(change.identity, 'request.change.identity', issues);
  const paths = array(change.paths, 'request.change.paths', issues);
  for (const [index, itemValue] of paths.entries()) {
    const item = object(itemValue, `request.change.paths[${index}]`, issues);
    exactKeys(item, ['path', 'regions', 'risk_tags'], `request.change.paths[${index}]`, issues);
    text(item.path, `request.change.paths[${index}].path`, issues);
    array(item.regions ?? [], `request.change.paths[${index}].regions`, issues);
    array(item.risk_tags ?? [], `request.change.paths[${index}].risk_tags`, issues);
  }

  const manifest = object(root.manifest, 'request.manifest', issues);
  exactKeys(manifest, [
    'schema', 'source_path', 'source_identity', 'evidence_complete',
    'catalog_complete', 'components', 'checks', 'policy',
  ], 'request.manifest', issues);
  if (manifest.schema !== TASK_MANIFEST_SCHEMA) {
    issues.push(`request.manifest.schema must be ${TASK_MANIFEST_SCHEMA}`);
  }
  text(manifest.source_path, 'request.manifest.source_path', issues);
  text(manifest.source_identity, 'request.manifest.source_identity', issues);
  if (typeof manifest.evidence_complete !== 'boolean') {
    issues.push('request.manifest.evidence_complete must be a boolean');
  }
  if (typeof manifest.catalog_complete !== 'boolean') {
    issues.push('request.manifest.catalog_complete must be a boolean');
  }
  const components = array(manifest.components, 'request.manifest.components', issues);
  for (const [index, componentValue] of components.entries()) {
    const component = object(componentValue, `request.manifest.components[${index}]`, issues);
    exactKeys(component, ['id', 'dependencies', 'path_globs', 'risk_tags'], `request.manifest.components[${index}]`, issues);
    text(component.id, `request.manifest.components[${index}].id`, issues);
    const globs = array(component.path_globs, `request.manifest.components[${index}].path_globs`, issues);
    if (!globs.length) issues.push(`request.manifest.components[${index}].path_globs must not be empty`);
    globs.forEach((glob, globIndex) => text(glob, `request.manifest.components[${index}].path_globs[${globIndex}]`, issues));
    array(component.dependencies, `request.manifest.components[${index}].dependencies`, issues);
    array(component.risk_tags ?? [], `request.manifest.components[${index}].risk_tags`, issues);
  }
  array(manifest.checks, 'request.manifest.checks', issues);
  object(manifest.policy, 'request.manifest.policy', issues);
  if (issues.length) throw new InputError(issues);
  return root;
}

function assessment(check, providerId) {
  const dependency = check.dependency ?? {
    completeness: 'UNKNOWN',
    mechanisms: [{ kind: 'DECLARED_SCOPE', positive: false }],
    boundaries: [],
    explanation: 'The manifest did not declare complete check-level dependency evidence.',
  };
  return {
    check_id: check.id,
    completeness: dependency.completeness,
    mechanisms: dependency.mechanisms.map((item) => ({
      kind: item.kind,
      positive: item.positive,
      evidence_refs: [providerId],
    })),
    boundaries: dependency.boundaries.map((item) => ({
      ...item,
      evidence_refs: [providerId],
    })),
    explanation: dependency.explanation,
  };
}

export function planTaskVerification(rawRequest) {
  const request = taskInput(rawRequest);
  const providerId = 'base-revision-manifest';
  const impacts = request.change.paths.map((changed) => {
    const matches = request.manifest.components.filter((component) =>
      component.path_globs.some((glob) => globMatches(glob, changed.path)));
    return {
      path: changed.path,
      components: [...new Set(matches.map((item) => item.id))].sort(),
      confidence: matches.length ? 'KNOWN' : 'UNKNOWN',
      reason: matches.length
        ? `Matched immutable manifest components: ${matches.map((item) => item.id).sort().join(', ')}`
        : 'No immutable manifest component owns this changed path.',
    };
  });
  const changedPaths = request.change.paths.map((changed) => {
    const matchedTags = request.manifest.components
      .filter((component) => component.path_globs.some((glob) => globMatches(glob, changed.path)))
      .flatMap((component) => component.risk_tags ?? []);
    return {
      path: changed.path,
      regions: [...new Set(changed.regions ?? [])].sort(),
      risk_tags: [...new Set([...(changed.risk_tags ?? []), ...matchedTags])].sort(),
    };
  });
  const input = {
    schema: 'opsle.affected-verification.input.v2',
    change: {
      base_revision: request.repository.base_revision,
      target_revision: request.repository.target_revision,
      identity: request.change.identity,
      paths: changedPaths,
    },
    evidence: {
      identity: contentIdentity({
        manifest: request.manifest.source_identity,
        paths: changedPaths,
        impacts,
      }),
      complete: request.manifest.evidence_complete,
      providers: [{
        id: providerId,
        kind: 'BASE_REVISION_MANIFEST',
        version: '1',
        identity: request.manifest.source_identity,
      }],
      components: request.manifest.components.map((component) => ({
        id: component.id,
        dependencies: component.dependencies,
      })),
      impacts,
      check_dependencies: request.manifest.checks.map((check) => assessment(check, providerId)),
    },
    catalog: {
      identity: contentIdentity(request.manifest.checks),
      complete: request.manifest.catalog_complete,
      checks: request.manifest.checks.map(({ dependency: _dependency, ...check }) => check),
    },
    policy: {
      identity: contentIdentity(request.manifest.policy),
      ...request.manifest.policy,
    },
  };
  const plan = planVerification(input);
  const result = {
    schema: TASK_PLAN_SCHEMA,
    decision_identity: null,
    task: { ...request.task },
    repository: { ...request.repository },
    manifest: {
      schema: request.manifest.schema,
      source_path: request.manifest.source_path,
      source_identity: request.manifest.source_identity,
    },
    impacts,
    plan,
  };
  return deepFreeze({
    ...result,
    decision_identity: contentIdentity({ ...result, decision_identity: undefined }),
  });
}
