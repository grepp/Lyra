import Editor from '@monaco-editor/react';
import axios from 'axios';
import clsx from 'clsx';
import { Eye, EyeOff, FolderOpen, Play, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

interface MountPoint {
  host_path: string;
  container_path: string;
  mode: 'rw' | 'ro';
}

interface CustomPortMapping {
  host_port: number;
  container_port: number;
}

export default function Provisioning() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Modal State
  const [modalConfig, setModalConfig] = useState({
      isOpen: false,
      title: '',
      message: '',
      type: 'alert' as 'alert' | 'confirm'
  });

  const showAlert = (title: string, message: string) => {
      setModalConfig({
          isOpen: true,
          title,
          message,
          type: 'alert'
      });
  };

  const [gpuCount, setGpuCount] = useState(0);
  const [maxGpus, setMaxGpus] = useState(0);
  const [totalGpus, setTotalGpus] = useState(0);

  const [mounts, setMounts] = useState<MountPoint[]>([]);
  const [customPorts, setCustomPorts] = useState<CustomPortMapping[]>([]);
  const [isAllocatingPort, setIsAllocatingPort] = useState(false);
  const [dockerfile, setDockerfile] = useState('FROM python:3.11-slim\n\n');

  // Fetch GPU Resources and Load Template
  useEffect(() => {
    // 1. Fetch GPU Info
    axios.get('resources/gpu')
      .then(res => {
         setMaxGpus(res.data.available);
         setTotalGpus(res.data.total);

         // 2. Load Template if exists
         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         const state = location.state as { templateConfig?: any };
         if (state && state.templateConfig) {
             const config = state.templateConfig;

             // Only load Dockerfile content
             if (config.dockerfile_content) setDockerfile(config.dockerfile_content);

             // Clear state so refresh doesn't reload template
             window.history.replaceState({}, document.title);

             // Default GPU count fallback
             setGpuCount(0);

             // Show a toast or notification? (Optional)
         } else {
             // Default behavior
             setGpuCount(0);
         }
      })
      .catch(err => console.error("Failed to fetch GPU resources", err));
  }, [location.state]);

  const handleAddMount = () => {
    setMounts([...mounts, { host_path: '', container_path: '', mode: 'rw' }]);
  };

  const handleRemoveMount = (index: number) => {
    setMounts(mounts.filter((_, i) => i !== index));
  };

  const handleMountChange = (index: number, field: keyof MountPoint, value: string) => {
    const newMounts = [...mounts];
    // @ts-expect-error: indexing with dynamic field name
    newMounts[index][field] = value;
    setMounts(newMounts);
  };

  const handleAddCustomPort = async () => {
    try {
      setIsAllocatingPort(true);
      const res = await axios.post('environments/ports/allocate', {
        count: 1,
        current_ports: customPorts,
      });
      const mappings = Array.isArray(res.data?.mappings) ? res.data.mappings : [];
      if (mappings.length > 0) {
        setCustomPorts((prev) => [...prev, mappings[0]]);
      } else {
        showToast(t('feedback.provisioning.allocateCustomPortFailed'), 'error');
      }
    } catch {
      showToast(t('feedback.provisioning.allocateCustomPortFailed'), 'error');
    } finally {
      setIsAllocatingPort(false);
    }
  };

  const handleRemoveCustomPort = (index: number) => {
    setCustomPorts((prev) => prev.filter((_, i) => i !== index));
  };

  // Error State
  const [errors, setErrors] = useState<{name?: string, password?: string}>({});

  const handleSubmit = async () => {
    const newErrors: {name?: string, password?: string} = {};
    if (!name.trim()) {
        newErrors.name = t('provisioning.errorEnvironmentNameRequired');
    } else if (!/^[a-zA-Z0-9-]+$/.test(name)) {
        newErrors.name = t('provisioning.errorEnvironmentNameFormat');
    }
    if (!password.trim()) newErrors.password = t('provisioning.errorRootPasswordRequired');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Clear errors if valid
    setErrors({});

    try {
      const validMounts = mounts.filter(m => m.host_path.trim() !== '' && m.container_path.trim() !== '');

      const payload = {
        name,
        container_user: 'root',
        root_password: password,
        mount_config: validMounts,
        custom_ports: customPorts,
        dockerfile_content: dockerfile,
        gpu_count: gpuCount
      };

      // Relative path works thanks to Nginx proxy
      await axios.post('environments/', payload);

      navigate('/');
    } catch (error) {
      console.error("Failed to create environment", error);
      showAlert(t('feedback.provisioning.creationFailedTitle'), t('feedback.provisioning.creationFailedMessage'));
    }
  };

  // Template Save State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateErrors, setTemplateErrors] = useState<{name?: string}>({});

  const handleSaveTemplate = async () => {
      if (!templateName.trim()) {
          setTemplateErrors({ name: t('provisioning.errorTemplateNameRequired') });
          return;
      }
      setTemplateErrors({});

      try {
          // Only save Dockerfile content as requested
          const config = {
              dockerfile_content: dockerfile
          };

          await axios.post('templates/', {
              name: templateName,
              description: templateDesc,
              config: config
          });

          setIsSaveModalOpen(false);
          setTemplateName('');
          setTemplateDesc('');
          showToast(t('feedback.provisioning.templateSaved'), "success");
      } catch (error) {
          console.error("Failed to save template", error);
          showToast(t('feedback.provisioning.templateSaveFailed'), "error");
      }
  };

  // Template Load State
  interface Template {
      id: string;
      name: string;
      description: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: any;
      created_at: string;
  }
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
      if (isLoadModalOpen) {
          fetchTemplates();
      }
  }, [isLoadModalOpen]);

  const fetchTemplates = async () => {
    try {
      setIsLoadingTemplates(true);
      const res = await axios.get('templates/');
      setTemplates(res.data);
    } catch (error) {
      console.error("Failed to fetch templates", error);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-20 relative">
      <Modal
          isOpen={modalConfig.isOpen}
          onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
          title={modalConfig.title}
          message={modalConfig.message}
          type={modalConfig.type}
      />

      {/* Save Template Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm">
            <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 space-y-4">
                    <h3 className="text-xl font-bold text-[var(--text)]">{t('provisioning.saveAsTemplate')}</h3>

                    <div className="space-y-1">
                        <label className="text-sm font-medium text-[var(--text-muted)]">{t('provisioning.templateName')}</label>
                        <input
                            value={templateName}
                            onChange={(e) => {
                                setTemplateName(e.target.value);
                                if (templateErrors.name) setTemplateErrors({});
                            }}
                            className={clsx(
                                "w-full bg-[var(--bg-soft)] border rounded-lg px-4 py-2 text-[var(--text)] focus:outline-none focus:ring-1 transition-all",
                                templateErrors.name
                                    ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
                                    : "border-[var(--border)] focus:border-blue-500 focus:ring-blue-500"
                            )}
                            placeholder={t('provisioning.templateNamePlaceholder')}
                        />
                         {templateErrors.name && (
                            <p className="text-xs text-red-400 mt-1">{templateErrors.name}</p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-medium text-[var(--text-muted)]">{t('provisioning.description')}</label>
                        <textarea
                            value={templateDesc}
                            onChange={(e) => setTemplateDesc(e.target.value)}
                            className="w-full bg-[var(--bg-soft)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--text)] focus:border-blue-500 focus:outline-none resize-none h-24"
                            placeholder={t('provisioning.optionalDescription')}
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-[var(--border)] flex justify-end gap-3 bg-[var(--bg-soft)]">
                    <button
                        onClick={() => {
                            setIsSaveModalOpen(false);
                            setTemplateErrors({});
                        }}
                        className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text)] hover:brightness-95 transition-colors"
                    >
                        {t('actions.cancel')}
                    </button>
                    <button
                        onClick={handleSaveTemplate}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all"
                    >
                        {t('provisioning.saveTemplate')}
                    </button>
                </div>
            </div>
        </div>
      )}

      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-[var(--text)] tracking-tight">{t('provisioning.title')}</h2>
          <p className="text-[var(--text-muted)] mt-1">{t('provisioning.subtitle')}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg flex items-center gap-2 font-medium shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]"
          >
            <Play size={18} fill="currentColor" />
            <span>{t('provisioning.buildRun')}</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-1 space-y-6">

          {/* Basic Info */}
          <section className="bg-[var(--bg-elevated)] p-6 rounded-xl border border-[var(--border)] space-y-4">
            <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
              <span className="w-1 h-5 bg-blue-500 rounded-full"></span>
              {t('provisioning.basicConfiguration')}
            </h3>

            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--text-muted)]">{t('provisioning.environmentName')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('provisioning.environmentNamePlaceholder')}
                className={clsx(
                  "w-full bg-[var(--bg-soft)] border rounded-lg px-4 py-2.5 text-[var(--text)] focus:outline-none focus:ring-1 transition-all",
                  errors.name
                    ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
                    : "border-[var(--border)] focus:border-blue-500 focus:ring-blue-500"
                )}
              />
              {errors.name && (
                <p className="text-xs text-red-400 mt-1">{errors.name}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--text-muted)]">{t('provisioning.rootPassword')}</label>
              <div
                className={clsx(
                  "w-full bg-[var(--bg-soft)] border rounded-lg px-3 py-1.5 flex items-center gap-2 focus-within:ring-1 transition-all",
                  errors.password
                    ? "border-red-500/50 focus-within:border-red-500 focus-within:ring-red-500/20"
                    : "border-[var(--border)] focus-within:border-blue-500 focus-within:ring-blue-500"
                )}
              >
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[var(--text)] focus:outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="shrink-0 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)] transition-colors"
                  title={showPassword ? t('provisioning.hidePassword') : t('provisioning.showPassword')}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-400 mt-1">{errors.password}</p>
              )}
            </div>
          </section>

          {/* Resources */}
          <section className="bg-[var(--bg-elevated)] p-6 rounded-xl border border-[var(--border)] space-y-4">
            <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
              <span className="w-1 h-5 bg-purple-500 rounded-full"></span>
              {t('provisioning.resourcesTitle')}
            </h3>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-[var(--text-muted)]">{t('provisioning.gpuAllocation')}</label>
                  <span className="text-2xl font-bold text-purple-400">{gpuCount} <span className="text-sm font-normal text-[var(--text-muted)]">{t('provisioning.gpus')}</span></span>
              </div>

              <div className="relative pt-6 pb-2">
                  <input
                    type="range"
                    min="0"
                    max={maxGpus || 0}
                    disabled={!maxGpus || maxGpus === 0}
                    value={gpuCount}
                    onChange={(e) => setGpuCount(parseInt(e.target.value))}
                    className={clsx(
                      "w-full h-2 rounded-lg appearance-none border border-[var(--border)]",
                      (!maxGpus || maxGpus === 0) ? "bg-[var(--bg-soft)] cursor-not-allowed" : "bg-[var(--bg-soft)] cursor-pointer accent-purple-500"
                    )}
                  />
                  <div className="flex justify-between text-xs text-[var(--text-muted)] mt-2">
                      <span>0</span>
                      <span>{t('provisioning.maxAvailable', { count: maxGpus || 0 })}</span>
                  </div>
              </div>

              <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-300">
                 {t('provisioning.currentSystemUsage', { used: (totalGpus || 0) - (maxGpus || 0), total: totalGpus || 0 })}
              </div>
            </div>
          </section>

          {/* Storage */}
          <section className="bg-[var(--bg-elevated)] p-6 rounded-xl border border-[var(--border)] space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                <span className="w-1 h-5 bg-green-500 rounded-full"></span>
                {t('provisioning.volumeMounts')}
                </h3>
                <button onClick={handleAddMount} className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                    <Plus size={18} />
                </button>
            </div>

            <div className="space-y-3">
              {mounts.map((mount, idx) => (
                <div key={idx} className="bg-[var(--bg-soft)] p-4 rounded-xl border border-[var(--border)] space-y-3 group transition-all hover:brightness-95">
                    <div className="flex gap-2 items-center">
                        <div className="flex-1 relative min-w-0">
                             <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                            <input
                                placeholder={t('provisioning.hostPathPlaceholder')}
                                value={mount.host_path}
                                onChange={(e) => handleMountChange(idx, 'host_path', e.target.value)}
                                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pl-9 text-sm text-[var(--text)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all"
                            />
                        </div>
                        <button
                            onClick={() => handleRemoveMount(idx)}
                            className="p-2 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                            title={t('provisioning.removeMount')}
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                    <div className="flex gap-2 items-center">
                        <div className="w-8 flex justify-center">
                            <span className="text-[var(--text-muted)] font-mono">:</span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <input
                                 placeholder={t('provisioning.containerPathPlaceholder')}
                                 value={mount.container_path}
                                 onChange={(e) => handleMountChange(idx, 'container_path', e.target.value)}
                                 className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all"
                            />
                        </div>
                        <div className="w-20 shrink-0">
                            <select
                                value={mount.mode}
                                onChange={(e) => handleMountChange(idx, 'mode', e.target.value)}
                                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-2 text-xs text-[var(--text-muted)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 cursor-pointer"
                            >
                                <option value="rw">RW</option>
                                <option value="ro">RO</option>
                            </select>
                        </div>
                    </div>
                </div>
              ))}
              {mounts.length === 0 && (
                <p className="text-sm text-[var(--text-muted)] text-center py-4 bg-[var(--bg-soft)] rounded-lg border border-dashed border-[var(--border)]">
                    {t('provisioning.noVolumesMounted')}
                </p>
              )}
            </div>
          </section>

          {/* Custom Port Mappings */}
          <section className="bg-[var(--bg-elevated)] p-6 rounded-xl border border-[var(--border)] space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <span className="w-1 h-5 bg-cyan-500 rounded-full"></span>
                  {t('provisioning.customPorts')}
                </h3>
                <button
                  onClick={handleAddCustomPort}
                  disabled={isAllocatingPort}
                  className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('provisioning.autoAllocateCustomPort')}
                >
                  <Plus size={18} className={isAllocatingPort ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="space-y-3">
              {customPorts.map((mapping, idx) => (
                <div
                  key={`${mapping.host_port}-${mapping.container_port}-${idx}`}
                  className="bg-[var(--bg-soft)] p-4 rounded-xl border border-[var(--border)] flex items-center justify-between gap-3"
                >
                  <div className="font-mono text-sm text-[var(--text)] min-w-0 overflow-x-auto whitespace-nowrap scrollbar-hide">
                    <span className="text-sky-500">{mapping.host_port}</span>
                    <span className="text-[var(--text-muted)] px-2">:</span>
                    <span className="text-[var(--success)]">{mapping.container_port}</span>
                  </div>
                  <button
                    onClick={() => handleRemoveCustomPort(idx)}
                    className="p-2 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                    title={t('provisioning.removeCustomPort')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {customPorts.length === 0 && (
                <p className="text-sm text-[var(--text-muted)] text-center py-4 bg-[var(--bg-soft)] rounded-lg border border-dashed border-[var(--border)]">
                  {t('provisioning.noCustomPortsAllocated')}
                </p>
              )}
            </div>
          </section>

        </div>

        {/* Right Column: Dockerfile Editor */}
        <div className="lg:col-span-2 flex flex-col h-[800px] bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] overflow-hidden">
             <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg-soft)]">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-500/10 rounded-md">
                        <span className="text-blue-400 font-mono text-sm font-bold">{t('provisioning.dockerfile')}</span>
                    </div>
                    <span className="text-sm text-[var(--text-muted)]">{t('provisioning.buildConfiguration')}</span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setIsLoadModalOpen(true)}
                        className="px-3 py-1.5 bg-[var(--bg-soft)] hover:brightness-95 text-[var(--text)] rounded-md flex items-center gap-2 transition-colors border border-[var(--border)] text-xs font-medium"
                    >
                        <Upload size={14} />
                        <span>{t('actions.load')}</span>
                    </button>
                    <button
                        onClick={() => setIsSaveModalOpen(true)}
                        className="px-3 py-1.5 bg-[var(--bg-soft)] hover:brightness-95 text-[var(--text)] rounded-md flex items-center gap-2 transition-colors border border-[var(--border)] text-xs font-medium"
                    >
                        <Save size={14} />
                        <span>{t('actions.save')}</span>
                    </button>
                </div>
             </div>
             <div className="flex-1 relative">
                <Editor
                    height="100%"
                    defaultLanguage="dockerfile"
                    theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
                    value={dockerfile}
                    onChange={(value) => setDockerfile(value || '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        scrollBeyondLastLine: false,
                        scrollbar: {
                            alwaysConsumeMouseWheel: false,
                        },
                        padding: { top: 20, bottom: 20 },
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
                    }}
                />
             </div>
        </div>
      </div>

      {/* Load Template Modal */}
      {isLoadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm">
            <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[80vh]">
                <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
                    <h3 className="text-xl font-bold text-[var(--text)]">{t('provisioning.loadTemplateTitle')}</h3>
                </div>

                <div className="p-4 overflow-y-auto space-y-3 flex-1 bg-[var(--bg-elevated)]">
                    {isLoadingTemplates ? (
                         <div className="text-center py-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--text)] mx-auto mb-2"></div>
                            <p className="text-[var(--text-muted)] text-sm">{t('provisioning.loadingTemplates')}</p>
                        </div>
                    ) : templates.length === 0 ? (
                        <div className="text-center py-10 text-[var(--text-muted)]">
                            <p>{t('provisioning.noTemplatesFound')}</p>
                        </div>
                    ) : (
                        templates.map((template) => (
                             <div key={template.id} className="bg-[var(--bg-soft)] rounded-lg border border-[var(--border)] p-4 flex items-center justify-between group hover:brightness-95 transition-all">
                                <div className="min-w-0 flex-1 mr-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="font-bold text-[var(--text)] truncate">{template.name}</h4>
                                        <span className="text-[10px] bg-[var(--bg-elevated)] text-[var(--text-muted)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                                            {new Date(template.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <p className="text-xs text-[var(--text-muted)] truncate">
                                        {template.description || t('provisioning.noDescription')}
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        if (template.config.dockerfile_content) {
                                            setDockerfile(template.config.dockerfile_content);
                                            setIsLoadModalOpen(false);
                                            showToast(t('feedback.provisioning.templateLoaded'), "success");
                                        } else {
                                            showToast(t('feedback.provisioning.templateDockerfileMissing'), "error");
                                        }
                                    }}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 shadow-lg shadow-blue-500/20"
                                >
                                    <Upload size={12} /> {t('actions.load')}
                                </button>
                             </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-soft)] flex justify-end">
                    <button
                        onClick={() => setIsLoadModalOpen(false)}
                        className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text)] hover:brightness-95 transition-colors"
                    >
                        {t('actions.close')}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
