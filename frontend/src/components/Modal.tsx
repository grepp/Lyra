import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm">
            <div className="w-full max-w-md scale-100 transform rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] opacity-100 shadow-2xl transition-all animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between border-b border-[var(--border)] p-6">
                    <h3 className="text-lg font-bold text-[var(--text)]">{title}</h3>
                    <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">
                    <p className="text-[var(--text-muted)]">{message}</p>
                </div>
                <div className="flex justify-end gap-3 rounded-b-xl border-t border-[var(--border)] bg-[var(--bg-soft)] p-6">
                    {type === 'confirm' && (
                        <button
                            onClick={onClose}
                            className="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] px-4 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:brightness-95"
                        >
                            {t('actions.cancel')}
                        </button>
                    )}
                    <button
                        onClick={() => {
                            if (onConfirm) onConfirm();
                            onClose();
                        }}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors shadow-lg ${
                            isDestructive
                            ? "bg-[var(--danger)] text-[var(--primary-contrast)] hover:brightness-110"
                            : "bg-[var(--primary)] text-[var(--primary-contrast)] hover:brightness-110"
                        }`}
                    >
                        {type === 'confirm' ? t('actions.confirm') : t('actions.ok')}
                    </button>
                </div>
            </div>
        </div>
    );
}
