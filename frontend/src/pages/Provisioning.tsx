import Editor from '@monaco-editor/react';
import axios from 'axios';
import clsx from 'clsx';
import { Eye, EyeOff, FolderOpen, Loader2, Play, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import HostPathPickerModal from '../components/HostPathPickerModal';
import Modal from '../components/Modal';
import OverlayPortal from '../components/OverlayPortal';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { decrypt } from '../utils/crypto';
import { buildPrefixedEnvironmentName, getStoredUserName, validateUserName } from '../utils/userIdentity';

interface MountPoint {
  host_path: string;
  container_path: string;
  mode: 'rw' | 'ro';
}

interface MountRowError {
  message: string;
  showSettingsCta?: boolean;
}

interface CustomPortMapping {
  host_port: number;
  container_port: number;
}

interface EnvironmentSummary {
  name?: string;
  status?: string;
  gpu_indices?: number[];
  worker_server_id?: string | null;
  worker_server_name?: string | null;
}

interface WorkerServerOption {
  id: string;
  name: string;
  last_health_status?: string;
}

const MANAGED_JUPYTER_START = '# >>> LYRA_MANAGED_JUPYTER_START';
const MANAGED_JUPYTER_END = '# <<< LYRA_MANAGED_JUPYTER_END';
const MANAGED_CODE_START = '# >>> LYRA_MANAGED_CODE_SERVER_START';
const MANAGED_CODE_END = '# <<< LYRA_MANAGED_CODE_SERVER_END';
const MANAGED_SSH_START = '# >>> LYRA_MANAGED_SSH_START';
const MANAGED_SSH_END = '# <<< LYRA_MANAGED_SSH_END';

const normalizeDockerfile = (text: string): string => {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  return normalized ? `${normalized}\n` : '';
};

const stripManagedBlocks = (text: string): string => {
  if (!text) return '';
  let next = text;
  const patterns = [
    new RegExp(`${MANAGED_SSH_START}[\\s\\S]*?${MANAGED_SSH_END}\\n?`, 'g'),
    new RegExp(`${MANAGED_JUPYTER_START}[\\s\\S]*?${MANAGED_JUPYTER_END}\\n?`, 'g'),
    new RegExp(`${MANAGED_CODE_START}[\\s\\S]*?${MANAGED_CODE_END}\\n?`, 'g'),
  ];
  for (const pattern of patterns) {
    next = next.replace(pattern, '');
  }
  return normalizeDockerfile(next);
};

const buildManagedBlocks = (enableJupyter: boolean, enableCodeServer: boolean): string => {
  const blocks: string[] = [
    `${MANAGED_SSH_START}`,
    '# Managed by Lyra provisioning runtime requirements',
    'RUN if ! command -v sshd >/dev/null 2>&1 && [ ! -x /usr/sbin/sshd ]; then \\',
    '      (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y --no-install-recommends openssh-server passwd) || \\',
    '      (command -v apk >/dev/null 2>&1 && apk add --no-cache openssh shadow) || \\',
    '      (command -v dnf >/dev/null 2>&1 && dnf install -y openssh-server shadow-utils) || \\',
    '      (command -v yum >/dev/null 2>&1 && yum install -y openssh-server shadow-utils); \\',
    '    fi && \\',
    '    if ! command -v chpasswd >/dev/null 2>&1; then \\',
    '      (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y --no-install-recommends passwd) || \\',
    '      (command -v apk >/dev/null 2>&1 && apk add --no-cache shadow) || \\',
    '      (command -v dnf >/dev/null 2>&1 && dnf install -y shadow-utils) || \\',
    '      (command -v yum >/dev/null 2>&1 && yum install -y shadow-utils); \\',
    '    fi && \\',
    '    mkdir -p /var/run/sshd /etc/ssh',
    `${MANAGED_SSH_END}`,
  ];
  if (enableJupyter) {
    blocks.push(
      `${MANAGED_JUPYTER_START}`,
      '# Managed by Lyra provisioning service toggle',
      'RUN if ! command -v python3 >/dev/null 2>&1 || ! python3 -m pip --version >/dev/null 2>&1; then \\',
      '      (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y --no-install-recommends python3 python3-pip) || \\',
      '      (command -v apk >/dev/null 2>&1 && apk add --no-cache python3 py3-pip) || \\',
      '      (command -v dnf >/dev/null 2>&1 && dnf install -y python3 python3-pip) || \\',
      '      (command -v yum >/dev/null 2>&1 && yum install -y python3 python3-pip); \\',
      '    fi && \\',
      '    if ! command -v python3 >/dev/null 2>&1 || ! python3 -m pip --version >/dev/null 2>&1; then \\',
      "      echo 'python3/pip are required for jupyterlab installation but were not found after package install attempts' >&2; \\",
      '      exit 1; \\',
      '    fi && \\',
      '    python3 -m pip install --no-cache-dir jupyterlab',
      `${MANAGED_JUPYTER_END}`
    );
  }
  if (enableCodeServer) {
    blocks.push(
      `${MANAGED_CODE_START}`,
      '# Managed by Lyra provisioning service toggle',
      'RUN if ! command -v curl >/dev/null 2>&1; then \\',
      '      (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y --no-install-recommends curl) || \\',
      '      (command -v apk >/dev/null 2>&1 && apk add --no-cache curl) || \\',
      '      (command -v dnf >/dev/null 2>&1 && dnf install -y curl) || \\',
      '      (command -v yum >/dev/null 2>&1 && yum install -y curl); \\',
      '    fi && \\',
      '    curl -fsSL https://code-server.dev/install.sh -o /tmp/install-code-server.sh && \\',
      '    sh /tmp/install-code-server.sh',
      `${MANAGED_CODE_END}`
    );
  }
  return blocks.join('\n');
};

const composeDockerfile = (userDockerfile: string, enableJupyter: boolean, enableCodeServer: boolean): string => {
  const userPart = stripManagedBlocks(userDockerfile).trimEnd();
  const managedPart = buildManagedBlocks(enableJupyter, enableCodeServer);
  if (!managedPart) {
    return `${userPart}\n`;
  }
  return `${userPart}\n\n${managedPart}\n`;
};

export default function Provisioning() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [selectedGpuIndices, setSelectedGpuIndices] = useState<number[]>([]);
  const [availableGpuIndices, setAvailableGpuIndices] = useState<number[]>([]);
  const [totalGpus, setTotalGpus] = useState(0);
  const [usedGpuCount, setUsedGpuCount] = useState(0);
  const [executionTarget, setExecutionTarget] = useState<'host' | string>('host');
  const [workerServers, setWorkerServers] = useState<WorkerServerOption[]>([]);

  const [mounts, setMounts] = useState<MountPoint[]>([]);
  const [hostPathPickerIndex, setHostPathPickerIndex] = useState<number | null>(null);
  const [hostPathPickerPrivateKey, setHostPathPickerPrivateKey] = useState<string | undefined>(undefined);
  const [mountErrors, setMountErrors] = useState<Record<number, MountRowError>>({});
  const [checkingBrowseIndex, setCheckingBrowseIndex] = useState<number | null>(null);
  const [customPorts, setCustomPorts] = useState<CustomPortMapping[]>([]);
  const [isAllocatingPort, setIsAllocatingPort] = useState(false);
  const [userDockerfile, setUserDockerfile] = useState('FROM python:3.11-slim\n');
  const [enableJupyter, setEnableJupyter] = useState(true);
  const [enableCodeServer, setEnableCodeServer] = useState(true);

  const fetchGpuResources = useCallback(async (target: 'host' | string) => {
    try {
      const gpuRes = target === 'host'
        ? await axios.get('resources/gpu')
        : await axios.get(`worker-servers/${target}/gpu`);
      const total = Number(gpuRes.data?.total || 0);
      const used = Number(gpuRes.data?.used || 0);
      const availableIndices = Array.isArray(gpuRes.data?.available_indices)
        ? gpuRes.data.available_indices.map((idx: number) => Number(idx)).filter((idx: number) => Number.isInteger(idx) && idx >= 0)
        : [];
      setTotalGpus(total);
      setUsedGpuCount(used);
      setAvailableGpuIndices(availableIndices);
      setSelectedGpuIndices((prev) => prev.filter((idx) => availableIndices.includes(idx)));
    } catch (error) {
      console.error('Failed to fetch GPU resources', error);
      setTotalGpus(0);
      setUsedGpuCount(0);
      setAvailableGpuIndices([]);
      setSelectedGpuIndices([]);
      showToast(t('feedback.provisioning.loadTargetResourcesFailed'), 'error');
    }
  }, [showToast, t]);

  const fetchWorkerServers = useCallback(async () => {
    try {
      const res = await axios.get('worker-servers/');
      const workers = Array.isArray(res.data) ? (res.data as WorkerServerOption[]) : [];
      setWorkerServers(workers);
      if (executionTarget !== 'host' && !workers.some((worker) => worker.id === executionTarget)) {
        setExecutionTarget('host');
      }
    } catch (error) {
      console.error('Failed to fetch worker servers', error);
      setWorkerServers([]);
      if (executionTarget !== 'host') setExecutionTarget('host');
    }
  }, [executionTarget]);

  // Load template if provided
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = location.state as { templateConfig?: any };
    if (state && state.templateConfig) {
      const config = state.templateConfig;

      // Only load Dockerfile content
      if (config.dockerfile_content) {
        setUserDockerfile(normalizeDockerfile(stripManagedBlocks(config.dockerfile_content)));
        setErrors((prev) => ({ ...prev, dockerfile: undefined }));
      }

      // Clear state so refresh doesn't reload template
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    void fetchWorkerServers();
  }, [fetchWorkerServers]);

  useEffect(() => {
    void fetchGpuResources(executionTarget);
  }, [executionTarget, fetchGpuResources]);

  const handleAddGpuSelection = () => {
    const selectable = availableGpuIndices.filter((idx) => !selectedGpuIndices.includes(idx));
    if (selectable.length === 0) {
      showToast(t('feedback.provisioning.allocateGpuFailed'), 'error');
      return;
    }
    setSelectedGpuIndices((prev) => [...prev, selectable[0]]);
  };

  const handleRemoveGpuSelection = (index: number) => {
    setSelectedGpuIndices((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGpuSelectionChange = (index: number, gpuIndex: number) => {
    setSelectedGpuIndices((prev) => prev.map((value, i) => (i === index ? gpuIndex : value)));
  };

  const handleAddMount = () => {
    setMounts([...mounts, { host_path: '', container_path: '', mode: 'rw' }]);
  };

  const handleRemoveMount = (index: number) => {
    setMounts(mounts.filter((_, i) => i !== index));
    setMountErrors((prev) => {
      const next: Record<number, MountRowError> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const idx = Number(key);
        if (idx < index) next[idx] = value;
        if (idx > index) next[idx - 1] = value;
      });
      return next;
    });
  };

  const handleMountChange = (index: number, field: keyof MountPoint, value: string) => {
    const newMounts = [...mounts];
    // @ts-expect-error: indexing with dynamic field name
    newMounts[index][field] = value;
    setMounts(newMounts);
    if (field === 'host_path') {
      setMountErrors((prev) => {
        if (!prev[index]) return prev;
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  };

  const setMountError = (index: number, message: string, showSettingsCta = false) => {
    setMountErrors((prev) => ({ ...prev, [index]: { message, showSettingsCta } }));
  };

  const getBrowseErrorMessage = (code?: string, fallbackMessage?: string) => {
    if (code === 'ssh_not_configured') return { message: t('provisioning.errorHostConnectionSettingsRequired'), settings: true };
    if (code === 'ssh_auth_failed') return { message: t('provisioning.errorHostConnectionAuthFailed'), settings: true };
    if (code === 'ssh_host_key_failed') return { message: t('provisioning.errorHostConnectionHostKeyFailed'), settings: true };
    if (code === 'permission_denied') return { message: t('provisioning.errorHostPathPermissionDenied'), settings: false };
    if (code === 'path_not_found') return { message: t('provisioning.errorHostPathNotFound'), settings: false };
    return { message: fallbackMessage || t('provisioning.errorHostConnectionUnknown'), settings: false };
  };

  const handleOpenHostPathPicker = async (index: number) => {
    if (executionTarget !== 'host') return;
    if (checkingBrowseIndex !== null) return;
    setCheckingBrowseIndex(index);
    setMountErrors((prev) => {
      if (!prev[index]) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });

    try {
      const fetchSettingValue = async (key: string): Promise<string> => {
        try {
          const res = await axios.get(`settings/${key}`);
          return String(res.data?.value ?? '').trim();
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            return '';
          }
          throw error;
        }
      };

      // Step 1: check required SSH settings exist.
      const [sshHost, sshUser, authMethodRaw] = await Promise.all([
        fetchSettingValue('ssh_host'),
        fetchSettingValue('ssh_username'),
        fetchSettingValue('ssh_auth_method'),
      ]);
      const authMethod = (authMethodRaw || 'password').toLowerCase();
      const sshPassword = authMethod === 'password' ? await fetchSettingValue('ssh_password') : '';
      let browsePrivateKey: string | undefined;

      if (authMethod === 'key') {
        const encrypted = localStorage.getItem('ssh_private_key_encrypted') || '';
        if (!encrypted) {
          setMountError(index, t('provisioning.errorHostConnectionSettingsRequired'), true);
          return;
        }
        const passphrase = window.prompt(t('provisioning.hostPathBrowsePassphrasePrompt'))?.trim() || '';
        if (!passphrase) {
          setMountError(index, t('provisioning.errorHostConnectionMasterPassphraseRequired'), false);
          return;
        }
        try {
          browsePrivateKey = await decrypt(encrypted, passphrase);
        } catch {
          setMountError(index, t('provisioning.errorHostConnectionMasterPassphraseInvalid'), false);
          return;
        }
      }

      // Backend defaults missing ssh_port to 22, so port is not required in frontend precheck.
      const hasBasic = Boolean(sshHost && sshUser && authMethod);
      const hasAuth = authMethod === 'password' ? Boolean(sshPassword) : Boolean(browsePrivateKey);
      if (!hasBasic || !hasAuth) {
        setMountError(index, t('provisioning.errorHostConnectionSettingsRequired'), true);
        return;
      }

      // Step 2: verify real API connectivity before opening picker.
      const probePath = mounts[index]?.host_path?.trim() || '/';
      const res = await axios.post('filesystem/host/list', { path: probePath, privateKey: browsePrivateKey });
      if (res.data?.status === 'success') {
        setHostPathPickerPrivateKey(browsePrivateKey);
        setHostPathPickerIndex(index);
        return;
      }
      const mapped = getBrowseErrorMessage(res.data?.code, res.data?.message);
      setMountError(index, mapped.message, mapped.settings);
    } catch (error) {
      let code = '';
      let message = '';
      if (axios.isAxiosError(error)) {
        code = String(error.response?.data?.code || '');
        message = String(error.response?.data?.message || error.message || '');
      }
      const mapped = getBrowseErrorMessage(code, message);
      setMountError(index, mapped.message, mapped.settings);
    } finally {
      setCheckingBrowseIndex(null);
    }
  };

  const handleCloseHostPathPicker = () => {
    setHostPathPickerIndex(null);
    setHostPathPickerPrivateKey(undefined);
  };

  const goToSettingsForSsh = () => {
    navigate('/settings');
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

  const renderedDockerfile = useMemo(
    () => composeDockerfile(userDockerfile, enableJupyter, enableCodeServer),
    [userDockerfile, enableJupyter, enableCodeServer]
  );
  const managedBlocksText = useMemo(
    () => normalizeDockerfile(buildManagedBlocks(enableJupyter, enableCodeServer)),
    [enableJupyter, enableCodeServer]
  );
  // Error State
  const [errors, setErrors] = useState<{name?: string, password?: string, dockerfile?: string}>({});
  const selectArrowStyle = {
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27 fill=%27none%27%3E%3Cpath d=%27M2.5 4.5L6 8L9.5 4.5%27 stroke=%27%236b7280%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 0.85rem center',
    backgroundSize: '12px',
  };
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm';
    onConfirm?: (() => void) | null;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'alert',
    onConfirm: null,
  });

  const showAlert = (title: string, message: string) => {
    setModalConfig({
      isOpen: true,
      title,
      message,
      type: 'alert',
      onConfirm: null,
    });
  };

  const submitEnvironment = async () => {
    const validMounts = mounts.filter(m => m.host_path.trim() !== '' && m.container_path.trim() !== '');
    const userName = getStoredUserName();
    const prefixedName = buildPrefixedEnvironmentName(userName, name.trim());

    const payload = {
      name: prefixedName,
      worker_server_id: executionTarget === 'host' ? null : executionTarget,
      container_user: 'root',
      root_password: password,
      mount_config: validMounts,
      custom_ports: customPorts,
      dockerfile_content: renderedDockerfile,
      enable_jupyter: enableJupyter,
      enable_code_server: enableCodeServer,
      gpu_count: selectedGpuIndices.length,
      selected_gpu_indices: selectedGpuIndices,
    };

    // Relative path works thanks to Nginx proxy
    await axios.post('environments/', payload);
    navigate('/');
  };

  const handleSubmit = async () => {
    const newErrors: {name?: string, password?: string, dockerfile?: string} = {};
    const userNameValidation = validateUserName(getStoredUserName());
    if (userNameValidation.code !== 'ok') {
      newErrors.name = t('provisioning.errorUserNameRequired');
    }
    if (!name.trim()) {
        newErrors.name = t('provisioning.errorEnvironmentNameRequired');
    } else if (!/^[a-zA-Z0-9-]+$/.test(name)) {
        newErrors.name = t('provisioning.errorEnvironmentNameFormat');
    }
    if (!password.trim()) newErrors.password = t('provisioning.errorRootPasswordRequired');
    if (!userDockerfile.trim()) newErrors.dockerfile = t('provisioning.errorDockerfileRequired');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Clear errors if valid
    setErrors({});

    try {
      const envRes = await axios.get('environments/');
      const envs: EnvironmentSummary[] = Array.isArray(envRes.data) ? envRes.data : [];
      const selectedSet = new Set(selectedGpuIndices);
      const selectedWorkerId = executionTarget === 'host' ? null : executionTarget;
      const stoppedConflicts = envs
        .filter((env) => {
          if (env?.status !== 'stopped' || !Array.isArray(env.gpu_indices) || env.gpu_indices.length === 0) {
            return false;
          }
          if (executionTarget === 'host') {
            return !env.worker_server_id;
          }
          if (!selectedWorkerId) return false;
          return (env.worker_server_id || null) === selectedWorkerId;
        })
        .map((env) => {
          const overlap = (env.gpu_indices || [])
            .map((idx) => Number(idx))
            .filter((idx) => Number.isInteger(idx) && selectedSet.has(idx))
            .sort((a, b) => a - b);
          return {
            name: env.name || 'unknown',
            overlap,
          };
        })
        .filter((item) => item.overlap.length > 0);

      if (stoppedConflicts.length > 0) {
        const conflictMessage = stoppedConflicts
          .map((item) => t('provisioning.gpuStoppedConflictLine', { name: item.name, indices: item.overlap.join(', ') }))
          .join('\n');
        setModalConfig({
          isOpen: true,
          title: t('provisioning.gpuStoppedConfirmTitle'),
          message: `${conflictMessage}\n\n${t('provisioning.gpuStoppedConfirmMessage')}`,
          type: 'confirm',
          onConfirm: () => {
            void submitEnvironment();
          },
        });
        return;
      }

      await submitEnvironment();
    } catch (error) {
      console.error("Failed to create environment", error);
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        const code = typeof detail === 'object' && detail ? String(detail.code || '') : '';
        const message = typeof detail === 'object' && detail ? String(detail.message || '') : '';

        if (code === 'duplicate_environment_name') {
          setErrors((prev) => ({ ...prev, name: t('provisioning.errorEnvironmentNameDuplicate') }));
          return;
        }
        if (code === 'dockerfile_required') {
          setErrors((prev) => ({ ...prev, dockerfile: t('provisioning.errorDockerfileRequired') }));
          return;
        }
        if (code === 'gpu_already_allocated' || code === 'gpu_capacity_insufficient') {
          showToast(t('feedback.provisioning.allocateGpuFailed'), 'error');
          return;
        }
        if (code === 'invalid_gpu_selection') {
          showToast(detail?.message || t('feedback.provisioning.invalidGpuSelection'), 'error');
          return;
        }
        if (code === 'custom_host_port_conflict') {
          showToast(message || t('feedback.provisioning.allocateCustomPortFailed'), 'error');
          return;
        }
        if (
          code === 'duplicate_custom_host_port' ||
          code === 'duplicate_custom_container_port' ||
          code === 'reserved_container_port'
        ) {
          showToast(message || t('feedback.provisioning.allocateCustomPortFailed'), 'error');
          return;
        }
        if (code === 'port_allocation_failed') {
          showAlert(t('feedback.provisioning.creationFailedTitle'), t('feedback.provisioning.portAllocationFailed'));
          return;
        }
        if (code === 'task_enqueue_failed') {
          showAlert(t('feedback.provisioning.creationFailedTitle'), t('feedback.provisioning.taskEnqueueFailed'));
          return;
        }
        if (code === 'security_key_missing') {
          showAlert(t('feedback.provisioning.creationFailedTitle'), t('feedback.provisioning.securityKeyMissing'));
          return;
        }
        if (code === 'password_encryption_failed') {
          showAlert(t('feedback.provisioning.creationFailedTitle'), t('feedback.provisioning.passwordEncryptionFailed'));
          return;
        }
        if (code === 'password_decryption_failed') {
          showAlert(t('feedback.provisioning.creationFailedTitle'), t('feedback.provisioning.passwordDecryptionFailed'));
          return;
        }
      }
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
          const templateDockerfile = normalizeDockerfile(userDockerfile);

          // Only save Dockerfile content as requested
          const config = {
              dockerfile_content: templateDockerfile
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
    <div className="p-6 max-w-7xl mx-auto space-y-6 pb-16 relative">
      <Modal
          isOpen={modalConfig.isOpen}
          onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false, onConfirm: null }))}
          onConfirm={modalConfig.onConfirm ?? undefined}
          title={modalConfig.title}
          message={modalConfig.message}
          type={modalConfig.type}
      />
      <HostPathPickerModal
        isOpen={hostPathPickerIndex !== null}
        onClose={handleCloseHostPathPicker}
        initialPath={hostPathPickerIndex !== null ? mounts[hostPathPickerIndex]?.host_path : '/'}
        privateKey={hostPathPickerPrivateKey}
        onSelect={(selectedPath) => {
          if (hostPathPickerIndex === null) return;
          handleMountChange(hostPathPickerIndex, 'host_path', selectedPath);
          handleCloseHostPathPicker();
        }}
      />

      {/* Save Template Modal */}
      {isSaveModalOpen && (
        <OverlayPortal>
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
        </OverlayPortal>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-1 space-y-6">

          {/* Basic Info */}
          <section className="bg-[var(--bg-elevated)] p-6 rounded-xl border border-[var(--border)] space-y-4">
            <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
              <span className="w-1 h-5 bg-blue-500 rounded-full"></span>
              {t('provisioning.basicConfiguration')}
            </h3>

            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--text-muted)]">{t('provisioning.executionTarget')}</label>
              <select
                value={executionTarget}
                onChange={(e) => setExecutionTarget(e.target.value)}
                className="w-full appearance-none pr-10 bg-[var(--bg-soft)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[var(--text)] focus:outline-none focus:ring-1 focus:border-blue-500 focus:ring-blue-500"
                style={selectArrowStyle}
              >
                <option value="host">{t('provisioning.executionTargetHost')}</option>
                {workerServers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--text-muted)]">
                {executionTarget === 'host'
                  ? t('provisioning.executionTargetHostDescription')
                  : t('provisioning.executionTargetWorkerDescription')}
              </p>
            </div>

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
              <p className="text-xs text-[var(--text-muted)]">
                {t('provisioning.environmentNamePreview', {
                  value: buildPrefixedEnvironmentName(getStoredUserName(), (name || '...').trim()),
                })}
              </p>
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
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                <span className="w-1 h-5 bg-purple-500 rounded-full"></span>
                {t('provisioning.resourcesTitle')}
              </h3>
              <button onClick={handleAddGpuSelection} className="p-1 hover:bg-[var(--bg-soft)] rounded text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                <Plus size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {selectedGpuIndices.map((gpuIndex, idx) => (
                <div key={`${gpuIndex}-${idx}`} className="bg-[var(--bg-soft)] p-4 rounded-xl border border-[var(--border)] flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <select
                      value={gpuIndex}
                      onChange={(e) => handleGpuSelectionChange(idx, parseInt(e.target.value, 10))}
                      className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 cursor-pointer"
                    >
                      {availableGpuIndices.map((option) => {
                        const isChosenByOther = selectedGpuIndices.some((selected, selectedIdx) => selectedIdx !== idx && selected === option);
                        return (
                          <option key={option} value={option} disabled={isChosenByOther}>
                            {t('provisioning.gpuOption', { index: option })}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <button
                    onClick={() => handleRemoveGpuSelection(idx)}
                    className="p-2 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                    title={t('provisioning.removeGpu')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {selectedGpuIndices.length === 0 && (
                <p className="text-sm text-[var(--text-muted)] text-center py-4 bg-[var(--bg-soft)] rounded-lg border border-dashed border-[var(--border)]">
                  {t('provisioning.noGpuSelected')}
                </p>
              )}
            </div>

            <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-400">
              {t('provisioning.currentSystemUsage', { used: usedGpuCount, total: totalGpus || 0 })}
            </div>
          </section>

          <section className="bg-[var(--bg-elevated)] p-6 rounded-xl border border-[var(--border)] space-y-4">
            <h3 className="text-lg font-semibold text-[var(--text)] flex items-center gap-2">
              <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
              {t('provisioning.optionalServices')}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">{t('provisioning.optionalServicesDescription')}</p>
            <div className="space-y-3">
              <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5 cursor-pointer">
                <span className="text-sm text-[var(--text)]">{t('provisioning.enableJupyter')}</span>
                <input
                  type="checkbox"
                  checked={enableJupyter}
                  onChange={(e) => setEnableJupyter(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] bg-[var(--bg-elevated)] text-blue-600 focus:ring-blue-500"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5 cursor-pointer">
                <span className="text-sm text-[var(--text)]">{t('provisioning.enableCodeServer')}</span>
                <input
                  type="checkbox"
                  checked={enableCodeServer}
                  onChange={(e) => setEnableCodeServer(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] bg-[var(--bg-elevated)] text-blue-600 focus:ring-blue-500"
                />
              </label>
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
                                className={clsx(
                                  "w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pl-9 text-sm text-[var(--text)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all",
                                  executionTarget === 'host' ? 'pr-16' : 'pr-3'
                                )}
                            />
                            {executionTarget === 'host' && (
                              <button
                                type="button"
                                onClick={() => { void handleOpenHostPathPicker(idx); }}
                                disabled={checkingBrowseIndex !== null}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1 text-[10px] text-[var(--text)] hover:brightness-95 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {checkingBrowseIndex === idx ? <Loader2 size={10} className="animate-spin" /> : null}
                                {t('provisioning.hostPathBrowseButton')}
                              </button>
                            )}
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
                    {mountErrors[idx] && (
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-xs text-red-400">{mountErrors[idx].message}</p>
                        {mountErrors[idx].showSettingsCta && (
                          <button
                            type="button"
                            onClick={goToSettingsForSsh}
                            className="text-xs text-red-300 underline underline-offset-2 hover:text-red-200 transition-colors"
                          >
                            {t('provisioning.goToSettings')}
                          </button>
                        )}
                      </div>
                    )}
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
        <div
          className={clsx(
            "lg:col-span-2 flex flex-col h-[800px] bg-[var(--bg-elevated)] rounded-xl border overflow-hidden",
            errors.dockerfile ? "border-red-500/50" : "border-[var(--border)]"
          )}
        >
             <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg-soft)]">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-500/10 rounded-md">
                        <span className="text-blue-400 font-mono text-sm font-bold">{t('provisioning.dockerfile')}</span>
                    </div>
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
             {errors.dockerfile && (
               <div className="border-b border-red-500/20 bg-red-500/5 px-6 py-2">
                 <p className="text-xs text-red-400">{errors.dockerfile}</p>
               </div>
             )}
             <div className="flex-1 min-h-0 relative">
                <Editor
                    height="100%"
                    defaultLanguage="dockerfile"
                    theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
                    value={userDockerfile}
                    onChange={(value) => {
                      const nextValue = value ?? '';
                      setUserDockerfile(nextValue);
                      if (errors.dockerfile && nextValue.trim()) {
                        setErrors((prev) => ({ ...prev, dockerfile: undefined }));
                      }
                    }}
                    options={{
                        automaticLayout: true,
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
             {managedBlocksText.trim() && (
               <div className="border-t border-[var(--border)] bg-[var(--bg-soft)]">
                 <div className="px-6 py-3 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                   {t('provisioning.managedServiceBlocks')}
                 </div>
                 <div className="h-64 border-t border-[var(--border)]">
                   <Editor
                     height="100%"
                     defaultLanguage="dockerfile"
                     theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
                     value={managedBlocksText}
                     options={{
                       automaticLayout: true,
                       readOnly: true,
                       domReadOnly: true,
                       minimap: { enabled: false },
                       fontSize: 13,
                       lineNumbers: 'on',
                       scrollBeyondLastLine: false,
                       scrollbar: {
                         alwaysConsumeMouseWheel: false,
                       },
                       renderLineHighlight: 'none',
                       padding: { top: 12, bottom: 12 },
                       fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
                     }}
                   />
                 </div>
               </div>
             )}
        </div>
      </div>

      {/* Load Template Modal */}
      {isLoadModalOpen && (
        <OverlayPortal>
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
                                            setUserDockerfile(normalizeDockerfile(stripManagedBlocks(template.config.dockerfile_content)));
                                            setErrors((prev) => ({ ...prev, dockerfile: undefined }));
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
        </OverlayPortal>
      )}
    </div>
  );
}
