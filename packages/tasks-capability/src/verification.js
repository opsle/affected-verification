import { executionTarget, projectGit } from './execution.js';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentIdentity } from './core/canonical.js';
import { planTaskVerification } from './core/task.js';
import { validateSchema } from './schema.js';

export const AV_MANIFEST_PATH = '.opsle/affected-verification.json';
const AV_TASK_PLAN_SCHEMA = 'opsle.affected-verification.task-plan.v1';
const AV_PLAN_SCHEMA = 'opsle.affected-verification.plan.v2';
const AV_REQUEST_SCHEMA = 'opsle.affected-verification.task-request.v1';
const AV_MANIFEST_SCHEMA = 'opsle.affected-verification.manifest.v1';
const AV_EVIDENCE_SCHEMA = 'opsle.tasks.affected-verification-evidence.v1';
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_ARTIFACT_BYTES = 5_000_000;
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function git(args, task, config, options = {}) {
  return projectGit(config, executionTarget(task), args, task.worktree_path, options);
}

function atomicJson(path, value) {
  const text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text) > MAX_ARTIFACT_BYTES) {
    throw new Error('Affected Verification evidence exceeds the bounded artifact limit.');
  }
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

function fallbackManifest(testCommand) {
  const checks = testCommand.trim() ? [{
    id: 'tasks.full-verification',
    type: 'integration-test',
    command: testCommand,
    scope: { components: ['repository'] },
    tags: ['tasks-full-fallback'],
    test_executions: 1,
    dependency: {
      completeness: 'UNKNOWN',
      mechanisms: [{ kind: 'DECLARED_SCOPE', positive: false }],
      boundaries: [],
      explanation: 'No base-revision AV manifest exists; Tasks can defend only its full configured command.',
    },
  }] : [];
  return {
    schema: AV_MANIFEST_SCHEMA,
    source_path: '<tasks-project-test-command>',
    source_identity: hash(testCommand),
    evidence_complete: false,
    catalog_complete: true,
    components: [{ id: 'repository', dependencies: [], path_globs: ['**'], risk_tags: [] }],
    checks,
    policy: { version: 'tasks-fallback-v1', rules: [] },
  };
}

