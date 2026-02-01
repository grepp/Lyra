import Editor from '@monaco-editor/react';
import axios from 'axios';
import clsx from 'clsx';
import { FolderOpen, Play, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';

interface MountPoint {
  host_path: string;
  container_path: string;
  mode: 'rw' | 'ro';
}

export default function Provisioning() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('admin');

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

  // Fetch GPU Resources
  useEffect(() => {
    axios.get('/resources/gpu')
      .then(res => {
         setMaxGpus(res.data.available);
         setTotalGpus(res.data.total);
         // Default to 1 if available, otherwise 0
         setGpuCount(res.data.available > 0 ? 1 : 0);
      })
      .catch(err => console.error("Failed to fetch GPU resources", err));
  }, []);

  const [dockerfile, setDockerfile] = useState('FROM python:3.11-slim\n\n');

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

  // Error State
  const [errors, setErrors] = useState<{name?: string, password?: string}>({});

  const handleSubmit = async () => {
    const newErrors: {name?: string, password?: string} = {};
    if (!name.trim()) newErrors.name = "Environment name is required.";
    if (!password.trim()) newErrors.password = "Root password is required.";

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
        dockerfile_content: dockerfile
      };

      // Relative path works thanks to Nginx proxy
      await axios.post('/environments/', payload);

      navigate('/');
    } catch (error) {
      console.error("Failed to create environment", error);
      showAlert("Creation Failed", "Failed to create environment. Check console for details.");
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
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">New Environment</h2>
          <p className="text-gray-400 mt-1">Configure your GPU instance and build environment.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg flex items-center gap-2 font-medium shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]"
          >
            <Play size={18} fill="currentColor" />
            <span>Build & Run</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-1 space-y-6">

          {/* Basic Info */}
          <section className="bg-[#18181b] p-6 rounded-xl border border-[#27272a] space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-1 h-5 bg-blue-500 rounded-full"></span>
              Basic Configuration
            </h3>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-400">Environment Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. llm-finetuning-v1"
                className={clsx(
                  "w-full bg-[#27272a] border rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-1 transition-all",
                  errors.name
                    ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
                    : "border-[#3f3f46] focus:border-blue-500 focus:ring-blue-500"
                )}
              />
              {errors.name && (
                <p className="text-xs text-red-400 mt-1">{errors.name}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-400">Root Password</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={clsx(
                  "w-full bg-[#27272a] border rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-1 transition-all font-mono",
                  errors.password
                    ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
                    : "border-[#3f3f46] focus:border-blue-500 focus:ring-blue-500"
                )}
              />
              {errors.password && (
                <p className="text-xs text-red-400 mt-1">{errors.password}</p>
              )}
            </div>
          </section>

          {/* Resources */}
          <section className="bg-[#18181b] p-6 rounded-xl border border-[#27272a] space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-1 h-5 bg-purple-500 rounded-full"></span>
              Resources
            </h3>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                  <label className="text-sm font-medium text-gray-400">GPU Allocation</label>
                  <span className="text-2xl font-bold text-purple-400">{gpuCount} <span className="text-sm font-normal text-gray-500">GPUs</span></span>
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
                      "w-full h-2 rounded-lg appearance-none border border-[#3f3f46]",
                      (!maxGpus || maxGpus === 0) ? "bg-[#27272a] cursor-not-allowed" : "bg-[#27272a] cursor-pointer accent-purple-500"
                    )}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-2">
                      <span>0</span>
                      <span>{maxGpus || 0} (Max Available)</span>
                  </div>
              </div>

              <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-300">
                 Current System Usage: {(totalGpus || 0) - (maxGpus || 0)} / {totalGpus || 0} GPUs active
              </div>
            </div>
          </section>

          {/* Storage */}
          <section className="bg-[#18181b] p-6 rounded-xl border border-[#27272a] space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-1 h-5 bg-green-500 rounded-full"></span>
                Storage Mounts
                </h3>
                <button onClick={handleAddMount} className="p-1 hover:bg-[#27272a] rounded text-gray-400 hover:text-white transition-colors">
                    <Plus size={18} />
                </button>
            </div>

            <div className="space-y-3">
              {mounts.map((mount, idx) => (
                <div key={idx} className="bg-[#27272a]/50 p-4 rounded-xl border border-[#3f3f46] space-y-3 group transition-all hover:border-[#4f4f5a]">
                    <div className="flex gap-2 items-center">
                        <div className="flex-1 relative min-w-0">
                             <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                placeholder="Host Path (e.g. /home/user/data)"
                                value={mount.host_path}
                                onChange={(e) => handleMountChange(idx, 'host_path', e.target.value)}
                                className="w-full bg-[#18181b] border border-[#3f3f46] rounded-lg px-3 py-2 pl-9 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all"
                            />
                        </div>
                        <button
                            onClick={() => handleRemoveMount(idx)}
                            className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                            title="Remove mount"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                    <div className="flex gap-2 items-center">
                        <div className="w-8 flex justify-center">
                            <span className="text-gray-600 font-mono">:</span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <input
                                 placeholder="Container Path (e.g. /data)"
                                 value={mount.container_path}
                                 onChange={(e) => handleMountChange(idx, 'container_path', e.target.value)}
                                 className="w-full bg-[#18181b] border border-[#3f3f46] rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all"
                            />
                        </div>
                        <div className="w-20 shrink-0">
                            <select
                                value={mount.mode}
                                onChange={(e) => handleMountChange(idx, 'mode', e.target.value)}
                                className="w-full bg-[#18181b] border border-[#3f3f46] rounded-lg px-2 py-2 text-xs text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 cursor-pointer"
                            >
                                <option value="rw">RW</option>
                                <option value="ro">RO</option>
                            </select>
                        </div>
                    </div>
                </div>
              ))}
              {mounts.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4 bg-[#27272a]/50 rounded-lg border border-dashed border-[#3f3f46]">
                    No volumes mounted
                </p>
              )}
            </div>
          </section>

        </div>

        {/* Right Column: Dockerfile Editor */}
        <div className="lg:col-span-2 flex flex-col h-[800px] bg-[#18181b] rounded-xl border border-[#27272a] overflow-hidden">
             <div className="px-6 py-4 border-b border-[#27272a] flex justify-between items-center bg-[#27272a]/30">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-500/10 rounded-md">
                        <span className="text-blue-400 font-mono text-sm font-bold">Dockerfile</span>
                    </div>
                    <span className="text-sm text-gray-400">Build Configuration</span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => showAlert("Coming Soon", "Template loading functionality will be implemented soon.")}
                        className="px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-gray-300 hover:text-white rounded-md flex items-center gap-2 transition-colors border border-[#3f3f46] text-xs font-medium"
                    >
                        <Upload size={14} />
                        <span>Load</span>
                    </button>
                    <button
                        onClick={() => showAlert("Coming Soon", "Template saving functionality will be implemented soon.")}
                        className="px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-gray-300 hover:text-white rounded-md flex items-center gap-2 transition-colors border border-[#3f3f46] text-xs font-medium"
                    >
                        <Save size={14} />
                        <span>Save</span>
                    </button>
                </div>
             </div>

             <div className="flex-1 relative">
                <Editor
                    height="100%"
                    defaultLanguage="dockerfile"
                    theme="vs-dark"
                    value={dockerfile}
                    onChange={(value) => setDockerfile(value || '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        scrollBeyondLastLine: false,
                        padding: { top: 20, bottom: 20 },
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
                    }}
                />
             </div>
        </div>
      </div>
    </div>
  );
}
