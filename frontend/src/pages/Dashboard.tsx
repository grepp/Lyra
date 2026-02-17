import axios from 'axios';
import { ChevronDown, ChevronUp, Code2, HardDrive, HelpCircle, LayoutTemplate, Network, Play, RefreshCw, Square, SquareTerminal, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import OverlayPortal from '../components/OverlayPortal';
import { useApp } from '../context/AppContext';
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
  worker_server_name?: string | null;
  worker_error_code?: string | null;
  worker_error_message?: string | null;
  container_user?: string;
  gpu_indices: number[];
  container_id?: string;
  ssh_port: number;
  jupyter_port: number;
  code_port: number;
  enable_jupyter?: boolean;
  enable_code_server?: boolean;
  created_at: string;
  mount_config: MountConfig[];
  custom_ports: CustomPortMapping[];
}

const ENVS_CACHE_KEY = 'lyra.dashboard.environments';
const TERMINAL_ACTION_QUEUE_KEY = 'lyra.terminal.pending_action';
const NOTICE_OPEN_KEY = 'lyra.dashboard.notice_open';

export default function Dashboard() {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { announcementMarkdown } = useApp();
  const hasAnnouncement = announcementMarkdown.trim().length > 0;
  const [isNoticeOpen, setIsNoticeOpen] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      const stored = window.localStorage.getItem(NOTICE_OPEN_KEY);
      return stored === 'true';
    } catch {
      return false;
    }
  });
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
  const [workerErrorInfo, setWorkerErrorInfo] = useState<{ name: string; message: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const getWorkerErrorText = (code?: string | null, fallback?: string | null) => {
    if (code) {
      const key = `dashboard.workerError.${code}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
    return fallback || t('feedback.common.unknownError');
  };
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

  const openEnvInTerminal = (env: Environment) => {
    const host = window.location.hostname;
    const sshUser = env.container_user || 'root';
    const sshCommand = `ssh -p ${env.ssh_port} ${sshUser}@${host}`;
    try {
      window.localStorage.setItem(
        TERMINAL_ACTION_QUEUE_KEY,
        JSON.stringify({
          type: 'open_tab_and_run',
          command: sshCommand,
          environmentName: env.name,
          requestedAt: Date.now(),
        }),
      );
    } catch {
      // Ignore storage failures and still move to terminal page.
    }
    navigate('/terminal');
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

  const openCodeServer = async (env: Environment) => {
    try {
      const res = await axios.post(`environments/${env.id}/code/launch`);
      const launchUrl = String(res.data.launch_url || '');
      if (!launchUrl) {
        showToast(t('feedback.dashboard.codeLaunchUrlMissing'), 'error');
        return;
      }
      const targetUrl = launchUrl.startsWith('http') ? launchUrl : `${window.location.origin}${launchUrl}`;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } catch {
      showToast(t('feedback.dashboard.codeOpenFailed'), 'error');
    }
  };

  useEffect(() => {
    fetchEnvironments({ showLoading: true });
    const interval = setInterval(() => {
      fetchEnvironments();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!hasAnnouncement) {
      setIsNoticeOpen(false);
      return;
    }
    try {
      const stored = window.localStorage.getItem(NOTICE_OPEN_KEY);
      if (stored === null) {
        setIsNoticeOpen(true);
        window.localStorage.setItem(NOTICE_OPEN_KEY, 'true');
      } else {
        setIsNoticeOpen(stored === 'true');
      }
    } catch {
      setIsNoticeOpen(true);
    }
  }, [hasAnnouncement, announcementMarkdown]);

  useEffect(() => {
    if (!hasAnnouncement) return;
    try {
      window.localStorage.setItem(NOTICE_OPEN_KEY, isNoticeOpen ? 'true' : 'false');
    } catch {
      // Ignore storage write failures
    }
  }, [hasAnnouncement, isNoticeOpen]);

  const renderAccessCell = (env: Environment): ReactNode => {
    if (env.status === 'stopped' || env.status === 'error') {
      return <span>-</span>;
    }

    const isRunning = env.status === 'running';
    const jupyterEnabled = env.enable_jupyter !== false;
    const codeEnabled = env.enable_code_server !== false;

    const sshSupported = !env.worker_server_name;

    const accessItems: Array<{ key: string; node: ReactNode }> = [
      {
        key: 'ssh',
        node: (
          <div className="relative group">
            <button
              onClick={() => openEnvInTerminal(env)}
              disabled={!isRunning || !sshSupported}
              className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <SquareTerminal size={14} />
            </button>
            <div className="pointer-events-none absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
              {!sshSupported
                ? t('dashboard.openInTerminalWorkerUnsupported')
                : isRunning
                ? t('dashboard.openInTerminal', { port: env.ssh_port })
                : t('dashboard.environmentMustBeRunning', { port: env.ssh_port })}
            </div>
          </div>
        ),
      },
      {
        key: 'jupyter',
        node: jupyterEnabled ? (
          <div className="relative group">
            <button
              onClick={() => openJupyter(env)}
              disabled={!isRunning}
              className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-orange-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LayoutTemplate size={14} />
            </button>
            <div className="pointer-events-none absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
              {t('dashboard.openJupyterLab')}
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="p-1 rounded text-[var(--border)] opacity-70 cursor-not-allowed"
          >
            <LayoutTemplate size={14} />
          </button>
        ),
      },
      {
        key: 'code',
        node: codeEnabled ? (
          <div className="relative group">
            <button
              onClick={() => openCodeServer(env)}
              disabled={!isRunning}
              className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-cyan-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Code2 size={14} />
            </button>
            <div className="pointer-events-none absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
              {t('dashboard.openCodeServer')}
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="p-1 rounded text-[var(--border)] opacity-70 cursor-not-allowed"
          >
            <Code2 size={14} />
          </button>
        ),
      },
    ];

    return (
      <div className="flex items-center gap-2">
        {accessItems.map((item, index) => (
          <div key={item.key} className="flex items-center gap-2">
            {index > 0 && <span className="w-1" aria-hidden="true" />}
            {item.node}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 relative">
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
        <OverlayPortal>
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
        </OverlayPortal>
      )}

      {/* Port Details Modal */}
      {selectedPortEnv && (
        <OverlayPortal>
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
        </OverlayPortal>
      )}

      {/* Error Log Modal */}
      {errorLogEnv && (
        <OverlayPortal>
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
        </OverlayPortal>
      )}

      {workerErrorInfo && (
        <OverlayPortal>
          <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
              <h3 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
                <HelpCircle size={20} className="text-yellow-400" />
                {t('dashboard.workerUnavailableTitle')}
              </h3>
              <button onClick={() => setWorkerErrorInfo(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-2">
              <p className="text-sm text-[var(--text-muted)]">{t('dashboard.workerUnavailableFor', { name: workerErrorInfo.name })}</p>
              <p className="text-sm text-[var(--text)]">{workerErrorInfo.message}</p>
            </div>
            <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-soft)] flex justify-end">
              <button
                onClick={() => setWorkerErrorInfo(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] hover:brightness-95 transition-all"
              >
                {t('actions.close')}
              </button>
            </div>
          </div>
        </OverlayPortal>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-[var(--text)]">{t('dashboard.title')}</h2>
          <p className="text-[var(--text-muted)] mt-1">{t('dashboard.subtitle')}</p>
        </div>
      </div>

      {hasAnnouncement && (
        <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className={`p-6 flex items-center justify-between ${isNoticeOpen ? 'border-b border-[var(--border)]' : ''}`}>
            <h3 className="inline-flex items-start gap-2 text-xl font-bold text-[var(--text)]">
              <span>{t('dashboard.noticeTitle')}</span>
              <span className="mt-1.5 inline-block h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
            </h3>
            <button
              type="button"
              onClick={() => setIsNoticeOpen((prev) => !prev)}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-2 text-[var(--text-muted)] transition-all hover:text-[var(--text)]"
              title={isNoticeOpen ? t('dashboard.collapseNotice') : t('dashboard.expandNotice')}
              aria-label={isNoticeOpen ? t('dashboard.collapseNotice') : t('dashboard.expandNotice')}
            >
              {isNoticeOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {isNoticeOpen && (
            <div className="p-6">
              <div className="text-sm text-[var(--text)] [&_a]:text-blue-500 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-[var(--bg-soft)] [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ ...props }) => (
                      <a {...props} target="_blank" rel="noopener noreferrer" />
                    ),
                    table: ({ ...props }) => (
                      <div className="my-3 overflow-x-auto">
                        <table {...props} className="w-full min-w-[420px] border-collapse text-left text-sm" />
                      </div>
                    ),
                    thead: ({ ...props }) => <thead {...props} className="bg-[var(--bg-soft)]" />,
                    th: ({ ...props }) => <th {...props} className="border border-[var(--border)] px-3 py-2 font-semibold text-[var(--text)]" />,
                    td: ({ ...props }) => <td {...props} className="border border-[var(--border)] px-3 py-2 text-[var(--text)]" />,
                  }}
                >
                  {announcementMarkdown}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}


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
        <div className="w-full overflow-x-auto text-left">
            {!hasLoadedOnce && loading ? (
                 <div className="p-6 text-center text-[var(--text-muted)]">{t('messages.loadingEnvironments')}</div>
            ) : environments.length === 0 ? (
                 <div className="p-6 text-center text-[var(--text-muted)]">{t('messages.noEnvironments')}</div>
            ) : (
                <table className="w-full min-w-[980px]">
                    <thead className="bg-[var(--bg-soft)] text-[var(--text-muted)] text-sm uppercase">
                        <tr>
                            <th className="px-6 py-4 font-medium">{t('labels.name')}</th>
                            <th className="px-6 py-4 font-medium">{t('labels.status')}</th>
                            <th className="px-6 py-4 font-medium">{t('labels.server')}</th>
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
                                <td className="px-6 py-4 w-[30%] max-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="relative group min-w-0 flex-1">
                                      <span className="block truncate whitespace-nowrap text-[var(--text)] font-medium">
                                        {env.name}
                                      </span>
                                      <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden max-w-[420px] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] shadow-lg group-hover:block">
                                        {env.name}
                                      </div>
                                    </div>
                                    <span className="shrink-0 text-sm text-[var(--text-muted)]">({env.container_id || env.id.slice(0, 12)})</span>
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
                                                env.status === 'creating' ? 'bg-blue-500/10 text-blue-500' :
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
                                                onClick={() => {
                                                  if (env.worker_server_name && (env.worker_error_message || env.worker_error_code)) {
                                                    setWorkerErrorInfo({
                                                      name: env.name,
                                                      message: getWorkerErrorText(env.worker_error_code, env.worker_error_message),
                                                    });
                                                    return;
                                                  }
                                                  setErrorLogEnv(env);
                                                }}
                                                className="text-red-400 hover:text-red-300 transition-colors"
                                                title={env.worker_server_name && (env.worker_error_message || env.worker_error_code)
                                                  ? t('dashboard.viewWorkerError')
                                                  : t('dashboard.viewErrorLogs')}
                                            >
                                                <HelpCircle size={16} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-[var(--text)]">
                                  {env.worker_server_name || t('dashboard.hostServer')}
                                </td>
                                <td className="px-6 py-4 text-[var(--text)]">
                                    {renderAccessCell(env)}
                                </td>
                                <td className="px-6 py-4 text-[var(--text)]">
                                    {env.gpu_indices.length > 0 ? (
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {env.gpu_indices.slice(0, 3).map((gpuIndex) => (
                                          <span
                                            key={`${env.id}-gpu-${gpuIndex}`}
                                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-400"
                                          >
                                            {gpuIndex}
                                          </span>
                                        ))}
                                        {env.gpu_indices.length > 3 && (
                                          <div className="relative group">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-400">
                                              +{env.gpu_indices.length - 3}
                                            </span>
                                            <div className="pointer-events-none absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
                                              {env.gpu_indices.join(' ')}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ) : "-"}
                                </td>
                                <td className="px-6 py-4 text-right space-x-2">
                                    {(() => {
                                        const isTransitioning =
                                          env.status === 'stopping' ||
                                          env.status === 'starting' ||
                                          env.status === 'creating' ||
                                          env.status === 'building';
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
