#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildValueReceipt,
  contentIdentity,
  operatorIndicator,
  planVerification,
} from '../../src/index.js';
import {
  TARGET_SHA,
  TARGET_URL,
  TESTMON_VERSION,
  TRUST_STAGE,
  identityWithout,
  readJson,
  validatePlanSkips,
  validateResultBundle,
  withIdentity,
  writeJson,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const preregDir = path.join(here, 'preregistration-v1');
const targetRepo = path.resolve(process.argv[2] ?? '');
const resultsDir = process.argv[3] ? path.resolve(process.argv[3]) : path.join(here, 'results-v1');
if (!process.argv[2]) throw new Error('usage: node run.mjs TARGET_CLICK_REPOSITORY [RESULTS_DIR]');
if (fs.existsSync(resultsDir)) throw new Error(`results path already exists: ${resultsDir}`);

function sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function run(command, args, options = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', ...options.env },
    maxBuffer: 128 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1000,
  });
  return {
    command: [command, ...args],
    exit_code: result.status,
    signal: result.signal,
    timed_out: result.error?.code === 'ETIMEDOUT',
    spawn_error: result.error?.message ?? null,
    duration_ms_observed: Math.round(Number(process.hrtime.bigint() - started) / 1e3) / 1e3,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function requireSuccess(result, label) {
  if (result.exit_code !== 0 || result.timed_out || result.spawn_error) {
    throw new Error(`${label} failed: exit=${result.exit_code} ${result.spawn_error ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
}

function git(cwd, args) {
  const result = run('git', args, { cwd, timeout: 2 * 60 * 1000 });
  requireSuccess(result, `git ${args.join(' ')}`);
  return result.stdout.trim();
}

function persistExecution(rawDir, id, execution) {
  fs.mkdirSync(rawDir, { recursive: true });
  const stdout = path.join(rawDir, `${id}.stdout.log`);
  const stderr = path.join(rawDir, `${id}.stderr.log`);
  fs.writeFileSync(stdout, execution.stdout);
  fs.writeFileSync(stderr, execution.stderr);
  const record = {
    command: execution.command,
    exit_code: execution.exit_code,
    signal: execution.signal,
    timed_out: execution.timed_out,
    spawn_error: execution.spawn_error,
    duration_ms_observed: execution.duration_ms_observed,
    stdout_sha256: sha256File(stdout),
    stderr_sha256: sha256File(stderr),
  };
  writeJson(path.join(rawDir, `${id}.execution.json`), record);
  return record;
}

function verifyPreregistration() {
  const manifest = readJson(path.join(preregDir, 'manifest.json'));
  if (manifest.identity !== identityWithout(manifest)) throw new Error('preregistration manifest identity mismatch');
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (sha256File(path.join(preregDir, name)) !== expected) throw new Error(`preregistration drift: ${name}`);
  }
  const values = {};
  for (const name of ['environment', 'catalog', 'selector', 'policy', 'scenarios', 'comparison', 'preregistration']) {
    values[name] = readJson(path.join(preregDir, `${name}.json`));
    if (values[name].identity !== identityWithout(values[name])) throw new Error(`${name} identity mismatch`);
  }
  for (const scenario of values.scenarios.scenarios) {
    if (sha256File(path.join(preregDir, scenario.patch)) !== scenario.patch_sha256) {
      throw new Error(`scenario patch drift: ${scenario.id}`);
    }
  }
  return { manifest, ...values };
}

function collectNodeIds(worktree, rawDir, id, extraArgs = [], extraEnv = {}) {
  fs.mkdirSync(rawDir, { recursive: true });
  const reportFile = path.join(rawDir, `${id}.pytest.json`);
  const execution = run(path.join(worktree, '.venv/bin/pytest'), [
    '--override-ini=addopts=', '-p', 'pytest_av_catalog', ...extraArgs, '-q',
  ], {
    cwd: worktree,
    env: {
      PYTHONPATH: here,
      PYTHONDONTWRITEBYTECODE: '1',
      AV2_PYTEST_REPORT: reportFile,
      ...extraEnv,
    },
    timeout: 15 * 60 * 1000,
  });
  const command = persistExecution(rawDir, id, execution);
  const report = fs.existsSync(reportFile) ? readJson(reportFile) : null;
  return { execution, command, report, report_file: reportFile };
}

function prepareTarget(prereg) {
  if (git(targetRepo, ['rev-parse', TARGET_SHA]) !== TARGET_SHA) throw new Error('target commit unavailable');
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-exp-002-run.'));
  const worktree = path.join(scratchRoot, 'click');
  const add = run('git', ['worktree', 'add', '--detach', worktree, TARGET_SHA], { cwd: targetRepo });
  requireSuccess(add, 'target detached worktree creation');
  if (git(worktree, ['rev-parse', 'HEAD']) !== TARGET_SHA) throw new Error('target SHA mismatch');

  let install = run('uv', ['sync', '--locked', '--all-groups'], { cwd: worktree, timeout: 15 * 60 * 1000 });
  requireSuccess(install, 'locked target install');
  install = run('uv', [
    'pip', 'install', '--python', '.venv/bin/python',
    `pytest-testmon==${TESTMON_VERSION}`, 'build==1.3.0', 'flit_core==3.12.0',
  ], { cwd: worktree, timeout: 10 * 60 * 1000 });
  requireSuccess(install, 'pinned benchmark tool install');

  for (const [name, expected] of Object.entries(prereg.environment.frozen_file_identities)) {
    if (sha256File(path.join(worktree, name)) !== expected) throw new Error(`target frozen-file drift: ${name}`);
  }
  const versions = run(path.join(worktree, '.venv/bin/python'), ['-c', [
    'import importlib.metadata as m, json, platform',
    'print(json.dumps({"python":platform.python_version(),"testmon":m.version("pytest-testmon")}))',
  ].join(';')], { cwd: worktree });
  requireSuccess(versions, 'toolchain version check');
  const observedVersions = JSON.parse(versions.stdout);
  if (observedVersions.python !== prereg.environment.python || observedVersions.testmon !== TESTMON_VERSION) {
    throw new Error('Python or selector version mismatch');
  }

  const preflightRaw = path.join(resultsDir, 'raw', 'preflight');
  const collect = collectNodeIds(worktree, preflightRaw, 'catalog', ['--collect-only']);
  requireSuccess(collect.execution, 'frozen catalog collection');
  const expectedNodes = prereg.catalog.checks.filter((check) => check.verification_class === 'PYTEST_NODE')
    .map((check) => check.id.slice('pytest:'.length)).sort();
  if (JSON.stringify(collect.report?.selected_nodeids) !== JSON.stringify(expectedNodes)) {
    throw new Error('collected pytest catalog mismatch');
  }
  return { scratchRoot, worktree, expectedNodes };
}

function runNonTestCheck(worktree, rawDir, runId, checkId) {
  let command;
  let args;
  let env = {};
  if (checkId === 'check:lint') [command, args] = [path.join(worktree, '.venv/bin/ruff'), ['check', '--no-fix', 'src', 'tests']];
  else if (checkId === 'check:format') [command, args] = [path.join(worktree, '.venv/bin/ruff'), ['format', '--check', 'src', 'tests']];
  else if (checkId === 'check:mypy') [command, args] = [path.join(worktree, '.venv/bin/mypy'), []];
  else if (checkId === 'check:pyright') {
    [command, args] = [path.join(worktree, '.venv/bin/pyright'), ['--ignoreexternal', '--verifytypes', 'click']];
    env = { PYTHONPATH: path.join(worktree, 'src') };
  }
  else if (checkId === 'check:build') {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'av2-build.'));
    [command, args] = [path.join(worktree, '.venv/bin/python'), ['-m', 'build', '--no-isolation', '--outdir', out]];
  } else if (checkId === 'check:docs') {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'av2-docs.'));
    [command, args] = [path.join(worktree, '.venv/bin/sphinx-build'), ['-E', '-W', '-b', 'dirhtml', 'docs', out]];
  } else if (checkId === 'check:lock') [command, args] = ['uv', ['lock', '--check']];
  else throw new Error(`unknown non-test check: ${checkId}`);
  const execution = run(command, args, { cwd: worktree, env, timeout: 15 * 60 * 1000 });
  const record = persistExecution(rawDir, `${runId}-${checkId.replace(':', '-')}`, execution);
  return { failed: execution.exit_code !== 0 || execution.timed_out || execution.spawn_error, record };
}

function runFullCatalog(worktree, rawDir, runId, prereg) {
  const pytest = collectNodeIds(worktree, rawDir, `${runId}-pytest`, []);
  if (!pytest.report) throw new Error(`missing pytest report: ${runId}`);
  const selected = pytest.report.selected_nodeids;
  const expected = prereg.catalog.checks.filter((check) => check.verification_class === 'PYTEST_NODE')
    .map((check) => check.id.slice('pytest:'.length)).sort();
  const failed = [];
  for (const [nodeid, outcome] of Object.entries(pytest.report.outcomes)) {
    if (outcome.outcome === 'failed') failed.push(`pytest:${nodeid}`);
  }
  const pytestCompleteExit = [0, 1].includes(pytest.execution.exit_code);
  if (!pytestCompleteExit || JSON.stringify(selected) !== JSON.stringify(expected)) {
    failed.push('check:pytest-collection');
  }
  const timings = [{ check_id: 'pytest:catalog', duration_ms_observed: pytest.execution.duration_ms_observed }];
  for (const checkId of ['check:lint', 'check:format', 'check:mypy', 'check:pyright', 'check:build', 'check:docs', 'check:lock']) {
    const result = runNonTestCheck(worktree, rawDir, runId, checkId);
    if (result.failed) failed.push(checkId);
    timings.push({ check_id: checkId, duration_ms_observed: result.record.duration_ms_observed });
  }
  const semantic = {
    target_sha: TARGET_SHA,
    catalog_identity: prereg.catalog.identity,
    executed_check_ids: prereg.catalog.checks.map((check) => check.id).sort(),
    failed_check_ids: [...new Set(failed)].sort(),
    pytest_selected_nodeids: selected,
    full_complete: pytestCompleteExit && JSON.stringify(selected) === JSON.stringify(expected)
      && !pytest.execution.timed_out && !pytest.execution.spawn_error,
  };
  return { ...semantic, identity: contentIdentity(semantic), timings_observed: timings };
}

function plannerType(check) {
  const mapping = {
    PYTEST_NODE: 'unit-test',
    LINT: 'lint',
    FORMAT: 'other',
    TYPECHECK_MYPY: 'typecheck',
    TYPECHECK_PYRIGHT: 'typecheck',
    PACKAGE_BUILD: 'build',
    DOCS_BUILD: 'documentation',
    LOCK_VALIDATION: 'test-infrastructure',
    TEST_INFRASTRUCTURE: 'test-infrastructure',
  };
  return mapping[check.verification_class] ?? 'other';
}

function plannerTag(check) {
  const mapping = {
    'check:lint': 'lint',
    'check:format': 'format',
    'check:mypy': 'mypy',
    'check:pyright': 'pyright',
    'check:build': 'build',
    'check:docs': 'docs',
    'check:lock': 'lock',
    'check:pytest-collection': 'collection',
  };
  return mapping[check.id] ? [mapping[check.id]] : ['pytest-node'];
}

function graphEvidence(worktree) {
  const execution = run(path.join(worktree, '.venv/bin/python'), [path.join(here, 'python_graph.py'), worktree], { cwd: worktree });
  requireSuccess(execution, 'Python graph adapter');
  return JSON.parse(execution.stdout);
}

function buildComponents(graph, prereg) {
  const moduleToComponent = new Map(graph.files.filter((file) => file.module).map((file) => [file.module, `file:${file.path}`]));
  const components = [{ id: 'repo:metadata', dependencies: [] }];
  for (const check of prereg.catalog.checks.filter((item) => item.verification_class !== 'PYTEST_NODE')) {
    components.push({ id: `check:${check.id}`, dependencies: [] });
  }
  for (const file of graph.files) {
    const dependencies = file.imports.map((name) => moduleToComponent.get(name)).filter(Boolean);
    components.push({ id: `file:${file.path}`, dependencies: [...new Set(dependencies)].sort() });
  }
  for (const check of prereg.catalog.checks.filter((item) => item.verification_class === 'PYTEST_NODE')) {
    const nodeid = check.id.slice('pytest:'.length);
    const testFile = nodeid.split('::')[0];
    components.push({ id: `testnode:${nodeid}`, dependencies: [`file:${testFile}`] });
  }
  const ids = new Set(components.map((component) => component.id));
  for (const component of components) component.dependencies = component.dependencies.filter((id) => ids.has(id));
  return components.sort((a, b) => a.id.localeCompare(b.id));
}

function createPlan(worktree, scenario, selectorState, selectorNodes, prereg, useSelector) {
  const graph = graphEvidence(worktree);
  const components = buildComponents(graph, prereg);
  const componentIds = new Set(components.map((component) => component.id));
  const runtimeRepair = useSelector
    && scenario.evidence.runtime_selector_can_repair === true
    && selectorState.database_ready
    && selectorState.well_formed;
  let complete = scenario.evidence.static_evidence_complete !== false || runtimeRepair;
  const selectedNodeComponents = useSelector
    ? selectorNodes.map((nodeid) => `testnode:${nodeid}`).filter((id) => componentIds.has(id))
    : [];
  const impacts = scenario.changed_paths.map((changedPath, index) => {
    const fileComponent = `file:${changedPath}`;
    let primary = componentIds.has(fileComponent) ? fileComponent : null;
    if (changedPath === 'pyproject.toml' || changedPath === 'uv.lock') primary = 'repo:metadata';
    if (!primary) complete = false;
    const extra = index === 0 ? selectedNodeComponents : [];
    return primary
      ? { path: changedPath, components: [primary, ...extra].sort(), confidence: 'KNOWN', reason: 'AV-EXP-002 Python/Git adapter mapping' }
      : { path: changedPath, components: extra.sort(), confidence: extra.length ? 'KNOWN' : 'UNKNOWN', reason: 'unmapped changed path' };
  });
  const changedGraphRecords = graph.files.filter((file) => scenario.changed_paths.includes(file.path));
  const providers = [
    { id: 'git-change', kind: 'git-change-identity', version: '1', identity: scenario.patch_sha256 },
    { id: 'python-ast', kind: 'python-import-and-symbol-evidence', version: 'av-exp-002-v1', identity: contentIdentity(graph) },
  ];
  if (useSelector) providers.push({
    id: 'pytest-testmon', kind: 'runtime-affected-test-selection', version: TESTMON_VERSION,
    identity: contentIdentity({ selectorNodes, selectorState }),
  });
  const plannerChecks = prereg.catalog.checks.map((check) => ({
    id: check.id,
    type: plannerType(check),
    command: check.invocation,
    scope: { components: [check.id === 'check:pytest-collection'
      ? '*'
      : check.verification_class === 'PYTEST_NODE'
        ? `testnode:${check.id.slice('pytest:'.length)}`
        : `check:${check.id}`] },
    tags: plannerTag(check),
    test_executions: check.verification_class === 'PYTEST_NODE' ? 1 : 0,
  }));
  const input = {
    schema: 'opsle.affected-verification.input.v1',
    change: {
      base_revision: TARGET_SHA,
      target_revision: scenario.patch_sha256,
      identity: contentIdentity({ target: TARGET_SHA, scenario: scenario.id, patch: scenario.patch_sha256 }),
      paths: scenario.changed_paths.map((changedPath) => ({
        path: changedPath,
        regions: [],
        risk_tags: changedPath === 'pyproject.toml' ? ['verification-metadata'] : [],
      })),
    },
    evidence: {
      identity: contentIdentity({ complete, components, impacts, providers }),
      complete,
      providers,
      components,
      impacts,
    },
    catalog: { identity: prereg.catalog.identity, complete: true, checks: plannerChecks },
    policy: {
      identity: prereg.policy.identity,
      version: prereg.policy.version,
      rules: [
        { id: 'always-collection', match: { path_globs: ['**'], risk_tags: [], component_ids: [] }, escalation: 'NONE', required_check_tags: ['collection'] },
        { id: 'python-hygiene', match: { path_globs: ['**/*.py'], risk_tags: [], component_ids: [] }, escalation: 'NONE', required_check_tags: ['lint', 'format'] },
        { id: 'source-typing', match: { path_globs: ['src/**/*.py'], risk_tags: [], component_ids: [] }, escalation: 'NONE', required_check_tags: ['mypy', 'pyright'] },
        { id: 'shared-core-full', match: { path_globs: ['src/click/core.py', 'src/click/types.py', 'src/click/utils.py', 'src/click/__init__.py'], risk_tags: [], component_ids: [] }, escalation: 'FULL', required_check_tags: [] },
        { id: 'metadata-full', match: { path_globs: ['pyproject.toml', 'uv.lock'], risk_tags: [], component_ids: [] }, escalation: 'FULL', required_check_tags: [] },
        { id: 'conftest-full', match: { path_globs: ['tests/conftest.py'], risk_tags: [], component_ids: [] }, escalation: 'FULL', required_check_tags: [] },
      ],
    },
  };
  const plan = planVerification(input);
  validatePlanSkips(plan);
  return {
    plan,
    graph_identity: providers.find((provider) => provider.id === 'python-ast').identity,
    dependency_complete: complete,
    dynamic_hazards: changedGraphRecords.flatMap((file) => file.dynamic_hazards).sort(),
    parse_errors: changedGraphRecords.filter((file) => file.parse_error).map((file) => ({ path: file.path, error: file.parse_error })),
  };
}

function runSelector(worktree, rawDir, scenario, baselineDb) {
  const db = path.join(worktree, '.testmondata');
  if (fs.existsSync(db)) fs.unlinkSync(db);
  const missing = scenario.evidence.selector_database === 'MISSING';
  if (!missing) fs.copyFileSync(baselineDb, db);
  const selected = collectNodeIds(worktree, rawDir, `${scenario.id}-testmon`, ['--testmon', '--collect-only']);
  const acceptableExit = selected.execution.exit_code === 0 || selected.execution.exit_code === 5;
  if (!acceptableExit || !selected.report) throw new Error(`malformed testmon output for ${scenario.id}`);
  return {
    selected_nodeids: selected.report.selected_nodeids,
    state: {
      database_ready: !missing,
      database_identity: missing ? null : sha256File(baselineDb),
      baseline_sha: missing ? null : TARGET_SHA,
      version: TESTMON_VERSION,
      well_formed: true,
      stale: false,
    },
  };
}

function selectedIdsFromPlan(plan) {
  return plan.selected_checks.map((check) => check.id).sort();
}

function armResult(armId, selectedCheckIds, relevant, plan = null) {
  const selected = new Set(selectedCheckIds);
  const misses = relevant.filter((checkId) => !selected.has(checkId));
  return {
    arm: armId,
    selected_check_ids: [...selected].sort(),
    relevant_check_ids: relevant,
    relevant_selected: relevant.filter((checkId) => selected.has(checkId)),
    misses,
    plan,
  };
}

function workload(prereg, selectedCheckIds) {
  const selected = new Set(selectedCheckIds);
  const tests = prereg.catalog.checks.filter((check) => check.verification_class === 'PYTEST_NODE');
  const selectedTests = tests.filter((check) => selected.has(check.id));
  const files = new Set(tests.map((check) => check.id.slice('pytest:'.length).split('::')[0]));
  const selectedFiles = new Set(selectedTests.map((check) => check.id.slice('pytest:'.length).split('::')[0]));
  const nonTests = prereg.catalog.checks.filter((check) => check.verification_class !== 'PYTEST_NODE');
  return {
    pytest_nodes: { available: tests.length, selected: selectedTests.length, skipped: tests.length - selectedTests.length },
    pytest_files: { available: files.size, selected: selectedFiles.size, skipped: files.size - selectedFiles.size },
    non_test_by_class: Object.fromEntries([...new Set(nonTests.map((check) => check.verification_class))].sort().map((verificationClass) => {
      const classChecks = nonTests.filter((check) => check.verification_class === verificationClass);
      const count = classChecks.filter((check) => selected.has(check.id)).length;
      return [verificationClass, { available: classChecks.length, selected: count, skipped: classChecks.length - count }];
    })),
  };
}

function classifyMiss(checkId, armId, prereg) {
  const check = prereg.catalog.checks.find((item) => item.id === checkId);
  if (armId === 'ECOSYSTEM_SELECTOR' && check?.verification_class !== 'PYTEST_NODE') {
    return { category: 'OUTSIDE_SELECTOR_CONTRACT', detail: 'pytest-testmon selects pytest tests, not this verification class.' };
  }
  if (armId === 'ECOSYSTEM_SELECTOR') return { category: 'DEPENDENCY_EVIDENCE_MISS', detail: 'Relevant pytest node omitted by selector output.' };
  return { category: 'PLANNER_OR_ADAPTER_MISS', detail: 'Relevant frozen catalog check omitted by the AV plan.' };
}

function baseline(worktree, prereg) {
  const repetitions = [];
  for (let index = 1; index <= 3; index += 1) {
    const id = `baseline-${index}`;
    const result = runFullCatalog(worktree, path.join(resultsDir, 'raw', id), id, prereg);
    writeJson(path.join(resultsDir, 'baseline', `${id}.json`), result);
    if (!result.full_complete || result.failed_check_ids.length) throw new Error(`baseline stability failure: ${id}`);
    repetitions.push({
      identity: result.identity,
      failed_check_ids: result.failed_check_ids,
      pytest_node_count: result.pytest_selected_nodeids.length,
    });
    console.error(`[Affected Verification] ${id}: PASS; ${result.pytest_selected_nodeids.length} pytest nodes; wall time OBSERVED`);
  }
  const semantic = {
    target_sha: TARGET_SHA,
    catalog_identity: prereg.catalog.identity,
    repetitions,
    stable: true,
  };
  const summary = { ...semantic, identity: contentIdentity(semantic) };
  writeJson(path.join(resultsDir, 'baseline', 'summary.json'), summary);
  return summary;
}

function trainSelector(worktree, prereg) {
  const rawDir = path.join(resultsDir, 'raw', 'selector-baseline');
  const db = path.join(worktree, '.testmondata');
  if (fs.existsSync(db)) fs.unlinkSync(db);
  const trained = collectNodeIds(worktree, rawDir, 'selector-baseline', ['--testmon']);
  requireSuccess(trained.execution, 'pytest-testmon clean baseline');
  if (!trained.report || trained.report.selected_nodeids.length !== prereg.catalog.pytest_nodes || !fs.existsSync(db)) {
    throw new Error('pytest-testmon baseline state incomplete');
  }
  const baselineDb = path.join(resultsDir, 'selector-baseline.testmondata');
  fs.copyFileSync(db, baselineDb);
  const semantic = withIdentity({
    schema: 'opsle.affected-verification.av-exp-002.testmon-baseline.v1',
    target_sha: TARGET_SHA,
    selector_version: TESTMON_VERSION,
    catalog_identity: prereg.catalog.identity,
    pytest_nodes_executed: trained.report.selected_nodeids.length,
    database_sha256: sha256File(baselineDb),
  });
  writeJson(path.join(resultsDir, 'selector-baseline.json'), semantic);
  return { baselineDb, record: semantic };
}

function scenarioRun(worktree, scenario, prereg, baselineSummary, selectorBaseline) {
  const patchFile = path.join(preregDir, scenario.patch);
  const apply = run('git', ['apply', patchFile], { cwd: worktree });
  requireSuccess(apply, `apply ${scenario.id}`);
  const trackedPaths = git(worktree, ['diff', '--name-only']).split('\n').filter(Boolean);
  const statusPaths = git(worktree, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3));
  const changedPaths = [...new Set([...trackedPaths, ...statusPaths])].sort();
  if (JSON.stringify(changedPaths) !== JSON.stringify([...scenario.changed_paths].sort())) {
    throw new Error(`changed path mismatch: ${scenario.id}`);
  }
  const rawDir = path.join(resultsDir, 'raw', scenario.id);

  // Selection is frozen before the FULL oracle is executed.
  const selector = runSelector(worktree, rawDir, scenario, selectorBaseline.baselineDb);
  const selectorCheckIds = selector.selected_nodeids.map((nodeid) => `pytest:${nodeid}`).sort();
  const core = createPlan(worktree, scenario, selector.state, [], prereg, false);
  const withSelector = createPlan(worktree, scenario, selector.state, selector.selected_nodeids, prereg, true);
  const coreReceipt = buildValueReceipt(core.plan, { mechanismRevision: git(repoRoot, ['rev-parse', 'HEAD']), runId: `${scenario.id}:AV_CORE` });
  const withReceipt = buildValueReceipt(withSelector.plan, { mechanismRevision: git(repoRoot, ['rev-parse', 'HEAD']), runId: `${scenario.id}:AV_WITH_SELECTOR_EVIDENCE` });
  writeJson(path.join(resultsDir, 'value-receipts', `${scenario.id}-AV_CORE.json`), coreReceipt);
  writeJson(path.join(resultsDir, 'value-receipts', `${scenario.id}-AV_WITH_SELECTOR_EVIDENCE.json`), withReceipt);

  const full = runFullCatalog(worktree, rawDir, scenario.id, prereg);
  if (!full.full_complete) throw new Error(`incomplete FULL: ${scenario.id}`);
  writeJson(path.join(resultsDir, 'full', `${scenario.id}.json`), full);
  const relevant = full.failed_check_ids;
  const fullIds = prereg.catalog.checks.map((check) => check.id).sort();
  const arms = {
    FULL: armResult('FULL', fullIds, relevant),
    ECOSYSTEM_SELECTOR: armResult('ECOSYSTEM_SELECTOR', selectorCheckIds, relevant),
    AV_CORE: armResult('AV_CORE', selectedIdsFromPlan(core.plan), relevant, core.plan),
    AV_WITH_SELECTOR_EVIDENCE: armResult('AV_WITH_SELECTOR_EVIDENCE', selectedIdsFromPlan(withSelector.plan), relevant, withSelector.plan),
  };
  const misses = [];
  for (const armId of ['ECOSYSTEM_SELECTOR', 'AV_CORE', 'AV_WITH_SELECTOR_EVIDENCE']) {
    for (const checkId of arms[armId].misses) misses.push({ scenario_id: scenario.id, arm: armId, check_id: checkId, ...classifyMiss(checkId, armId, prereg) });
  }
  const result = {
    scenario_id: scenario.id,
    scenario_identity: contentIdentity(scenario),
    kind: scenario.kind,
    changed_paths: scenario.changed_paths,
    patch_sha256: scenario.patch_sha256,
    full_complete: full.full_complete,
    full_identity: full.identity,
    oracle: {
      definition: 'Clean PASS changed to scenario FAIL; relevant within the frozen verification catalog.',
      baseline_identity: baselineSummary.identity,
      scenario_revision: scenario.patch_sha256,
      relevant_check_ids: relevant,
    },
    selector_state: selector.state,
    adapter: {
      core_dependency_complete: core.dependency_complete,
      with_selector_dependency_complete: withSelector.dependency_complete,
      core_graph_identity: core.graph_identity,
      with_selector_graph_identity: withSelector.graph_identity,
      dynamic_hazards: [...new Set([...core.dynamic_hazards, ...withSelector.dynamic_hazards])].sort(),
      parse_errors: core.parse_errors,
    },
    arms,
    workload: Object.fromEntries(Object.entries(arms).map(([armId, arm]) => [armId, workload(prereg, arm.selected_check_ids)])),
    misses,
  };
  writeJson(path.join(resultsDir, 'scenarios', `${scenario.id}.json`), result);
  const selectedRelevant = arms.AV_WITH_SELECTOR_EVIDENCE.relevant_selected.length;
  const tests = result.workload.AV_WITH_SELECTOR_EVIDENCE.pytest_nodes;
  const telemetry = [
    '[Affected Verification]',
    `Target: pallets/click@${TARGET_SHA}`,
    `Scenario: ${scenario.id}`,
    `Selected tests: ${tests.selected} / ${tests.available}`,
    `Skipped tests: ${tests.skipped}`,
    `Sufficiency: ${withSelector.plan.sufficiency}`,
    `Oracle-relevant checks selected: ${selectedRelevant} / ${relevant.length}`,
    `Shadow miss: ${arms.AV_WITH_SELECTOR_EVIDENCE.misses.length ? 'YES' : 'NO'}`,
  ].join('\n');
  fs.mkdirSync(path.join(resultsDir, 'telemetry'), { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'telemetry', `${scenario.id}.txt`), `${telemetry}\n`);
  console.error(telemetry);
  console.error(operatorIndicator(withSelector.plan));

  const reverse = run('git', ['apply', '--reverse', patchFile], { cwd: worktree });
  requireSuccess(reverse, `reverse ${scenario.id}`);
  if (git(worktree, ['status', '--porcelain', '--untracked-files=no'])) throw new Error(`tracked target not clean after ${scenario.id}`);
  return result;
}

function aggregateArm(scenarios, armId) {
  const relevant = scenarios.flatMap((scenario) => scenario.arms[armId].relevant_check_ids);
  const selected = scenarios.flatMap((scenario) => scenario.arms[armId].relevant_selected);
  const misses = scenarios.flatMap((scenario) => scenario.arms[armId].misses);
  return {
    relevant_checks: relevant.length,
    relevant_selected: selected.length,
    misses: misses.length,
    recall: relevant.length ? `${selected.length}/${relevant.length}` : 'not-applicable',
    scenario_misses: scenarios.filter((scenario) => scenario.arms[armId].misses.length).map((scenario) => scenario.scenario_id),
    broadening_events: armId.startsWith('AV_')
      ? scenarios.filter((scenario) => ['FULL_VERIFICATION_REQUIRED', 'SUFFICIENT_BROADENED'].includes(scenario.arms[armId].plan.sufficiency)).map((scenario) => scenario.scenario_id)
      : [],
  };
}

function rawManifest(root) {
  const files = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (!full.endsWith('evidence-manifest.json')) files[path.relative(root, full).split(path.sep).join('/')] = sha256File(full);
    }
  }
  visit(root);
  return withIdentity({
    schema: 'opsle.affected-verification.av-exp-002.evidence-manifest.v1',
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    timing_note: 'Raw hashes include OBSERVED timing and scratch-path output; semantic result identity does not.',
  });
}

const prereg = verifyPreregistration();
const amendmentFiles = [
  '001-report-directory.md',
  '002-pytest-report-and-pyright-resolution.md',
  '003-planner-catalog-coverage-scope.md',
  '004-added-path-change-identity.md',
];
const amendments = amendmentFiles.map((name) => ({
  name,
  identity: sha256File(path.join(here, 'amendments', name)),
}));
const preregistrationSha = git(repoRoot, ['log', '-1', '--format=%H', '--', 'benchmark/av-exp-002/preregistration-v1']);
if (!preregistrationSha) throw new Error('preregistration must be committed before result execution');
const prepared = prepareTarget(prereg);
const baselineSummary = baseline(prepared.worktree, prereg);
const selectorBaseline = trainSelector(prepared.worktree, prereg);
const scenarioResults = [];
for (const scenario of prereg.scenarios.scenarios) {
  scenarioResults.push(scenarioRun(prepared.worktree, scenario, prereg, baselineSummary, selectorBaseline));
}

const allMisses = scenarioResults.flatMap((scenario) => scenario.misses);
const resultWithoutIdentity = {
  schema: 'opsle.affected-verification.av-exp-002.result.v1',
  experiment_id: 'AV-EXP-002',
  title: prereg.preregistration.title,
  trust_stage: TRUST_STAGE,
  target: { repository: TARGET_URL, sha: TARGET_SHA, license: 'BSD-3-Clause' },
  preregistration_sha: preregistrationSha,
  preregistration_identity: prereg.preregistration.identity,
  amendments,
  catalog_identity: prereg.catalog.identity,
  corpus_identity: prereg.scenarios.identity,
  baseline_identity: baselineSummary.identity,
  selector_baseline_identity: selectorBaseline.record.identity,
  scenarios: scenarioResults,
  safety: Object.fromEntries(['FULL', 'ECOSYSTEM_SELECTOR', 'AV_CORE', 'AV_WITH_SELECTOR_EVIDENCE']
    .map((armId) => [armId, aggregateArm(scenarioResults, armId)])),
  misses: allMisses,
  claim_limit: 'Observed only on the frozen Click revision, catalog, toolchain, selector baseline, and synthetic corpus; FULL remained authoritative.',
};
const bundle = { ...resultWithoutIdentity, result_identity: contentIdentity(resultWithoutIdentity) };
validateResultBundle(bundle);
writeJson(path.join(resultsDir, 'summary.json'), bundle);

const av1 = readJson(path.join(repoRoot, 'benchmark/av-exp-001/results-v2/summary.json'));
const comparison = withIdentity({
  schema: 'opsle.affected-verification.cross-experiment-observation.v1',
  experiments: {
    'AV-EXP-001': { result_identity: av1.summary_identity, selector: 'Vitest related', ecosystem: 'JavaScript/TypeScript' },
    'AV-EXP-002': { result_identity: bundle.result_identity, selector: 'pytest-testmon', ecosystem: 'Python' },
  },
  normalized: {
    relevant_check_recall: { 'AV-EXP-001': av1.selector_results, 'AV-EXP-002': bundle.safety },
    scenario_misses: { 'AV-EXP-002': Object.fromEntries(Object.entries(bundle.safety).map(([arm, value]) => [arm, value.scenario_misses])) },
    broadening_events: { 'AV-EXP-002': { AV_CORE: bundle.safety.AV_CORE.broadening_events, AV_WITH_SELECTOR_EVIDENCE: bundle.safety.AV_WITH_SELECTOR_EVIDENCE.broadening_events } },
  },
  non_comparable_units: ['Vitest files versus pytest nodes', 'wall clock across ecosystems', 'unlike non-test classes'],
});
writeJson(path.join(resultsDir, 'cross-experiment.json'), comparison);
const manifest = rawManifest(resultsDir);
writeJson(path.join(resultsDir, 'evidence-manifest.json'), manifest);
console.log(JSON.stringify({
  result_identity: bundle.result_identity,
  evidence_bundle_identity: manifest.identity,
  av_core_misses: bundle.safety.AV_CORE.misses,
  av_with_selector_misses: bundle.safety.AV_WITH_SELECTOR_EVIDENCE.misses,
  selector_misses: bundle.safety.ECOSYSTEM_SELECTOR.misses,
}, null, 2));
