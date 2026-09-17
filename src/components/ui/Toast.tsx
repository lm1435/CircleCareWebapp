import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
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
 * Every control of the toast on screen that is not on its way out. An open
 * Modal appends these to the END of its Tab cycle (Modal.tsx) — the region is
 * outside every dialog, so without that a keyboard user could never reach a
 * toast's action (e.g. the premium gate's "Upgrade") while a dialog is up.
 */
export const TOAST_CONTROL_SELECTOR =
  '[data-toast-region] > [data-toast]:not([data-leaving]) button';

/**
 * The 4px status rail. Written out literally, one class per type: Tailwind
 * scans source text, so an interpolated `bg-${type}` compiles to nothing.
 */
const RAIL_CLASS: Record<ToastType, string> = {
  info: 'bg-dusk',
  success: 'bg-moss',
  error: 'bg-terracotta',
};

/**
 * A pointer press on a toast control must not MOVE focus. The region lives
 * outside any dialog, and the toast is removed on click: letting the press
 * focus its button pulled focus out of an open Modal and then stranded it on
 * `<body>` when the node went — outside the Modal's focus-recovery watch, so
 * Escape and the Tab trap stopped working. The click itself still fires, and
 * keyboard activation (Tab to it, Enter/Space) is unaffected.
 */
function keepFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

interface ToastItemProps {
  toast: ToastEntry;
  closeLabel: string;
  moreLabel: string;
  onDismiss: (id: number) => void;
  onExited: (id: number) => void;
}

/**
 * One toast. Split out so each keeps its own node ref: the exit is retired via
 * `waitForExitAnimation` (motion.ts) — a NATIVE `animationend` listener plus a
 * fallback timer, shared with Modal. See that module for why a native
 * listener rather than React's `onAnimationEnd`.
 *
 * LONG COPY IS CLAMPED TO TWO LINES, VISUALLY ONLY. A toast floats over the
 * page or an open dialog, so its height is the thing that decides what it
 * covers: an unclamped ~150-character Spanish error grew to 242px at 360x640
 * and sat on every field of the dialog behind it. Two lines is what fits above
 * a full-height dialog's body at every tested viewport
 * (e2e/unhappy/writes/toast-modal-overlap.spec.ts). The clamp is CSS
 * (`line-clamp-2`), so the full message is still in the DOM — the live region
 * announces all of it, never the truncation. When the text really is cut off
 * (measured, not guessed from length), an invisible "More" button over the
 * message expands it in place; an expanded toast also stops its auto-dismiss,
 * since the reader asked for time to read it. So does focus inside the toast:
 * a keyboard user tabbing to "Upgrade" must not have it vanish mid-Tab.
 */
