import { analyzeAffectedVerification, captureBuildChange } from './verification.js';
import { validateSchema } from './schema.js';

const hooks = {
  'verification.plan': ['verification-request-v1', 'verification-analysis-v1'],
  'verification.capture': ['capture-request-v1', 'change-set-v1'],
};
export function createAdapter({ manifest, configuration, services }, packageIdentity) {
  validateSchema('tasks-config-v2', configuration);
  const binding = structuredClone(services.task);
  const config = { ...services.executionConfig, packageIdentity };
  return {
    invoke(hook, payload) {
      if (!Object.hasOwn(hooks, hook)) throw new Error(`Unsupported capability hook: ${hook}`);
      const [input, output] = hooks[hook];
      validateSchema(input, payload);
      for (const key of ['id', 'repo_id', 'repo_name', 'repo_path', 'base_commit', 'worktree_path', 'ssh_host', 'ssh_user', 'sshHost', 'sshUser', 'test_command']) {
        if (payload.task[key] !== binding[key]) {
          throw new Error(`Verification request has a different task binding: ${key}`);
        }
      }
      if (hook === 'verification.plan' && (payload.attemptId !== services.attemptId
        || payload.executionId !== services.executionId)) throw new Error('Different attempt or execution binding');
      const native = hook === 'verification.capture'
        ? captureBuildChange(payload.task, config)
        : analyzeAffectedVerification({ ...payload, config });
      const contract = manifest.hooks.find(item => item.name === hook);
      const outputSchema = contract.outputSchema ?? contract.output_schema;
      const value = { schema: outputSchema, ...native };
      validateSchema(output, value);
      return {
        schema: 'opsle.capability-result.v1', capability: manifest.id, hook,
        output_schema: outputSchema, status: 'ok', value, receipts: [], events: [],
        artifacts: hook === 'verification.plan' ? [{
          kind: 'verification-analysis', path: native.evidencePath,
          schema: 'opsle.tasks.affected-verification-evidence.v1',
        }] : [],
      };
    },
  };
}
