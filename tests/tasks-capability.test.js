import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const compatRevision = '3603c09dd01bfe5bb8f89cfd3e28cebbd4bdf2ec';
const id = 'opsle.affected-verification';
const schema = 'opsle.execution.verification-request.v1';
const emptySelection = { schema: 'opsle.capability-selection.v1', enable: [], disable: [], configuration: {} };
const grant = { schema: 'opsle.capability-grants.v1', allow: [id] };
const hash = value => createHash('sha256').update(value).digest('hex');
const commandEnvironment = { ...process.env };
delete commandEnvironment.npm_config_allow_scripts;
delete commandEnvironment.NPM_CONFIG_ALLOW_SCRIPTS;
commandEnvironment.NODE_ENV = 'test';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd,
  env: commandEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 60_000 });
const git = (cwd, args) => run('git', args, cwd).trim();
let temp, tarball, packed, upgradeTarball;
before(() => {
  process.env.NODE_ENV = 'test';
  temp = mkdtempSync(resolve(tmpdir(), 'av-capability-'));
  // Build from a minimal export: neither Tasks source nor sibling AV checkout is available.
  const source = resolve(temp, 'source');
  mkdirSync(resolve(source, 'packages'), { recursive: true });
  for (const path of ['src', 'schemas', 'LICENSE']) cpSync(resolve(root, path), resolve(source, path), { recursive: true });
  const packagePath = resolve(source, 'packages/tasks-capability');
  cpSync(resolve(root, 'packages/tasks-capability'), packagePath, {
    recursive: true, filter: path => !['runtime', 'adapter.js'].includes(path.split('/').at(-1)) || path.includes('/src/'),
  });
  packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temp], packagePath))[0];
  tarball = resolve(temp, packed.filename);
  // Build a second, synthetic compatible patch tarball for the restart contract.
  for (const name of ['package.json', 'opsle-capability.json']) {
    const path = resolve(packagePath, name);
    const value = JSON.parse(readFileSync(path)); value.version = '0.2.1';
    writeFileSync(path, JSON.stringify(value));
  }
  upgradeTarball = resolve(temp, JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temp], packagePath))[0].filename);
  rmSync(source, { recursive: true });
});
after(() => rmSync(temp, { recursive: true, force: true }));
function install(name, artifact = tarball) {
  const prefix = resolve(temp, name);
  mkdirSync(prefix);
  run('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', artifact], temp);
  return resolve(prefix, 'node_modules/@opsle/affected-verification-tasks-capability');
}
function fixture(t, name, modify = x => x) {
  const path = resolve(temp, name);
  mkdirSync(resolve(path, '.opsle'), { recursive: true });
  mkdirSync(resolve(path, 'logs'));
  mkdirSync(resolve(path, 'repo'));
  const project = resolve(path, 'repo');
  mkdirSync(resolve(project, '.opsle'));
  const manifest = modify({
    schema: 'opsle.affected-verification.manifest.v1', evidence_complete: true, catalog_complete: true,
    components: ['a', 'b'].map(id => ({ id, dependencies: [], path_globs: [`${id}.js`], risk_tags: [] })),
    checks: ['a', 'b'].map(id => ({ id, type: 'unit-test', command: `node --test ${id}.test.js`,
      scope: { components: [id] }, tags: [], test_executions: 1,
      dependency: { completeness: 'COMPLETE_FOR_CHECK', mechanisms: [{ kind: 'DECLARED_SCOPE', positive: false }], boundaries: [], explanation: 'Immutable scope' } })),
    policy: { version: '1', rules: [] },
  });
  if (manifest !== null) writeFileSync(resolve(project, '.opsle/affected-verification.json'), JSON.stringify(manifest));
  for (const id of ['a', 'b']) writeFileSync(resolve(project, `${id}.js`), 'before\n');
  git(project, ['init', '-q']); git(project, ['add', '.']);
  git(project, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base']);
  const task = { id: 1, repo_id: 1, repo_name: name, repo_path: project, worktree_path: project,
    base_commit: git(project, ['rev-parse', 'HEAD']), test_command: 'full-suite', capability_grants: grant };
  writeFileSync(resolve(project, 'a.js'), 'after\n');
  return { task, logsDir: resolve(path, 'logs'), manifest };
}
async function direct(directory, f) {
  const { createCapability } = await import(pathToFileURL(resolve(directory, 'adapter.js')));
  const manifest = JSON.parse(readFileSync(resolve(directory, 'opsle-capability.json')));
  return createCapability({ manifest, configuration: {}, services: { task: f.task, attemptId: 1,
    executionId: 'exec-1', executionConfig: { logsDir: f.logsDir } } });
}
const request = f => ({ schema, task: f.task, attemptId: 1, executionId: 'exec-1', generation: 1 });
const shadowRequest = (f, plan, overrides = {}) => ({
  schema: 'opsle.execution.verification-shadow-request.v1',
  task: f.task,
  attemptId: 1,
  executionId: 'exec-1',
  generation: 1,
  trustStage: 'OBSERVE_SHADOW',
  results: [...plan.selected_checks, ...plan.skipped_checks].map(item => ({
    id: item.id,
    type: item.type,
    command: item.command,
    status: 'PASSED',
    command_outcome: 'PASSED',
    exit_code: 0,
    signal: null,
    interrupted: false,
    interruption_reason: null,
    duration_ms: 1,
    stdout_path: '/private/stdout',
    stderr_path: '/private/stderr',
    evidence_path: '/private/evidence',
    evidence_status: 'VERIFIED',
    evidence_limitation: null,
  })),
  ...overrides,
});

test('installable artifact contains planner and schemas, plans deterministically, captures drift and retains private evidence', async t => {
  const directory = install('standalone');
  const f = fixture(t, 'standalone-project');
  const adapter = await direct(directory, f);
  assert.equal(adapter.health().available, true);
  const result = adapter.invoke('verification.plan', request(f));
  assert.equal(result.status, 'ok');
  assert.equal(result.value.error, null);
  assert.deepEqual(result.value.decision.plan.selected_checks.map(x => x.id), ['a']);
  assert.deepEqual(result.value.decision.plan.skipped_checks.map(x => x.id), ['b']);
  for (const path of [result.value.inputPath, result.value.evidencePath]) {
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
  assert.equal(existsSync(result.value.receiptPath), false,
    'planning cannot emit a receipt before authoritative comparison');
  const finalized = adapter.invoke('verification.shadow',
    shadowRequest(f, result.value.decision.plan));
  assert.equal(finalized.receipts.length, 1);
  assert.equal(finalized.value.status, 'SHADOW_HEALTHY');
  assert.equal(finalized.value.shadow.classification, 'NO_SELECTION_MISS');
  assert.equal(statSync(finalized.value.receiptPath).mode & 0o777, 0o600);
  const receipt = finalized.receipts[0];
  assert.equal(receipt.run.id, 'exec-1');
  assert.equal(receipt.extensions.affected_verification.task.attempt_id, 1);
  assert.match(receipt.mechanism.revision, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.extensions.affected_verification.plan.identity,
    result.value.decision.plan.plan_identity);
  const repeat = adapter.invoke('verification.plan', { ...request(f), generation: 2 });
  assert.deepEqual(repeat.value.decision, result.value.decision);
  const capture = () => adapter.invoke('verification.capture', { schema: 'opsle.execution.change-capture-request.v1', task: f.task }).value;
  assert.equal(capture().target_revision, result.value.change.target_revision);
  writeFileSync(resolve(f.task.repo_path, 'a.js'), 'drift\n');
  assert.notEqual(capture().target_revision, result.value.change.target_revision);
  assert.equal(existsSync(resolve(directory, 'runtime/core/task.js')), true);
  const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json')));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(JSON.parse(readFileSync(resolve(directory, 'opsle-capability.json'))).default_enabled, false);
  t.diagnostic(JSON.stringify({ version: pkg.version, artifact_sha256: hash(readFileSync(tarball)), npm_integrity: packed.integrity }));
});

test('unsupported hooks, schemas, bindings and external structural evidence cannot enter planning', async t => {
  const bound = fixture(t, 'invalid-project');
  const adapter = await direct(install('invalid'), bound);
  const f = fixture(t, 'wrong-project');
  for (const update of [{ attemptId: 2 }, { executionId: 'other-execution' }]) {
    assert.throws(() => adapter.invoke('verification.plan', { ...request(bound), ...update }), /binding/);
  }
  const { validateSchema } = await import(pathToFileURL(resolve(temp, 'invalid/node_modules/@opsle/affected-verification-tasks-capability/runtime/schema.js')));
  assert.throws(() => validateSchema('tasks-config-v2', { repository: '/untrusted-executable' }), /schema/);
  assert.throws(() => validateSchema('tasks-config-v2', { schema: 'opsle.affected-verification.tasks-config.v1' }), /schema/);
  assert.throws(() => adapter.invoke('structural.evidence', request(f)), /Unsupported/);
  assert.throws(() => adapter.invoke('verification.plan', { ...request(f), schema: 'future' }), /schema/);
  assert.throws(() => adapter.invoke('verification.plan', request(f)), /binding/);
  assert.throws(() => adapter.invoke('verification.plan', { ...request(f), structural_evidence: { complete: true } }), /schema/);
  for (const generation of ['../../escape', 0, 1.5]) assert.throws(() => adapter.invoke('verification.plan', { ...request(f), generation }), /schema/);
});

for (const [name, mutate, expected] of [
  ['incomplete', m => ({ ...m, evidence_complete: false }), 'FULL_VERIFICATION_REQUIRED'],
  ['opaque', m => { m.checks[1].dependency.completeness = 'OPAQUE_BOUNDARY'; m.checks[1].dependency.boundaries = [{ id: 'dynamic', kind: 'DYNAMIC_IMPORT', status: 'OPEN', relevant: true, explanation: 'Unresolved runtime import', source: { path: 'b.js', line: 1, construct: 'import(name)' } }]; return m; }, 'SUFFICIENT_BROADENED'],
  ['missing', () => null, 'FULL_VERIFICATION_REQUIRED'],
  ['empty-catalog', m => ({ ...m, checks: [] }), null],
  ['malformed', m => ({ ...m, schema: 'unsupported' }), null],
  ['external-evidence', m => ({ ...m, structural_evidence: { complete: true } }), null],
]) test(`${name} evidence broadens or fails closed`, async t => {
  const f = fixture(t, name, mutate);
  const adapter = await direct(install(`install-${name}`), f);
  const result = adapter.invoke('verification.plan', request(f)).value;
  if (expected) { assert.equal(result.error, null, result.error); assert.equal(result.decision.plan.sufficiency, expected); }
  else { assert.ok(result.error); assert.equal(result.decision, null); assert.equal(result.record.status, 'ANALYSIS_FAILED'); }
  assert.deepEqual(result.record.verification_results, []);
});

test('immutable base manifest, empty change and missing fallback never manufacture passing verification', async t => {
  const f = fixture(t, 'immutable');
  const adapter = await direct(install('install-immutable'), f);
  writeFileSync(resolve(f.task.repo_path, '.opsle/affected-verification.json'), '{"checks":[]}');
  const result = adapter.invoke('verification.plan', request(f)).value;
  assert.equal(result.error, null);
  assert.equal(result.decision.plan.sufficiency, 'FULL_VERIFICATION_REQUIRED');
  assert.equal(result.decision.plan.selected_checks.length, 2);
  git(f.task.repo_path, ['reset', '--hard', f.task.base_commit]);
  const empty = adapter.invoke('verification.plan', { ...request(f), generation: 2 }).value;
  assert.equal(empty.decision.plan.sufficiency, 'FULL_VERIFICATION_REQUIRED');
  const missing = fixture(t, 'no-fallback', () => null);
  missing.task.test_command = '';
  const noFallback = (await direct(install('install-no-fallback'), missing)).invoke('verification.plan', request(missing)).value;
  assert.equal(noFallback.decision, null);
  assert.match(noFallback.error, /no catalogued checks/);
});

test('mutated transitive installation bytes block invocation before execution', async t => {
  const directory = install('mutated');
  const f = fixture(t, 'mutated-project');
  const adapter = await direct(directory, f);
  const path = resolve(directory, 'runtime/core/planner.js');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n// mutation\n');
  assert.throws(() => adapter.invoke('verification.plan', request(f)), /installation changed/);
});

test('canonical decisions reject wrong task/change, catalog injection, and forged completeness', async t => {
  const directory = install('decisions');
  const f = fixture(t, 'decision-project');
  const adapter = await direct(directory, f);
  const result = adapter.invoke('verification.plan', request(f)).value;
  const input = JSON.parse(readFileSync(result.inputPath));
  const { validateDecision } = await import(pathToFileURL(resolve(directory, 'runtime/verification.js')));
  for (const mutate of [
    x => { x.task.id = 'task-2'; }, x => { x.plan.change.identity = 'other'; },
    x => { x.plan.selected_checks[0].command = 'touch /tmp/injected'; },
    x => { x.plan.skipped_checks = []; }, x => { x.plan.argument.unknown_is_safe_to_skip = true; },
    x => { x.plan.provenance = {}; },
  ]) { const decision = structuredClone(result.decision); mutate(decision); assert.throws(() => validateDecision(decision, input)); }
});

test('shadow finalization rejects stale execution evidence, source drift, and incomplete full results', async t => {
  const directory = install('shadow-identity');
  const f = fixture(t, 'shadow-identity-project');
  const adapter = await direct(directory, f);
  const analysis = adapter.invoke('verification.plan', request(f)).value;
  const full = shadowRequest(f, analysis.decision.plan);
  assert.throws(() => adapter.invoke('verification.shadow', {
    ...full,
    results: full.results.slice(0, 1),
  }), /exact full catalog/);
  const stored = JSON.parse(readFileSync(analysis.evidencePath));
  writeFileSync(analysis.evidencePath, JSON.stringify({ ...stored, execution_id: 'stale' }));
  assert.throws(() => adapter.invoke('verification.shadow', full),
    /evidence identity/);
  writeFileSync(analysis.evidencePath, JSON.stringify(stored));
  writeFileSync(resolve(f.task.repo_path, 'b.js'), 'drift\n');
  assert.throws(() => adapter.invoke('verification.shadow', full),
    /source identity drifted/);
  assert.equal(existsSync(analysis.receiptPath), false);
});

test('SSH failures, invalid targets and quoting remain bounded and fail closed', async t => {
  const directory = install('ssh');
  const { executionTarget, projectGit, sshArguments } = await import(pathToFileURL(resolve(directory, 'runtime/execution.js')));
  for (const ssh_host of ['-oProxyCommand=bad', 'host; touch /tmp/injected']) assert.throws(() => executionTarget({ ssh_host, ssh_user: 'deploy', repo_path: '/repo' }));
  assert.throws(() => executionTarget({ ssh_host: 'host', ssh_user: 'bad;user', repo_path: '/repo' }));
  const target = executionTarget({ ssh_host: 'host', ssh_user: 'deploy', repo_path: '/repo' });
  assert.throws(() => sshArguments({}, target, 'true'), /key/);
  const fake = resolve(temp, 'ssh-failure');
  writeFileSync(fake, '#!/bin/sh\necho "Host key verification failed" >&2\nexit 255\n', { mode: 0o700 });
  assert.throws(() => projectGit({ sshBin: fake, sshKeyPath: '/fixture-not-a-key' }, target, ['status'], '/repo', { allowFailure: true }), /host key verification failure/);
  for (const [status, message, expected] of [
    [255, 'Permission denied', /SSH authentication failure/],
    [255, 'Connection refused', /unreachable/],
    [124, '', /command timeout/], [72, 'OPSLE_REPOSITORY_MISSING', /repository missing/],
  ]) {
    writeFileSync(fake, `#!/bin/sh\necho '${message}' >&2\nexit ${status}\n`, { mode: 0o700 });
    assert.throws(() => projectGit({ sshBin: fake, sshKeyPath: '/fixture-not-a-key' }, target, ['status'], '/repo', { allowFailure: true }), expected);
  }
  const args = sshArguments({ sshKeyPath: '/fixture-not-a-key' }, target, "echo '$(false)'", 1);
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.match(args.at(-1), /timeout --signal=TERM --kill-after=5s 1s/);
  const f = fixture(t, 'quoted-project');
  const filename = "odd ' $(touch SHOULD_NOT_EXIST).js";
  writeFileSync(resolve(f.task.repo_path, filename), 'change');
  const adapter = await direct(directory, f);
  const captured = adapter.invoke('verification.capture', { schema: 'opsle.execution.change-capture-request.v1', task: f.task }).value;
  assert.ok(captured.paths.some(x => x.path === filename));
  assert.equal(existsSync(resolve(f.task.repo_path, 'SHOULD_NOT_EXIST')), false);
});

const tasksRoot = process.env.OPSLE_TASKS_RUNTIME_ROOT;
test('real generic Tasks lifecycle: discover, grant, dispatch, revoke, remove, reinstall and compatible upgrade/restart', {
  skip: !tasksRoot && 'Set OPSLE_TASKS_RUNTIME_ROOT to the pinned Tasks checkout; required by verify:tasks-capability.',
}, async t => {
  assert.equal(git(tasksRoot, ['rev-parse', 'HEAD']), compatRevision, 'Compatibility revision must be explicitly updated after review');
  const before = git(tasksRoot, ['diff', 'HEAD', '--', 'src']);
  assert.equal(before, '', 'Tasks runtime must be unchanged');
  const sourceHash = hash(readFileSync(resolve(tasksRoot, 'src/capabilities.js')));
  const { discoverCapabilities, createCapabilityRuntime } = await import(pathToFileURL(resolve(tasksRoot, 'src/capabilities.js')));
  const { verificationSelection } = await import(pathToFileURL(resolve(tasksRoot, 'src/runner.js')));
  const f = fixture(t, 'lifecycle-project');
  let directory = install('lifecycle');
  const events = [];
  const config = { capabilityRoots: [directory], logsDir: f.logsDir };
  const runtime = (grants = grant, selection = emptySelection) => createCapabilityRuntime({ config,
    task: { ...f.task, capability_grants: grants }, attemptId: 1, executionId: 'exec-1', selection,
    emitEvent: (kind, message) => events.push({ kind, message }),
  });
  assert.equal(discoverCapabilities(config)[0].defaultEnabled, false);
  const inactive = await runtime({ schema: grant.schema, allow: [] });
  assert.equal(inactive.status.length, 0);
  await assert.rejects(inactive.authority('verification.plan', request(f)), /exactly one enabled authority/);
  for (const key of ['enable', 'disable']) await assert.rejects(runtime(grant, { ...emptySelection, [key]: [id] }), /operator-controlled/);
  const enabled = await runtime();
  const analysis = await enabled.authority('verification.plan', request(f));
  assert.equal(analysis.error, null);
  const shadow = await enabled.authority('verification.shadow',
    shadowRequest(f, analysis.decision.plan));
  assert.equal(shadow.status, 'SHADOW_HEALTHY');
  assert.equal(shadow.receipt.run.id, 'exec-1');
  assert.ok(events.some(x => x.kind === 'AFFECTED_VERIFICATION_SHADOW'));
  const capture = await enabled.authority('verification.capture', { schema: 'opsle.execution.change-capture-request.v1', task: f.task });
  assert.equal(capture.identity, analysis.change.identity);
  assert.ok(events.some(x => x.kind === 'CAPABILITY_ARTIFACT'));
  const history = readFileSync(analysis.evidencePath);
  const empty = fixture(t, 'lifecycle-empty', () => null);
  empty.task.test_command = '';
  const emptyRuntime = await createCapabilityRuntime({ config: { ...config, logsDir: empty.logsDir },
    task: empty.task, attemptId: 1, executionId: 'exec-1', selection: emptySelection });
  const emptyAnalysis = await emptyRuntime.authority('verification.plan', request(empty));
  assert.throws(() => verificationSelection(emptyAnalysis, empty.task), /no full verification command/);
  assert.equal(verificationSelection(emptyAnalysis, { ...empty.task, test_command: 'full-suite' }).mode, 'FULL_FALLBACK');
  const revoked = await runtime({ schema: grant.schema, allow: [] });
  await assert.rejects(revoked.authority('verification.capture', { schema: 'opsle.execution.change-capture-request.v1', task: f.task }), /exactly one enabled authority/);
  config.capabilityRoots = [directory, install('duplicate')];
  assert.throws(() => discoverCapabilities(config), /Duplicate/);
  config.capabilityRoots = [directory];
  const entry = resolve(directory, 'adapter.js');
  writeFileSync(entry, readFileSync(entry, 'utf8') + '\n// changed\n');
  await assert.rejects(enabled.authority('verification.plan', request(f)), /installation changed/);
  rmSync(directory, { recursive: true });
  assert.deepEqual(discoverCapabilities(config), []);
  await assert.rejects((await runtime()).authority('verification.plan', request(f)), /exactly one enabled authority/);
  assert.deepEqual(readFileSync(analysis.evidencePath), history);
  directory = install('reinstall'); config.capabilityRoots = [directory];
  assert.equal((await runtime({ schema: grant.schema, allow: [] })).status.length, 0);
  const restored = await runtime();
  assert.equal((await restored.authority('verification.plan', { ...request(f), generation: 2 })).error, null);
  // Install the separately packed compatible patch artifact, then start a fresh runtime.
  const upgraded = install('upgrade', upgradeTarball);
  const restart = resolve(temp, 'restart.mjs');
  writeFileSync(restart, `import { createCapabilityRuntime } from ${JSON.stringify(pathToFileURL(resolve(tasksRoot, 'src/capabilities.js')).href)};
const context = JSON.parse(process.argv[2]);
const runtime = await createCapabilityRuntime(context);
const value = await runtime.authority('verification.capture', {schema:'opsle.execution.change-capture-request.v1',task:context.task});
process.stdout.write(JSON.stringify({version:runtime.status[0].version,value}));`);
  const restarted = JSON.parse(run(process.execPath, [restart, JSON.stringify({ config: { ...config, capabilityRoots: [upgraded] }, task: f.task, attemptId: 1, executionId: 'exec-1', selection: emptySelection })], temp));
  assert.equal(restarted.version, '0.2.1');
  assert.equal(restarted.value.identity, capture.identity);
  assert.deepEqual(readFileSync(analysis.evidencePath), history);
  assert.equal(git(tasksRoot, ['diff', 'HEAD', '--', 'src']), before);
  assert.equal(hash(readFileSync(resolve(tasksRoot, 'src/capabilities.js'))), sourceHash);
  t.diagnostic(JSON.stringify({ tasks_revision: compatRevision, runtime_sha256: sourceHash,
    artifact_version: packed.version, artifact_sha256: hash(readFileSync(tarball)),
    upgrade_artifact_sha256: hash(readFileSync(upgradeTarball)), central_source_unchanged: true }));
});
