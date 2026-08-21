import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { Icon } from '../ui/Icon';
import { ToastContext, type ToastInput } from './toast-context';

interface Toast extends ToastInput {
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => {
      return current.filter((toast) => toast.id !== id);
    });
  }, []);

  const notify = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current.slice(-2), { ...input, id }]);
      window.setTimeout(() => {
        dismiss(id);
      }, 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-atomic="false" aria-live="polite" className="toast-region">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.tone ?? 'info'}`} key={toast.id} role="status">
            <span className="toast__icon">
              <Icon name={toast.tone === 'error' ? 'warning' : 'check'} size={18} />
            </span>
            <div className="toast__content">
              <strong>{toast.title}</strong>
              {toast.description ? <p>{toast.description}</p> : null}
            </div>
            <button
              aria-label="Dispensar notificação"
              onClick={() => {
                dismiss(toast.id);
              }}
              type="button"
            >
              <Icon name="close" size={17} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
