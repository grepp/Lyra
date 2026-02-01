import Editor from '@monaco-editor/react';
import axios from 'axios';
import { Clock, FileCode, Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';

interface Template {
  id: string;
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  created_at: string;
}

export default function Templates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [modalConfig, setModalConfig] = useState({
      isOpen: false,
      title: '',
      message: '',
      type: 'alert' as 'alert' | 'confirm',
      onConfirm: () => {}
  });

  const fetchTemplates = async () => {
    try {
      setIsLoading(true);
      const res = await axios.get('templates/');
      setTemplates(res.data);
    } catch (error) {
      console.error("Failed to fetch templates", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleDeleteClick = (id: string, name: string) => {
      setModalConfig({
          isOpen: true,
          title: 'Delete Template',
          message: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
          type: 'confirm',
          onConfirm: () => handleDelete(id)
      });
  };

  const handleDelete = async (id: string) => {
      try {
          await axios.delete(`templates/${id}`);
          fetchTemplates();
      } catch (error) {
          console.error("Failed to delete template", error);
      } finally {
          setModalConfig(prev => ({ ...prev, isOpen: false }));
      }
  };

  const handleLoad = (template: Template) => {
      navigate('/provisioning', { state: { templateConfig: template.config } });
  };

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 relative">
      <Modal
          isOpen={modalConfig.isOpen}
          onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
          title={modalConfig.title}
          message={modalConfig.message}
          type={modalConfig.type}
          onConfirm={modalConfig.onConfirm}
      />

      {/* Template Details Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-[#18181b] rounded-xl border border-[#3f3f46] shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-[#27272a] flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-bold text-white">{selectedTemplate.name}</h3>
                        <div className="flex items-center gap-2 mt-2 text-sm text-gray-400">
                             <Clock size={14} />
                             <span>Created {new Date(selectedTemplate.created_at).toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {selectedTemplate.description && (
                         <div className="space-y-2">
                            <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Description</h4>
                            <p className="text-gray-300 bg-[#27272a]/50 p-3 rounded-lg border border-[#3f3f46]">
                                {selectedTemplate.description}
                            </p>
                        </div>
                    )}

                    <div className="space-y-4">

                        {selectedTemplate.config.dockerfile_content && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Dockerfile</h4>
                                <div className="h-64 rounded-lg border border-[#3f3f46] overflow-hidden">
                                     <Editor
                                        height="100%"
                                        defaultLanguage="dockerfile"
                                        theme="vs-dark"
                                        value={selectedTemplate.config.dockerfile_content}
                                        options={{
                                            readOnly: true,
                                            minimap: { enabled: false },
                                            fontSize: 13,
                                            padding: { top: 16, bottom: 16 },
                                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                            scrollBeyondLastLine: false
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-[#3f3f46] flex justify-end gap-3 bg-[#27272a]/50">
                    <button
                        onClick={() => setSelectedTemplate(null)}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-[#3f3f46] transition-colors"
                    >
                        Close
                    </button>
                    <button
                        onClick={() => handleLoad(selectedTemplate)}
                        className="px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2"
                    >
                        <Play size={16} /> Load Template
                    </button>
                </div>
            </div>
        </div>
      )}

      <header>
        <h2 className="text-3xl font-bold text-white tracking-tight">Templates</h2>
        <p className="text-gray-400 mt-1">Manage your saved environment configurations.</p>
      </header>

      {isLoading ? (
          <div className="text-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
              <p className="text-gray-400">Loading templates...</p>
          </div>
      ) : templates.length === 0 ? (
          <div className="bg-[#18181b] rounded-xl border border-[#27272a] p-12 text-center text-gray-400 flex flex-col items-center gap-4">
            <div className="p-4 bg-[#27272a] rounded-full">
                <FileCode size={32} className="text-gray-500" />
            </div>
            <div>
                <h3 className="text-lg font-semibold text-white mb-1">No Templates Found</h3>
                <p>Save your favorite configurations in the Provisioning tab.</p>
            </div>
            <button
                onClick={() => navigate('/provisioning')}
                className="mt-2 px-6 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded-lg text-sm font-medium transition-colors"
            >
                Go to Provisioning
            </button>
          </div>
      ) : (
        <div className="space-y-4">
          {templates.map((template) => (
            <div key={template.id} className="bg-[#18181b] rounded-xl border border-[#27272a] p-4 flex items-center justify-between group hover:border-[#3f3f46] transition-all hover:bg-[#202023]">

              <div className="flex items-center gap-4 flex-1 min-w-0 pointer-events-none">
                <div className="p-3 bg-blue-500/10 rounded-lg text-blue-400 shrink-0">
                    <FileCode size={24} />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-white truncate">{template.name}</h3>
                        <div className="flex items-center gap-1 text-xs text-gray-500 bg-[#27272a] px-2 py-0.5 rounded border border-[#3f3f46]">
                            <Clock size={10} />
                            {new Date(template.created_at).toLocaleDateString()}
                        </div>
                    </div>
                    <p className="text-sm text-gray-400 truncate mt-0.5">
                        {template.description}
                    </p>
                </div>
              </div>

              <div className="flex items-center gap-3 ml-6 shrink-0">
                  <button
                      onClick={() => setSelectedTemplate(template)}
                      className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] border border-[#3f3f46] hover:border-gray-500/50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
                  >
                      View
                  </button>
                  <button
                      onClick={() => handleDeleteClick(template.id, template.name)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Delete Template"
                  >
                      <Trash2 size={18} />
                  </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
