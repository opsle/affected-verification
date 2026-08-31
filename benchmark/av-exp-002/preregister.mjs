#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  TARGET_SHA,
  TARGET_URL,
  TESTMON_VERSION,
  TRUST_STAGE,
  withIdentity,
  writeJson,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const preregDir = path.join(here, 'preregistration-v1');
const target = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: node preregister.mjs TARGET_CLICK_CHECKOUT');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? target,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1000,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function sha256File(file) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function git(...args) {
  return run('git', args);
}

if (git('rev-parse', 'HEAD') !== TARGET_SHA) throw new Error('target SHA mismatch');
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('target tracked files are dirty');

run('uv', ['sync', '--locked', '--all-groups']);
run('uv', [
  'pip', 'install', '--python', '.venv/bin/python',
  `pytest-testmon==${TESTMON_VERSION}`,
  'build==1.3.0',
  'flit_core==3.12.0',
]);

const collectReport = path.join(os.tmpdir(), `av2-collect-${process.pid}.json`);
run(path.join(target, '.venv/bin/pytest'), [
  '--override-ini=addopts=', '-p', 'pytest_av_catalog', '--collect-only', '-q',
], {
  env: {
    PYTHONPATH: here,
    AV2_PYTEST_REPORT: collectReport,
  },
});
const nodeids = JSON.parse(fs.readFileSync(collectReport, 'utf8')).selected_nodeids;
fs.unlinkSync(collectReport);
if (nodeids.length !== 2016) throw new Error(`expected 2016 active nodes, observed ${nodeids.length}`);

const versionScript = [
  'import importlib.metadata as m, json, platform, sys',
  'names=["pytest","pytest-testmon","ruff","mypy","pyright","sphinx","build","flit_core"]',
  'print(json.dumps({"python":platform.python_version(),"implementation":platform.python_implementation(),"packages":{n:m.version(n) for n in names}}))',
].join(';');
const versions = JSON.parse(run(path.join(target, '.venv/bin/python'), ['-c', versionScript]));

const frozenFiles = ['pyproject.toml', 'uv.lock', 'tests/conftest.py', '.pre-commit-config.yaml'];
const frozenIdentities = Object.fromEntries(frozenFiles.map((name) => [name, sha256File(path.join(target, name))]));
const adapterFiles = ['pytest_av_catalog.py', 'python_graph.py', 'run.mjs', 'lib.mjs'];
const adapterIdentities = Object.fromEntries(adapterFiles.map((name) => [name, sha256File(path.join(here, name))]));
const testFiles = [...new Set(nodeids.map((nodeid) => nodeid.split('::')[0]))].sort();

const environment = withIdentity({
  schema: 'opsle.affected-verification.av-exp-002.environment.v1',
  target_sha: TARGET_SHA,
  os: { platform: process.platform, arch: process.arch, kernel: os.release() },
  python: versions.python,
  implementation: versions.implementation,
  uv: run('uv', ['--version']),
  packages: versions.packages,
  selector: { name: 'pytest-testmon', version: TESTMON_VERSION },
  install: [
    'uv sync --locked --all-groups',
    `uv pip install --python .venv/bin/python pytest-testmon==${TESTMON_VERSION} build==1.3.0 flit_core==3.12.0`,
  ],
  frozen_file_identities: frozenIdentities,
  benchmark_adapter_identities: adapterIdentities,
});

