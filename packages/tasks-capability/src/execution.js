import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const argv = args => args.map(quote).join(' ');
export function executionTarget(project = {}) {
  const host = project.ssh_host ?? project.sshHost ?? '';
  const user = project.ssh_user ?? project.sshUser ?? '';
  const path = project.repo_path ?? project.path;
  if (!host && !user && process.env.NODE_ENV === 'test') return { kind: 'test-local', path };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host)) throw new Error('Project execution host is required: configure its private Incus hostname. Local execution is disabled.');
  if (!/^[a-z_][a-z0-9_-]{0,63}$/.test(user)) throw new Error('Project SSH user is required or invalid.');
  if (typeof path !== 'string' || !path.startsWith('/') || /[\x00-\x1f]/.test(path) || path === '/') throw new Error('Project repository path must be an absolute path inside its container.');
  return { kind: 'ssh', host, user, path };
}

export function sshArguments(config, target, script, seconds = 30) {
  if (target.kind !== 'ssh') throw new Error('SSH requires an explicit project execution target.');
  if (!config.sshKeyPath) throw new Error('Tasks SSH key is not configured (OPSLE_SSH_KEY_PATH).');
  // GNU timeout owns a remote process group, including provider grandchildren.
  // It still enforces the deadline if the control plane or SSH connection disappears.
  return ['-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
    '-i', config.sshKeyPath,
    ...(config.sshKnownHostsPath ? ['-o', `UserKnownHostsFile=${config.sshKnownHostsPath}`] : []),
    '--', `${target.user}@${target.host}`,
    `exec timeout --signal=TERM --kill-after=5s ${Math.max(1, seconds)}s /bin/sh -c ${quote(script)}`];
}

export function executionError(result, target, label = 'Remote command') {
  const detail = String(result.stderr || result.error?.message || '').slice(-2000);
  const where = target.kind === 'ssh' ? `${target.user}@${target.host}` : 'test-local';
  let reason;
  if (result.error?.code === 'ETIMEDOUT' || [124, 137].includes(result.status ?? result.code)) reason = 'command timeout';
  else if ((result.status ?? result.code) === 255 && /Permission denied|Authentication failed/i.test(detail)) reason = 'SSH authentication failure';
  else if (/could not read Username|Authentication failed|Permission denied.*publickey/i.test(detail)) reason = 'repository origin authentication failure';
  else if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(detail)) reason = 'SSH host key verification failure';
  else if (/Could not resolve hostname|Connection refused|No route to host|Connection timed out|Network is unreachable|Connection closed|Connection reset/i.test(detail) || (result.status ?? result.code) === 255) reason = 'container/host unreachable or SSH connection lost';
  else if (/OPSLE_REPOSITORY_MISSING|not a git repository/.test(detail)) reason = 'repository missing';
  else if (/OPSLE_PROVIDER_MISSING/.test(detail)) reason = 'provider CLI missing';
  else if (/OPSLE_PROVIDER_AUTH|not logged in|authentication required|unauthorized|invalid.*token|please.*log.?in/i.test(detail)) reason = 'provider authentication unavailable';
  else reason = `exit ${result.status ?? result.code ?? result.error?.code ?? 'unknown'}`;
  const evidence = result.stderrPath ? ` Raw evidence: ${result.stderrPath}` : '';
  const error = new Error(`${label}: ${reason} at ${where}.${reason === 'repository missing' ? ` Repository: ${target.path}.` : ''}${evidence}`);
  error.code = reason;
  return error;
}

function invocation(config, target, script, seconds, cwd) {
  if (target.kind === 'test-local' && process.env.NODE_ENV === 'test') return { command: '/bin/sh', args: ['-c', script], cwd };
  return { command: config.sshBin || 'ssh', args: sshArguments(config, target, script, seconds) };
}

export function projectScript(cwd, script, environment = {}) {
  const exports = Object.entries(environment).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error('Invalid command environment name.');
    return `export ${key}=${quote(value)};`;
  }).join('\n');
  return `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin";\n${exports}\ncd ${quote(cwd)} 2>/dev/null || { echo OPSLE_REPOSITORY_MISSING >&2; exit 72; };\n${script}`;
}

export function projectExec(config, target, args, options = {}) {
  const seconds = options.timeoutSeconds || 20;
  const command = invocation(config, target, projectScript(options.cwd || target.path, `exec ${argv(args)}`), seconds, options.cwd || target.path);
  const result = spawnSync(command.command, command.args, {
    cwd: command.cwd, input: options.input, encoding: options.encoding ?? 'utf8',
    timeout: (seconds + 15) * 1000, maxBuffer: options.maxBuffer || 10_000_000,
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure && !result.error && ![72, 124, 137, 255].includes(result.status)) return result;
    if (config.logsDir) {
      result.stderrPath = resolve(config.logsDir, `execution-error-${randomUUID()}.stderr`);
      writeFileSync(result.stderrPath, String(result.stderr || result.error?.message || '').slice(-20_000_000), { mode: 0o600 });
    }
    throw executionError(result, target, args[0]);
  }
  return options.allowFailure ? result : result.stdout;
}

export const projectGit = (config, target, args, cwd = target.path, options = {}) => projectExec(config, target, ['git', ...args], { ...options, cwd });

