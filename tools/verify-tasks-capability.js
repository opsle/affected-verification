import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = process.env.OPSLE_TASKS_RUNTIME_ROOT;
if (!runtime) throw new Error('OPSLE_TASKS_RUNTIME_ROOT must name the trusted Tasks compatibility checkout; lifecycle verification cannot be skipped for release.');
const revision = execFileSync('git', ['-C', runtime, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (revision !== 'e1207c5264c59e14efe9838bba3a33ba504665d2') throw new Error('Unreviewed Tasks compatibility revision');
const env = { ...process.env, NODE_ENV: 'test', OPSLE_AFFECTED_VERIFICATION_REPO: root };
execFileSync(process.execPath, ['--test', 'tests/tasks-capability.test.js'], { cwd: root, env, stdio: 'inherit' });
// These are the existing generic contract and AV regressions, not a replacement runtime.
execFileSync(process.execPath, ['--test', ...[
  'capabilities.test.js', 'capability-history.test.js', 'adapters.test.js', 'affected-verification.test.js',
].map(name => resolve(runtime, 'test', name))], { cwd: root, env, stdio: 'inherit' });