const testChecks = nodeids.map((nodeid) => ({
  id: `pytest:${nodeid}`,
  verification_class: 'PYTEST_NODE',
  invocation: `.venv/bin/pytest ${nodeid}`,
  scope: { components: [`testnode:${nodeid}`] },
  content_identity: withIdentity({ target_sha: TARGET_SHA, nodeid }).identity,
  configuration_identities: {
    pyproject: frozenIdentities['pyproject.toml'],
    conftest: frozenIdentities['tests/conftest.py'],
  },
}));
const nonTestChecks = [
  ['check:lint', 'LINT', '.venv/bin/ruff check --no-fix src tests', ['python-change']],
  ['check:format', 'FORMAT', '.venv/bin/ruff format --check src tests', ['python-change']],
  ['check:mypy', 'TYPECHECK_MYPY', '.venv/bin/mypy', ['source-change']],
  ['check:pyright', 'TYPECHECK_PYRIGHT', '.venv/bin/pyright --ignoreexternal --verifytypes click', ['source-change']],
  ['check:build', 'PACKAGE_BUILD', '.venv/bin/python -m build --no-isolation --outdir <scratch>', ['package-change']],
  ['check:docs', 'DOCS_BUILD', '.venv/bin/sphinx-build -E -W -b dirhtml docs <scratch>', ['docs-change']],
  ['check:lock', 'LOCK_VALIDATION', 'uv lock --check', ['dependency-change']],
  ['check:pytest-collection', 'TEST_INFRASTRUCTURE', '.venv/bin/pytest --collect-only', ['python-change']],
].map(([id, verification_class, invocation, tags]) => ({
  id,
  verification_class,
  invocation,
  scope: { components: [] },
  tags,
  content_identity: withIdentity({ target_sha: TARGET_SHA, id, invocation }).identity,
  configuration_identities: frozenIdentities,
}));
const catalog = withIdentity({
  schema: 'opsle.affected-verification.av-exp-002.catalog.v1',
  target_sha: TARGET_SHA,
  complete: true,
  unit_definition: '2,016 active non-stress pytest node IDs plus seven separately typed non-test checks',
  pytest_nodes: nodeids.length,
  pytest_files: testFiles.length,
  excluded_stress_nodes: 31000,
  checks: [...testChecks, ...nonTestChecks],
});

const selector = withIdentity({
  schema: 'opsle.affected-verification.av-exp-002.selector.v1',
  arm_id: 'ECOSYSTEM_SELECTOR',
  tool: 'pytest-testmon',
  version: TESTMON_VERSION,
  contract: 'Runtime coverage and source/block change based pytest test selection using a persisted .testmondata database; tests only.',
  baseline: 'Run the frozen 2,016-node catalog once at the exact target SHA with --testmon, preserve .testmondata, and restore that byte identity before each scenario.',
  catalog_filter: 'pytest_av_catalog.py excludes the same stress-marked nodes as target addopts without using -m, because pytest-testmon documents that -m disables selection.',
  invocation: '.venv/bin/pytest --override-ini=addopts= -p pytest_av_catalog --testmon --collect-only -q',
  asymmetry: 'The selector database receives clean baseline runtime coverage. AV_CORE does not receive it. AV_WITH_SELECTOR_EVIDENCE receives only the normalized selected node IDs and database readiness evidence.',
  limitations: ['tests only', 'runtime paths not executed during baseline are not dependency evidence', 'database freshness and environment identity are required'],
});

const policy = withIdentity({
  schema: 'opsle.affected-verification.av-exp-002.policy.v1',
  version: 'av-exp-002-click-v1',
  rules: [
    { id: 'PYTHON-HYGIENE', match: ['**/*.py'], require: ['check:lint', 'check:format'] },
    { id: 'SOURCE-TYPING', match: ['src/**/*.py'], require: ['check:mypy', 'check:pyright'] },
    { id: 'SHARED-CORE-FULL', match: ['src/click/core.py', 'src/click/types.py', 'src/click/utils.py', 'src/click/__init__.py'], escalation: 'FULL' },
    { id: 'PACKAGE-METADATA-FULL', match: ['pyproject.toml', 'uv.lock'], escalation: 'FULL' },
    { id: 'PYTEST-CONFIG-FULL', match: ['tests/conftest.py'], escalation: 'FULL' },
    { id: 'UNKNOWN-OR-PARSE-FAIL', match_evidence: ['unknown_path', 'parse_error'], escalation: 'FULL' },
    { id: 'DYNAMIC-STATIC-UNCERTAINTY', match_evidence: ['dynamic_import', 'plugin_discovery'], escalation: 'FULL_UNLESS_COMPLETE_RUNTIME_SELECTOR' },
  ],
  skip_requirement: 'Every omitted catalog check must carry a reason, evidence references, policy state, and uncertainty state.',
});

