import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Icon } from './Icon';
import { EXIT_FALLBACK_MS, prefersReducedMotion, waitForExitAnimation } from './motion';
import { Text } from './Text';

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

interface ToastEntry extends Toast {
  /** Playing `modal-out`; retired on its `animationend` (spec §4.5). */
  leaving: boolean;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

/**
 * The 4px status rail. Written out literally, one class per type: Tailwind
 * scans source text, so an interpolated `bg-${type}` compiles to nothing.
 */
const RAIL_CLASS: Record<ToastType, string> = {
  info: 'bg-dusk',
  success: 'bg-moss',
  error: 'bg-terracotta',
};

interface ToastItemProps {
  toast: ToastEntry;
  closeLabel: string;
  onDismiss: (id: number) => void;
  onExited: (id: number) => void;
}

/**
 * One toast. Split out so each keeps its own node ref: the exit is retired via
 * `waitForExitAnimation` (motion.ts) — a NATIVE `animationend` listener plus a
 * fallback timer, shared with Modal. See that module for why a native
 * listener rather than React's `onAnimationEnd`.
 */
function ToastItem({ toast, closeLabel, onDismiss, onExited }: ToastItemProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { id, leaving } = toast;

  useEffect(() => {
    if (!leaving) return;
    return waitForExitAnimation(ref.current, () => onExited(id));
  }, [leaving, id, onExited]);

  return (
    <div
      ref={ref}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      className={`pointer-events-auto relative flex min-h-[44px] items-center gap-3 overflow-hidden rounded-lg border border-line bg-cream px-4 py-3 shadow-lg motion-reduce:animate-none ${
        leaving ? 'animate-[modal-out_160ms_ease-in]' : 'animate-[modal-in_240ms_var(--ease-spring)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-0 left-0 top-0 w-1 ${RAIL_CLASS[toast.type]}`}
      />
      <Text variant="bodyDense" className="min-w-0 flex-1">
        {toast.message}
      </Text>
      {toast.action && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(id);
          }}
          className="-my-1 shrink-0"
        >
          {toast.action.label}
        </Button>
      )}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={() => onDismiss(id)}
        className="-my-3 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink"
      >
        <Icon name="close-outline" size="row" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const { t } = useTranslation('common');
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      if (prefersReducedMotion()) {
        remove(id);
        return;
      }
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))
      );
      // Safety net for a browser that never fires `animationend`.
      window.setTimeout(() => remove(id), EXIT_FALLBACK_MS);
    },
    [remove]
  );

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', action?: ToastAction) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, type, action, leaving: false }]);
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
        className="pointer-events-none fixed z-50 flex flex-col gap-2 sm:bottom-6 sm:right-6 sm:w-[360px] max-sm:inset-x-4 max-sm:bottom-[calc(var(--nav-h,0px)+var(--nav-inset,0px)+16px)]"
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            closeLabel={t('close')}
            onDismiss={dismiss}
            onExited={remove}
          />
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
