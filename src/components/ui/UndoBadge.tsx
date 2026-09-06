import type { ReactElement } from 'react';

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

  return (
    <div
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