function ToastItem({
  toast,
  closeLabel,
  moreLabel,
  onDismiss,
  onExited,
}: ToastItemProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const messageBoxRef = useRef<HTMLDivElement>(null);
  const messageId = useId();
  const { id, leaving } = toast;
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!leaving) return;
    return waitForExitAnimation(ref.current, () => onExited(id));
  }, [leaving, id, onExited]);

  // Auto-dismiss, paused while the reader holds the toast (expanded, or focus
  // inside it) and restarted in full when they let go.
  const held = expanded || focused;
  useEffect(() => {
    if (leaving || held) return;
    const timer = window.setTimeout(() => onDismiss(id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, held, id, onDismiss]);

  // Is the clamp actually hiding text? Measured while collapsed (an expanded
  // message is by definition not clipped, and must keep its toggle to collapse).
  useLayoutEffect(() => {
    if (expanded) return;
    const message = messageBoxRef.current?.firstElementChild as HTMLElement | null;
    if (!message) return;
    const measure = (): void => setClamped(message.scrollHeight > message.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(message);
    return () => observer.disconnect();
  }, [toast.message, expanded]);

  return (
    <div
      ref={ref}
      data-toast=""
      data-leaving={leaving ? '' : undefined}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      onFocus={() => setFocused(true)}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className={`pointer-events-auto relative flex min-h-[44px] items-center gap-x-3 overflow-hidden rounded-lg border border-line bg-cream px-4 py-3 shadow-lg max-sm:py-2 motion-reduce:animate-none ${
        expanded ? 'flex-wrap gap-y-1' : ''
      } ${leaving ? 'animate-[modal-out_160ms_ease-in]' : 'animate-[modal-in_240ms_var(--ease-spring)]'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-0 left-0 top-0 w-1 ${RAIL_CLASS[toast.type]}`}
      />
      <div
        ref={messageBoxRef}
        data-toast-message=""
        className={expanded ? 'relative min-w-0 basis-full' : 'relative min-w-0 flex-1'}
      >
        <Text
          id={messageId}
          variant="bodyDense"
          className={expanded ? 'break-words' : 'line-clamp-2 break-words'}
        >
          {toast.message}
        </Text>
        {(clamped || expanded) && (
          <button
            type="button"
            aria-label={moreLabel}
            aria-expanded={expanded}
            aria-controls={messageId}
            onMouseDown={keepFocus}
            onClick={() => setExpanded((open) => !open)}
            className="absolute inset-0 cursor-pointer rounded-md"
          />
        )}
      </div>
      {toast.action && (
        <Button
          variant="ghost"
          size="sm"
          onMouseDown={keepFocus}
          onClick={() => {
            toast.action?.onClick();
            onDismiss(id);
          }}
          className={expanded ? '-my-1 ml-auto shrink-0' : '-my-1 shrink-0'}
        >
          {toast.action.label}
        </Button>
      )}
      <button
        type="button"
        aria-label={closeLabel}
        onMouseDown={keepFocus}
        onClick={() => onDismiss(id)}
        className={`-my-3 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink ${
          expanded && !toast.action ? 'ml-auto' : ''
        }`}
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

  /**
   * ONE TOAST AT A TIME: a new toast REPLACES whatever is showing, at once.
   *
   * The region used to append, so a retry that failed again stacked a second
   * toast under the first — and a stack that grows from a fixed anchor grows
   * over whatever is below it: two error toasts over an open AddEventModal
   * covered its date field at 360x640, and over VitalFormModal its value and
   * time. Replacing is what makes the region's height bounded (one clamped
   * toast), which is the only way to guarantee it clears the controls under
   * it. It also coalesces a repeated message for free — the same failure twice
   * is one toast, not two — and the replacement is a NEW node, so an assistive
   * technology announces the second failure too. The replaced toast was
   * already announced when it appeared; its stale auto-dismiss timer died with
   * its item.
   */
  const showToast = useCallback((message: string, type: ToastType = 'info', action?: ToastAction) => {
    const id = nextId.current++;
    setToasts([{ id, message, type, action, leaving: false }]);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        ONE region, always mounted — only its placement changes. Every toast
        drops from the TOP; where exactly depends on what is on screen.

        Page placement drops from the TOP, where every page keeps its heading,
        not from the bottom, where pages keep their primary actions. It used to
        be bottom-right: at 1280x720 that covered 54% of EditCirclePage's "Save
        changes" at scroll 0, and over 11 pages x 7 viewports it covered a real
        control at scroll 0 in 43 of 69 cases (a medication's Confirm/Skip,
        task checkboxes, the DOB picker, note chips, the Delete circle button).
        Each band below was measured over those same pages and is clear of
        every control at scroll 0 (e2e/unhappy/writes/toast-page-overlap.spec.ts
        proves it with real toasts):
          - <640px: full-bleed at top 120px. The app header ends at 60 and each
            page's own header row — Back on the left, its primary action (Add
            event, Upload, Invite) on the right — ends at 116; under it is the
            page's h1. The app header band itself was rejected: it covers the
            circle switcher and account menu on every page.
          - 640-1023px: centred, 360px wide, at top 76px (16px under the
            header). That row's controls are the same left Back and right
            action, with only the eyebrow between them; a left anchor covered
            Back at 667 and 768 wide.
          - >=1024px (the sidebar is on screen): top-left of the MAIN column,
            24px in. The page title is left-aligned and its actions are
            right-aligned — at exactly 1024 a centred toast clipped
            Emergency's Print button.

        Dialog placement (`modal-open:`, globals.css): TOP-LEFT at 16px. A
        centred panel's footer is always at its bottom and its only header
        control, the close button, is always at its top-RIGHT; the top-left
        corner holds the (non-interactive) title or the backdrop. The width is
        capped to end at least 8px short of where the close button can be:
          - calc(100vw-104px): a panel that fills the viewport (<= ~544px wide)
            puts the close button's left edge at 100vw-76px;
          - calc(50vw+108px): the narrowest panel, `sm` (max-w-sm, 384px),
            centred, puts it at 50vw+132px;
          - 360px: the page placement's own width, which binds on anything
            wider.
        `modal-open:` selectors carry `body:has(...)`, so they out-rank the
        responsive page utilities without relying on stylesheet order.

        Pure CSS (`:has()`), so it tracks a dialog opening or closing while a
        toast is up, and resizes, with no measurement.
      */}
      <div
        aria-atomic="false"
        data-toast-region
        className="pointer-events-none fixed z-50 flex flex-col max-sm:inset-x-4 max-sm:top-30 sm:left-[calc(50%-180px)] sm:top-19 sm:w-[360px] xl:left-[calc(17rem+1.5rem)] modal-open:left-4 modal-open:right-auto modal-open:top-[max(1rem,env(safe-area-inset-top))] modal-open:w-[min(360px,calc(100vw-104px),calc(50vw+108px))]"
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            closeLabel={t('close')}
            moreLabel={t('more')}
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
