import axios from 'axios';
import { AlertCircle, CheckCircle2, FolderOpen, HardDrive, ImageIcon, Key, Lock, RefreshCw, Save, Server, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { encrypt } from '../utils/crypto';

type StatusState = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };

export default function Settings() {
  const { appName, setAppName, faviconDataUrl, setFavicon, isLoading: appLoading } = useApp();
  const [localAppName, setLocalAppName] = useState(appName);
  const [localFaviconDataUrl, setLocalFaviconDataUrl] = useState(faviconDataUrl);
  const [appNameStatus, setAppNameStatus] = useState<StatusState>({ type: 'idle' });
  const [faviconStatus, setFaviconStatus] = useState<StatusState>({ type: 'idle' });
  const [sshStatus, setSshStatus] = useState<StatusState>({ type: 'idle' });
  const [resourceStatus, setResourceStatus] = useState<StatusState>({ type: 'idle' });

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalAppName(appName);
  }, [appName]);

  useEffect(() => {
    setLocalFaviconDataUrl(faviconDataUrl);
  }, [faviconDataUrl]);

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
      setResourceStatus({ type: 'error', message: 'Failed to load resource management data.' });
    } finally {
      setIsResourceLoading(false);
    }
  }, [imageMode]);

  useEffect(() => {
    loadResourceData(imageMode);
  }, [imageMode, loadResourceData]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localAppName.trim()) {
      setAppNameStatus({ type: 'error', message: 'Application name cannot be empty.' });
      return;
    }

    try {
      setAppNameStatus({ type: 'loading' });
      await setAppName(localAppName);
      setAppNameStatus({ type: 'success', message: 'Application name updated successfully!' });
      setTimeout(() => setAppNameStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setAppNameStatus({ type: 'error', message: 'Failed to update application name. Please try again.' });
    }
  };

  const handleFaviconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFaviconStatus({ type: 'error', message: 'Please select an image file.' });
      return;
    }

    if (file.size > 512 * 1024) {
      setFaviconStatus({ type: 'error', message: 'Favicon must be 512KB or smaller.' });
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
      setFaviconStatus({ type: 'success', message: 'Favicon updated successfully!' });
      setTimeout(() => setFaviconStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setFaviconStatus({ type: 'error', message: 'Failed to update favicon.' });
    }
  };

  const handleResetFavicon = async () => {
    try {
      setFaviconStatus({ type: 'loading' });
      setLocalFaviconDataUrl('');
      await setFavicon('');
      if (faviconInputRef.current) faviconInputRef.current.value = '';
      setFaviconStatus({ type: 'success', message: 'Favicon reset to default.' });
      setTimeout(() => setFaviconStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setFaviconStatus({ type: 'error', message: 'Failed to reset favicon.' });
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
        setSshStatus({ type: 'error', message: 'Username is required.' });
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
          setSshStatus({ type: 'error', message: 'Password is required.' });
          return;
        }
        updates.push({ key: 'ssh_password', value: sshSettings.password });
      }

      // Handle Key Encryption and Storage
      if (sshSettings.authMethod === 'key') {
        if (sshSettings.privateKey) {
            if (!sshSettings.masterPassword) {
                setSshStatus({ type: 'error', message: 'Master passphrase is required for encryption.' });
                return;
            }
            const encrypted = await encrypt(sshSettings.privateKey, sshSettings.masterPassword);
            localStorage.setItem('ssh_private_key_encrypted', encrypted);
            localStorage.setItem('ssh_key_name', sshSettings.keyName);
        } else if (!sshSettings.keyName) {
            setSshStatus({ type: 'error', message: 'Please select an SSH key file.' });
            return;
        }
        // If they have keyName but no privateKey in state, it means they are using existing key
      }

      await Promise.all(updates.map(u => axios.put(`settings/${u.key}`, { value: u.value })));

      setSshStatus({ type: 'success', message: 'SSH settings updated! Key is encrypted in your browser.' });
      setTimeout(() => setSshStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setSshStatus({ type: 'error', message: 'Failed to update SSH settings.' });
    }
  };

  const handleTestSsh = async () => {
    try {
      setSshStatus({ type: 'loading', message: 'Testing connection...' });

      const keyToTest = sshSettings.privateKey;
      if (sshSettings.authMethod === 'key' && !keyToTest) {
          setSshStatus({ type: 'error', message: 'Please pick a key file to test.' });
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
        setSshStatus({ type: 'success', message: 'Connection Successful!' });
      } else {
        setSshStatus({ type: 'error', message: `Connection Failed: ${res.data.message}` });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSshStatus({ type: 'error', message: `Test failed: ${message}` });
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
      setResourceStatus({ type: 'loading', message: 'Cleaning unused images...' });
      const res = await axios.post('resources/docker/images/prune', { mode: imageMode });
      setResourceStatus({
        type: 'success',
        message: `Images cleaned: ${res.data?.removed_count || 0} removed, ${res.data?.skipped_count || 0} skipped.`,
      });
      await loadResourceData(imageMode);
      setTimeout(() => setResourceStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setResourceStatus({ type: 'error', message: 'Failed to clean images.' });
    }
  };

  const runVolumePrune = async () => {
    if (selectedVolumes.length === 0) {
      setResourceStatus({ type: 'error', message: 'Select at least one unused volume.' });
      return;
    }
    try {
      setResourceStatus({ type: 'loading', message: 'Removing selected volumes...' });
      const res = await axios.post('resources/docker/volumes/prune', { volume_names: selectedVolumes });
      setResourceStatus({
        type: 'success',
        message: `Volumes removed: ${res.data?.removed_count || 0} removed, ${res.data?.skipped_count || 0} skipped.`,
      });
      setSelectedVolumes([]);
      await loadResourceData(imageMode);
      setTimeout(() => setResourceStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setResourceStatus({ type: 'error', message: 'Failed to remove selected volumes.' });
    }
  };

  const runBuildCachePrune = async () => {
    try {
      setResourceStatus({ type: 'loading', message: 'Cleaning build cache...' });
      const res = await axios.post('resources/docker/build-cache/prune', { all: true });
      setResourceStatus({
        type: 'success',
        message: `Build cache cleaned. Reclaimed ${formatBytes(Number(res.data?.space_reclaimed || 0))}.`,
      });
      await loadResourceData(imageMode);
      setTimeout(() => setResourceStatus({ type: 'idle' }), 3000);
    } catch (error) {
      console.error(error);
      setResourceStatus({ type: 'error', message: 'Failed to clean build cache.' });
    }
  };

  const isLoading = appLoading || isSettingsLoading;

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold text-white">Settings</h2>
        <p className="text-gray-400 mt-1">Configure your application preferences and host access</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        {/* Branding Section */}
        <section className="bg-[#27272a] rounded-xl border border-[#3f3f46] overflow-hidden shadow-xl">
          <div className="p-6 border-b border-[#3f3f46]">
            <h3 className="text-xl font-semibold text-white flex items-center gap-2">General</h3>
            <p className="text-sm text-gray-400 mt-1">Configure general application identifiers.</p>
          </div>

          <form onSubmit={handleSaveName} className="p-6 space-y-4">
            <div>
              <label htmlFor="appName" className="block text-sm font-medium text-gray-300 mb-2">Application Name</label>
              <div className="flex gap-4">
                <input
                  id="appName"
                  type="text"
                  value={localAppName}
                  onChange={(e) => setLocalAppName(e.target.value)}
                  disabled={isLoading}
                  className="flex-1 bg-[#18181b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-all"
                />
                <button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2"><Save size={18} />Save</button>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <label className="block text-sm font-medium text-gray-300">Favicon</label>
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-lg border border-[#3f3f46] bg-[#18181b] flex items-center justify-center overflow-hidden">
                  {localFaviconDataUrl ? (
                    <img src={localFaviconDataUrl} alt="Favicon preview" className="h-8 w-8 object-contain" />
                  ) : (
                    <ImageIcon size={18} className="text-gray-500" />
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
                    className="bg-[#3f3f46] hover:bg-[#52525b] text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
                  >
                    Select File
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveFavicon}
                    disabled={isLoading}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save size={14} />
                    Save Favicon
                  </button>
                  <button
                    type="button"
                    onClick={handleResetFavicon}
                    disabled={isLoading}
                    className="bg-[#3f3f46] hover:bg-[#52525b] text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} />
                    Reset
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-gray-500">Recommended: square icon (32x32 or 64x64), max 512KB.</p>
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
          </form>
        </section>

        {/* SSH Connection Section */}
        <section className="bg-[#27272a] rounded-xl border border-[#3f3f46] overflow-hidden shadow-xl">
          <div className="p-6 border-b border-[#3f3f46]">
            <h3 className="text-xl font-semibold text-white flex items-center gap-2">
              <Server size={20} className="text-blue-400" /> Host Server Connection
            </h3>
            <p className="text-sm text-gray-400 mt-1">Configure SSH access to the host machine for the Terminal tab.</p>
          </div>

          <form onSubmit={handleSaveSsh} className="p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="col-span-1 sm:col-span-2 space-y-2">
                <label className="text-sm font-medium text-gray-300">Host Address</label>
                <div className="w-full bg-[#18181b]/50 border border-[#3f3f46] rounded-lg px-4 py-2.5 text-gray-400 text-sm flex items-center gap-2 overflow-hidden">
                  <Server size={14} /> {window.location.hostname}
                  <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded ml-auto uppercase font-bold">Auto-detected</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Port</label>
                <input type="number" value={sshSettings.port} onChange={e => setSshSettings({...sshSettings, port: e.target.value})} className="w-full bg-[#18181b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Username</label>
                <input type="text" value={sshSettings.username} onChange={e => setSshSettings({...sshSettings, username: e.target.value})} className="w-full bg-[#18181b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div className="col-span-1 sm:col-span-2 space-y-2">
                <label className="text-sm font-medium text-gray-300">Authentication Method</label>
                <div className="flex gap-4 p-1 bg-[#18181b] rounded-lg border border-[#3f3f46]">
                  <button type="button" onClick={() => setSshSettings({...sshSettings, authMethod: 'password'})} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${sshSettings.authMethod === 'password' ? 'bg-[#3f3f46] text-white' : 'text-gray-400'}`}>Password</button>
                  <button type="button" onClick={() => setSshSettings({...sshSettings, authMethod: 'key'})} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${sshSettings.authMethod === 'key' ? 'bg-[#3f3f46] text-white' : 'text-gray-400'}`}>SSH Key</button>
                </div>
              </div>
            </div>

            {sshSettings.authMethod === 'password' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300 flex items-center gap-2"><Lock size={14} /> Password</label>
                <input type="password" value={sshSettings.password} onChange={e => setSshSettings({...sshSettings, password: e.target.value})} className="w-full bg-[#18181b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300 flex items-center gap-2"><Key size={14} /> Private Key File</label>
                    <div className="flex gap-4 items-center">
                        <div className="flex-1 bg-[#18181b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-white font-mono text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                            {sshSettings.keyName || 'No file selected'}
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="bg-[#3f3f46] hover:bg-[#52525b] text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all">
                            <FolderOpen size={18} /> Select File
                        </button>
                    </div>
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300 flex items-center gap-2"><Lock size={14} /> Master Passphrase</label>
                    <input type="password" placeholder="Set password to encrypt the key in your browser" value={sshSettings.masterPassword} onChange={e => setSshSettings({...sshSettings, masterPassword: e.target.value})} className="w-full bg-[#18181b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" />
                    <p className="text-[10px] text-gray-500 mt-1">This passphrase is used locally only and never sent to the server.</p>
                </div>
              </div>
            )}

            <div className="pt-6 border-t border-[#3f3f46] flex flex-col gap-4">
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
                  className="w-full sm:w-auto bg-[#3f3f46] hover:bg-[#52525b] text-white px-6 py-2.5 rounded-lg font-medium transition-all"
                >
                  Test Connection
                </button>
                <button
                  type="submit"
                  disabled={sshStatus.type === 'loading'}
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white px-10 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={18} />
                  Save Settings
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>

      <section className="bg-[#27272a] rounded-xl border border-[#3f3f46] overflow-hidden shadow-xl">
        <div className="p-6 border-b border-[#3f3f46] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-white flex items-center gap-2">
              Resource Management
            </h3>
            <p className="text-sm text-gray-400 mt-1">Cleanup only targets resources not referenced by any running or stopped container.</p>
          </div>
          <button
            type="button"
            onClick={() => loadResourceData(imageMode)}
            className="self-start sm:self-auto bg-[#3f3f46] hover:bg-[#52525b] text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
          >
            <RefreshCw size={14} className={isResourceLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-[#18181b] border border-[#3f3f46] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-white font-medium">Unused Images</h4>
              <select
                value={imageMode}
                onChange={(e) => setImageMode(e.target.value as 'dangling' | 'unused')}
                className="bg-[#27272a] border border-[#3f3f46] rounded-lg px-2 py-1 text-xs text-gray-200"
              >
                <option value="dangling">Dangling Only</option>
                <option value="unused">All Unused</option>
              </select>
            </div>
            <p className="text-xs text-gray-400">{unusedImages.length} candidate images</p>
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {unusedImages.length === 0 ? (
                <p className="text-xs text-gray-500">No removable images.</p>
              ) : unusedImages.map((img) => (
                <div key={img.id} className="text-xs border border-[#3f3f46] rounded-lg p-2 text-gray-300">
                  <div className="font-mono text-[11px] text-gray-200">{img.short_id}</div>
                  <div className="truncate">{(img.tags && img.tags.length > 0 ? img.tags.join(', ') : '<none>:<none>')}</div>
                  <div className="text-gray-500">{formatBytes(img.size)}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={runImagePrune}
              className="bg-red-600/90 hover:bg-red-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-all"
            >
              Cleanup Images
            </button>
          </div>

          <div className="bg-[#18181b] border border-[#3f3f46] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-white font-medium flex items-center gap-2"><HardDrive size={15} /> Unused Volumes</h4>
              <span className="text-xs text-gray-400">{unusedVolumes.length} candidates</span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {unusedVolumes.length === 0 ? (
                <p className="text-xs text-gray-500">No removable volumes.</p>
              ) : unusedVolumes.map((vol) => (
                <label key={vol.name} className="flex items-start gap-2 text-xs border border-[#3f3f46] rounded-lg p-2 text-gray-300 cursor-pointer">
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
                    <div className="font-mono text-[11px] text-gray-200 break-all">{vol.name}</div>
                    <div className="text-gray-500 break-all">{vol.mountpoint}</div>
                  </div>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={runVolumePrune}
              className="bg-red-600/90 hover:bg-red-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={selectedVolumes.length === 0}
            >
              Remove Selected Volumes
            </button>
          </div>

          <div className="bg-[#18181b] border border-[#3f3f46] rounded-xl p-4 space-y-3">
            <h4 className="text-white font-medium">Build Cache</h4>
            <div className="text-sm text-gray-300">Entries: <span className="font-mono">{buildCache.count}</span></div>
            <div className="text-sm text-gray-300">Size: <span className="font-mono">{formatBytes(buildCache.size)}</span></div>
            <button
              type="button"
              onClick={runBuildCachePrune}
              className="bg-red-600/90 hover:bg-red-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-all"
            >
              Cleanup Build Cache
            </button>
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
