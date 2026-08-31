#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  contentIdentity,
  createShadowBenchmarkResult,
  planVerification,
  validateScenarioManifest,
  validateShadowBenchmarkResult,
} from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const preregDir = path.join(here, 'preregistration-v1');
const targetSha = 'b57db4f86ef179285da216eeb291266da82c361c';
const targetUrl = 'https://github.com/pmndrs/zustand.git';
const preregistrationSha = '0544362d7659093b7f0b4f89ee8f68023fd269c3';
const amendmentIdentity = 'sha256:80a04b99ad73e86ecb2e7c85dda3a11ddbe99cdf200ca38e2c1effe498184357';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function identityWithout(value, key = 'identity') {
  const copy = structuredClone(value);
  delete copy[key];
  return contentIdentity(copy);
}

function run(command, args, options = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', GITHUB_ACTIONS: '', ...options.env },
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1000,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    command: [command, ...args],
    exit_code: result.status,
    signal: result.signal,
    timed_out: result.error?.code === 'ETIMEDOUT',
    duration_ms: Math.round(durationMs * 1000) / 1000,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    spawn_error: result.error?.message ?? null,
  };
}

function requireSuccess(result, label) {
  if (result.exit_code !== 0 || result.timed_out || result.spawn_error) {
    throw new Error(`${label} failed: exit=${result.exit_code} signal=${result.signal} ${result.spawn_error ?? ''}`);
  }
}

function verifyIdentityFile(name) {
  const value = readJson(path.join(preregDir, name));
  if (value.identity !== identityWithout(value)) throw new Error(`${name} identity mismatch`);
  return value;
}

function verifyPreregistration() {
  const manifest = verifyIdentityFile('manifest.json');
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = sha256File(path.join(preregDir, name));
    if (actual !== expected) throw new Error(`preregistration manifest mismatch: ${name}`);
  }
  const prereg = verifyIdentityFile('preregistration.json');
  const catalog = verifyIdentityFile('catalog.json');
  const policy = verifyIdentityFile('policy.json');
  const native = verifyIdentityFile('native-selector.json');
  const scenarios = verifyIdentityFile('scenarios.json');
  validateScenarioManifest(scenarios);
  for (const scenario of scenarios.scenarios) {
    if (sha256File(path.join(preregDir, scenario.patch)) !== scenario.patch_sha256) {
      throw new Error(`scenario patch/hash mismatch: ${scenario.id}`);
    }
  }
  const amendmentFile = path.join(here, 'amendments', '001-worktree-install.md');
  const amendmentText = fs.readFileSync(amendmentFile, 'utf8');
  const amendmentBody = amendmentText.split('\nAmendment identity:\n')[0] + '\n';
  if (sha256Bytes(amendmentBody) !== amendmentIdentity) throw new Error('benchmark amendment identity mismatch');
  return { manifest, prereg, catalog, policy, native, scenarios };
}

function plannerVersion() {
  return contentIdentity({
    planner: sha256File(path.join(repoRoot, 'src', 'planner.js')),
    benchmark_result: sha256File(path.join(repoRoot, 'src', 'benchmark.js')),
    harness: sha256File(path.join(here, 'run.mjs')),
  });
}

function git(cwd, args) {
  const result = run('git', args, { cwd, timeout: 2 * 60 * 1000 });
  requireSuccess(result, `git ${args.join(' ')}`);
  return result.stdout.trim();
}

function verifyTarget(target, frozen) {
  const observed = git(target, ['rev-parse', 'HEAD']);
  if (observed !== targetSha) throw new Error(`target SHA mismatch: ${observed}`);
  const status = git(target, ['status', '--porcelain', '--untracked-files=no']);
  if (status) throw new Error('target tracked worktree is dirty');
  for (const [name, expected] of Object.entries(frozen)) {
    if (sha256File(path.join(target, name)) !== expected) throw new Error(`target frozen file drift: ${name}`);
  }
  const version = run('corepack', ['pnpm', 'exec', 'vitest', '--version'], { cwd: target });
  requireSuccess(version, 'Vitest version check');
  if (!version.stdout.includes('vitest/4.1.10')) throw new Error('native selector version drift');
}

