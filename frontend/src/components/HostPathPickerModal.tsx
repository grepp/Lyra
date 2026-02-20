import axios from 'axios';
import { ChevronUp, Folder, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import OverlayPortal from './OverlayPortal';

interface HostPathEntry {
  name: string;
  path: string;
  is_dir: boolean;
  readable: boolean;
  writable: boolean;
}

interface HostPathListSuccessResponse {
  status: 'success';
  path: string;
  parent: string;
  entries: HostPathEntry[];
  truncated: boolean;
}

interface HostPathListErrorResponse {
  status: 'error';
  code?: string;
  message?: string;
}

interface HostPathPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  privateKey?: string;
  sshConfig?: Record<string, unknown>;
}

const normalizePath = (value?: string): string => {
  const raw = (value || '').trim();
  if (!raw) return '/';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.replace(/^\/+/, '/');
};

export default function HostPathPickerModal({
  isOpen,
  onClose,
  onSelect,
  initialPath,
  privateKey,
  sshConfig,
}: HostPathPickerModalProps) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState('/');
  const [parentPath, setParentPath] = useState('/');
  const [entries, setEntries] = useState<HostPathEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('/');
  const [truncated, setTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPath = useCallback(async (nextPath: string) => {
    const normalized = normalizePath(nextPath);

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setErrorCode('');
    setErrorMessage('');

    try {
      const res = await axios.post<HostPathListSuccessResponse | HostPathListErrorResponse>(
        'filesystem/host/list',
        { path: normalized, privateKey, sshConfig },
        { signal: controller.signal }
      );

      if (requestId !== requestIdRef.current) return;

      if (res.data.status === 'success') {
        setCurrentPath(res.data.path);
        setParentPath(res.data.parent);
        setEntries(res.data.entries.filter((item) => item.is_dir));
        setSelectedPath(res.data.path);
        setTruncated(Boolean(res.data.truncated));
        return;
      }

      setEntries([]);
      setTruncated(false);
      setErrorCode(res.data.code || 'browse_failed');
      setErrorMessage(res.data.message || '');
    } catch (error: unknown) {
      if (requestId !== requestIdRef.current) return;
      if (axios.isCancel(error)) return;
      setEntries([]);
      setTruncated(false);
      setErrorCode('browse_failed');
      if (axios.isAxiosError(error)) {
        setErrorMessage(error.response?.data?.message || error.message);
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [privateKey, sshConfig]);

  useEffect(() => {
    if (!isOpen) return;
    const startPath = normalizePath(initialPath);
    setCurrentPath(startPath);
    setSelectedPath(startPath);
    void fetchPath(startPath);
  }, [isOpen, initialPath, fetchPath]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  if (!isOpen) return null;

  const getErrorText = () => {
    if (errorCode === 'ssh_not_configured') return t('provisioning.errorHostConnectionSettingsRequired');
    if (errorCode === 'ssh_auth_failed') return t('provisioning.errorHostConnectionAuthFailed');
    if (errorCode === 'ssh_host_key_failed') return t('provisioning.errorHostConnectionHostKeyFailed');
    if (errorCode === 'path_not_found') return t('provisioning.errorHostPathNotFound');
    if (errorCode === 'permission_denied') return t('provisioning.errorHostPathPermissionDenied');
    if (errorMessage) return `${t('provisioning.errorHostPathBrowseFailed')}: ${errorMessage}`;
    return t('provisioning.errorHostPathBrowseFailed');
  };

  const handleMoveToParent = () => {
    if (isLoading || currentPath === '/') return;
    void fetchPath(parentPath);
  };

  const handleOpenDirectory = (path: string) => {
    if (isLoading) return;
    void fetchPath(path);
  };

  const handleRefresh = () => {
    if (isLoading) return;
    void fetchPath(currentPath);
  };

  return (
    <OverlayPortal className="p-4">
      <div className="w-full max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between border-b border-[var(--border)] p-5">
          <h3 className="text-lg font-bold text-[var(--text)]">{t('provisioning.hostPathBrowseTitle')}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleMoveToParent}
              disabled={isLoading || currentPath === '/'}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-xs text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95"
            >
              <ChevronUp size={14} />
              {t('provisioning.hostPathBrowseParent')}
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-xs text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              {t('actions.refresh')}
            </button>
          </div>

          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{t('provisioning.hostPathBrowseCurrentPath')}</div>
            <div className="text-sm font-mono text-[var(--text)] break-all">{currentPath}</div>
          </div>

          {truncated && (
            <p className="text-xs text-amber-500">{t('provisioning.hostPathBrowseTruncated')}</p>
          )}

          {errorCode ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {getErrorText()}
            </div>
          ) : (
            <div className="relative rounded-md border border-[var(--border)] bg-[var(--bg-soft)] min-h-[320px] max-h-[320px] overflow-auto">
              {isLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-soft)]/75 backdrop-blur-[1px]">
                  <span className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                    <Loader2 size={14} className="animate-spin" />
                    {t('provisioning.hostPathBrowseLoading')}
                  </span>
                </div>
              )}
              {entries.length === 0 ? (
                <div className="h-full min-h-[320px] flex items-center justify-center text-sm text-[var(--text-muted)]">
                  {t('provisioning.hostPathBrowseNoDirectories')}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => handleOpenDirectory(entry.path)}
                        disabled={isLoading}
                        className="w-full px-3 py-2.5 text-left hover:brightness-95 transition-colors disabled:cursor-not-allowed"
                      >
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <Folder size={14} className="text-blue-400 shrink-0" />
                          <span className="text-sm text-[var(--text)] truncate">{entry.name}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-soft)] p-4 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm text-[var(--text)] hover:brightness-95 transition-colors"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSelect(selectedPath)}
            disabled={Boolean(errorCode) || isLoading || !selectedPath}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-contrast)] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-colors"
          >
            {t('provisioning.hostPathBrowseSelect')}
          </button>
        </div>
      </div>
    </OverlayPortal>
  );
}