function baseManifest(task, config) {
  const object = `${task.base_commit}:${AV_MANIFEST_PATH}`;
  const exists = git(['cat-file', '-e', object], task, config, { allowFailure: true });
  if (exists.status !== 0) return fallbackManifest(task.test_command || '');
  const raw = git(['show', object], task, config);
  if (Buffer.byteLength(raw) > MAX_MANIFEST_BYTES) {
    throw new Error(`Affected Verification manifest exceeds ${MAX_MANIFEST_BYTES} bytes.`);
  }
  let manifest;
  try { manifest = JSON.parse(raw); }
  catch { throw new Error(`Base-revision ${AV_MANIFEST_PATH} is not valid JSON.`); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Base-revision ${AV_MANIFEST_PATH} must contain a JSON object.`);
  }
  validateSchema('manifest-v1', manifest);
  const policy = manifest.policy && typeof manifest.policy === 'object'
    ? manifest.policy
    : { version: '1', rules: [] };
  const rules = Array.isArray(policy.rules) ? [...policy.rules] : [];
  rules.push({
    id: 'affected-verification-manifest-change',
    match: { path_globs: [AV_MANIFEST_PATH], risk_tags: [], component_ids: [] },
    escalation: 'FULL',
    required_check_tags: [],
  });
  return {
    ...manifest,
    schema: manifest.schema,
    source_path: AV_MANIFEST_PATH,
    source_identity: hash(raw),
    policy: { ...policy, rules },
  };
}

export function captureBuildChange(task, config = {}) {
  if (!task.worktree_path || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(task.base_commit || '')) {
    throw new Error('Affected Verification requires a retained worktree and exact base revision.');
  }
  git(['cat-file', '-e', `${task.base_commit}^{commit}`], task, config);
  git(['add', '--all'], task, config);
  const targetTree = git(['write-tree'], task, config).trim();
  const patch = git([
    'diff', '--cached', '--binary', '--no-ext-diff', task.base_commit, '--',
  ], task, config, { encoding: 'buffer' });
  const paths = git([
    'diff', '--cached', '--name-only', '-z', task.base_commit, '--',
  ], task, config).split('\0').filter(Boolean).sort();
  const remote = git(['config', '--get', 'remote.origin.url'], task, config, { allowFailure: true });
  return {
    repository_identity: remote.status === 0 && remote.stdout.trim()
      ? remote.stdout.trim()
      : `local:${task.repo_name}`,
    base_revision: task.base_commit,
    target_revision: `git-tree:${targetTree}`,
    identity: hash(patch),
    diff_sha256: hash(patch),
    paths: paths.map(path => ({ path, regions: [], risk_tags: [] })),
  };
}

export function validateDecision(decision, request) {
  if (decision?.schema !== AV_TASK_PLAN_SCHEMA || decision.plan?.schema !== AV_PLAN_SCHEMA) {
    throw new Error('Affected Verification returned an unsupported or malformed plan.');
  }
  if (decision.task?.id !== request.task.id
    || decision.task?.execution_id !== request.task.execution_id
    || decision.repository?.identity !== request.repository.identity
    || decision.repository?.base_revision !== request.repository.base_revision
    || decision.repository?.target_revision !== request.repository.target_revision
    || decision.plan.change?.identity !== request.change.identity) {
    throw new Error('Affected Verification returned a plan for a different task execution or change set.');
  }
  const expected = new Map(request.manifest.checks.map(check => [check.id, check.command]));
  const actions = [...(decision.plan.selected_checks || []), ...(decision.plan.skipped_checks || [])];
  if (actions.length !== expected.size || new Set(actions.map(item => item.id)).size !== actions.length) {
    throw new Error('Affected Verification did not return an exact catalog partition.');
  }
  for (const action of actions) {
    if (!expected.has(action.id) || expected.get(action.id) !== action.command) {
      throw new Error('Affected Verification returned an action outside the immutable command catalog.');
    }
  }
  const allowed = new Set([
    'SUFFICIENT_TARGETED', 'SUFFICIENT_BROADENED',
    'FULL_VERIFICATION_REQUIRED', 'INSUFFICIENT_EVIDENCE',
  ]);
  if (!allowed.has(decision.plan.sufficiency)
    || decision.plan.argument?.unknown_is_safe_to_skip !== false
    || decision.plan.argument?.every_skip_explained !== true
    || decision.plan.argument?.every_skip_dependency_complete !== true) {
    throw new Error('Affected Verification returned incomplete sufficiency evidence.');
  }
  if (decision.decision_identity !== contentIdentity({ ...decision, decision_identity: undefined })
    || contentIdentity(decision) !== contentIdentity(planTaskVerification(request))) {
    throw new Error('Affected Verification decision differs from canonical provenance or completeness.');
  }
  return decision;
}

export function analyzeAffectedVerification({ config, task, attemptId, executionId, generation }) {
  const change = captureBuildChange(task, config);
  const inputPath = resolve(config.logsDir, `task-${task.id}-attempt-${attemptId}-av-${generation}-input.json`);
  const receiptPath = resolve(config.logsDir, `task-${task.id}-attempt-${attemptId}-av-${generation}-value-receipt.json`);
  const evidencePath = resolve(config.logsDir, `task-${task.id}-attempt-${attemptId}-av-${generation}.json`);
  let manifest;
  let decision = null;
  let error = null;
  try {
    manifest = baseManifest(task, config);
    if (change.paths.length === 0) manifest = { ...manifest, evidence_complete: false };
    const request = {
      schema: AV_REQUEST_SCHEMA,
      task: { id: `task-${task.id}`, execution_id: executionId },
      repository: {
        identity: change.repository_identity,
        base_revision: change.base_revision,
        target_revision: change.target_revision,
      },
      change: { identity: change.identity, paths: change.paths },
      manifest,
    };
    validateSchema('task-request-v1', request);
    atomicJson(inputPath, request);
    // Empty catalogs must enter Tasks' error/full-fallback path, not its legacy
    // NO_AUTOMATED_VERIFICATION branch, which allows completion without checks.
    if (manifest.checks.length === 0) {
      throw new Error('Affected Verification has no catalogued checks; full configured verification is required or execution must stop.');
    }
    const binary = resolve(packageRoot, 'runtime', 'planner-cli.js');
    if (!existsSync(binary)) throw new Error('Affected Verification CLI is unavailable.');
    const result = spawnSync(process.execPath, [
      binary, 'task-plan', inputPath, '--receipt', receiptPath,
    ], { encoding: 'utf8', timeout: 10_000, maxBuffer: MAX_ARTIFACT_BYTES });
    if (result.error) throw new Error(`Affected Verification failed internally: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(`Affected Verification rejected the task change: ${(result.stdout || result.stderr || 'unknown error').trim().slice(0, 2000)}`);
    }
    try { decision = validateDecision(JSON.parse(result.stdout), request); }
    catch (cause) {
      if (cause instanceof SyntaxError) throw new Error('Affected Verification returned invalid JSON.');
      throw cause;
    }
  } catch (cause) {
    error = String(cause.message || cause).slice(0, 3000);
  }
  const record = {
    schema: AV_EVIDENCE_SCHEMA,
    task_id: task.id,
    attempt_id: attemptId,
    execution_id: executionId,
    generation,
    execution_target: executionTarget(task),
    status: error ? 'ANALYSIS_FAILED' : 'ANALYZED',
    mechanism: {
      id: 'opsle.affected-verification',
      revision: config.packageIdentity,
      interface: AV_TASK_PLAN_SCHEMA,
    },
    repository: {
      identity: change.repository_identity,
      base_revision: change.base_revision,
      target_revision: change.target_revision,
    },
    change: {
      identity: change.identity,
      diff_sha256: change.diff_sha256,
      paths: change.paths,
    },
    manifest: manifest ? {
      source_path: manifest.source_path,
      source_identity: manifest.source_identity,
      evidence_complete: manifest.evidence_complete,
      catalog_complete: manifest.catalog_complete,
    } : null,
    input_path: existsSync(inputPath) ? inputPath : null,
    value_receipt_path: existsSync(receiptPath) ? receiptPath : null,
    decision,
    analysis_error: error,
    verification_results: [],
    fallback: null,
    limitations: [
      'Changed regions are not inferred; path ownership and check completeness come from the immutable base-revision manifest.',
      'Passing selected commands proves only their observed process results, not global correctness.',
    ],
  };
  validateSchema('evidence-v1', record);
  atomicJson(evidencePath, record);
  return { change, decision, error, evidencePath, inputPath, receiptPath, record };
}

export function saveAffectedVerificationRecord(path, record) {
  atomicJson(path, record);
}