const scenarioDefs = [
  ['AV2-001', 'isolated implementation fault', 'SYNTHETIC_FAULT', ['src/click/parser.py'], {}],
  ['AV2-002', 'direct formatting dependency fault', 'SYNTHETIC_FAULT', ['src/click/formatting.py'], {}],
  ['AV2-003', 'shared/transitive utility fault', 'SYNTHETIC_FAULT', ['src/click/utils.py'], {}],
  ['AV2-004', 'test-only benign change', 'BENIGN_SYNTHETIC_CHANGE', ['tests/test_parser.py'], {}],
  ['AV2-005', 'public interface typing fault', 'SYNTHETIC_FAULT', ['src/click/core.py'], {}],
  ['AV2-006', 'lint-sensitive unused import', 'SYNTHETIC_FAULT', ['src/click/parser.py'], {}],
  ['AV2-007', 'package metadata/build fault', 'SYNTHETIC_FAULT', ['pyproject.toml'], {}],
  ['AV2-008', 'multi-file formatting behavior fault', 'SYNTHETIC_FAULT', ['src/click/formatting.py', 'tests/test_formatting.py'], {}],
  ['AV2-009', 'dynamic plugin-discovery fault with incomplete static evidence', 'UNCERTAINTY_SCENARIO', ['src/click/decorators.py'], { static_evidence_complete: false, runtime_selector_can_repair: true }],
  ['AV2-010', 'unknown source path with missing selector database', 'UNCERTAINTY_SCENARIO', ['src/click/_av_unknown.py'], { static_evidence_complete: false, selector_database: 'MISSING' }],
  ['AV2-011', 'shared conftest configuration change', 'UNCERTAINTY_SCENARIO', ['tests/conftest.py'], { static_evidence_complete: false }],
];
const scenarios = withIdentity({
  schema: 'opsle.affected-verification.av-exp-002.scenarios.v1',
  target_sha: TARGET_SHA,
  scenarios: scenarioDefs.map(([id, title, kind, changed_paths, evidence]) => {
    const patchFile = path.join(preregDir, 'patches', `${id}.patch`);
    return {
      id, title, kind, changed_paths, evidence,
      patch: `patches/${id}.patch`,
      patch_sha256: sha256File(patchFile),
    };
  }),
});

const comparison = withIdentity({
  schema: 'opsle.affected-verification.cross-experiment-comparison.v1',
  experiments: ['AV-EXP-001', 'AV-EXP-002'],
  compatible: ['oracle-relevant check recall', 'scenario misses', 'broadening events', 'targeted scenarios', 'test units selected/skipped within each experiment', 'non-test selection by normalized class', 'uncertainty frequency'],
  prohibited_direct_aggregation: ['Vitest files with pytest nodes', 'cross-ecosystem runtime', 'unlike non-test classes'],
});

