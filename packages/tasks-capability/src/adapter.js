import {
  analyzeAffectedVerification,
  captureBuildChange,
  finalizeAffectedVerification,
} from './verification.js';
import { validateSchema } from './schema.js';

const hooks = {
  'verification.plan': ['verification-request-v1', 'verification-analysis-v1'],
  'verification.shadow': ['shadow-request-v1', 'shadow-result-v1'],
  'verification.capture': ['capture-request-v1', 'change-set-v1'],
};
export function createAdapter({ manifest, configuration, services }, packageIdentity) {
  validateSchema('tasks-config-v2', configuration);
  // Tasks keeps this execution-scoped object current when it allocates or
  // refreshes the retained worktree. Holding the reference preserves the
  // original execution binding without freezing stale pre-BUILD fields.
  const binding = services.task;
  const config = { ...services.executionConfig, packageIdentity };
  return {
    invoke(hook, payload) {
      if (!Object.hasOwn(hooks, hook)) throw new Error(`Unsupported capability hook: ${hook}`);
      const [input, output] = hooks[hook];
      validateSchema(input, payload);
      // Bind the capability to one task and repository. The base revision and
      // retained worktree are lifecycle state: Tasks may advance them after a
      // verified merge or restore them during same-attempt continuation.
      // Planning/finalization bind their exact source tree independently.
      for (const key of ['id', 'repo_id', 'repo_name', 'repo_path', 'ssh_host', 'ssh_user', 'sshHost', 'sshUser']) {
        if (payload.task[key] !== binding[key]) {
          throw new Error(`Verification request has a different task binding: ${key}`);
        }
      }
      if (['verification.plan', 'verification.shadow'].includes(hook)
        && (payload.attemptId !== services.attemptId
        || payload.executionId !== services.executionId)) throw new Error('Different attempt or execution binding');
      const native = hook === 'verification.capture'
        ? captureBuildChange(payload.task, config)
        : hook === 'verification.shadow'
          ? finalizeAffectedVerification({
            ...payload,
            config,
            mechanismVersion: manifest.version,
          })
          : analyzeAffectedVerification({ ...payload, config });
      const contract = manifest.hooks.find(item => item.name === hook);
      const outputSchema = contract.outputSchema ?? contract.output_schema;
      const value = { schema: outputSchema, ...native };
      validateSchema(output, value);
      return {
        schema: 'opsle.capability-result.v1', capability: manifest.id, hook,
        output_schema: outputSchema, status: 'ok', value,
        receipts: hook === 'verification.shadow' ? [native.receipt] : [],
        events: hook === 'verification.shadow' ? [{
          kind: 'AFFECTED_VERIFICATION_SHADOW',
          message: JSON.stringify({
            status: native.status,
            classification: native.shadow.classification,
            selection_misses: native.shadow.selection_misses.length,
            full_run_complete: native.shadow.full_run_complete,
          }),
        }] : [],
        artifacts: hook === 'verification.plan' ? [{
          kind: 'verification-analysis', path: native.evidencePath,
          schema: 'opsle.tasks.affected-verification-evidence.v1',
        }] : hook === 'verification.shadow' ? [{
          kind: 'verification-analysis', path: native.evidencePath,
          schema: 'opsle.tasks.affected-verification-evidence.v1',
        }, {
          kind: 'value-receipt', path: native.receiptPath,
          schema: 'opsle.value-receipt.v1',
        }] : [],
      };
    },
  };
}
