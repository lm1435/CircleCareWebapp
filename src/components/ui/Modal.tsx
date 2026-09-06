import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { Icon } from './Icon';
import { prefersReducedMotion, waitForExitAnimation } from './motion';
import { Text } from './Text';

export interface ModalProps {
  /**
   * Opt-in lifecycle control. **Omit it** and the shell behaves exactly as it
   * always has: the caller conditionally mounts it, so the exit animation only
   * plays for a caller that happens to keep it mounted.
   *
   * **Pass it** and the shell owns its own lifecycle — mount it
   * unconditionally and flip this instead. `true` mounts and plays `modal-in`;
   * `false` plays `modal-out` and renders `null` once that animation ends (or
   * immediately under `prefers-reduced-motion`), so the exit is actually
   * visible. `onClose` still fires synchronously on the close gesture; a
   * controlled caller responds by setting `open={false}`.
   */
  open?: boolean;
  /** Visible heading rendered in the labelled title slot; wired to aria-labelledby. */
  title: ReactNode;
  /** Called on Escape, backdrop click, or close-button press. */
  onClose: () => void;
  /** Accessible label for the close (×) button — supply an i18n string. */
  closeLabel: string;
  children: ReactNode;
  /** Footer slot. The shell owns the row layout (spec §4.5 footer convention). */
  footer?: ReactNode;
  /** Max-width utility for the panel. Defaults to a comfortable form width. */
  size?: 'sm' | 'md' | 'lg';
  /** When false, a backdrop click does not close (e.g. destructive confirm). */
  closeOnBackdropClick?: boolean;
  /**
   * When false, the dialog cannot be dismissed at all: Escape is ignored, the
   * × close button is disabled, and backdrop clicks are ignored (regardless
   * of `closeOnBackdropClick`). Use while a blocking action is in flight
   * (e.g. `loading`) so the user can't abandon it mid-request. Default true.
   */
  dismissible?: boolean;
  /**
   * When true, `title` stays in the tree as an sr-only `<h2>` — it still
   * supplies the dialog's `aria-labelledby` name — but the header renders as
   * a compact row (no bottom border, tighter top padding, close button only)
   * instead of the usual title-plus-× band. For callers whose own content
   * carries the ONE visible heading (e.g. a per-step heading in a wizard), so
   * the dialog does not also show a redundant blank-looking header. Default
   * false.
   */
  hideTitle?: boolean;
  /**
   * Rich header content — an icon tile, a title line, a subtitle, a badge —
   * rendered IN the title row, beside the × and above the header rule, in
   * place of the plain `title` text. Pair it with `hideTitle`: `title` still
   * names the dialog through the sr-only `<h2>`, so the visible header must
   * not repeat it as another heading. Without this, `hideTitle` leaves the ×
   * alone on its row and a header rendered as the first body row floats
   * under it.
   */
  header?: ReactNode;
  /**
   * Focus this element on open instead of the close button (still falls back
   * to the close button — or, when `dismissible` is false, the dialog panel
   * itself — when unset or not yet mounted). Lets a caller's own `autoFocus`
   * on its first field actually win: the shell always owns initial focus, so
   * an `autoFocus` prop nested in `children` was previously silently
   * overridden by the close-button focus below.
   */
  initialFocusRef?: RefObject<FocusableHandle | null>;
}

/**
 * Anything with a `.focus()` — a plain DOM node ref (`HTMLElement` structurally
 * satisfies this) or a component's imperative handle (e.g. `OtpInput`, whose
 * "element" is really its first box).
 */
