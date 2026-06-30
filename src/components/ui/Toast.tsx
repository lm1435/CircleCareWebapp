import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

export type ToastType = 'info' | 'success' | 'error';

/** Optional inline action rendered as a button inside the toast (e.g. "Upgrade"). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

const typeClass: Record<ToastType, string> = {
  info: 'border-line bg-cream text-ink',
  success: 'border-moss/40 bg-cream text-moss-deep',
  error: 'border-terracotta/40 bg-cream text-terracotta-deep',
};

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const { t } = useTranslation('common');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', action?: ToastAction) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, type, action }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-atomic="false"
        className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 max-w-[calc(100vw-3rem)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
            className={`pointer-events-auto flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm shadow-lg ${typeClass[toast.type]}`}
          >
            <div className="m-0 flex min-w-0 flex-col gap-2">
              <p className="m-0">{toast.message}</p>
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss(toast.id);
                  }}
                  className="w-fit rounded-full bg-terracotta-deep px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label={t('close')}
              onClick={() => dismiss(toast.id)}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full leading-none text-ink-3 hover:text-ink"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
