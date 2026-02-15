import axios from 'axios';
import { AlertCircle, Lock, Settings as SettingsIcon, Unlock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

export default function TerminalPage() {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const wsInstance = useRef<WebSocket | null>(null);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null); // null means loading
  const [masterPassword, setMasterPassword] = useState('');
  const [error, setError] = useState('');
  const [authMethod, setAuthMethod] = useState<string | null>(null);
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
    if (!isUnlocked || !terminalRef.current || isConfigured === false) return;

    // Initialize Terminal
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      theme: XTERM_DARK_THEME,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    termInstance.current = term;
    fitAddonInstance.current = fitAddon;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = import.meta.env.DEV
        ? 'ws://localhost:8000/api/terminal/ws'
        : `${protocol}//${window.location.host}/api/terminal/ws`;

    const ws = new WebSocket(wsUrl);
    wsInstance.current = ws;

    ws.binaryType = 'blob';

    ws.onopen = async () => {
        term.write(`\r\n\x1b[32m${terminalMessagesRef.current.connectedService}\x1b[0m\r\n`);

        let privateKey = '';
        if (authMethod === 'key') {
            const encrypted = localStorage.getItem('ssh_private_key_encrypted');
            if (!encrypted) {
                term.write(`\r\n\x1b[31m${terminalMessagesRef.current.errorKeyNotFound}\x1b[0m\r\n`);
                ws.close();
                return;
            }
            try {
                privateKey = await decrypt(encrypted, masterPassword);
                term.write(`\x1b[32m${terminalMessagesRef.current.keyDecrypted}\x1b[0m\r\n`);
            } catch {
                term.write(`\r\n\x1b[31m${terminalMessagesRef.current.decryptFailed}\x1b[0m\r\n`);
                ws.close();
                return;
            }
        }

        const initData = {
            type: 'INIT',
            privateKey: privateKey,
            rows: term.rows,
            cols: term.cols
        };
        ws.send(JSON.stringify(initData));
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

    const handleResize = () => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
             ws.send(`RESIZE:${term.rows},${term.cols}`);
        }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
    };
  }, [isUnlocked, isConfigured, authMethod, masterPassword]);

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
       <div className="flex-1 rounded-xl border border-[var(--terminal-border)] p-2 overflow-hidden shadow-2xl bg-[var(--terminal-bg)]">
         <div ref={terminalRef} className="w-full h-full" />
       </div>
    </div>
  );
}
