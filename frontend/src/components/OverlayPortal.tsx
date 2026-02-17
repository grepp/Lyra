import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface OverlayPortalProps {
  children: ReactNode;
  className?: string;
}

export default function OverlayPortal({ children, className = '' }: OverlayPortalProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm ${className}`.trim()}>
      {children}
    </div>,
    document.body
  );
}
