import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import { UNDO_HOLD_CAP_MS } from '@/lib/undoTimer';

export type UndoBadgeKind = 'taken' | 'skipped' | 'done';

export interface UndoBadgeProps {
  /** Which state the item was moved to. `taken` and `done` share the same look. */
  kind: UndoBadgeKind;
  /** The status label ("Taken", "Skipped", "Done", …) — translated by the caller. */
  label: string;
  /** The Undo button's label — translated by the caller. */
  undoLabel: string;
  /**
   * Name of the item being undone. Several badges can be open at once (one
   * per dose/task), so without it every Undo button reads identically to a
   * screen reader — mirrors mobile's `UndoBadge` `itemLabel` prop. When
   * given, the button's accessible name becomes `"${undoLabel} ${itemLabel}"`
   * (e.g. "Undo Metformin") instead of just `undoLabel`.
   */
  itemLabel?: string;
  onUndo: () => void;
  /**
   * Grace period the progress bar drains over, in ms. Default 5000, matching
   * mobile's `UNDO_DELAY_MS`.
   *
   * This component does NOT own the timer that actually commits the action —
   * the caller does (as `TaskRow.tsx` does today). The progress bar here is
   * purely decorative, same as mobile's and the existing
   * `cc-countdown` keyframe's own doc comment says.
   */
  durationMs?: number;
  /**
   * WCAG 2.2.1 Timing Adjustable. Called with `true` when the pointer moves
   * over the badge or KEYBOARD focus lands inside it, and with `false` once
   * both have left (or the badge unmounts while held). The caller pauses its
   * commit timer for that long (`lib/undoTimer`), and the bar below pauses with
   * it, so what is drawn is what is left. Focus that only followed a mouse
   * click (not `:focus-visible`) and touch contact do not hold: otherwise every
   * mouse click on Take would park the write until the next click elsewhere.
   * For the same reason hover starts on pointer MOVEMENT over the badge, not on
   * `pointerenter`: the badge replaces the button just clicked, so it appears
   * under a resting cursor and Chrome reports it hovered with no one hovering
   * it. Any movement over it (reaching for Undo, a magnifier following the
   * cursor) holds; leaving releases.
   */
  onHoldChange?: (held: boolean) => void;
  className?: string;
}

/** Keyboard focus, as the browser itself judges it for focus rings. */
function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    // No `:focus-visible` support: hold on any focus (the safe side for 2.2.1).
    return true;
  }
}

const DEFAULT_DURATION_MS = 5000;
/** How long before the hold cap the badge says the write is about to happen. */
export const UNDO_CAP_WARNING_MS = 10_000;

/**
 * Replaces a care item's Take/Skip (or Done) pair for a 5s undo window after
 * the action is taken — mirrors mobile's `UndoBadge`.
 *
 * `role="status"` + `aria-live="polite"` gives the same guarantee mobile gets
 * from `AccessibilityInfo.announceForAccessibility`: the badge silently
 * replaces the action pills, so without an announcement a screen-reader user
 * has no idea the undo window opened before it's gone.
 */
