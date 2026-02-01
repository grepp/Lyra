import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm?: () => void;
    title: string;
    message: string;
    type?: 'confirm' | 'alert';
    isDestructive?: boolean;
}

export default function Modal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    type = 'confirm',
    isDestructive = false
}: ModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-[#18181b] border border-[#3f3f46] rounded-xl w-full max-w-md shadow-2xl transform transition-all scale-100 opacity-100 animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center p-6 border-b border-[#3f3f46]">
                    <h3 className="text-lg font-bold text-white">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">
                    <p className="text-gray-300">{message}</p>
                </div>
                <div className="flex justify-end gap-3 p-6 bg-[#27272a]/50 rounded-b-xl border-t border-[#3f3f46]">
                    {type === 'confirm' && (
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-[#3f3f46] hover:bg-[#52525b] rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        onClick={() => {
                            if (onConfirm) onConfirm();
                            onClose();
                        }}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors shadow-lg ${
                            isDestructive
                            ? "bg-red-600 hover:bg-red-500 shadow-red-600/20"
                            : "bg-blue-600 hover:bg-blue-500 shadow-blue-600/20"
                        }`}
                    >
                        {type === 'confirm' ? 'Confirm' : 'OK'}
                    </button>
                </div>
            </div>
        </div>
    );
}
