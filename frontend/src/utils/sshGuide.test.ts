import { describe, expect, it } from 'vitest';
import { buildSshGuide, resolveSshHost, type SshGuideEnvironmentLike } from './sshGuide';

const baseEnv: SshGuideEnvironmentLike = {
  id: 'env-1',
  name: 'my-env',
  ssh_port: 22001,
};

describe('resolveSshHost', () => {
  it('returns localhost for host environments', () => {
    expect(resolveSshHost(baseEnv)).toBe('127.0.0.1');
  });

  it('uses worker base_url hostname when available', () => {
    expect(
      resolveSshHost({
        ...baseEnv,
        worker_server_name: 'worker-a',
        worker_server_base_url: 'http://10.20.30.40:8000',
      })
    ).toBe('10.20.30.40');
  });

  it('falls back to worker name when base_url is invalid', () => {
    expect(
      resolveSshHost({
        ...baseEnv,
        worker_server_name: 'worker-b',
        worker_server_base_url: 'not-a-url',
      })
    ).toBe('worker-b');
  });
});

describe('buildSshGuide', () => {
  it('builds host guide with root fallback', () => {
    const guide = buildSshGuide(baseEnv);
    expect(guide.jumpHost).toBe('127.0.0.1');
    expect(guide.targetUser).toBe('root');
    expect(guide.jumpAlias).toBe('lyra-host');
    expect(guide.envAlias).toBe('lyra-env-my-env');
    expect(guide.oneShotCommand).toContain('-p 22001 root@127.0.0.1');
    expect(guide.oneShotCommand).toContain('-J <host-ssh-user>@127.0.0.1');
    expect(guide.sshConfig).toContain('ProxyJump lyra-host');
    expect(guide.sshConfig).toContain('User <host-ssh-user>');
    expect(guide.sshConfig).toContain('Port 22');
  });

  it('applies saved ssh client username/port for host jump config', () => {
    const guide = buildSshGuide(baseEnv, {
      host: 'localhost',
      username: 'lyra-admin',
      port: '2222',
    });
    expect(guide.oneShotCommand).toContain('-J lyra-admin@localhost:2222');
    expect(guide.sshConfig).toContain('HostName localhost');
    expect(guide.sshConfig).toContain('User lyra-admin');
    expect(guide.sshConfig).toContain('Port 2222');
  });

  it('uses container_user when provided', () => {
    const guide = buildSshGuide({
      ...baseEnv,
      container_user: 'alice',
      worker_server_name: 'Worker 01',
      worker_server_base_url: 'http://10.0.0.5:8000',
    }, {
      host: 'localhost',
      username: 'ignored-user',
      port: '2022',
    });
    expect(guide.targetUser).toBe('alice');
    expect(guide.jumpAlias).toBe('lyra-worker-worker-01');
    expect(guide.oneShotCommand).toContain('alice@127.0.0.1');
    expect(guide.sshConfig).toContain('User <host-ssh-user>');
    expect(guide.sshConfig).toContain('Port 22');
  });
});
