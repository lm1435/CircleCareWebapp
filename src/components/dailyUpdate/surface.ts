/**
 * THE daily-update surface (docs/plans/daily-update.md "Design (Fable)").
 *
 * A moss-wash card with a moss-line hairline — the same family as mobile's
 * quick-fill group — so the evening card reads as one CircleCare moment,
 * distinct from the white Sheets that carry the day's records beneath it.
 * It is deliberately NOT a `Sheet` (white + shadow) and NOT a paper card:
 * the tint is the whole point, and the §4.6 card-shell ban only covers the
 * paper fills, so this constant is the one place the combination lives.
 *
 * Shared by the Home card, the full/dated page and the e2e harness so the
 * three can never drift.
 */
export const DAILY_UPDATE_SURFACE = 'rounded-xl border border-moss-line bg-moss-wash';

/** The hairline between the two sections / above the action row. */
export const DAILY_UPDATE_HAIRLINE = 'border-moss-line';

/** Entrance: a 250ms fade + 8px rise; `motion-reduce` removes it entirely. */
export const DAILY_UPDATE_ENTER =
  'animate-[card-in_250ms_var(--ease-spring)_both] motion-reduce:animate-none';

/** A text link in the action row (See the full update / Invite someone). */
export const DAILY_UPDATE_LINK =
  'inline-flex min-h-[44px] items-center text-md font-semibold text-moss-deep underline-offset-2 hover:underline';

/** The quiet "Turn off" control, pushed to the row's end. */
export const DAILY_UPDATE_QUIET =
  'ml-auto inline-flex min-h-[44px] items-center text-sm text-ink-2 underline underline-offset-2 hover:text-ink disabled:opacity-50';