export interface FocusableHandle {
  focus: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SIZE_CLASS = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

/**
 * Spec §4.5 footer convention: one row, right-aligned, gap 12, secondary then
 * primary — stacked full width (primary on top) only below 480px. Owned by the
 * shell so every dialog gets the same footer without restating it.
 *
 * The top rule mirrors the header's bottom rule (full-bleed via `-mx-6`): a
 * body taller than the panel scrolls UNDER the footer, and without a visible
 * edge the last field simply stops above the buttons with nothing to say
 * more content is hidden — the rule is the affordance.
 */
const MODAL_FOOTER_CLASS =
  '-mx-6 -mb-6 mt-4 flex shrink-0 justify-end gap-3 border-t border-line px-6 pb-6 pt-4 max-[479px]:flex-col-reverse max-[479px]:[&>*]:w-full ' +
  // Footer buttons sit at 44px, not the `md` Button's 56px: `md` is mobile's
  // thumb target (16px padding, verbatim), and a dialog footer on a desktop
  // is a mouse target beside another button. Set here, once, so every
  // footer agrees without each of two dozen call sites restating `size`.
  '[&_button]:min-h-[44px] [&_button]:px-5 [&_button]:py-2.5';

/**
 * Reusable modal shell — the base for every form/confirm dialog on web.
 *
 * - role="dialog" + aria-modal="true", labelled by the title slot
 * - focus moves to the close button on open (or `initialFocusRef`, when given),
 *   Tab is trapped (wraps both ways), Escape closes, focus is restored to the
 *   trigger when the shell retires
 * - body scroll is locked while open
 * - the scrollable body is itself `role="region"` + `tabIndex={0}` (labelled
 *   by the same title), so a body taller than the viewport is keyboard- and
 *   AT-reachable even when it holds no other focusable content (axe
 *   `scrollable-region-focusable`)
 * - backdrop click closes (opt-out via `closeOnBackdropClick={false}`)
 * - `modal-in` entrance (240ms, spring) always plays. The `modal-out` exit
 *   (160ms), with the node held in the tree until `animationend` (spec §4.5),
 *   is OPT-IN via the controlled `open` prop: `onClose` always fires
 *   synchronously on the close gesture, but an uncontrolled shell (no `open`)
 *   never touches its own phase in response — a caller whose `onClose`
 *   declines to close (shows a confirm dialog instead, say) keeps the panel
 *   exactly as it was, rather than having the shell race ahead and retire
 *   itself out from under that caller. Only a controlled caller flipping
 *   `open` to `false` starts the exit.
 * - the body wrapper is `min-h-0 flex-1 overflow-y-auto`: without `min-h-0` a
 *   flex child never shrinks below its content, so tall bodies were clipped by
 *   the panel's `overflow-hidden` instead of scrolling (D-health.md §9.2).
 *
 * No user-facing copy is hardcoded: `title` and `closeLabel` come from props.
 */
export function Modal({
  open,
  title,
  onClose,
  closeLabel,
  children,
  footer,
  size = 'md',
  closeOnBackdropClick = true,
  dismissible = true,
  hideTitle = false,
  header,
  initialFocusRef,
}: ModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const controlled = open !== undefined;
  const [phase, setPhase] = useState<'open' | 'closing' | 'closed'>(() =>
    controlled && !open ? 'closed' : 'open'
  );
  const mounted = phase !== 'closed';

  // Controlled mode only: `open` drives the phase. `false` starts the exit
  // (or retires immediately under reduced motion) and `true` re-opens a shell
  // that had retired, without the caller ever unmounting it.
  useEffect(() => {
    if (!controlled) return;
    if (open) {
      setPhase('open');
      return;
    }
    const next = prefersReducedMotion() ? 'closed' : 'closing';
    // Already retired (including the initial `open={false}` mount) — do not
    // replay the exit.
    setPhase((current) => (current === 'closed' ? 'closed' : next));
  }, [controlled, open]);

  // Focus management + body scroll lock: focus the close button on open,
  // lock scroll while the shell is on screen, restore both when it retires
  // (either the caller unmounts us, or the exit animation finishes). When not
  // dismissible the close button is disabled (unfocusable), so fall back to
  // the dialog panel itself.
  useEffect(() => {
    if (!mounted) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (initialFocusRef?.current) {
      initialFocusRef.current.focus();
    } else if (dismissible) {
      closeButtonRef.current?.focus();
    } else {
      dialogRef.current?.focus();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
    // Runs once while mounted: `dismissible` is not expected to change over a
    // dialog's lifetime, and re-running would steal focus back mid-edit.
  }, [mounted]);

  // Retire the node when the exit animation ends, with a timer as the safety
  // net — see `waitForExitAnimation` (motion.ts), shared with Toast.
  useEffect(() => {
    if (phase !== 'closing') return;
    return waitForExitAnimation(dialogRef.current, () => setPhase('closed'));
  }, [phase]);

  // `onClose` fires synchronously — the shell never assumes the close
  // succeeded. Deliberately not guarded on `phase`: a second dismissal
  // gesture during the 160ms exit still reports to the caller.
  //
  // Uncontrolled mode (no `open` prop) stops there and leaves `phase` alone:
  // the caller is the single source of truth for whether anything actually
  // closes (it may show a confirm dialog instead), so self-retiring on a
  // gesture the caller declined would strand exactly the caller that needed
  // the panel to stay put. The exit animation is opt-in ONLY via the
  // controlled `open` prop (see that effect above) — a controlled caller that
  // ignores `onClose` keeps the dialog fully open, as it should.
  const requestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLDivElement>) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.stopPropagation();
        if (dismissible) requestClose();
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
    [dismissible, requestClose]
  );

  const handleBackdropClick = useCallback(
    (mouseEvent: MouseEvent<HTMLDivElement>) => {
      if (!dismissible || !closeOnBackdropClick) return;
      if (mouseEvent.target === mouseEvent.currentTarget) requestClose();
    },
    [dismissible, closeOnBackdropClick, requestClose]
  );

  if (!mounted) return null;

  const closing = phase === 'closing';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 motion-reduce:animate-none ${
        closing
          ? 'animate-[fade-in_160ms_ease-in_reverse_forwards]'
          : 'animate-[fade-in_200ms_ease-out]'
      }`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[90vh] w-full ${
          SIZE_CLASS[size]
        } flex-col overflow-hidden rounded-xl bg-cream p-6 shadow-xl motion-reduce:animate-none ${
          closing
            ? 'animate-[modal-out_160ms_ease-in]'
            : 'animate-[modal-in_240ms_var(--ease-spring)]'
        }`}
      >
        <div
          className={
            hideTitle && !header
              ? 'flex shrink-0 items-start justify-end gap-4'
              : '-mx-6 mb-4 flex shrink-0 items-start gap-4 border-b border-line-2 px-6 pb-4'
          }
        >
          <Text
            variant="h2"
            as="h2"
            id={titleId}
            className={hideTitle ? 'sr-only' : 'min-w-0 flex-1 break-words'}
          >
            {title}
          </Text>
          {header ? <div className="min-w-0 flex-1">{header}</div> : null}
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={closeLabel}
            onClick={dismissible ? requestClose : undefined}
            disabled={!dismissible}
            className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          >
            <Icon name="close-outline" size="chrome" />
          </button>
        </div>

        <div
          role="region"
          aria-labelledby={titleId}
          tabIndex={0}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
        >
          {children}
        </div>

        {footer ? <div className={MODAL_FOOTER_CLASS}>{footer}</div> : null}
      </div>
    </div>
  );
}