function createWorktree(target, worktree) {
  if (fs.existsSync(worktree)) throw new Error(`scratch path already exists: ${worktree}`);
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(target, ['worktree', 'add', '--detach', worktree, targetSha]);
  const install = run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--offline'], {
    cwd: worktree,
    timeout: 10 * 60 * 1000,
  });
  requireSuccess(install, `offline dependency install for ${path.basename(worktree)}`);
  return worktree;
}

function persistCommand(rawDir, id, execution) {
  fs.mkdirSync(rawDir, { recursive: true });
  const stdoutFile = path.join(rawDir, `${id}.stdout.log`);
  const stderrFile = path.join(rawDir, `${id}.stderr.log`);
  fs.writeFileSync(stdoutFile, execution.stdout);
  fs.writeFileSync(stderrFile, execution.stderr);
  const record = {
    command: execution.command,
    exit_code: execution.exit_code,
    signal: execution.signal,
    timed_out: execution.timed_out,
    duration_ms_observed: execution.duration_ms,
    spawn_error: execution.spawn_error,
    stdout_sha256: sha256File(stdoutFile),
    stderr_sha256: sha256File(stderrFile),
  };
  writeJson(path.join(rawDir, `${id}.execution.json`), record);
  return {
    ...record,
    stdout_file: path.relative(repoRoot, stdoutFile),
    stderr_file: path.relative(repoRoot, stderrFile),
  };
}

function relativeTestFile(name, worktree) {
  return path.relative(worktree, name).split(path.sep).join('/');
}

function runVitest(worktree, rawDir, id, args) {
  const outputFile = path.join(rawDir, `${id}.vitest.json`);
  fs.mkdirSync(rawDir, { recursive: true });
  const execution = run('corepack', [
    'pnpm', 'exec', 'vitest', ...args,
    '--reporter=json', `--outputFile=${outputFile}`,
  ], { cwd: worktree });
  const commandRecord = persistCommand(rawDir, id, execution);
  let report = null;
  if (fs.existsSync(outputFile)) report = readJson(outputFile);
  return { execution, commandRecord, report, outputFile };
}

function normalizeVitestOutcomes(report, worktree, catalog) {
  const testChecks = catalog.checks.filter((check) => check.type === 'unit-test');
  const byTarget = new Map(testChecks.map((check) => [check.target, check]));
  const outcomes = new Map();
  for (const testResult of report?.testResults ?? []) {
    const target = relativeTestFile(testResult.name, worktree);
    const check = byTarget.get(target);
    if (!check) throw new Error(`native or full Vitest output contains unknown test file: ${target}`);
    outcomes.set(check.id, testResult.status === 'passed' ? 'PASS' : 'FAIL');
  }
  return outcomes;
}

