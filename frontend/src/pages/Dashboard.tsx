import axios from 'axios';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';

interface Environment {
  id: string;
  name: string;
  status: string;
  gpu_indices: number[];
  ssh_port: number;
  jupyter_port: number;
  created_at: string;
}

export default function Dashboard() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchEnvironments = async () => {
    try {
      setLoading(true);
      const res = await axios.get('environments/');
      setEnvironments(res.data);
    } catch (error) {
      console.error("Failed to fetch environments", error);
    } finally {
      setLoading(false);
    }
  };

  const deleteEnvironment = async () => {
    if (!deleteId) return;
    try {
        await axios.delete(`environments/${deleteId}`);
        fetchEnvironments();
    } catch (error) {
        console.error("Failed to delete environment", error);
        // Could also add an error modal here
    }
    setDeleteId(null);
  };

  useEffect(() => {
    fetchEnvironments();
    const interval = setInterval(fetchEnvironments, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 space-y-8 relative">
      <Modal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={deleteEnvironment}
        title="Delete Environment"
        message="Are you sure you want to delete this environment? This action cannot be undone and will permanently remove the container and data."
        isDestructive={true}
      />

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-white">Dashboard</h2>
          <p className="text-gray-400 mt-1">Manage your GPU virtual environments</p>
      </div>
      <Link to="/provisioning" className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-blue-600/20">
          Create Environment
      </Link>
    </div>


      <div className="bg-[#27272a] rounded-xl border border-[#3f3f46] overflow-hidden">
        <div className="p-6 border-b border-[#3f3f46] flex justify-between items-center">
            <h3 className="text-xl font-bold text-white">Instances</h3>
            <button onClick={fetchEnvironments} className="p-2 hover:bg-[#3f3f46] rounded-full text-gray-400 transition-colors">
                <RefreshCw size={18} className={loading && environments.length > 0 ? "animate-spin" : ""} />
            </button>
        </div>
        <div className="w-full text-left">
            {loading && environments.length === 0 ? (
                 <div className="p-8 text-center text-gray-500">Loading environments...</div>
            ) : environments.length === 0 ? (
                 <div className="p-8 text-center text-gray-500">No environments found. Create one to get started.</div>
            ) : (
                <table className="w-full">
                    <thead className="bg-[#18181b] text-gray-400 text-sm uppercase">
                        <tr>
                            <th className="px-6 py-4 font-medium">Name</th>
                            <th className="px-6 py-4 font-medium">Status</th>
                            <th className="px-6 py-4 font-medium">Ports (SSH/Jupyter)</th>
                            <th className="px-6 py-4 font-medium">GPU</th>
                            <th className="px-6 py-4 font-medium text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#3f3f46]">
                        {environments.map((env) => (
                            <tr key={env.id} className="hover:bg-[#3f3f46]/50 transition-colors">
                                <td className="px-6 py-4 text-white font-medium">{env.name}</td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                        env.status === 'running' ? 'bg-green-500/10 text-green-500' :
                                        env.status === 'building' ? 'bg-yellow-500/10 text-yellow-500' :
                                        'bg-red-500/10 text-red-500'
                                    }`}>
                                        {env.status.charAt(0).toUpperCase() + env.status.slice(1)}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-gray-300">
                                    {env.ssh_port} / {env.jupyter_port}
                                </td>
                                <td className="px-6 py-4 text-gray-300">
                                    {env.gpu_indices.length > 0 ? env.gpu_indices.join(', ') : "-"}
                                </td>
                                <td className="px-6 py-4 text-right space-x-2">
                                    <button
                                        onClick={() => setDeleteId(env.id)}
                                        className="p-2 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-red-400 transition-colors"
                                        title="Delete"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
      </div>
    </div>
  );
}
