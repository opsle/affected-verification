import { readFileSync, writeFileSync } from 'node:fs';
import { planTaskVerification } from './core/task.js';
import { canonicalJson } from './core/canonical.js';
import { buildValueReceipt } from './core/value-receipt.js';
try {
  const [command, input, option, receipt] = process.argv.slice(2);
  if (command !== 'task-plan' || option !== '--receipt' || !receipt) throw new Error('Unsupported planner invocation');
  const decision = planTaskVerification(JSON.parse(readFileSync(input, 'utf8')));
  writeFileSync(receipt, canonicalJson(buildValueReceipt(decision.plan)) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(canonicalJson(decision) + '\n');
} catch (error) {
  process.stderr.write(String(error.message).slice(0, 3000) + '\n');
  process.exitCode = 2;
}
