export interface SshGuideEnvironmentLike {
  id: string;
  name: string;
  container_user?: string;
  ssh_port: number;
  worker_server_name?: string | null;
  worker_server_base_url?: string | null;
}

export interface SshGuideTemplate {
  jumpHost: string;
  targetUser: string;
  jumpAlias: string;
  envAlias: string;
  jumpUser: string;
  jumpPort: number;
  oneShotCommand: string;
  sshConfig: string;
}

export interface SshGuideClientInfo {
  host?: string | null;
  username?: string | null;
  port?: string | number | null;
}

export const resolveSshHost = (env: SshGuideEnvironmentLike): string => {
  if (!env.worker_server_name) {
    return '127.0.0.1';
  }

  const baseUrl = env.worker_server_base_url || '';
  if (baseUrl) {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      // Fall through to worker name.
    }
  }

  return env.worker_server_name;
};

const sanitizeSshAliasPart = (value: string): string => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'env';
};

const parseJumpPort = (value: string | number | null | undefined): number => {
  const raw = String(value ?? '').trim();
  if (!raw) return 22;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return 22;
  return parsed;
};

export const buildSshGuide = (
  env: SshGuideEnvironmentLike,
  clientInfo?: SshGuideClientInfo,
): SshGuideTemplate => {
  const targetUser = env.container_user || 'root';
  const jumpAlias = env.worker_server_name
    ? `lyra-worker-${sanitizeSshAliasPart(env.worker_server_name)}`
    : 'lyra-host';
  const envAlias = `lyra-env-${sanitizeSshAliasPart(env.name || env.id)}`;
  const applyHostClientInfo = !env.worker_server_name;
  const jumpHostCandidate = String(clientInfo?.host || '').trim();
  const jumpHost = applyHostClientInfo && jumpHostCandidate
    ? jumpHostCandidate
    : resolveSshHost(env);
  const jumpUserCandidate = String(clientInfo?.username || '').trim();
  const jumpUser = applyHostClientInfo && jumpUserCandidate ? jumpUserCandidate : '<host-ssh-user>';
  const jumpPort = applyHostClientInfo ? parseJumpPort(clientInfo?.port) : 22;
  const jumpSpec = jumpPort !== 22 ? `${jumpUser}@${jumpHost}:${jumpPort}` : `${jumpUser}@${jumpHost}`;
  const oneShotCommand = `ssh -J ${jumpSpec} -p ${env.ssh_port} ${targetUser}@127.0.0.1`;
  const sshConfig = [
    `Host ${jumpAlias}`,
    `  HostName ${jumpHost}`,
    `  User ${jumpUser}`,
    `  Port ${jumpPort}`,
    '',
    `Host ${envAlias}`,
    '  HostName 127.0.0.1',
    `  Port ${env.ssh_port}`,
    `  User ${targetUser}`,
    `  ProxyJump ${jumpAlias}`,
  ].join('\n');

  return {
    jumpHost,
    targetUser,
    jumpAlias,
    envAlias,
    jumpUser,
    jumpPort,
    oneShotCommand,
    sshConfig,
  };
};
