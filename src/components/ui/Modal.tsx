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
import { TOAST_CONTROL_SELECTOR } from './Toast';

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
  /**
   * Max-width utility for the panel. Defaults to a comfortable form width.
   * sm 384px · md 512px (default) · lg 672px · xl 768px — xl is for dense chip
   * forms (EditMedicalInfoModal stacks four tag fields whose 44px chips wrapped
   * into three rows at md). Below each width the panel is simply full-width.
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';
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
  xl: 'max-w-3xl',
} as const;

/**
 * Whether `dialog` is the modal that owns the keyboard: the LAST
 * `aria-modal="true"` element in document order. A nested dialog (a
 * ConfirmDialog inside EventDetailModal) renders inside its parent's panel, so
 * it comes later; the coarse-pointer picker sheet portals to the end of
 * `<body>`, so while it is up no Modal owns the toast.
 */
function isTopmostModal(dialog: HTMLElement): boolean {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  return modals[modals.length - 1] === dialog;
}

/** The on-screen toast's controls — only for the dialog that owns the keyboard. */
function toastControlsFor(dialog: HTMLElement): HTMLElement[] {
  if (!isTopmostModal(dialog)) return [];
  return Array.from(document.querySelectorAll<HTMLElement>(TOAST_CONTROL_SELECTOR));
}

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
 * - the body wrapper is `min-h-0 flex-1 overflow-y-auto -mr-5 pr-4`: without
 *   `min-h-0` a flex child never shrinks below its content, so tall bodies were
 *   clipped by the panel's `overflow-hidden` instead of scrolling
 *   (D-health.md §9.2); the negative-margin/padding pair carves the scrollbar
 *   its own gutter out of the panel's right padding, so an overlay scrollbar
 *   stops painting over the last ~15px of every dialog's content. The pair is
 *   deliberately UNBALANCED (20px out, 16px back) — see the comment on the
 *   element itself for what that costs and why it is kept.
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
  /** The panel control focus left from when Tab carried it into the toast. */
  const toastReturnRef = useRef<HTMLElement | null>(null);
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

  // FOCUS RECOVERY — the trap has to survive a control blurring itself away.
  //
  // A browser BLURS an element the moment it becomes `disabled`, and half the
  // dialogs in this app disable their primary button for the duration of a
  // request (`disabled={mutation.isPending}` / `loading`). On success the
  // dialog usually closes and the cleanup above restores focus to the trigger;
  // on FAILURE the button re-enables and nothing has moved focus, so it is
  // sitting on `document.body`. That is not cosmetic: `handleKeyDown` below is
  // a React `onKeyDown` bound to this shell's own backdrop div, so a synthetic
  // key event only reaches it when the event target is inside that subtree.
  // From `<body>`, Escape stops closing the dialog and the Tab trap is dead —
  // the next Tab walks into the page behind the backdrop (WCAG 2.1.2 no
  // keyboard trap, 2.4.3 focus order).
  //
  // NOTE ON WHAT IS *NOT* HERE. This comment used to say the page behind was
  // `aria-hidden`. It is not, and nothing in `src` makes it so: the only
  // non-decorative `aria-hidden` uses in this app are icons, spinners,
  // skeletons and a `LatestHero` duplicate block, and `aria-modal="true"` on
  // the panel is the sole background suppression there is. That was left as a
  // comment fix rather than implemented because this shell renders INLINE —
  // there is no portal — so the dialog is a DESCENDANT of the page content it
  // would have to hide, and `inert`/`aria-hidden` on "everything else" has no
  // well-defined subtree to apply to without first moving the panel to a
  // portal. That is a real improvement and a separate change.
  //
  // TWO WAYS FOCUS ESCAPES TO `<body>`, and they need different listeners:
  //
  //  1. The focused control is BLURRED (it became `disabled`). A `focusout`
  //     fires, with `relatedTarget === null` when focus went nowhere.
  //  2. The focused control is REMOVED. Browsers fire NO blur/focusout at all
  //     for a detached node — `activeElement` just silently resets to `<body>`
  //     — so (1)'s listener never runs. The live instance is a nested dialog:
  //     `EventDetailActions` renders a `ConfirmDialog` inside
  //     `EventDetailModal`'s Modal, and on confirm the inner shell's cleanup
  //     calls `previouslyFocused?.focus()` on an Edit button the same commit
  //     removed. Focusing a detached node is a no-op, so focus is stranded on
  //     `<body>` inside the still-open OUTER dialog. A MutationObserver on the
  //     dialog subtree is the only signal there is.
  //
  // Both paths converge on the same check, and both stand down the moment
  // anything else holds focus: focus moving to another element — inside the
  // dialog or deliberately outside it — is left alone. Keeping focus in is the
  // Tab handler's job; fighting every focus change would make the dialog
  // impossible to leave by any other means.
  useEffect(() => {
    if (!mounted) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // `isConnected` is defensive only (focusing a detached node is already a
    // no-op); the `activeElement` test is the actual rail, and it is what stops
    // the recovery yanking focus off something that claimed it in between.
    function recoverIfFocusFellToNothing(): void {
      queueMicrotask(() => {
        if (!dialog || !dialog.isConnected) return;
        const active = document.activeElement;
        // Something (including this dialog's own Tab handler) already claimed
        // focus, or the whole document lost it — leave both alone.
        if (active !== null && active !== document.body) return;
        dialog.focus();
      });
    }

    function handleFocusOut(focusEvent: FocusEvent): void {
      // Fast path out of every ordinary move between two controls. Redundant
      // with the `activeElement` re-check below rather than load-bearing on
      // its own — a non-null `relatedTarget` is the element about to receive
      // focus, so that check would stand down anyway — but it keeps a
      // microtask off every focus change inside the dialog.
      if (focusEvent.relatedTarget !== null) return;
      // The re-check is deferred because `focusout` fires BEFORE the new focus
      // target is set, so `document.activeElement` reads `<body>` even for an
      // ordinary move between two controls.
      recoverIfFocusFellToNothing();
    }

    dialog.addEventListener('focusout', handleFocusOut);

    // Removal fires no event, so watch the subtree instead. The callback is
    // already a microtask, and it does nothing at all unless focus is on
    // `<body>` — so the common case (any DOM update inside an open dialog)
    // costs one `activeElement` comparison.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(recoverIfFocusFellToNothing);
      observer.observe(dialog, { childList: true, subtree: true });
    }

    return () => {
      dialog.removeEventListener('focusout', handleFocusOut);
      observer?.disconnect();
    };
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
      // A dialog nested inside this one already moved focus for this Tab (the
      // synthetic event bubbles on to every enclosing shell).
      if (keyEvent.defaultPrevented) return;

      const dialog = dialogRef.current;
      const focusables = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!dialog || !focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      // The toast's controls extend the cycle past `last` (see the toast
      // keyboard effect below): Tab off the last control enters the toast,
      // Shift+Tab off the first enters it from the end.
      const toasts = toastControlsFor(dialog);

      // THE PANEL IS A BOUNDARY, NOT A MEMBER. It is `tabIndex={-1}`, so
      // `FOCUSABLE_SELECTOR` excludes it — and it is also the FIRST node in
      // the subtree, so `contains(active)` is true for it (a node contains
      // itself). Without this case, Shift+Tab from the panel matched neither
      // `active === first` nor `!contains(active)`, nothing called
      // `preventDefault`, and the browser walked to the previous tabbable
      // OUTSIDE the dialog. That is not a corner: the focus recovery below
      // parks focus on the panel on EVERY blur-to-nothing, which is every
      // failed submit in every dialog in this app.
      const onPanel = active === dialog;

      if (keyEvent.shiftKey) {
        if (onPanel || active === first || !dialog.contains(active)) {
          keyEvent.preventDefault();
          if (active === first && toasts.length > 0) {
            toastReturnRef.current = first;
            toasts[toasts.length - 1].focus();
          } else {
            last.focus();
          }
        }
      } else if (onPanel || active === last || !dialog.contains(active)) {
        keyEvent.preventDefault();
        if (active === last && toasts.length > 0) {
          toastReturnRef.current = last;
          toasts[0].focus();
        } else {
          first.focus();
        }
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

  // Latest-value handles for the toast effect below, which attaches its
  // listeners once per open (re-attaching on every render would also reset
  // what it knows about where focus is).
  const requestCloseRef = useRef(requestClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    requestCloseRef.current = requestClose;
    dismissibleRef.current = dismissible;
  });

  // THE TOAST IS PART OF THE TOPMOST DIALOG'S TAB CYCLE (WCAG 2.1.1).
  //
  // A toast raised while a dialog is open lives in the app-level toast region,
  // OUTSIDE this panel — and the trap above only ever cycled the panel's own
  // controls, so a keyboard user could never reach a toast's action. The live
  // case is the premium gate: a 402 from a save inside a dialog raises "Upgrade"
  // in a toast, and nothing but a mouse could press it.
  //
  // Options weighed, and why this one:
  //  - Moving focus TO an actionable toast when it appears steals focus from a
  //    form the user is still in, on a message they may not care about.
  //  - A shortcut (F6, Alt+T) is undiscoverable and collides with browser and
  //    screen-reader keys.
  //  - Appending the toast's controls to the END of the cycle changes nothing
  //    until the user Tabs past the last control or Shift+Tabs past the first —
  //    exactly where "what else is there?" is asked. Nothing moves on its own.
  //
  // The region is not a React descendant of this shell, so its keys never
  // reach `handleKeyDown`: native listeners on the region carry Tab/Shift+Tab
  // back into the panel, and Escape still closes the dialog. Focus stays
  // trapped in panel + toast. A focused toast control that DISAPPEARS (its toast
  // was dismissed, replaced, or timed out) fires no event — the same trap as
  // `recoverIfFocusFellToNothing` above — so the region is watched too and
  // focus goes back to the control the user Tabbed in from. Nested dialogs:
  // only the topmost one acts (`isTopmostModal`).
  useEffect(() => {
    if (!mounted) return;
    const dialog = dialogRef.current;
    const region = document.querySelector<HTMLElement>('[data-toast-region]');
    if (!dialog || !region) return;

    let focusInToast = false;

    function focusBackInDialog(target: HTMLElement | null): void {
      if (!dialog) return;
      if (target && target.isConnected && dialog.contains(target)) target.focus();
      else dialog.focus();
    }

    function handleRegionKeyDown(keyEvent: globalThis.KeyboardEvent): void {
      if (!dialog || !isTopmostModal(dialog)) return;
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        if (dismissibleRef.current) requestCloseRef.current();
        return;
      }
      if (keyEvent.key !== 'Tab') return;
      const own = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const toasts = toastControlsFor(dialog);
      const index = toasts.indexOf(document.activeElement as HTMLElement);
      keyEvent.preventDefault();
      if (keyEvent.shiftKey) {
        if (index > 0) toasts[index - 1].focus();
        else focusBackInDialog(own[own.length - 1] ?? null);
      } else if (index >= 0 && index < toasts.length - 1) {
        toasts[index + 1].focus();
      } else {
        focusBackInDialog(own[0] ?? null);
      }
    }

    function handleRegionFocusIn(): void {
      focusInToast = true;
    }

    function recoverFromVanishedToast(): void {
      queueMicrotask(() => {
        if (!focusInToast || !dialog || !dialog.isConnected) return;
        const active = document.activeElement;
        if (active !== null && active !== document.body) {
          if (!region?.contains(active)) focusInToast = false;
          return;
        }
        focusInToast = false;
        if (isTopmostModal(dialog)) focusBackInDialog(toastReturnRef.current);
      });
    }

    function handleRegionFocusOut(focusEvent: FocusEvent): void {
      const next = focusEvent.relatedTarget as Node | null;
      if (next === null) {
        recoverFromVanishedToast();
      } else if (!region?.contains(next)) {
        focusInToast = false;
      }
    }

    region.addEventListener('keydown', handleRegionKeyDown);
    region.addEventListener('focusin', handleRegionFocusIn);
    region.addEventListener('focusout', handleRegionFocusOut);
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(recoverFromVanishedToast);
      observer.observe(region, { childList: true, subtree: true });
    }

    return () => {
      region.removeEventListener('keydown', handleRegionKeyDown);
      region.removeEventListener('focusin', handleRegionFocusIn);
      region.removeEventListener('focusout', handleRegionFocusOut);
      observer?.disconnect();
    };
  }, [mounted]);

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

        {/*
          THE SCROLLBAR NEEDS A LANE OF ITS OWN. This container used to span the
          panel's full content box, so on macOS — and anywhere else the platform
          paints an OVERLAY scrollbar — the bar was drawn ON TOP of the rightmost
          ~15px of the body instead of taking layout width from it: Toggle
          switches and the right edge of wrapped paragraphs sat under it
          (AddEventModal is the visible case). `scrollbar-gutter: stable` is not
          the fix — it reserves space only for a scrollbar that CONSUMES space,
          and an overlay scrollbar consumes none, so it is a no-op in exactly the
          case being reported.

          So the gutter is carved by hand out of the panel's own `p-6`: `-mr-5`
          pushes this box 20px into that 24px right padding, so its right edge —
          and the overlay scrollbar riding on it — sits ~4px from the panel edge,
          still clear of the rounded corner.

          `pr-4` GIVES BACK 16 OF THOSE 20, NOT ALL OF THEM, and that 4px is a
          real, visible difference rather than a rounding error: the body's
          content box ends 20px from the panel edge, while the header rule and
          the footer (full-bleed via `-mx-6 px-6`) keep their content at 24px, so
          the body's right edge runs 4px wider than theirs. Deliberate, and kept
          deliberately: it buys 4px more digit and toggle clearance under the widest
          platform scrollbar, and the mismatch is invisible in practice because
          body content is ragged-right — the one thing it must not do is be
          "corrected" back to `-mr-4` by someone reading this block as if the two
          numbers were supposed to match. They are not. Only the scrollbar gains
          somewhere to be; the 4px is what that costs.
        */}
        <div
          role="region"
          aria-labelledby={titleId}
          tabIndex={0}
          className="-mr-5 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-4"
        >
          {children}
        </div>

        {/*
          `data-modal-footer` is not styling — it is how a FIXED, portalled
          popover anchored to a field in this body finds the band it must not
          cover. `pickerPopover` reads it (via `closest('[role=dialog]')`) to
          reserve this row when it places itself: at <=400px the calendar
          otherwise sat squarely over Cancel AND Create, and a click meant for
          Create picked a date instead. Nothing else may key off it.
        */}
        {footer ? (
          <div data-modal-footer className={MODAL_FOOTER_CLASS}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
