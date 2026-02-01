import clsx from 'clsx';
import { CheckCircle, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  onClose: (id: string) => void;
}

export default function Toast({ id, message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, 3000);

    return () => clearTimeout(timer);
  }, [id, onClose]);

  return (
    <div
      className={clsx(
        "flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-md transition-all animate-in slide-in-from-right-full duration-300",
        type === 'success' && "bg-green-500/10 border-green-500/20 text-green-200",
        type === 'error' && "bg-red-500/10 border-red-500/20 text-red-200",
        type === 'info' && "bg-blue-500/10 border-blue-500/20 text-blue-200"
      )}
      role="alert"
    >
      <div className="shrink-0">
        {type === 'success' && <CheckCircle size={18} className="text-green-500" />}
        {type === 'error' && <XCircle size={18} className="text-red-500" />}
        {type === 'info' && <Info size={18} className="text-blue-500" />}
      </div>
      <p className="text-sm font-medium">{message}</p>
      <button
        onClick={() => onClose(id)}
        className={clsx(
          "ml-4 p-1 rounded-md transition-colors hover:bg-white/10",
          type === 'success' && "text-green-400 hover:text-green-100",
          type === 'error' && "text-red-400 hover:text-red-100",
          type === 'info' && "text-blue-400 hover:text-blue-100"
        )}
      >
        <X size={14} />
      </button>
    </div>
  );
}