function runFullCatalog(worktree, rawDir, catalog, runId) {
  const testRun = runVitest(worktree, rawDir, `${runId}-tests`, ['run']);
  const outcomes = normalizeVitestOutcomes(testRun.report, worktree, catalog);
  const commandRecords = [testRun.commandRecord];
  const nonTests = [
    ['check:format', 'format', ['pnpm', 'run', 'test:format']],
    ['check:typecheck', 'typecheck', ['pnpm', 'run', 'test:types']],
    ['check:lint', 'lint', ['pnpm', 'run', 'test:lint']],
    ['check:build', 'build', ['pnpm', 'run', 'build']],
  ];
  for (const [checkId, id, args] of nonTests) {
    const execution = run('corepack', args, { cwd: worktree });
    commandRecords.push(persistCommand(rawDir, `${runId}-${id}`, execution));
    outcomes.set(checkId, execution.exit_code === 0 && !execution.timed_out && !execution.spawn_error ? 'PASS' : 'FAIL');
  }
  const allIds = catalog.checks.map((check) => check.id).sort();
  const executed = [...outcomes.keys()].sort();
  const complete = JSON.stringify(allIds) === JSON.stringify(executed)
    && commandRecords.every((record) => !record.timed_out && !record.spawn_error);
  const failed = [...outcomes.entries()].filter(([, status]) => status === 'FAIL').map(([id]) => id).sort();
  const semantic = {
    scenario_id: runId,
    target_sha: targetSha,
    catalog_identity: catalog.identity,
    executed_check_ids: executed,
    failed_check_ids: failed,
    outcomes: Object.fromEntries([...outcomes.entries()].sort()),
    complete,
    command_evidence: commandRecords.map((record) => ({
      command: record.command,
      exit_code: record.exit_code,
      signal: record.signal,
      timed_out: record.timed_out,
      spawn_error: record.spawn_error,
      stdout_sha256: record.stdout_sha256,
      stderr_sha256: record.stderr_sha256,
    })),
  };
  return {
    ...semantic,
    identity: contentIdentity(semantic),
    observed_durations_ms: commandRecords.map((record) => ({
      command: record.command,
      duration_ms: record.duration_ms_observed,
    })),
    evidence_files: commandRecords.flatMap((record) => [record.stdout_file, record.stderr_file]),
    test_count: testRun.report?.numTotalTests ?? null,
    test_file_count: testRun.report?.numTotalTestSuites ?? null,
  };
}

function importSpecifiers(source) {
  const result = [];
  const pattern = /(?:\bfrom\s+|\bimport\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) result.push(match[1]);
  return result;
}

function sourceFiles(root) {
  const result = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) result.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  visit(path.join(root, 'src'));
  return result.sort();
}

function resolveSourceImport(fromFile, specifier, known) {
  if (!specifier.startsWith('.')) return null;
  const raw = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, path.posix.join(raw, 'index.ts')];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

function buildSourceGraph(root, catalog, nativeSelected = []) {
  const files = sourceFiles(root);
  const known = new Set(files);
  const components = files.map((file) => {
    const dependencies = importSpecifiers(fs.readFileSync(path.join(root, file), 'utf8'))
      .map((specifier) => resolveSourceImport(file, specifier, known))
      .filter(Boolean);
    return { id: file, dependencies: [...new Set(dependencies)].sort() };
  });
  components.push({ id: 'repo:metadata', dependencies: [] });
  for (const check of catalog.checks.filter((item) => item.type === 'unit-test')) {
    components.push({ id: `testfile:${check.target}`, dependencies: [] });
    components.push({ id: `native:${check.id}`, dependencies: [] });
  }
  return {
    components: components.sort((a, b) => a.id.localeCompare(b.id)),
    nativeSelected: [...nativeSelected].sort(),
  };
}

function plannerCatalog(catalog) {
  return catalog.checks.map((check) => ({
    id: check.id,
    type: check.type,
    command: check.invocation,
    scope: {
      components: check.type === 'unit-test'
        ? [...check.scope, `testfile:${check.target}`, `native:${check.id}`].sort()
        : [...check.scope],
    },
    tags: [...check.tags],
    test_executions: check.test_executions,
  }));
}

function metadataPath(changedPath) {
  return [
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vitest.config.mts',
    'tsconfig.json', 'eslint.config.mjs', 'rollup.config.mjs',
  ].includes(changedPath) || changedPath.startsWith('.github/workflows/');
}

