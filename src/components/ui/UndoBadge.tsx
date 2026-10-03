import { useLayoutEffect, useRef, type ReactElement } from 'react';

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
  className?: string;
}

const DEFAULT_DURATION_MS = 5000;

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
  className = '',
}: UndoBadgeProps): ReactElement {
  const isTaken = kind === 'taken' || kind === 'done';
  const rootRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

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
        style={{ animation: `cc-countdown ${durationMs}ms linear forwards` }}
      />
    </div>
  );
}
