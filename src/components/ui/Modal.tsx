import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface ModalProps {
  /** Visible heading rendered in the labelled title slot; wired to aria-labelledby. */
  title: ReactNode;
  /** Called on Escape, backdrop click, or close-button press. */
  onClose: () => void;
  /** Accessible label for the close (×) button — supply an i18n string. */
  closeLabel: string;
  children: ReactNode;
  /** Footer slot, rendered below the body with a divider when present. */
  footer?: ReactNode;
  /** Max-width utility for the panel. Defaults to a comfortable form width. */
  size?: 'sm' | 'md' | 'lg';
  /** When false, a backdrop click does not close (e.g. destructive confirm). */
  closeOnBackdropClick?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SIZE_CLASS = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

/**
 * Reusable modal shell — the base for every form/confirm dialog on web.
 *
 * Extracted verbatim from the original `EventDetailModal` trap logic and kept
 * consistent with the `AppLayout` drawer idioms:
 * - role="dialog" + aria-modal="true", labelled by the title slot
 * - focus moves to the close button on open, Tab is trapped (wraps both ways),
 *   Escape closes, focus is restored to the trigger on unmount
 * - body scroll is locked while open
 * - backdrop click closes (opt-out via `closeOnBackdropClick={false}`)
 * - subtle `modal-in` entrance; respects prefers-reduced-motion globally
 *
 * No user-facing copy is hardcoded: `title` and `closeLabel` come from props.
 */
export function Modal({
  title,
  onClose,
  closeLabel,
  children,
  footer,
  size = 'md',
  closeOnBackdropClick = true,
}: ModalProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Focus management + body scroll lock: focus the close button on open,
  // lock scroll while mounted, restore both on close.
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const handleKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLDivElement>) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.stopPropagation();
        onClose();
        return;
      }
      if (keyEvent.key !== 'Tab') return;

      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (keyEvent.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          keyEvent.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current?.contains(active)) {
        keyEvent.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  const handleBackdropClick = useCallback(
    (mouseEvent: MouseEvent<HTMLDivElement>) => {
      if (!closeOnBackdropClick) return;
      if (mouseEvent.target === mouseEvent.currentTarget) onClose();
    },
    [closeOnBackdropClick, onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 animate-[fade-in_200ms_ease-out]"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[90vh] w-full ${SIZE_CLASS[size]} flex-col overflow-y-auto rounded-2xl border border-line bg-cream shadow-lg animate-[modal-in_240ms_cubic-bezier(0.2,0.7,0.2,1)]`}
      >
        <div className="flex items-start gap-4 border-b border-line-2 px-6 pb-4 pt-6">
          <h2
            id={titleId}
            className="serif m-0 min-w-0 flex-1 break-words text-2xl leading-tight text-ink"
          >
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="flex flex-col gap-4 p-6">{children}</div>

        {footer ? <div className="border-t border-line-2 p-6">{footer}</div> : null}
      </div>
    </div>
  );
}
