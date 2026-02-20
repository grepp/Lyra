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
  oneShotCommand: string;
  sshConfig: string;
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

export const buildSshGuide = (env: SshGuideEnvironmentLike): SshGuideTemplate => {
  const jumpHost = resolveSshHost(env);
  const targetUser = env.container_user || 'root';
  const jumpAlias = env.worker_server_name
    ? `lyra-worker-${sanitizeSshAliasPart(env.worker_server_name)}`
    : 'lyra-host';
  const envAlias = `lyra-env-${sanitizeSshAliasPart(env.name || env.id)}`;
  const oneShotCommand = `ssh -J <host-ssh-user>@${jumpHost} -p ${env.ssh_port} ${targetUser}@127.0.0.1`;
  const sshConfig = [
    `Host ${jumpAlias}`,
    `  HostName ${jumpHost}`,
    '  User <host-ssh-user>',
    '  Port 22',
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
    oneShotCommand,
    sshConfig,
  };
};
