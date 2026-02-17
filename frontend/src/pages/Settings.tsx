import axios from 'axios';
import { AlertCircle, CheckCircle2, FolderOpen, ImageIcon, Key, Lock, PencilLine, RefreshCw, Save, Server, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { withApiMessage } from '../utils/i18nMessage';
import { decrypt, encrypt } from '../utils/crypto';
import OverlayPortal from '../components/OverlayPortal';
import { getStoredUserName, setStoredUserName } from '../utils/userIdentity';

type StatusState = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };
type TmuxSession = { name: string; attached: number; windows: number };

export default function Settings() {
  const {
    appName,
    setAppName,
    faviconDataUrl,
    setFavicon,
    announcementMarkdown,
    setAnnouncementMarkdown,
    isLoading: appLoading,
  } = useApp();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [localAppName, setLocalAppName] = useState(appName);
  const [localUserName, setLocalUserName] = useState(() => getStoredUserName());
  const [localFaviconDataUrl, setLocalFaviconDataUrl] = useState(faviconDataUrl);
  const [appNameStatus, setAppNameStatus] = useState<StatusState>({ type: 'idle' });
  const [userNameStatus, setUserNameStatus] = useState<StatusState>({ type: 'idle' });
  const [faviconStatus, setFaviconStatus] = useState<StatusState>({ type: 'idle' });
  const [announcementStatus, setAnnouncementStatus] = useState<StatusState>({ type: 'idle' });
  const [sshStatus, setSshStatus] = useState<StatusState>({ type: 'idle' });
  const [resourceStatus, setResourceStatus] = useState<StatusState>({ type: 'idle' });
  const [sessionStatus, setSessionStatus] = useState<StatusState>({ type: 'idle' });
  const [announcementEditorOpen, setAnnouncementEditorOpen] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState('');

  // SSH Settings State
  const [sshSettings, setSshSettings] = useState({
    port: '22',
    username: '',
    authMethod: 'password', // 'password' or 'key'
    password: '',
    privateKey: '', // Raw content from file upload
    keyName: '',    // Filename to display
    masterPassword: '', // Password for local encryption
  });
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isResourceLoading, setIsResourceLoading] = useState(false);
  const [imageMode, setImageMode] = useState<'dangling' | 'unused'>('dangling');
  const [unusedImages, setUnusedImages] = useState<Array<{ id: string; short_id: string; tags: string[]; size: number }>>([]);
  const [unusedVolumes, setUnusedVolumes] = useState<Array<{ name: string; mountpoint: string; driver: string }>>([]);
  const [selectedVolumes, setSelectedVolumes] = useState<string[]>([]);
  const [buildCache, setBuildCache] = useState<{ count: number; size: number }>({ count: 0, size: 0 });
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSession[]>([]);
  const [selectedTmuxSessions, setSelectedTmuxSessions] = useState<string[]>([]);
  const [tmuxLoading, setTmuxLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalAppName(appName);
  }, [appName]);

  useEffect(() => {
    setLocalFaviconDataUrl(faviconDataUrl);
  }, [faviconDataUrl]);

  useEffect(() => {
    setAnnouncementDraft(announcementMarkdown);
  }, [announcementMarkdown]);

  useEffect(() => {
    const fetchSshSettings = async () => {
      try {
        setIsSettingsLoading(true);
        const keys = ['ssh_port', 'ssh_username', 'ssh_auth_method', 'ssh_password'];
        const settings: Record<string, string> = {};

        await Promise.all(keys.map(async (key) => {
          try {
            const res = await axios.get(`settings/${key}`);
            settings[key] = res.data.value;
          } catch {
            // Setting might not exist yet
          }
        }));

        const savedKeyName = localStorage.getItem('ssh_key_name') || '';

        setSshSettings(prev => ({
          ...prev,
          port: settings.ssh_port || '22',
          username: settings.ssh_username || '',
          authMethod: settings.ssh_auth_method || 'password',
          password: settings.ssh_password || '',
          keyName: savedKeyName,
        }));
      } catch (error) {
        console.error("Failed to fetch SSH settings", error);
      } finally {
        setIsSettingsLoading(false);
      }
    };

    fetchSshSettings();
  }, []);

  const loadResourceData = useCallback(async (targetMode: 'dangling' | 'unused' = imageMode) => {
    try {
      setIsResourceLoading(true);
      const [imagesRes, volumesRes, cacheRes] = await Promise.all([
        axios.get(`resources/docker/images/unused?mode=${targetMode}`),
        axios.get('resources/docker/volumes/unused'),
        axios.get('resources/docker/build-cache'),
      ]);
      setUnusedImages(imagesRes.data?.images || []);
      setUnusedVolumes(volumesRes.data?.volumes || []);
      setBuildCache({
        count: Number(cacheRes.data?.count || 0),
        size: Number(cacheRes.data?.size || 0),
      });
      setSelectedVolumes((prev) => prev.filter((name) => (volumesRes.data?.volumes || []).some((v: { name: string }) => v.name === name)));
    } catch (error) {
      console.error(error);
      setResourceStatus({ type: 'error', message: t('feedback.settings.loadResourceDataFailed') });
    } finally {
      setIsResourceLoading(false);
    }
  }, [imageMode, t]);

  useEffect(() => {
    loadResourceData(imageMode);
  }, [imageMode, loadResourceData]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localAppName.trim()) {
      setAppNameStatus({ type: 'error', message: t('feedback.settings.appNameRequired') });
      return;
    }

    try {
      setAppNameStatus({ type: 'loading' });
      await setAppName(localAppName);
      setAppNameStatus({ type: 'success', message: t('feedback.settings.appNameUpdated') });
      setTimeout(() => setAppNameStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setAppNameStatus({ type: 'error', message: t('feedback.settings.appNameUpdateFailed') });
    }
  };

  const handleSaveUserName = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = setStoredUserName(localUserName);
      if (result.code !== 'ok') {
        if (result.code === 'empty') {
          setUserNameStatus({ type: 'error', message: t('feedback.settings.userNameRequired') });
          return;
        }
        if (result.code === 'too_long') {
          setUserNameStatus({ type: 'error', message: t('feedback.settings.userNameTooLong') });
          return;
        }
        setUserNameStatus({ type: 'error', message: t('feedback.settings.userNameFormatInvalid') });
        return;
      }
      setLocalUserName(result.value);
      setUserNameStatus({ type: 'success', message: t('feedback.settings.userNameUpdated') });
      setTimeout(() => setUserNameStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setUserNameStatus({ type: 'error', message: t('feedback.settings.userNameUpdateFailed') });
    }
  };

  const handleFaviconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFaviconStatus({ type: 'error', message: t('feedback.settings.faviconSelectImage') });
      return;
    }

    if (file.size > 512 * 1024) {
      setFaviconStatus({ type: 'error', message: t('feedback.settings.faviconSizeLimit') });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = String(event.target?.result || '');
      if (!dataUrl) return;
      setLocalFaviconDataUrl(dataUrl);
      setFaviconStatus({ type: 'idle' });
    };
    reader.readAsDataURL(file);
  };

  const handleSaveFavicon = async () => {
    try {
      setFaviconStatus({ type: 'loading' });
      await setFavicon(localFaviconDataUrl);
      setFaviconStatus({ type: 'success', message: t('feedback.settings.faviconUpdated') });
      setTimeout(() => setFaviconStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setFaviconStatus({ type: 'error', message: t('feedback.settings.faviconUpdateFailed') });
    }
  };

  const handleResetFavicon = async () => {
    try {
      setFaviconStatus({ type: 'loading' });
      setLocalFaviconDataUrl('');
      await setFavicon('');
      if (faviconInputRef.current) faviconInputRef.current.value = '';
      setFaviconStatus({ type: 'success', message: t('feedback.settings.faviconReset') });
      setTimeout(() => setFaviconStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setFaviconStatus({ type: 'error', message: t('feedback.settings.faviconResetFailed') });
    }
  };

  const openAnnouncementEditor = () => {
    setAnnouncementDraft(announcementMarkdown);
    setAnnouncementEditorOpen(true);
  };

  const handleSaveAnnouncement = async () => {
    try {
      setAnnouncementStatus({ type: 'loading' });
      await setAnnouncementMarkdown(announcementDraft);
      setAnnouncementStatus({ type: 'success', message: t('feedback.settings.announcementUpdated') });
      setAnnouncementEditorOpen(false);
      setTimeout(() => setAnnouncementStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setAnnouncementStatus({ type: 'error', message: t('feedback.settings.announcementUpdateFailed') });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setSshSettings(prev => ({
        ...prev,
        privateKey: content,
        keyName: file.name
      }));
    };
    reader.readAsText(file);
  };

  const handleSaveSsh = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!sshSettings.username.trim()) {
        setSshStatus({ type: 'error', message: t('feedback.settings.sshUsernameRequired') });
        return;
      }

      const updates = [
        { key: 'ssh_host', value: window.location.hostname },
        { key: 'ssh_port', value: sshSettings.port },
        { key: 'ssh_username', value: sshSettings.username },
        { key: 'ssh_auth_method', value: sshSettings.authMethod },
      ];

      if (sshSettings.authMethod === 'password') {
        if (!sshSettings.password.trim()) {
          setSshStatus({ type: 'error', message: t('feedback.settings.sshPasswordRequired') });
          return;
        }
        updates.push({ key: 'ssh_password', value: sshSettings.password });
      }

      // Handle Key Encryption and Storage
      if (sshSettings.authMethod === 'key') {
        if (sshSettings.privateKey) {
            if (!sshSettings.masterPassword) {
                setSshStatus({ type: 'error', message: t('feedback.settings.sshMasterPassphraseRequired') });
                return;
            }
            const encrypted = await encrypt(sshSettings.privateKey, sshSettings.masterPassword);
            localStorage.setItem('ssh_private_key_encrypted', encrypted);
            localStorage.setItem('ssh_key_name', sshSettings.keyName);
        } else if (!sshSettings.keyName) {
            setSshStatus({ type: 'error', message: t('feedback.settings.sshKeyFileRequired') });
            return;
        }
        // If they have keyName but no privateKey in state, it means they are using existing key
      }

      await Promise.all(updates.map(u => axios.put(`settings/${u.key}`, { value: u.value })));

      setSshStatus({ type: 'success', message: t('feedback.settings.sshSettingsUpdated') });
      setTimeout(() => setSshStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setSshStatus({ type: 'error', message: t('feedback.settings.sshSettingsUpdateFailed') });
    }
  };

  const handleTestSsh = async () => {
    try {
      setSshStatus({ type: 'loading', message: t('feedback.settings.sshTesting') });

      const keyToTest = sshSettings.privateKey;
      if (sshSettings.authMethod === 'key' && !keyToTest) {
          setSshStatus({ type: 'error', message: t('feedback.settings.sshPickKeyToTest') });
          return;
      }

      const res = await axios.post('terminal/test-ssh', {
        host: window.location.hostname,
        port: parseInt(sshSettings.port),
        username: sshSettings.username,
        authMethod: sshSettings.authMethod,
        password: sshSettings.password,
        privateKey: keyToTest,
      });

      if (res.data.status === 'success') {
        setSshStatus({ type: 'success', message: t('feedback.settings.sshConnectionSuccess') });
      } else {
        setSshStatus({ type: 'error', message: withApiMessage(t, 'feedback.settings.sshConnectionFailed', res.data.message) });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSshStatus({ type: 'error', message: withApiMessage(t, 'feedback.settings.sshTestFailed', message) });
    }
  };

  const resolvePrivateKeyForTmuxOps = useCallback(async (): Promise<string | undefined> => {
    if (sshSettings.authMethod !== 'key') return undefined;
    if (sshSettings.privateKey) return sshSettings.privateKey;

    const encrypted = localStorage.getItem('ssh_private_key_encrypted');
    if (!encrypted) {
      throw new Error(t('feedback.settings.tmuxKeyMissing'));
    }
    if (!sshSettings.masterPassword) {
      throw new Error(t('feedback.settings.tmuxMasterPassphraseRequired'));
    }
    try {
      return await decrypt(encrypted, sshSettings.masterPassword);
    } catch {
      throw new Error(t('feedback.settings.tmuxKeyDecryptFailed'));
    }
  }, [sshSettings.authMethod, sshSettings.privateKey, sshSettings.masterPassword, t]);

  const loadTmuxSessions = useCallback(async () => {
    try {
      setTmuxLoading(true);
      const privateKey = await resolvePrivateKeyForTmuxOps();
      const res = await axios.post('terminal/tmux/sessions/list', {
        privateKey,
      });
      if (res.data?.status !== 'success') {
        setSessionStatus({
          type: 'error',
          message: withApiMessage(t, 'feedback.settings.tmuxSessionsLoadFailed', res.data?.message || ''),
        });
        return;
      }
      if (!res.data.installed) {
        setTmuxSessions([]);
        setSelectedTmuxSessions([]);
        setSessionStatus({ type: 'error', message: t('feedback.settings.tmuxNotInstalled') });
        return;
      }
      const sessions = (res.data.sessions || []) as TmuxSession[];
      setTmuxSessions(sessions);
      setSelectedTmuxSessions((prev) => prev.filter((name) => sessions.some((s) => s.name === name)));
      setSessionStatus({ type: 'idle' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionStatus({ type: 'error', message: withApiMessage(t, 'feedback.settings.tmuxSessionsLoadFailed', message) });
    } finally {
      setTmuxLoading(false);
    }
  }, [resolvePrivateKeyForTmuxOps, t]);

  useEffect(() => {
    if (isSettingsLoading) return;
    void loadTmuxSessions();
  }, [isSettingsLoading, loadTmuxSessions]);

  const killSelectedTmuxSessions = async () => {
    if (selectedTmuxSessions.length === 0) {
      setSessionStatus({ type: 'error', message: t('feedback.settings.tmuxSelectSessionRequired') });
      return;
    }

    try {
      setTmuxLoading(true);
      const privateKey = await resolvePrivateKeyForTmuxOps();
      const res = await axios.post('terminal/tmux/sessions/kill', {
        privateKey,
        session_names: selectedTmuxSessions,
      });
      if (res.data?.status !== 'success') {
        setSessionStatus({
          type: 'error',
          message: withApiMessage(t, 'feedback.settings.tmuxSessionsKillFailed', res.data?.message || ''),
        });
        return;
      }
      setSessionStatus({ type: 'idle' });
      setSelectedTmuxSessions([]);
      await loadTmuxSessions();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionStatus({ type: 'error', message: withApiMessage(t, 'feedback.settings.tmuxSessionsKillFailed', message) });
    } finally {
      setTmuxLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const runImagePrune = async () => {
    try {
      setResourceStatus({ type: 'loading', message: t('feedback.settings.cleanupImagesRunning') });
      const res = await axios.post('resources/docker/images/prune', { mode: imageMode });
      setResourceStatus({
        type: 'success',
        message: t('feedback.settings.cleanupImagesResult', {
          removed: Number(res.data?.removed_count || 0),
          skipped: Number(res.data?.skipped_count || 0),
        }),
      });
      await loadResourceData(imageMode);
      setTimeout(() => setResourceStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setResourceStatus({ type: 'error', message: t('feedback.settings.cleanupImagesFailed') });
    }
  };

  const runVolumePrune = async () => {
    if (selectedVolumes.length === 0) {
      setResourceStatus({ type: 'error', message: t('feedback.settings.selectUnusedVolume') });
      return;
    }
    try {
      setResourceStatus({ type: 'loading', message: t('feedback.settings.cleanupVolumesRunning') });
      const res = await axios.post('resources/docker/volumes/prune', { volume_names: selectedVolumes });
      setResourceStatus({
        type: 'success',
        message: t('feedback.settings.cleanupVolumesResult', {
          removed: Number(res.data?.removed_count || 0),
          skipped: Number(res.data?.skipped_count || 0),
        }),
      });
      setSelectedVolumes([]);
      await loadResourceData(imageMode);
      setTimeout(() => setResourceStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setResourceStatus({ type: 'error', message: t('feedback.settings.cleanupVolumesFailed') });
    }
  };

  const runBuildCachePrune = async () => {
    try {
      setResourceStatus({ type: 'loading', message: t('feedback.settings.cleanupBuildCacheRunning') });
      const res = await axios.post('resources/docker/build-cache/prune', { all: true });
      setResourceStatus({
        type: 'success',
        message: t('feedback.settings.cleanupBuildCacheResult', {
          size: formatBytes(Number(res.data?.space_reclaimed || 0)),
        }),
      });
      await loadResourceData(imageMode);
      setTimeout(() => setResourceStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setResourceStatus({ type: 'error', message: t('feedback.settings.cleanupBuildCacheFailed') });
    }
  };

  const isLoading = appLoading || isSettingsLoading;
  const refreshResourceManagement = async () => {
    await Promise.allSettled([
      loadResourceData(imageMode),
      loadTmuxSessions(),
    ]);
  };
  const handleLanguageChange = (nextLanguage: 'en' | 'ko') => {
    void i18n.changeLanguage(nextLanguage);
    try {
      window.localStorage.setItem('lyra.language', nextLanguage);
    } catch {
      // Ignore storage write errors
    }
  };

  const sectionClass = 'rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden';
  const sectionHeaderClass = 'p-6 border-b border-[var(--border)]';
  const fieldBgClass = 'bg-[color-mix(in_oklab,var(--bg)_38%,var(--bg-elevated))]';
  const inputClass = `w-full rounded-lg border border-[var(--border)] ${fieldBgClass} px-4 py-2.5 text-[var(--text)] transition-all focus:outline-none focus:border-blue-500`;
  const selectClass = `${inputClass} appearance-none pr-10`;
  const selectArrowStyle: React.CSSProperties = {
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27 fill=%27none%27%3E%3Cpath d=%27M2.5 4.5L6 8L9.5 4.5%27 stroke=%27%236b7280%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 0.85rem center',
    backgroundSize: '12px',
  };
  const secondaryButtonClass = `rounded-lg border border-[var(--border)] ${fieldBgClass} px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-all hover:brightness-95`;
  const primaryButtonClass = 'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed';
  const dangerButtonClass = 'rounded-lg bg-red-600/90 px-3 py-2 text-sm font-medium text-white transition-all hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed';
  const resourceCardClass = `rounded-xl border border-[var(--border)] ${fieldBgClass} p-4 space-y-3`;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {announcementEditorOpen && (
        <OverlayPortal className="p-4">
          <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] p-6">
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">{t('settings.announcementEditorTitle')}</h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{t('settings.announcementEditorDescription')}</p>
              </div>
              <button
                onClick={() => setAnnouncementEditorOpen(false)}
                className="text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                aria-label={t('actions.close')}
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <textarea
                value={announcementDraft}
                onChange={(e) => setAnnouncementDraft(e.target.value)}
                placeholder={t('settings.announcementEditorPlaceholder')}
                className={`h-[360px] w-full resize-y rounded-lg border border-[var(--border)] ${fieldBgClass} p-4 font-mono text-sm text-[var(--text)] focus:border-blue-500 focus:outline-none`}
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] bg-[var(--bg-soft)] p-4">
              <button
                type="button"
                onClick={() => setAnnouncementEditorOpen(false)}
                className={secondaryButtonClass}
                disabled={announcementStatus.type === 'loading'}
              >
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveAnnouncement}
                className={primaryButtonClass}
                disabled={announcementStatus.type === 'loading'}
              >
                {t('actions.save')}
              </button>
            </div>
          </div>
        </OverlayPortal>
      )}

      <div>
        <h2 className="text-3xl font-bold text-[var(--text)]">{t('settings.title')}</h2>
        <p className="mt-1 text-[var(--text-muted)]">{t('settings.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Branding Section */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <h3 className="text-xl font-semibold text-[var(--text)] flex items-center gap-2">{t('settings.generalTitle')}</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t('settings.generalDescription')}</p>
          </div>

          <div className="p-6 space-y-4">
            <form onSubmit={handleSaveName} className="space-y-0">
              <label htmlFor="appName" className="mb-2 block text-sm font-medium text-[var(--text-muted)]">{t('settings.applicationName')}</label>
              <div className="flex gap-4">
                <input
                  id="appName"
                  type="text"
                  value={localAppName}
                  onChange={(e) => setLocalAppName(e.target.value)}
                  disabled={isLoading}
                  className={`flex-1 ${inputClass}`}
                />
                <button type="submit" disabled={isLoading} className={`${primaryButtonClass} px-6 font-medium flex items-center gap-2`}><Save size={18} />{t('actions.save')}</button>
              </div>
            </form>
            <form onSubmit={handleSaveUserName} className="space-y-0">
              <label htmlFor="userName" className="mb-2 block text-sm font-medium text-[var(--text-muted)]">{t('settings.userName')}</label>
              <div className="flex gap-4">
                <input
                  id="userName"
                  type="text"
                  placeholder={t('settings.userNamePlaceholder')}
                  value={localUserName}
                  onChange={(e) => setLocalUserName(e.target.value)}
                  disabled={isLoading}
                  className={`flex-1 ${inputClass}`}
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className={`${primaryButtonClass} px-6 font-medium flex items-center gap-2`}
                >
                  <Save size={18} />
                  {t('actions.save')}
                </button>
              </div>
            </form>

            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="settings-language" className="mb-2 block text-sm font-medium text-[var(--text-muted)]">{t('settings.language')}</label>
                  <select
                    id="settings-language"
                    aria-label={t('settings.language')}
                    value={i18n.language}
                    onChange={(e) => handleLanguageChange((e.target.value as 'en' | 'ko'))}
                    className={selectClass}
                    style={selectArrowStyle}
                  >
                    <option value="en">{t('settings.languageEnglish')}</option>
                    <option value="ko">{t('settings.languageKorean')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="settings-theme" className="mb-2 block text-sm font-medium text-[var(--text-muted)]">{t('settings.theme')}</label>
                  <select
                    id="settings-theme"
                    aria-label={t('settings.theme')}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'auto')}
                    className={selectClass}
                    style={selectArrowStyle}
                  >
                    <option value="auto">{t('settings.themeAuto')}</option>
                    <option value="dark">{t('settings.themeDark')}</option>
                    <option value="light">{t('settings.themeLight')}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <label className="block text-sm font-medium text-[var(--text-muted)]">{t('settings.favicon')}</label>
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]">
                  {localFaviconDataUrl ? (
                    <img src={localFaviconDataUrl} alt={t('settings.faviconPreviewAlt')} className="h-8 w-8 object-contain" />
                  ) : (
                    <ImageIcon size={18} className="text-[var(--text-muted)]" />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    ref={faviconInputRef}
                    onChange={handleFaviconFileChange}
                    accept="image/png,image/x-icon,image/svg+xml,image/jpeg,image/webp"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => faviconInputRef.current?.click()}
                    className={`${secondaryButtonClass} py-2`}
                  >
                    {t('actions.selectFile')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveFavicon}
                    disabled={isLoading}
                    className={`${primaryButtonClass} py-2 flex items-center gap-2`}
                  >
                    <Save size={14} />
                    {t('actions.save')}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetFavicon}
                    disabled={isLoading}
                    className={`${secondaryButtonClass} px-3 py-2 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <Trash2 size={14} />
                    {t('actions.reset')}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">{t('settings.faviconRecommended')}</p>
            </div>

            <div className="space-y-2 pt-2">
              <label className="block text-sm font-medium text-[var(--text-muted)]">{t('settings.announcement')}</label>
              <div className={`rounded-lg border border-[var(--border)] ${fieldBgClass} p-3 text-xs text-[var(--text-muted)]`}>
                {announcementMarkdown.trim()
                  ? t('settings.announcementConfigured')
                  : t('settings.announcementEmpty')}
              </div>
              <button
                type="button"
                onClick={openAnnouncementEditor}
                className={`${secondaryButtonClass} inline-flex items-center gap-2 py-2`}
              >
                <PencilLine size={14} />
                {t('settings.editAnnouncement')}
              </button>
            </div>

            {appNameStatus.message && (
              <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${
                appNameStatus.type === 'success'
                  ? 'text-green-400 bg-green-500/5 border-green-500/20'
                  : 'text-red-400 bg-red-500/5 border-red-500/20'
              }`}>
                {appNameStatus.type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
                <span className="font-medium">{appNameStatus.message}</span>
              </div>
            )}
            {faviconStatus.message && (
              <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${
                faviconStatus.type === 'success'
                  ? 'text-green-400 bg-green-500/5 border-green-500/20'
                  : 'text-red-400 bg-red-500/5 border-red-500/20'
              }`}>
                {faviconStatus.type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
                <span className="font-medium">{faviconStatus.message}</span>
              </div>
            )}
            {userNameStatus.message && (
              <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${
                userNameStatus.type === 'success'
                  ? 'text-green-400 bg-green-500/5 border-green-500/20'
                  : 'text-red-400 bg-red-500/5 border-red-500/20'
              }`}>
                {userNameStatus.type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
                <span className="font-medium">{userNameStatus.message}</span>
              </div>
            )}
            {announcementStatus.message && (
              <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${
                announcementStatus.type === 'success'
                  ? 'text-green-400 bg-green-500/5 border-green-500/20'
                  : announcementStatus.type === 'loading'
                    ? 'text-blue-400 bg-blue-500/5 border-blue-500/20'
                    : 'text-red-400 bg-red-500/5 border-red-500/20'
              }`}>
                {announcementStatus.type === 'success'
                  ? <CheckCircle2 size={18} className="shrink-0" />
                  : announcementStatus.type === 'loading'
                    ? <RefreshCw size={18} className="shrink-0 animate-spin" />
                    : <AlertCircle size={18} className="shrink-0" />}
                <span className="font-medium">{announcementStatus.message}</span>
              </div>
            )}
          </div>
        </section>

        {/* SSH Connection Section */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <h3 className="text-xl font-semibold text-[var(--text)] flex items-center gap-2">
              {t('settings.hostServerTitle')}
            </h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">{t('settings.hostServerDescription')}</p>
          </div>

          <form onSubmit={handleSaveSsh} className="p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="col-span-1 sm:col-span-2 space-y-2">
                <label className="text-sm font-medium text-[var(--text-muted)]">{t('settings.hostAddress')}</label>
                <div className={`w-full ${fieldBgClass} border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text-muted)] text-sm flex items-center gap-2 overflow-hidden`}>
                  <Server size={14} /> {window.location.hostname}
                  <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded ml-auto uppercase font-bold">{t('settings.autoDetected')}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-muted)]">{t('settings.port')}</label>
                <input type="number" value={sshSettings.port} onChange={e => setSshSettings({...sshSettings, port: e.target.value})} className={inputClass} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-muted)]">{t('settings.username')}</label>
                <input type="text" value={sshSettings.username} onChange={e => setSshSettings({...sshSettings, username: e.target.value})} className={inputClass} />
              </div>
              <div className="col-span-1 sm:col-span-2 space-y-2">
                <label className="text-sm font-medium text-[var(--text-muted)]">{t('settings.authenticationMethod')}</label>
                <div className="flex gap-4 p-1 bg-[var(--bg-soft)] rounded-lg border border-[var(--border)]">
                  <button type="button" onClick={() => setSshSettings({...sshSettings, authMethod: 'password'})} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${sshSettings.authMethod === 'password' ? 'bg-[var(--bg-elevated)] text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)]'}`}>{t('settings.password')}</button>
                  <button type="button" onClick={() => setSshSettings({...sshSettings, authMethod: 'key'})} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${sshSettings.authMethod === 'key' ? 'bg-[var(--bg-elevated)] text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)]'}`}>{t('settings.sshKey')}</button>
                </div>
              </div>
            </div>

            {sshSettings.authMethod === 'password' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-muted)] flex items-center gap-2"><Lock size={14} /> {t('settings.password')}</label>
                <input type="password" value={sshSettings.password} onChange={e => setSshSettings({...sshSettings, password: e.target.value})} className={inputClass} />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-[var(--text-muted)] flex items-center gap-2"><Key size={14} /> {t('settings.privateKeyFile')}</label>
                    <div className="flex gap-4 items-center">
                        <div className="flex-1 bg-[var(--bg-soft)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text)] font-mono text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                            {sshSettings.keyName || t('settings.noFileSelected')}
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                        <button type="button" onClick={() => fileInputRef.current?.click()} className={`${secondaryButtonClass} flex items-center gap-2`}>
                            <FolderOpen size={18} /> {t('actions.selectFile')}
                        </button>
                    </div>
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-[var(--text-muted)] flex items-center gap-2"><Lock size={14} /> {t('settings.masterPassphrase')}</label>
                    <input type="password" placeholder={t('settings.masterPassphrasePlaceholder')} value={sshSettings.masterPassword} onChange={e => setSshSettings({...sshSettings, masterPassword: e.target.value})} className={inputClass} />
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('settings.masterPassphraseHelp')}</p>
                </div>
              </div>
            )}

            <div className="pt-6 border-t border-[var(--border)] flex flex-col gap-4">
              {sshStatus.message && (
                <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${
                  sshStatus.type === 'success'
                    ? 'text-green-400 bg-green-500/5 border-green-500/20'
                    : 'text-red-400 bg-red-500/5 border-red-500/20'
                }`}>
                  {sshStatus.type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
                  <span className="font-medium">{sshStatus.message}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-end gap-4">
                <button
                  type="button"
                  onClick={handleTestSsh}
                  className={`${secondaryButtonClass} w-full sm:w-auto px-6 font-medium`}
                >
                  {t('actions.testConnection')}
                </button>
                <button
                  type="submit"
                  disabled={sshStatus.type === 'loading'}
                  className={`${primaryButtonClass} w-full sm:w-auto px-10 font-medium flex items-center justify-center gap-2`}
                >
                  <Save size={18} />
                  {t('actions.save')}
                </button>
              </div>
            </div>

          </form>
        </section>
      </div>

      <section className={sectionClass}>
        <div className="p-6 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-[var(--text)] flex items-center gap-2">
              {t('settings.resourceManagementTitle')}
            </h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">{t('settings.resourceManagementDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshResourceManagement();
            }}
            className={`${secondaryButtonClass} self-start sm:self-auto px-3 py-2 flex items-center gap-2`}
          >
            <RefreshCw size={14} className={isResourceLoading || tmuxLoading ? 'animate-spin' : ''} />
            {t('actions.refresh')}
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className={resourceCardClass}>
            <div className="flex items-center justify-between">
            <h4 className="text-[var(--text)] font-medium">{t('settings.unusedImages')}</h4>
              <select
                value={imageMode}
                onChange={(e) => setImageMode(e.target.value as 'dangling' | 'unused')}
                className={`w-auto min-w-[108px] appearance-none rounded-lg border border-[var(--border)] ${fieldBgClass} pl-2 pr-8 py-1 text-xs text-[var(--text)] transition-all focus:outline-none focus:border-blue-500`}
                style={selectArrowStyle}
              >
                <option value="dangling">{t('settings.danglingOnly')}</option>
                <option value="unused">{t('settings.allUnused')}</option>
              </select>
            </div>
            <p className="text-xs text-[var(--text-muted)]">{t('settings.candidateImages', { count: unusedImages.length })}</p>
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {unusedImages.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{t('settings.noRemovableImages')}</p>
              ) : unusedImages.map((img) => (
                <div key={img.id} className="text-xs border border-[var(--border)] rounded-lg p-2 text-[var(--text)]">
                  <div className="font-mono text-[11px] text-[var(--text)]">{img.short_id}</div>
                  <div className="truncate">{(img.tags && img.tags.length > 0 ? img.tags.join(', ') : '<none>:<none>')}</div>
                  <div className="text-[var(--text-muted)]">{formatBytes(img.size)}</div>
                </div>
              ))}
            </div>
            <button type="button" onClick={runImagePrune} className={dangerButtonClass}>
              {t('resource.cleanupImages')}
            </button>
          </div>

          <div className={resourceCardClass}>
            <div className="flex items-center justify-between">
              <h4 className="text-[var(--text)] font-medium">{t('settings.unusedVolumes')}</h4>
              <span className="text-xs text-[var(--text-muted)]">{t('settings.candidates', { count: unusedVolumes.length })}</span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {unusedVolumes.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{t('settings.noRemovableVolumes')}</p>
              ) : unusedVolumes.map((vol) => (
                <label key={vol.name} className="flex items-start gap-2 text-xs border border-[var(--border)] rounded-lg p-2 text-[var(--text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedVolumes.includes(vol.name)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedVolumes((prev) => [...prev, vol.name]);
                      else setSelectedVolumes((prev) => prev.filter((v) => v !== vol.name));
                    }}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-[var(--text)] break-all">{vol.name}</div>
                    <div className="text-[var(--text-muted)] break-all">{vol.mountpoint}</div>
                  </div>
                </label>
              ))}
            </div>
            <button type="button" onClick={runVolumePrune} className={dangerButtonClass} disabled={selectedVolumes.length === 0}>
              {t('resource.removeSelectedVolumes')}
            </button>
          </div>

          <div className={resourceCardClass}>
            <h4 className="text-[var(--text)] font-medium">{t('settings.buildCache')}</h4>
            <div className="text-sm text-[var(--text)]">{t('settings.entries')}: <span className="font-mono">{buildCache.count}</span></div>
            <div className="text-sm text-[var(--text)]">{t('settings.size')}: <span className="font-mono">{formatBytes(buildCache.size)}</span></div>
            <button type="button" onClick={runBuildCachePrune} className={dangerButtonClass}>
              {t('resource.cleanupBuildCache')}
            </button>
          </div>

          <div className={resourceCardClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-[var(--text)] font-medium">{t('settings.terminalSessionsTitle')}</h4>
                <p className="text-xs text-[var(--text-muted)] mt-1">{t('settings.terminalSessionsDescription')}</p>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
              {tmuxSessions.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{t('settings.noTerminalSessions')}</p>
              ) : tmuxSessions.map((session) => (
                <label key={session.name} className="flex items-center gap-2 text-xs border border-[var(--border)] rounded-lg p-2 text-[var(--text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTmuxSessions.includes(session.name)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedTmuxSessions((prev) => [...prev, session.name]);
                      else setSelectedTmuxSessions((prev) => prev.filter((name) => name !== session.name));
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] text-[var(--text)] break-all">{session.name}</div>
                    <div className="text-[var(--text-muted)]">
                      {t('settings.terminalSessionMeta', { attached: session.attached, windows: session.windows })}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <button
              type="button"
              onClick={killSelectedTmuxSessions}
              className={dangerButtonClass}
              disabled={tmuxLoading || selectedTmuxSessions.length === 0}
            >
              {t('settings.killSelectedTerminalSessions')}
            </button>

            {sessionStatus.type === 'error' && sessionStatus.message && (
              <div className="flex items-center gap-2 text-sm p-3 rounded-lg border text-red-400 bg-red-500/5 border-red-500/20">
                <AlertCircle size={18} className="shrink-0" />
                <span className="font-medium">{sessionStatus.message}</span>
              </div>
            )}
          </div>

        </div>

        {resourceStatus.message && (
          <div className={`mx-6 mb-6 flex items-center gap-2 text-sm p-3 rounded-lg border ${
            resourceStatus.type === 'success'
              ? 'text-green-400 bg-green-500/5 border-green-500/20'
              : resourceStatus.type === 'error'
                ? 'text-red-400 bg-red-500/5 border-red-500/20'
                : 'text-blue-400 bg-blue-500/5 border-blue-500/20'
          }`}>
            {resourceStatus.type === 'success'
              ? <CheckCircle2 size={18} className="shrink-0" />
              : resourceStatus.type === 'error'
                ? <AlertCircle size={18} className="shrink-0" />
                : <RefreshCw size={18} className="shrink-0 animate-spin" />}
            <span className="font-medium">{resourceStatus.message}</span>
          </div>
        )}
      </section>

    </div>
  );
}