export function UndoBadge({
  kind,
  label,
  undoLabel,
  itemLabel,
  onUndo,
  durationMs = DEFAULT_DURATION_MS,
  onHoldChange,
  className = '',
}: UndoBadgeProps): ReactElement {
  const isTaken = kind === 'taken' || kind === 'done';
  const rootRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  // HOLD (WCAG 2.2.1): hovered OR keyboard-focused pauses the countdown; it
  // resumes with the time left once BOTH have gone.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const onHoldChangeRef = useRef(onHoldChange);
  onHoldChangeRef.current = onHoldChange;
  const reportedHeldRef = useRef(false);
  useEffect(() => {
    if (held === reportedHeldRef.current) return;
    reportedHeldRef.current = held;
    onHoldChangeRef.current?.(held);
  }, [held]);
  // Unmounted while held (a re-render that swaps the row, not Undo / commit):
  // release, or the write would stay paused with no badge left to resume it.
  useEffect(
    () => () => {
      if (reportedHeldRef.current) onHoldChangeRef.current?.(false);
    },
    []
  );
  // THE HOLD CAP (lib/undoTimer UNDO_HOLD_CAP_MS): however long it is held, the
  // write commits 60 s after the press. Ten seconds before that, a held badge
  // says so through its own polite live region. Measured from mount, which is
  // the press (the badge replaces the pressed button in the same commit).
  const { t } = useTranslation('common');
  const [capSoon, setCapSoon] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setCapSoon(true), UNDO_HOLD_CAP_MS - UNDO_CAP_WARNING_MS);
    return () => window.clearTimeout(id);
  }, []);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'touch') setHovered(true);
  };
  const onPointerLeave = (): void => setHovered(false);
  const onFocus = (e: FocusEvent<HTMLDivElement>): void => {
    setFocused(isKeyboardFocus(e.target));
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    const next = e.relatedTarget;
    if (next instanceof Node && rootRef.current?.contains(next)) return;
    setFocused(false);
  };

  // KEYBOARD FOCUS (WCAG 2.4.3). The badge REPLACES the button that was just
  // pressed (Confirm / Skip / Done), so that button leaves the DOM with focus
  // on it and the browser drops focus to <body> — the next Tab restarts at the
  // top of the page, and a screen reader loses its place. On mount, if focus
  // was lost that way, it goes to Undo (the only control that replaced the one
  // pressed). A caller rendering the badge twice (TaskRow's two layout slots,
  // one CSS-hidden) is fine: a hidden button has no client rects and is
  // skipped, so the visible copy takes it.
  useLayoutEffect(() => {
    const button = undoRef.current;
    const active = document.activeElement;
    if (!button || (active && active !== document.body)) return;
    if (button.getClientRects().length === 0) return;
    button.focus();
  }, []);

  // ...and when the badge itself leaves (Undo pressed, or the window closed)
  // with focus inside it, focus goes back to the same row — the restored
  // Confirm/Skip pair after an Undo — or, when the row is gone or has nothing
  // focusable left, to the neighbouring row, instead of to <body>. Layout
  // cleanup runs before the node is detached, so `contains` still sees it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    return () => {
      if (!root || !root.contains(document.activeElement)) return;
      const row = root.closest('li') ?? root.parentElement;
      const next = row?.nextElementSibling ?? null;
      const prev = row?.previousElementSibling ?? null;
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        for (const candidate of [row, next, prev]) {
          if (!candidate || !candidate.isConnected) continue;
          const target = Array.from(
            candidate.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          ).find((el) => el.getClientRects().length > 0);
          if (target) {
            target.focus();
            return;
          }
        }
      }, 0);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="status"
      aria-live="polite"
      className={`inline-flex flex-col rounded-full overflow-hidden ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      data-held={held ? 'true' : undefined}
    >
      <div
        className={`flex items-center gap-[5px] px-3 py-2 ${
          isTaken ? 'bg-moss-soft' : 'bg-line-2'
        }`}
      >
        <span className={`text-sm ${isTaken ? 'font-semibold text-moss-deep' : 'text-ink-2'}`}>
          {label}
        </span>
        <span aria-hidden className="w-px h-3.5 bg-moss-muted mx-0.5" />
        {held && capSoon ? (
          <span className="sr-only">{t('undoCap.savingSoon')}</span>
        ) : null}
        <button
          ref={undoRef}
          type="button"
          onClick={onUndo}
          aria-label={itemLabel ? `${undoLabel} ${itemLabel}` : undefined}
          className="text-sm font-bold text-moss min-h-[44px] -my-2 px-2"
        >
          {undoLabel}
        </button>
      </div>
      <span
        aria-hidden
        className={`block h-[2.5px] origin-left motion-reduce:animate-none ${
          isTaken ? 'bg-moss-light' : 'bg-ink-3'
        }`}
        // Play-state inside the shorthand (not a separate longhand React would
        // warn about mixing): only the NAME restarts a CSS animation, so
        // toggling paused/running resumes the bar where it stopped.
        style={{
          animation: `cc-countdown ${durationMs}ms linear forwards ${held ? 'paused' : 'running'}`,
        }}
      />
    </div>
  );
}
