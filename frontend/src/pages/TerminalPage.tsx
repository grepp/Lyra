import axios from 'axios';
import { AlertCircle, Lock, Plus, Settings as SettingsIcon, Unlock, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { decrypt } from '../utils/crypto';

const XTERM_DARK_THEME = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: '#4ade80',
  selectionBackground: 'rgba(74, 222, 128, 0.28)',
};

type TerminalTab = {
  id: string;
  number: number;
  sessionKey: string;
  title?: string;
};

const TERMINAL_TABS_STORAGE_KEY = 'terminal_tabs_v1';
const TERMINAL_ACTIVE_TAB_STORAGE_KEY = 'terminal_active_tab_v1';
const TERMINAL_ACTION_QUEUE_KEY = 'lyra.terminal.pending_action';

const getInitialTabs = (): TerminalTab[] => {
  if (typeof window === 'undefined') {
    return [{ id: 'terminal-tab-1', number: 1, sessionKey: 'lyra_terminal-tab-1' }];
  }
  try {
    const raw = localStorage.getItem(TERMINAL_TABS_STORAGE_KEY);
    if (!raw) return [{ id: 'terminal-tab-1', number: 1, sessionKey: 'lyra_terminal-tab-1' }];
    const parsed = JSON.parse(raw) as Array<Partial<TerminalTab>>;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ id: 'terminal-tab-1', number: 1, sessionKey: 'lyra_terminal-tab-1' }];
    }
    const valid = parsed
      .filter(
        (tab) =>
          tab &&
          typeof tab.id === 'string' &&
          tab.id.length > 0 &&
          typeof tab.number === 'number' &&
          Number.isFinite(tab.number) &&
          tab.number > 0,
      )
      .map((tab) => ({
        id: tab.id as string,
        number: tab.number as number,
        sessionKey:
          typeof tab.sessionKey === 'string' && tab.sessionKey.length > 0
            ? tab.sessionKey
            : `lyra_${String(tab.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        title: typeof tab.title === 'string' && tab.title.trim() ? tab.title.trim() : undefined,
      }));
    return valid.length > 0 ? valid : [{ id: 'terminal-tab-1', number: 1, sessionKey: 'lyra_terminal-tab-1' }];
  } catch {
    return [{ id: 'terminal-tab-1', number: 1, sessionKey: 'lyra_terminal-tab-1' }];
  }
};

const getInitialActiveTabId = (tabs: TerminalTab[]): string => {
  if (typeof window === 'undefined') {
    return tabs[0]?.id ?? 'terminal-tab-1';
  }
  const stored = localStorage.getItem(TERMINAL_ACTIVE_TAB_STORAGE_KEY);
  if (!stored) return tabs[0]?.id ?? 'terminal-tab-1';
  return tabs.some((tab) => tab.id === stored) ? stored : tabs[0]?.id ?? 'terminal-tab-1';
};

export default function TerminalPage() {
  const { t } = useTranslation();
  const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const terminalSessions = useRef<Record<string, { term: Terminal; fitAddon: FitAddon; ws: WebSocket }>>({});

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null); // null means loading
  const [masterPassword, setMasterPassword] = useState('');
  const [error, setError] = useState('');
  const [authMethod, setAuthMethod] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>(getInitialTabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => getInitialActiveTabId(getInitialTabs()));
  const tabCounterRef = useRef(1);
  const decryptedPrivateKeyRef = useRef<string | null>(null);
  const pendingTabCommandsRef = useRef<Record<string, string>>({});
  const terminalMessagesRef = useRef({
    connectedService: '',
    errorKeyNotFound: '',
    keyDecrypted: '',
    decryptFailed: '',
    connectionClosed: '',
  });

  useEffect(() => {
    terminalMessagesRef.current = {
      connectedService: t('terminal.connectedService'),
      errorKeyNotFound: t('terminal.errorKeyNotFound'),
      keyDecrypted: t('terminal.keyDecrypted'),
      decryptFailed: t('terminal.decryptFailed'),
      connectionClosed: t('terminal.connectionClosed'),
    };
  }, [t]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TERMINAL_TABS_STORAGE_KEY, JSON.stringify(tabs));
    const persistedActive = tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id;
    if (persistedActive) {
      localStorage.setItem(TERMINAL_ACTIVE_TAB_STORAGE_KEY, persistedActive);
    }
  }, [tabs, activeTabId]);

  useEffect(() => {
    if (tabs.length === 0) return;
    tabCounterRef.current = Math.max(1, ...tabs.map((tab) => Math.floor(tab.number || 1)));
  }, [tabs]);

  const createTab = useCallback((options?: { initialCommand?: string; titlePrefix?: string }) => {
    tabCounterRef.current += 1;
    const nextId = `terminal-tab-${tabCounterRef.current}`;
    if (options?.initialCommand) {
      pendingTabCommandsRef.current[nextId] = options.initialCommand;
    }

    let title: string | undefined;
    if (options?.titlePrefix) {
      const prefix = options.titlePrefix.trim();
      if (prefix) {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^${escaped}\\s+(\\d+)$`);
        let maxSuffix = 0;
        tabs.forEach((tab) => {
          const currentTitle = (tab.title || '').trim();
          const match = currentTitle.match(pattern);
          if (match) {
            const n = Number(match[1]);
            if (Number.isFinite(n) && n > maxSuffix) {
              maxSuffix = n;
            }
          }
        });
        title = `${prefix} ${maxSuffix + 1}`;
      }
    }
    setTabs((prev) => [
      ...prev,
      {
        id: nextId,
        number: tabCounterRef.current,
        sessionKey: `lyra_${nextId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        title,
      },
    ]);
    setActiveTabId(nextId);
  }, [tabs]);

  useEffect(() => {
    if (!isUnlocked || isConfigured === false) return;
    try {
      const raw = window.localStorage.getItem(TERMINAL_ACTION_QUEUE_KEY);
      if (!raw) return;
      const action = JSON.parse(raw) as { type?: string; command?: string; environmentName?: string };
      window.localStorage.removeItem(TERMINAL_ACTION_QUEUE_KEY);
      if (action.type === 'open_tab_and_run' && typeof action.command === 'string' && action.command.trim()) {
        createTab({
          initialCommand: action.command.trim(),
          titlePrefix: typeof action.environmentName === 'string' ? action.environmentName : undefined,
        });
      }
    } catch {
      // Ignore malformed action payloads.
    }
  }, [isUnlocked, isConfigured, createTab]);

  // Check auth method and configuration first
  useEffect(() => {
    const checkAuth = async () => {
        try {
            const [methodRes, userRes] = await Promise.all([
                axios.get('settings/ssh_auth_method'),
                axios.get('settings/ssh_username')
            ]);

            const method = methodRes.data.value;
            const username = userRes.data.value;

            if (!username) {
                setIsConfigured(false);
                return;
            }

            setAuthMethod(method);
            setIsConfigured(true);

            if (method !== 'key') {
                setIsUnlocked(true); // Don't need password if not using key
            }
        } catch {
            setIsConfigured(false);
        }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (!isUnlocked || isConfigured === false) return;

    const getPrivateKey = async () => {
      if (authMethod !== 'key') return '';
      if (decryptedPrivateKeyRef.current) return decryptedPrivateKeyRef.current;

      const encrypted = localStorage.getItem('ssh_private_key_encrypted');
      if (!encrypted) {
        throw new Error('KEY_NOT_FOUND');
      }
      const privateKey = await decrypt(encrypted, masterPassword);
      decryptedPrivateKeyRef.current = privateKey;
      return privateKey;
    };

    const createSession = (tabId: string) => {
      if (terminalSessions.current[tabId]) return;
      const container = terminalRefs.current[tabId];
      if (!container) return;
      const tab = tabs.find((item) => item.id === tabId);

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 14,
        theme: XTERM_DARK_THEME,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = import.meta.env.DEV
        ? 'ws://localhost:8000/api/terminal/ws'
        : `${protocol}//${window.location.host}/api/terminal/ws`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'blob';

      ws.onopen = async () => {
        term.write(`\r\n\x1b[32m${terminalMessagesRef.current.connectedService}\x1b[0m\r\n`);
        let privateKey = '';

        if (authMethod === 'key') {
          try {
            privateKey = await getPrivateKey();
            term.write(`\x1b[32m${terminalMessagesRef.current.keyDecrypted}\x1b[0m\r\n`);
          } catch (e) {
            if ((e as Error).message === 'KEY_NOT_FOUND') {
              term.write(`\r\n\x1b[31m${terminalMessagesRef.current.errorKeyNotFound}\x1b[0m\r\n`);
            } else {
              term.write(`\r\n\x1b[31m${terminalMessagesRef.current.decryptFailed}\x1b[0m\r\n`);
            }
            ws.close();
            return;
          }
        }

        ws.send(
          JSON.stringify({
            type: 'INIT',
            privateKey,
            sessionKey: tab?.sessionKey ?? `lyra_${tabId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
            rows: term.rows,
            cols: term.cols,
          }),
        );
        const pendingCommand = pendingTabCommandsRef.current[tabId];
        if (pendingCommand) {
          ws.send(`${pendingCommand}\n`);
          delete pendingTabCommandsRef.current[tabId];
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const payload = JSON.parse(event.data) as { type?: string; code?: string; message?: string };
            if (payload?.type === 'error') {
              const msg = payload.message || payload.code || 'Terminal connection error';
              term.write(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
              return;
            }
          } catch {
            // Fallback to legacy plain-text frame.
          }
          term.write(event.data);
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            term.write(reader.result as string);
          };
          reader.readAsText(event.data);
        }
      };

      ws.onclose = () => {
        term.write(`\r\n\x1b[31m${terminalMessagesRef.current.connectionClosed}\x1b[0m\r\n`);
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      terminalSessions.current[tabId] = { term, fitAddon, ws };
    };

    createSession(activeTabId);

    const handleResize = () => {
      Object.values(terminalSessions.current).forEach((session) => {
        session.fitAddon.fit();
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(`RESIZE:${session.term.rows},${session.term.cols}`);
        }
      });
    };

    window.addEventListener('resize', handleResize);
    const activeSession = terminalSessions.current[activeTabId];
    if (activeSession) {
      activeSession.fitAddon.fit();
      if (activeSession.ws.readyState === WebSocket.OPEN) {
        activeSession.ws.send(`RESIZE:${activeSession.term.rows},${activeSession.term.cols}`);
      }
    }

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isUnlocked, isConfigured, authMethod, masterPassword, activeTabId, tabs]);

  useEffect(() => {
    return () => {
      Object.values(terminalSessions.current).forEach((session) => {
        session.ws.close();
        session.term.dispose();
      });
      terminalSessions.current = {};
    };
  }, []);

  const addTab = () => createTab();

  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const session = terminalSessions.current[tabId];
    if (session) {
      session.ws.close();
      session.term.dispose();
      delete terminalSessions.current[tabId];
    }
    delete pendingTabCommandsRef.current[tabId];
    delete terminalRefs.current[tabId];

    const idx = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId === tabId) {
      const nextActive = nextTabs[Math.max(0, idx - 1)]?.id || nextTabs[0]?.id;
      if (nextActive) setActiveTabId(nextActive);
    }
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterPassword) {
        setError(t('terminal.errorEnterMasterPassphrase'));
        return;
    }
    setError('');
    setIsUnlocked(true);
  };

  if (isConfigured === null) {
      return (
          <div className="h-full flex items-center justify-center bg-[var(--surface)]">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
      );
  }

  if (isConfigured === false) {
      return (
          <div className="p-6 max-w-7xl mx-auto space-y-6 relative">
              <header>
                  <h2 className="text-3xl font-bold text-[var(--text)] tracking-tight">{t('terminal.title')}</h2>
                  <p className="text-[var(--text-muted)] mt-1">{t('terminal.subtitle')}</p>
              </header>

              <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-6 text-center text-[var(--text-muted)] flex flex-col items-center gap-4">
                  <div className="p-4 bg-[var(--bg-soft)] rounded-full">
                      <AlertCircle size={32} className="text-amber-500" />
                  </div>
                  <div>
                      <h3 className="text-lg font-semibold text-[var(--text)] mb-1">{t('terminal.setupRequiredTitle')}</h3>
                      <p>{t('terminal.setupRequiredMessage')}</p>
                  </div>
                  <Link
                      to="/settings"
                      className="mt-2 px-6 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] hover:brightness-95 transition-colors flex items-center gap-2"
                  >
                      <SettingsIcon size={16} />
                      {t('terminal.goToSettings')}
                  </Link>
              </div>
          </div>
      );
  }

  if (!isUnlocked) {
    return (
        <div className="h-full flex items-center justify-center bg-[var(--surface)] p-6">
            <div className="max-w-md w-full bg-[var(--bg-elevated)] rounded-2xl border border-[var(--border)] p-6 shadow-2xl">
                <div className="flex flex-col items-center text-center space-y-4">
                    <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-400 mb-2">
                        <Lock size={32} />
                    </div>
                    <h2 className="text-2xl font-bold text-[var(--text)]">{t('terminal.lockedTitle')}</h2>
                    <p className="text-[var(--text-muted)]">{t('terminal.lockedMessage')}</p>

                    <form onSubmit={handleUnlock} className="w-full space-y-4 mt-6">
                        <div className="relative">
                            <input
                                type="password"
                                autoFocus
                                value={masterPassword}
                                onChange={(e) => setMasterPassword(e.target.value)}
                                placeholder={t('terminal.masterPassphrasePlaceholder')}
                                className="w-full bg-[var(--bg-soft)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--text)] focus:outline-none focus:border-blue-500 transition-all pl-11"
                            />
                            <Unlock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-red-400 text-sm">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                        >
                            <Unlock size={18} />
                            {t('terminal.unlockConnect')}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col space-y-6 bg-[var(--surface)]">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-[var(--text)]">{t('terminal.title')}</h2>
          <p className="text-[var(--text-muted)] mt-1">{t('terminal.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg-soft)] px-3 py-1.5 rounded-full border border-[var(--border)]">
          <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
          {t('terminal.connectedViaWebsocket')}
        </div>
      </header>

      <div className="flex-1 min-h-0 rounded-xl border border-[var(--terminal-border)] overflow-hidden shadow-2xl bg-[var(--terminal-bg)]">
        <div className="flex items-center gap-2 border-b border-[var(--terminal-border)] bg-[var(--terminal-bg)] p-2">
          <div className="flex items-center gap-2 overflow-x-auto min-w-0">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`group flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-mono transition-all ${
                    active
                      ? 'bg-black/35 border-emerald-500/50 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.25)]'
                      : 'bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-[var(--text-muted)]/45 group-hover:bg-[var(--text-muted)]'}`} />
                  <button
                    type="button"
                    onClick={() => setActiveTabId(tab.id)}
                    className="whitespace-nowrap tracking-tight"
                  >
                    {tab.title || t('terminal.hostTab', { number: tab.number })}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTab(tab.id)}
                    disabled={tabs.length <= 1}
                    className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed"
                    title={t('terminal.closeTab')}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addTab}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/15 transition-colors"
            title={t('terminal.addTab')}
          >
            <Plus size={14} />
            {t('terminal.addTab')}
          </button>
        </div>
        <div className="h-[calc(100%-52px)] p-2">
          {tabs.map((tab) => (
            <div key={tab.id} className={tab.id === activeTabId ? 'w-full h-full' : 'hidden'}>
              <div
                ref={(el) => {
                  terminalRefs.current[tab.id] = el;
                }}
                className="w-full h-full"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