function createPlan(worktree, scenario, catalog, policy, native, nativeSelected = null) {
  const graph = buildSourceGraph(worktree, catalog, nativeSelected ?? []);
  const componentIds = new Set(graph.components.map((component) => component.id));
  let dependencyComplete = scenario.evidence_mode !== 'INCOMPLETE_DEPENDENCY_EVIDENCE';
  const impacts = scenario.changed_paths.map((changedPath) => {
    let component = null;
    if (componentIds.has(changedPath)) component = changedPath;
    else if (changedPath.startsWith('tests/')) component = `testfile:${changedPath}`;
    else if (metadataPath(changedPath)) component = 'repo:metadata';
    if (!component || !componentIds.has(component)) dependencyComplete = false;
    const nativeComponents = (nativeSelected ?? []).map((id) => `native:${id}`);
    return component
      ? { path: changedPath, components: [component, ...nativeComponents].sort(), confidence: 'KNOWN', reason: 'deterministic AV-EXP-001 adapter mapping' }
      : { path: changedPath, components: [], confidence: 'UNKNOWN', reason: 'changed path has no frozen component mapping' };
  });
  const providers = [
    { id: 'git-diff', kind: 'git-change-identity', version: '1', identity: scenario.patch_sha256 },
    { id: 'source-graph', kind: 'typescript-static-imports', version: 'av-exp-001-v1', identity: contentIdentity(graph.components) },
  ];
  if (nativeSelected !== null) {
    providers.push({ id: 'native-vitest', kind: 'native-related-tests', version: native.version, identity: native.identity });
  }
  const input = {
    schema: 'opsle.affected-verification.input.v1',
    change: {
      base_revision: targetSha,
      target_revision: scenario.patch_sha256,
      identity: contentIdentity({ target_sha: targetSha, scenario_id: scenario.id, patch_sha256: scenario.patch_sha256 }),
      paths: scenario.changed_paths.map((changedPath) => ({
        path: changedPath,
        regions: scenario.changed_regions,
        risk_tags: metadataPath(changedPath) ? ['verification-metadata']
          : ['src/index.ts', 'src/vanilla.ts', 'src/react.ts', 'src/types.d.ts'].includes(changedPath)
            ? ['public-contract'] : [],
      })),
    },
    evidence: {
      identity: contentIdentity({ components: graph.components, impacts, providers, complete: dependencyComplete }),
      complete: dependencyComplete,
      providers,
      components: graph.components,
      impacts,
    },
    catalog: { identity: catalog.identity, complete: true, checks: plannerCatalog(catalog) },
    policy: {
      identity: policy.identity,
      version: 'av-exp-001-zustand-policy-v1',
      rules: [
        {
          id: 'always-non-test-catalog',
          match: { path_globs: ['**'], risk_tags: [], component_ids: [] },
          escalation: 'NONE',
          required_check_tags: ['non-test-required'],
        },
        {
          id: 'verification-metadata-full',
          match: { path_globs: ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vitest.config.mts', 'tsconfig.json', 'eslint.config.mjs', 'rollup.config.mjs', '.github/workflows/**'], risk_tags: [], component_ids: [] },
          escalation: 'FULL',
          required_check_tags: [],
        },
        {
          id: 'public-contract-broaden',
          match: { path_globs: [], risk_tags: ['public-contract'], component_ids: [] },
          escalation: 'BROADEN',
          required_check_tags: ['typecheck', 'build'],
        },
      ],
    },
  };
  return { input, plan: planVerification(input), dependencyComplete };
}

function runNative(worktree, rawDir, scenario, catalog, native) {
  const id = `${scenario.id}-native`;
  const runResult = runVitest(worktree, rawDir, id, ['related', ...scenario.changed_paths, '--run']);
  let selected = [];
  if (runResult.report) {
    selected = [...normalizeVitestOutcomes(runResult.report, worktree, catalog).keys()].sort();
  } else {
    const combined = `${runResult.execution.stdout}\n${runResult.execution.stderr}`;
    if (!/No test files found|no tests found/i.test(combined)) {
      throw new Error(`native selector failed without a parseable selection for ${scenario.id}`);
    }
  }
  const testIds = new Set(catalog.checks.filter((check) => check.type === 'unit-test').map((check) => check.id));
  if (selected.some((idValue) => !testIds.has(idValue))) throw new Error('native selector emitted non-test or unknown check');
  return {
    selected_check_ids: selected,
    observed_identity: identityWithout(native),
    evidence_files: [runResult.commandRecord.stdout_file, runResult.commandRecord.stderr_file,
      ...(fs.existsSync(runResult.outputFile) ? [path.relative(repoRoot, runResult.outputFile)] : [])],
    duration_ms_observed: runResult.execution.duration_ms,
  };
}

function skipRecord(check, arm, planCheck = null) {
  if (arm === 'NATIVE') {
    return {
      check_id: check.id,
      reason: check.type === 'unit-test'
        ? 'Not selected by the frozen Vitest related output.'
        : 'The native Vitest related arm does not select non-test catalog checks.',
      evidence_refs: ['native-selector:zustand-vitest-related-v1', 'native-selector-output'],
    };
  }
  return {
    check_id: check.id,
    reason: planCheck.reasons.map((reason) => `${reason.code}: ${reason.detail}`).join('; '),
    evidence_refs: [...new Set(planCheck.reasons.flatMap((reason) => reason.evidence_refs))].sort(),
  };
}

function armFromSelection(catalog, selected, arm, plan = null) {
  const selectedSet = new Set(selected);
  return {
    plan_identity: plan?.plan_identity ?? null,
    selected_check_ids: [...selectedSet].sort(),
    skipped_checks: catalog.checks.filter((check) => !selectedSet.has(check.id)).map((check) => {
      const planCheck = plan?.skipped_checks.find((item) => item.id === check.id) ?? null;
      return skipRecord(check, arm, planCheck);
    }),
    sufficiency: plan?.sufficiency ?? null,
    uncertainty: plan?.uncertainty ?? null,
    escalation: plan?.escalation ?? null,
    policy_identity: plan?.provenance.policy_identity ?? null,
  };
}

function workloadFor(catalog, arms) {
  const availableTests = catalog.checks.filter((check) => check.type === 'unit-test')
    .reduce((sum, check) => sum + check.test_executions, 0);
  const availableFiles = catalog.checks.filter((check) => check.type === 'unit-test').length;
  const nonTestTypes = [...new Set(catalog.checks.filter((check) => check.type !== 'unit-test').map((check) => check.type))].sort();
  const armWorkload = {};
  for (const [armId, arm] of Object.entries(arms)) {
    const selected = new Set(arm.selected_check_ids);
    const selectedTests = catalog.checks.filter((check) => selected.has(check.id) && check.type === 'unit-test');
    armWorkload[armId] = {
      test_files: { available: availableFiles, selected: selectedTests.length, skipped: availableFiles - selectedTests.length },
      test_executions: {
        available: availableTests,
        selected: selectedTests.reduce((sum, check) => sum + check.test_executions, 0),
        skipped: availableTests - selectedTests.reduce((sum, check) => sum + check.test_executions, 0),
      },
      non_test_checks: Object.fromEntries(nonTestTypes.map((type) => {
        const checks = catalog.checks.filter((check) => check.type === type);
        const count = checks.filter((check) => selected.has(check.id)).length;
        return [type, { available: checks.length, selected: count, skipped: checks.length - count }];
      })),
    };
  }
  return { units_not_combined: true, arms: armWorkload };
}

function evidenceHashes(files) {
  return files.map((file) => `${file}=${sha256File(path.join(repoRoot, file))}`).sort();
}

function baseline(target, scratch, resultsDir, frozen, catalog) {
  const runs = [];
  for (let index = 1; index <= 3; index += 1) {
    const runId = `baseline-${index}`;
    const worktree = createWorktree(target, path.join(scratch, runId));
    const full = runFullCatalog(worktree, path.join(resultsDir, 'raw', runId), catalog, runId);
    writeJson(path.join(resultsDir, 'baseline', `${runId}.json`), full);
    console.error(`[Affected Verification] ${runId}: ${full.failed_check_ids.length ? 'FAIL' : 'PASS'}; ${full.test_count ?? 'unknown'} tests; duration OBSERVED`);
    runs.push(full);
  }
  const stable = runs.every((item) => item.complete && item.failed_check_ids.length === 0
    && item.test_count === catalog.source.collection_count
    && item.test_file_count === catalog.checks.filter((check) => check.type === 'unit-test').length);
  if (!stable) throw new Error('baseline stability gate failed');
  const semantic = {
    target_sha: targetSha,
    catalog_identity: catalog.identity,
    repetitions: runs.map((item) => ({
      full_run_identity: item.identity,
      executed_check_ids: item.executed_check_ids,
      failed_check_ids: item.failed_check_ids,
      test_count: item.test_count,
      test_file_count: item.test_file_count,
    })),
    stable: true,
  };
  const record = { ...semantic, identity: contentIdentity(semantic), observed_durations_ms: runs.map((item) => item.observed_durations_ms) };
  writeJson(path.join(resultsDir, 'baseline', 'baseline-summary.json'), record);
  return record;
}

function scenarioResult(target, scratch, resultsDir, scenario, prereg, baselineRecord) {
  const worktree = createWorktree(target, path.join(scratch, scenario.id));
  const patchFile = path.join(preregDir, scenario.patch);
  const apply = run('git', ['apply', patchFile], { cwd: worktree });
  requireSuccess(apply, `materialize ${scenario.id}`);
  const diff = run('git', ['diff', '--binary'], { cwd: worktree });
  requireSuccess(diff, `freeze materialized ${scenario.id}`);
  const observedPatchSha256 = sha256File(patchFile);
  if (observedPatchSha256 !== scenario.patch_sha256) throw new Error(`scenario patch/hash mismatch after materialization: ${scenario.id}`);
  const changedPaths = git(worktree, ['diff', '--name-only']).split('\n').filter(Boolean).sort();
  if (JSON.stringify(changedPaths) !== JSON.stringify([...scenario.changed_paths].sort())) throw new Error(`scenario changed-path mismatch: ${scenario.id}`);

  const rawDir = path.join(resultsDir, 'raw', scenario.id);
  const nativeRun = runNative(worktree, rawDir, scenario, prereg.catalog, prereg.native);
  const core = createPlan(worktree, scenario, prereg.catalog, prereg.policy, prereg.native, null);
  const withNative = createPlan(worktree, scenario, prereg.catalog, prereg.policy, prereg.native, nativeRun.selected_check_ids);
  const full = runFullCatalog(worktree, rawDir, prereg.catalog, scenario.id);
  writeJson(path.join(resultsDir, 'full', `${scenario.id}.json`), full);
  if (!full.complete) throw new Error(`full-run incomplete: ${scenario.id}`);
  const relevant = [...full.failed_check_ids].sort();
  const oracleSemantic = {
    scenario_id: scenario.id,
    full_run_identity: full.identity,
    baseline_identity: baselineRecord.identity,
    relevant_check_ids: relevant,
    definition: 'Clean PASS changed to scenario FAIL; relevant within this frozen verification catalog.',
  };
  const oracle = { ...oracleSemantic, identity: contentIdentity(oracleSemantic) };
  writeJson(path.join(resultsDir, 'oracle', `${scenario.id}.json`), oracle);

  const fullArm = { selected_check_ids: prereg.catalog.checks.map((check) => check.id).sort() };
  const arms = {
    FULL: fullArm,
    NATIVE: armFromSelection(prereg.catalog, nativeRun.selected_check_ids, 'NATIVE'),
    AV_CORE: armFromSelection(prereg.catalog, core.plan.selected_checks.map((check) => check.id), 'AV_CORE', core.plan),
    AV_WITH_NATIVE_EVIDENCE: armFromSelection(prereg.catalog, withNative.plan.selected_checks.map((check) => check.id), 'AV_WITH_NATIVE_EVIDENCE', withNative.plan),
  };
  for (const armId of ['NATIVE', 'AV_CORE', 'AV_WITH_NATIVE_EVIDENCE']) {
    const selected = new Set(arms[armId].selected_check_ids);
    arms[armId].supplied_selection_misses = relevant.filter((id) => !selected.has(id)).sort();
  }
  const evidenceFiles = [...full.evidence_files, ...nativeRun.evidence_files];
  const benchmarkResult = createShadowBenchmarkResult({
    experiment_id: 'AV-EXP-001',
    benchmark_revision: `${preregistrationSha}+${amendmentIdentity}`,
    trust_stage: 'SHADOW',
    target: { repository: targetUrl, expected_sha: targetSha, observed_sha: git(worktree, ['rev-parse', 'HEAD']) },
    scenario: {
      id: scenario.id,
      identity: contentIdentity(scenario),
      declared_patch_sha256: scenario.patch_sha256,
      observed_patch_sha256: observedPatchSha256,
      changed_paths: scenario.changed_paths,
    },
    catalog: prereg.catalog,
    observed_catalog_identity: identityWithout(prereg.catalog),
    native_selector: {
      declared_identity: prereg.native.identity,
      observed_identity: nativeRun.observed_identity,
      version: prereg.native.version,
    },
    adapter_evidence: { valid: true, dependency_complete: core.dependencyComplete },
    planner: { version: plannerVersion(), policy_identity: prereg.policy.identity, declared_policy_identity: identityWithout(prereg.policy) },
    baseline: { identity: baselineRecord.identity, target_sha: targetSha, catalog_identity: prereg.catalog.identity, stable: baselineRecord.stable },
    full_run: { scenario_id: scenario.id, identity: full.identity, executed_check_ids: full.executed_check_ids, failed_check_ids: full.failed_check_ids, complete: full.complete },
    oracle: { ...oracle, stale: false },
    arms,
    workload: workloadFor(prereg.catalog, arms),
    evidence_hashes: evidenceHashes(evidenceFiles),
  });
  validateShadowBenchmarkResult(benchmarkResult);
  writeJson(path.join(resultsDir, 'scenarios', `${scenario.id}.json`), benchmarkResult);

  const av = benchmarkResult.arms.AV_WITH_NATIVE_EVIDENCE;
  const testWork = benchmarkResult.workload.arms.AV_WITH_NATIVE_EVIDENCE.test_executions;
  const telemetry = scenario.evidence_mode === 'INCOMPLETE_DEPENDENCY_EVIDENCE'
    ? `[Affected Verification]\nScenario: ${scenario.id}\nImpact evidence incomplete\nTargeted skipping denied\nVerification broadened: FULL\nSelection miss risk: unresolved, fail-closed\n`
    : `[Affected Verification]\nScenario: ${scenario.id}\nSelected tests: ${testWork.selected} / ${testWork.available}\nSkipped tests: ${testWork.skipped}\nOther selected checks: format, typecheck, lint, build\nSufficiency: ${av.sufficiency}\nShadow relevant checks: ${relevant.length - av.selection_misses.length} / ${relevant.length} selected\nSelection miss: ${av.selection_misses.length ? 'YES' : 'NO'}\n`;
  fs.mkdirSync(path.join(resultsDir, 'telemetry'), { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'telemetry', `${scenario.id}.txt`), telemetry);
  console.error(telemetry.trim());
  return benchmarkResult;
}

function summarize(resultsDir, catalog, scenarioResults, baselineRecord) {
  const selectors = ['NATIVE', 'AV_CORE', 'AV_WITH_NATIVE_EVIDENCE'];
  const summary = {
    schema: 'opsle.affected-verification.shadow-benchmark-summary.v1',
    experiment_id: 'AV-EXP-001',
    preregistration_sha: preregistrationSha,
    amendment_identity: amendmentIdentity,
    target: { repository: targetUrl, sha: targetSha },
    catalog_identity: catalog.identity,
    baseline_identity: baselineRecord.identity,
    scenario_count: scenarioResults.length,
    scenarios_with_relevant_failures: scenarioResults.filter((result) => result.oracle.relevant_check_ids.length).length,
    selector_results: {},
    scenario_result_identities: Object.fromEntries(scenarioResults.map((result) => [result.scenario.id, result.result_identity])),
    trust_stage: 'SHADOW',
    trust_decision: 'REMAIN_SHADOW',
    claim_limit: 'No miss was observed only if the miss count is zero; either outcome is bounded to this frozen calibration corpus.',
  };
  for (const selector of selectors) {
    const relevant = scenarioResults.reduce((sum, result) => sum + result.oracle.relevant_check_ids.length, 0);
    const misses = scenarioResults.flatMap((result) => result.arms[selector].selection_misses.map((checkId) => ({ scenario_id: result.scenario.id, check_id: checkId })));
    const selectedRelevant = relevant - misses.length;
    summary.selector_results[selector] = {
      relevant_checks: relevant,
      selected_relevant_checks: selectedRelevant,
      missed_relevant_checks: misses.length,
      relevant_check_recall: relevant ? `${selectedRelevant}/${relevant}` : 'NOT_APPLICABLE',
      scenario_level_miss_count: new Set(misses.map((miss) => miss.scenario_id)).size,
      escalations: scenarioResults.filter((result) => result.arms[selector].escalation?.state === 'FULL').length,
      misses,
    };
  }
  const withoutIdentity = { ...summary, summary_identity: undefined };
  summary.summary_identity = contentIdentity(withoutIdentity);
  writeJson(path.join(resultsDir, 'summary.json'), summary);
  return summary;
}

function parseArgs(argv) {
  const result = { command: argv[2] ?? 'help' };
  for (let index = 3; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument: ${key}`);
    result[key.slice(2)] = path.resolve(value);
  }
  return result;
}

function prepare(target) {
  if (fs.existsSync(target)) throw new Error(`target path already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const clone = run('git', ['clone', '--no-checkout', targetUrl, target], { timeout: 10 * 60 * 1000 });
  requireSuccess(clone, 'target clone');
  git(target, ['checkout', '--detach', targetSha]);
  const install = run('corepack', ['pnpm', 'install', '--frozen-lockfile'], { cwd: target, timeout: 10 * 60 * 1000 });
  requireSuccess(install, 'target dependency install');
  return target;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'prepare') {
    if (!args.target) throw new Error('--target is required');
    prepare(args.target);
    console.error(`[Affected Verification] target prepared at ${args.target}`);
    return;
  }
  if (args.command !== 'all') {
    console.log('Usage: node benchmark/av-exp-001/run.mjs all --target <clone> --scratch <empty-dir> --results <dir>');
    console.log('   or: node benchmark/av-exp-001/run.mjs prepare --target <new-dir>');
    return;
  }
  for (const key of ['target', 'scratch', 'results']) if (!args[key]) throw new Error(`--${key} is required`);
  const prereg = verifyPreregistration();
  verifyTarget(args.target, prereg.environment?.frozen_target_files ?? readJson(path.join(preregDir, 'environment.json')).frozen_target_files);
  if (fs.existsSync(args.scratch)) throw new Error(`scratch path already exists: ${args.scratch}`);
  if (fs.existsSync(args.results)) throw new Error(`results path already exists: ${args.results}`);
  fs.mkdirSync(args.scratch, { recursive: true });
  fs.mkdirSync(args.results, { recursive: true });
  const baselineRecord = baseline(args.target, args.scratch, args.results, readJson(path.join(preregDir, 'environment.json')).frozen_target_files, prereg.catalog);
  const results = prereg.scenarios.scenarios.map((scenario) => scenarioResult(args.target, args.scratch, args.results, scenario, prereg, baselineRecord));
  const summary = summarize(args.results, prereg.catalog, results, baselineRecord);
  console.error(`[Affected Verification] AV-EXP-001 complete in SHADOW: summary ${summary.summary_identity}`);
}

main();