const preregistration = withIdentity({
  schema: 'opsle.affected-verification.preregistration.v1',
  experiment_id: 'AV-EXP-002',
  title: 'Cross-Ecosystem Minimum Defensible Verification Shadow Calibration',
  revision: 1,
  stage: 'CALIBRATION_SHADOW',
  trust_stage: TRUST_STAGE,
  question: 'Does Affected Verification preserve oracle-relevant verification while reducing proposed verification workload in a second ecosystem with a different established affected-test selector?',
  secondary_questions: [
    'Does the normalized evidence model remain usable outside JavaScript/TypeScript?',
    'Which verification classes are invisible to pytest-testmon?',
    'Does AV incorporate selector evidence without blindly trusting it?',
    'Does uncertainty broaden correctly?',
    'How much proposed verification work can be omitted within compatible units?',
    'Which AV-EXP-001 assumptions fail in Python?',
  ],
  target: { url: TARGET_URL, commit: TARGET_SHA, license: 'BSD-3-Clause' },
  toolchain: environment.identity,
  selector: selector.identity,
  catalog: catalog.identity,
  policy: policy.identity,
  corpus: scenarios.identity,
  comparison: comparison.identity,
  arms: [
    { id: 'FULL', definition: 'Execute every frozen catalog unit; authoritative.' },
    { id: 'ECOSYSTEM_SELECTOR', definition: 'pytest-testmon 2.2.0 proposes affected pytest nodes under its documented tests-only contract.' },
    { id: 'AV_CORE', definition: 'AV consumes Git change, Python import/symbol evidence, catalog, and policy without testmon output.' },
    { id: 'AV_WITH_SELECTOR_EVIDENCE', definition: 'AV additionally consumes normalized testmon node selection and database readiness; AV still owns cross-class sufficiency.' },
  ],
  relevance_oracle: {
    scope: 'Relevant within this frozen verification catalog.',
    procedure: ['qualifying clean baseline', 'exact patch identity', 'complete frozen catalog execution', 'freeze checks whose normalized PASS outcome changes to FAIL'],
    limit: 'No complete semantic-correctness claim.',
  },
  metrics: {
    safety: ['relevant checks', 'selected relevant checks', 'individual misses', 'scenario misses', 'broadening'],
    workload: ['pytest nodes selected/skipped', 'pytest files selected/skipped', 'non-test checks by class'],
    runtime: 'OBSERVED only; excluded from semantic identity and causal-savings claims.',
  },
  shadow_miss: 'A frozen oracle-relevant check omitted by a proposing arm.',
  stop_conditions: ['identity drift', 'unstable clean baseline', 'incomplete FULL', 'harness defect affecting outcomes', 'unpreserved raw evidence', 'attempt to bypass FULL'],
  analysis_rules: ['safety before workload', 'every miss individual', 'missing is not zero', 'unlike units stay separate', 'zero observed misses is corpus-bounded', 'revision 1 is immutable after outcomes'],
  dynamic_language_hazards: ['dynamic imports', 'monkeypatching', 'runtime distribution/plugin discovery', 'conftest/fixture coupling', 'environment-dependent behavior'],
  evidence_adapters: adapterIdentities,
  fault_injections: scenarioDefs.map(([id, title, kind, changed_paths, evidence]) => ({ id, title, kind, changed_paths, evidence })),
  providers: 'No external model/provider benchmark subjects.',
});

for (const [name, value] of Object.entries({
  'environment.json': environment,
  'catalog.json': catalog,
  'selector.json': selector,
  'policy.json': policy,
  'scenarios.json': scenarios,
  'comparison.json': comparison,
  'preregistration.json': preregistration,
})) writeJson(path.join(preregDir, name), value);

const manifestFiles = [
  'environment.json', 'catalog.json', 'selector.json', 'policy.json',
  'scenarios.json', 'comparison.json', 'preregistration.json',
  'README.md', 'candidate-evaluation.md',
  ...scenarioDefs.map(([id]) => `patches/${id}.patch`),
];
const manifest = withIdentity({
  schema: 'opsle.affected-verification.preregistration-manifest.v1',
  experiment_id: 'AV-EXP-002',
  files: Object.fromEntries(manifestFiles.map((name) => [name, sha256File(path.join(preregDir, name))])),
});
writeJson(path.join(preregDir, 'manifest.json'), manifest);
console.log(JSON.stringify({
  target: TARGET_SHA,
  pytest_nodes: nodeids.length,
  pytest_files: testFiles.length,
  catalog: catalog.identity,
  scenarios: scenarios.identity,
  preregistration: preregistration.identity,
  manifest: manifest.identity,
}, null, 2));
