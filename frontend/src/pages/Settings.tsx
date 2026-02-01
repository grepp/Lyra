import { AlertCircle, CheckCircle2, Save } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';

export default function Settings() {
  const { appName, setAppName, isLoading } = useApp();
  const [localAppName, setLocalAppName] = useState(appName);
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' });

  useEffect(() => {
    setLocalAppName(appName);
  }, [appName]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localAppName.trim()) {
      setStatus({ type: 'error', message: 'Application name cannot be empty.' });
      return;
    }

    try {
      setStatus({ type: 'loading' });
      await setAppName(localAppName);
      setStatus({ type: 'success', message: 'Application name updated successfully!' });

      // Reset status after a few seconds
      setTimeout(() => {
        setStatus({ type: 'idle' });
      }, 3000);
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: 'Failed to update application name. Please try again.' });
    }
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-white">Settings</h2>
        <p className="text-gray-400 mt-1">Configure your application preferences</p>
      </div>

      <div className="space-y-6">
        {/* Branding Section */}
        <section className="bg-[#27272a] rounded-xl border border-[#3f3f46] overflow-hidden shadow-xl">
          <div className="p-6 border-b border-[#3f3f46]">
            <h3 className="text-xl font-semibold text-white">General</h3>
            <p className="text-sm text-gray-400 mt-1">Configure general application identifiers and preferences.</p>
          </div>

          <form onSubmit={handleSaveName} className="p-6 space-y-4">
            <div>
              <label htmlFor="appName" className="block text-sm font-medium text-gray-300 mb-2">
                Application Name
              </label>
              <div className="flex gap-4">
                <input
                  id="appName"
                  type="text"
                  value={localAppName}
                  onChange={(e) => setLocalAppName(e.target.value)}
                  disabled={isLoading || status.type === 'loading'}
                  placeholder="Enter application name (e.g., My GPU Lab)"
                  className="flex-1 bg-[#18181b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isLoading || status.type === 'loading' || localAppName === appName}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white px-6 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
                >
                  {status.type === 'loading' ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save size={18} />
                  )}
                  Save Changes
                </button>
              </div>

              {/* Status Messages */}
              {status.message && (
                <div className={`mt-4 flex items-center gap-2 text-sm ${
                  status.type === 'success' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {status.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  {status.message}
                </div>
              )}
            </div>

            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 mt-4">
              <p className="text-xs text-blue-300 leading-relaxed">
                <strong>Note:</strong> Changing the application name will update the sidebar logo and title across the entire platform.
                Individual environment names will remain unchanged.
              </p>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
