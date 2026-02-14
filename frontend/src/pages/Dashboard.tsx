import axios from 'axios';
import { Code2, HardDrive, HelpCircle, LayoutTemplate, Network, Play, RefreshCw, Square, SquareTerminal, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../components/Modal';
import { useToast } from '../context/ToastContext';

interface MountConfig {
  host_path: string;
  container_path: string;
  mode: string;
}

interface CustomPortMapping {
  host_port: number;
  container_port: number;
}

interface Environment {
  id: string;
  name: string;
  status: string;
  container_user?: string;
  gpu_indices: number[];
  container_id?: string;
  ssh_port: number;
  jupyter_port: number;
  code_port: number;
  created_at: string;
  mount_config: MountConfig[];
  custom_ports: CustomPortMapping[];
}

const ENVS_CACHE_KEY = 'lyra.dashboard.environments';

export default function Dashboard() {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [environments, setEnvironments] = useState<Environment[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const cached = window.localStorage.getItem(ENVS_CACHE_KEY);
      if (!cached) return [];
      return JSON.parse(cached) as Environment[];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    const cached = window.localStorage.getItem(ENVS_CACHE_KEY);
    return !cached;
  });
  const [hasLoadedOnce, setHasLoadedOnce] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.localStorage.getItem(ENVS_CACHE_KEY));
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedVolEnv, setSelectedVolEnv] = useState<Environment | null>(null);
  const [selectedPortEnv, setSelectedPortEnv] = useState<Environment | null>(null);
  const [errorLogEnv, setErrorLogEnv] = useState<Environment | null>(null);
  const [errorLog, setErrorLog] = useState<string>("");
  const [logLoading, setLogLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const getStatusLabel = (status: string) => {
    const key = `status.${status}`;
    const translated = t(key);
    return translated === key ? t('status.unknown') : translated;
  };

  const fetchEnvironments = async (options: { showLoading?: boolean } = {}) => {
    const { showLoading = false } = options;

    if (showLoading) {
      setLoading(true);
    }

    try {
      const res = await axios.get('environments/');
      setEnvironments(res.data);
      setHasLoadedOnce(true);
      try {
        window.localStorage.setItem(ENVS_CACHE_KEY, JSON.stringify(res.data));
      } catch {
        // Ignore cache write failures
      }
    } catch (error) {
      console.error("Failed to fetch environments", error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  const fetchErrorLogs = useCallback(async (envId: string) => {
    try {
        setLogLoading(true);
        const res = await axios.get(`environments/${envId}/logs`);
        setErrorLog(res.data.logs);
    } catch (error) {
        console.error("Failed to fetch logs", error);
        setErrorLog(t('status.error'));
    } finally {
        setLogLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (errorLogEnv) {
        fetchErrorLogs(errorLogEnv.id);
    } else {
        setErrorLog("");
    }
  }, [errorLogEnv, fetchErrorLogs]);

  const deleteEnvironment = async () => {
    if (!deleteId) return;
    try {
        await axios.delete(`environments/${deleteId}`);
        fetchEnvironments();
    } catch (error) {
        console.error("Failed to delete environment", error);
        // Could also add an error modal here
    }
    setDeleteId(null);
  };

  const withActionLoading = async (environmentId: string, action: () => Promise<void>) => {
    setActionLoading((prev) => ({ ...prev, [environmentId]: true }));
    try {
      await action();
    } catch (error) {
      console.error("Failed to change environment state", error);
    } finally {
      await fetchEnvironments();
      setActionLoading((prev) => ({ ...prev, [environmentId]: false }));
    }
  };

  const startEnvironment = async (env: Environment) => {
    await withActionLoading(env.id, async () => {
      await axios.post(`environments/${env.id}/start`);
    });
  };

  const stopEnvironment = async (env: Environment) => {
    await withActionLoading(env.id, async () => {
      await axios.post(`environments/${env.id}/stop`);
    });
  };

  const copySshCommand = async (sshCommand: string) => {
    try {
      await navigator.clipboard.writeText(sshCommand);
      showToast(t('feedback.dashboard.sshCopied'), 'success');
    } catch {
      showToast(t('feedback.dashboard.copyFailedRunManually', { command: sshCommand }), 'error');
    }
  };

  const copyEnvSshCommand = async (env: Environment) => {
    const host = window.location.hostname;
    const sshUser = env.container_user || 'root';
    const sshCommand = `ssh -p ${env.ssh_port} ${sshUser}@${host}`;
    await copySshCommand(sshCommand);
  };

  const openJupyter = async (env: Environment) => {
    try {
      const res = await axios.post(`environments/${env.id}/jupyter/launch`);
      const launchUrl = String(res.data.launch_url || '');
      if (!launchUrl) {
        showToast(t('feedback.dashboard.jupyterLaunchUrlMissing'), 'error');
        return;
      }
      const targetUrl = launchUrl.startsWith('http') ? launchUrl : `${window.location.origin}${launchUrl}`;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } catch {
      showToast(t('feedback.dashboard.jupyterOpenFailed'), 'error');
    }
  };

  const openCodeServer = (env: Environment) => {
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const url = `${protocol}//${host}:${env.code_port}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    fetchEnvironments({ showLoading: true });
    const interval = setInterval(() => {
      fetchEnvironments();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 space-y-8 relative">
      <Modal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={deleteEnvironment}
        title={t('dashboard.deleteEnvironmentTitle')}
        message={t('dashboard.deleteEnvironmentMessage')}
        isDestructive={true}
      />

      {/* Volume Details Modal */}
      {selectedVolEnv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm">
            <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
                    <h3 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
                        <HardDrive size={20} className="text-blue-400" />
                        {t('dashboard.volumeMounts')}
                    </h3>
                    <button onClick={() => setSelectedVolEnv(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">
                    <p className="text-[var(--text-muted)] text-sm mb-4">{t('dashboard.mountedVolumesFor', { name: selectedVolEnv.name })}</p>
                    <div className="space-y-3">
                        {selectedVolEnv.mount_config.map((mount, idx) => (
                            <div key={idx} className="bg-[var(--bg-soft)] p-3 rounded-lg border border-[var(--border)] text-sm">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-blue-400 uppercase w-10 shrink-0">{t('dashboard.hostLabel')}</span>
                                    <span className="text-[var(--text)] font-mono overflow-x-auto whitespace-nowrap flex-1 scrollbar-hide">{mount.host_path}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-green-400 uppercase w-10 shrink-0">{t('dashboard.destinationLabel')}</span>
                                    <span className="text-[var(--text)] font-mono overflow-x-auto whitespace-nowrap flex-1 scrollbar-hide">{mount.container_path}</span>
                                    <span className="ml-auto text-[10px] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded text-[var(--text-muted)] border border-[var(--border)] uppercase">
                                        {mount.mode}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-soft)] flex justify-end">
                    <button
                        onClick={() => setSelectedVolEnv(null)}
                        className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] hover:brightness-95 transition-all"
                    >
                        {t('actions.close')}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Port Details Modal */}
      {selectedPortEnv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm">
            <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
                    <h3 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
                        <Network size={20} className="text-cyan-400" />
                        {t('dashboard.customPortMappings')}
                    </h3>
                    <button onClick={() => setSelectedPortEnv(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">
                    <p className="text-[var(--text-muted)] text-sm mb-4">{t('dashboard.customPortsFor', { name: selectedPortEnv.name })}</p>
                    <div className="space-y-3">
                        {selectedPortEnv.custom_ports.map((mapping, idx) => (
                            <div key={`${mapping.host_port}-${mapping.container_port}-${idx}`} className="bg-[var(--bg-soft)] p-3 rounded-lg border border-[var(--border)] text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-cyan-400 uppercase w-14 shrink-0">{t('dashboard.hostLabel')}</span>
                                    <span className="text-[var(--text)] font-mono">{mapping.host_port}</span>
                                    <span className="text-[var(--text-muted)] px-2">:</span>
                                    <span className="text-xs font-bold text-green-400 uppercase w-10 shrink-0">{t('dashboard.portLabel')}</span>
                                    <span className="text-[var(--text)] font-mono">{mapping.container_port}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-soft)] flex justify-end">
                    <button
                        onClick={() => setSelectedPortEnv(null)}
                        className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] hover:brightness-95 transition-all"
                    >
                        {t('actions.close')}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Error Log Modal */}
      {errorLogEnv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm">
            <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
                    <h3 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
                        <HelpCircle size={20} className="text-red-400" />
                        {t('dashboard.containerErrorLog')}
                    </h3>
                    <button onClick={() => setErrorLogEnv(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">
                    <p className="text-[var(--text-muted)] text-sm mb-4">{t('dashboard.last50LinesFor', { name: errorLogEnv.name })}</p>
                    <div className="bg-[var(--bg-soft)] rounded-lg border border-[var(--border)] p-4 max-h-[400px] overflow-y-auto">
                        {logLoading ? (
                            <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
                                <RefreshCw size={24} className="animate-spin" />
                            </div>
                        ) : (
                            <pre className="text-xs font-mono text-[var(--text)] whitespace-pre-wrap font-ligatures-none">
                                {errorLog || t('dashboard.noLogsAvailable')}
                            </pre>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-soft)] flex justify-end">
                    <button
                        onClick={() => setErrorLogEnv(null)}
                        className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] hover:brightness-95 transition-all"
                    >
                        {t('actions.close')}
                    </button>
                </div>
            </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-[var(--text)]">{t('dashboard.title')}</h2>
          <p className="text-[var(--text-muted)] mt-1">{t('dashboard.subtitle')}</p>
      </div>
    </div>


      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
            <h3 className="text-xl font-bold text-[var(--text)]">{t('labels.instances')}</h3>
            <button
              onClick={() => fetchEnvironments({ showLoading: true })}
              className="p-2 hover:bg-[var(--bg-soft)] rounded-full text-[var(--text-muted)] transition-colors"
            >
                <RefreshCw size={18} className={loading && hasLoadedOnce ? "animate-spin" : ""} />
            </button>
        </div>
        <div className="w-full text-left">
            {!hasLoadedOnce && loading ? (
                 <div className="p-8 text-center text-[var(--text-muted)]">{t('messages.loadingEnvironments')}</div>
            ) : environments.length === 0 ? (
                 <div className="p-8 text-center text-[var(--text-muted)]">{t('messages.noEnvironments')}</div>
            ) : (
                <table className="w-full">
                    <thead className="bg-[var(--bg-soft)] text-[var(--text-muted)] text-sm uppercase">
                        <tr>
                            <th className="px-6 py-4 font-medium">{t('labels.name')}</th>
                            <th className="px-6 py-4 font-medium">{t('labels.status')}</th>
                            <th className="px-6 py-4 font-medium">{t('labels.access')}</th>
                            <th className="px-6 py-4 font-medium">{t('labels.gpu')}</th>
                            <th className="px-6 py-4 font-medium text-right">{t('labels.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                        {[...environments]
                          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
                          .map((env) => (
                            <tr key={env.id} className="hover:bg-[var(--bg-soft)] transition-colors">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[var(--text)] font-medium">{env.name}</span>
                                    <span className="text-sm text-[var(--text-muted)]">({env.container_id || env.id.slice(0, 12)})</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                            actionLoading[env.id]
                                              ? (env.status === 'running'
                                                ? 'bg-gray-500/10 text-gray-400'
                                                : 'bg-gray-500/10 text-gray-400')
                                              : env.status === 'running' ? 'bg-green-500/10 text-green-500' :
                                                env.status === 'stopped' ? 'bg-yellow-500/10 text-yellow-500' :
                                                env.status === 'building' ? 'bg-blue-500/10 text-blue-500' :
                                                env.status === 'starting' ? 'bg-gray-500/10 text-gray-400' :
                                                env.status === 'stopping' ? 'bg-gray-500/10 text-gray-400' :
                                                'bg-red-500/10 text-red-500'
                                        }`}>
                                            {actionLoading[env.id]
                                              ? (env.status === 'running' ? t('status.stopping') : t('status.starting'))
                                              : getStatusLabel(env.status)}
                                        </span>
                                        {env.status === 'error' && (
                                            <button
                                                onClick={() => setErrorLogEnv(env)}
                                                className="text-red-400 hover:text-red-300 transition-colors"
                                                title={t('dashboard.viewErrorLogs')}
                                            >
                                                <HelpCircle size={16} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-[var(--text)]">
                                    {env.status === 'stopped' || env.status === 'error' ? (
                                        <span>-</span>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <div className="relative group">
                                                <button
                                                    onClick={() => copyEnvSshCommand(env)}
                                                    disabled={env.status !== 'running'}
                                                    className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                                                >
                                                    <SquareTerminal size={14} />
                                                </button>
                                                <div className="pointer-events-none absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
                                                    {env.status === 'running'
                                                      ? t('dashboard.copySshCommand', { port: env.ssh_port })
                                                      : t('dashboard.environmentMustBeRunning', { port: env.ssh_port })}
                                                </div>
                                            </div>
                                            <span className="text-[var(--text-muted)]">/</span>
                                            <div className="relative group">
                                                <button
                                                    onClick={() => openJupyter(env)}
                                                    className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-orange-400 transition-colors"
                                                >
                                                    <LayoutTemplate size={14} />
                                                </button>
                                                <div className="pointer-events-none absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
                                                    {t('dashboard.openJupyterLab')}
                                                </div>
                                            </div>
                                            <span className="text-[var(--text-muted)]">/</span>
                                            <div className="relative group">
                                                <button
                                                    onClick={() => openCodeServer(env)}
                                                    className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-cyan-400 transition-colors"
                                                >
                                                    <Code2 size={14} />
                                                </button>
                                                <div className="pointer-events-none absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
                                                    {t('dashboard.openCodeServer')}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-[var(--text)]">
                                    {env.gpu_indices.length > 0 ? env.gpu_indices.join(', ') : "-"}
                                </td>
                                <td className="px-6 py-4 text-right space-x-2">
                                    {(() => {
                                        const isTransitioning = env.status === 'stopping' || env.status === 'starting';
                                        const isRunning = env.status === 'running';
                                        return (
                                            <button
                                                onClick={() => {
                                                    if (isRunning) {
                                                        stopEnvironment(env);
                                                    } else {
                                                        startEnvironment(env);
                                                    }
                                                }}
                                                disabled={actionLoading[env.id] || isTransitioning}
                                                className={`p-2 rounded-lg transition-colors ${
                                                    isRunning
                                                    ? "hover:bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-yellow-400"
                                                    : "hover:bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-green-400"
                                                } ${actionLoading[env.id] ? "animate-pulse opacity-80" : ""}`}
                                                title={isRunning ? t('dashboard.stopInstance') : t('dashboard.startInstance')}
                                            >
                                                {actionLoading[env.id] || isTransitioning
                                                    ? <RefreshCw size={18} className="animate-spin" />
                                                    : isRunning
                                                        ? <Square size={18} fill="currentColor" className="opacity-80" />
                                                        : <Play size={18} fill="currentColor" />
                                                }
                                            </button>
                                        );
                                    })()}
                                    <button
                                        onClick={() => {
                                            if (env.mount_config && env.mount_config.length > 0) {
                                                setSelectedVolEnv(env);
                                            }
                                        }}
                                        disabled={!env.mount_config || env.mount_config.length === 0}
                                        className={`p-2 rounded-lg transition-colors ${
                                            env.mount_config && env.mount_config.length > 0
                                            ? "text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-500/10"
                                            : "text-[var(--text-muted)] cursor-not-allowed opacity-30"
                                        }`}
                                        title={env.mount_config && env.mount_config.length > 0 ? t('dashboard.viewVolumes') : t('dashboard.noVolumes')}
                                    >
                                        <HardDrive size={18} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (env.custom_ports && env.custom_ports.length > 0) {
                                                setSelectedPortEnv(env);
                                            }
                                        }}
                                        disabled={!env.custom_ports || env.custom_ports.length === 0}
                                        className={`p-2 rounded-lg transition-colors ${
                                            env.custom_ports && env.custom_ports.length > 0
                                            ? "text-[var(--text-muted)] hover:text-cyan-400 hover:bg-cyan-500/10"
                                            : "text-[var(--text-muted)] cursor-not-allowed opacity-30"
                                        }`}
                                        title={env.custom_ports && env.custom_ports.length > 0 ? t('dashboard.viewCustomPorts') : t('dashboard.noCustomPorts')}
                                    >
                                        <Network size={18} />
                                    </button>
                                    <button
                                        onClick={() => setDeleteId(env.id)}
                                        className="p-2 hover:bg-[var(--bg-soft)] rounded-lg text-[var(--text-muted)] hover:text-red-400 transition-colors"
                                        title={t('actions.delete')}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
      </div>
    </div>
  );
}
