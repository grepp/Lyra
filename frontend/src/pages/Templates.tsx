import Editor from '@monaco-editor/react';
import axios from 'axios';
import { AlertCircle, Clock, Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
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
  const { t, i18n } = useTranslation();
  const { resolvedTheme } = useTheme();
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
          title: t('templates.deleteTemplateTitle'),
          message: t('templates.deleteTemplateMessage', { name }),
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm">
            <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-[var(--border)] flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-bold text-[var(--text)]">{selectedTemplate.name}</h3>
                        <div className="flex items-center gap-2 mt-2 text-sm text-[var(--text-muted)]">
                             <Clock size={14} />
                             <span>{t('templates.createdAt', { value: new Date(selectedTemplate.created_at).toLocaleString(i18n.language) })}</span>
                        </div>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {selectedTemplate.description && (
                         <div className="space-y-2">
                            <h4 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">{t('templates.description')}</h4>
                            <p className="text-[var(--text)] bg-[var(--bg-soft)] p-3 rounded-lg border border-[var(--border)]">
                                {selectedTemplate.description}
                            </p>
                        </div>
                    )}

                    <div className="space-y-4">

                        {selectedTemplate.config.dockerfile_content && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">{t('templates.dockerfile')}</h4>
                                <div className="h-64 rounded-lg border border-[var(--border)] overflow-hidden">
                                     <Editor
                                        height="100%"
                                        defaultLanguage="dockerfile"
                                        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
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

                <div className="p-4 border-t border-[var(--border)] flex justify-end gap-3 bg-[var(--bg-soft)]">
                    <button
                        onClick={() => setSelectedTemplate(null)}
                        className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text)] hover:brightness-95 transition-colors"
                    >
                        {t('actions.close')}
                    </button>
                    <button
                        onClick={() => handleLoad(selectedTemplate)}
                        className="px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2"
                    >
                        <Play size={16} /> {t('templates.loadTemplate')}
                    </button>
                </div>
            </div>
        </div>
      )}

      <header>
        <h2 className="text-3xl font-bold text-[var(--text)] tracking-tight">{t('templates.title')}</h2>
        <p className="text-[var(--text-muted)] mt-1">{t('templates.subtitle')}</p>
      </header>

      {isLoading ? (
          <div className="text-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--text)] mx-auto mb-4"></div>
              <p className="text-[var(--text-muted)]">{t('templates.loadingTemplates')}</p>
          </div>
      ) : templates.length === 0 ? (
          <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-12 text-center text-[var(--text-muted)] flex flex-col items-center gap-4">
            <div className="p-4 bg-[var(--bg-soft)] rounded-full">
                <AlertCircle size={32} className="text-amber-500" />
            </div>
            <div>
                <h3 className="text-lg font-semibold text-[var(--text)] mb-1">{t('templates.noTemplatesTitle')}</h3>
                <p>{t('templates.noTemplatesMessage')}</p>
            </div>
            <button
                onClick={() => navigate('/provisioning')}
                className="mt-2 px-6 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] hover:brightness-95 transition-colors"
            >
                {t('templates.goToProvisioning')}
            </button>
          </div>
      ) : (
        <div className="space-y-4">
          {templates.map((template) => (
            <div key={template.id} className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between group transition-all hover:brightness-95">

              <div className="flex items-center gap-4 flex-1 min-w-0 pointer-events-none">

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-[var(--text)] truncate">{template.name}</h3>
                        <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] bg-[var(--bg-soft)] px-2 py-0.5 rounded border border-[var(--border)]">
                            <Clock size={10} />
                            {new Date(template.created_at).toLocaleDateString(i18n.language)}
                        </div>
                    </div>
                    <p className="text-sm text-[var(--text-muted)] truncate mt-0.5">
                        {template.description}
                    </p>
                </div>
              </div>

              <div className="flex items-center gap-3 ml-6 shrink-0">
                  <button
                      onClick={() => setSelectedTemplate(template)}
                      className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] hover:brightness-95 flex items-center gap-2 transition-all"
                  >
                      {t('templates.view')}
                  </button>
                  <button
                      onClick={() => handleDeleteClick(template.id, template.name)}
                      className="p-2 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title={t('templates.deleteTemplate')}
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
