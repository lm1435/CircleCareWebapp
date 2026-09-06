import type { CalendarEvent, EventType } from '@/api/calendarEvents';
import { isEventPastDue } from '@/utils/timezone';

// Color coding mirrored from mobile's design system: medication → clay,
// appointment → dusk, task → moss. The web tokens share the mobile vocabulary.
//
// Timeline / chip treatment now matches mobile's TimelineEventBlock exactly:
// SOLID type-colored blocks with WHITE text (never soft-tinted surfaces).
// Mobile keeps blocks type-colored regardless of confirmation status — status
// is NOT encoded in the block background. We mirror that, and additionally use
// mobile's only compact status cue: skipped/done events read as muted
// (lower opacity) and skipped titles get a strikethrough. Tokens only — the
// white-on-solid treatment matches mobile's #FFFFFF on the colored blocks.

export type MedicationStatus = 'taken' | 'missed' | 'skipped' | 'pending';

/** Small dot accent per event type (month-view dots, legends). */
export const EVENT_TYPE_DOT_CLASS: Record<EventType, string> = {
  medication: 'bg-clay',
  appointment: 'bg-dusk',
  task: 'bg-moss',
};

/** Solid block background per event type (mobile TimelineEventBlock). */
export const EVENT_TYPE_BLOCK_CLASS: Record<EventType, string> = {
  medication: 'bg-clay',
  appointment: 'bg-dusk',
  task: 'bg-moss',
};

/**
 * Muted "done" treatment per event type: a soft tinted surface with the deep
 * type color for text. Replaces the old whole-block `opacity-70` cue, which
 * dimmed white text toward the light page and failed WCAG AA contrast (~3:1).
 * The tint still recedes (done events read as settled) while keeping the type
 * identity and clearing AA — same pattern as the Today's Meds "done" tile.
 */
export const EVENT_TYPE_DONE_CLASS: Record<EventType, string> = {
  medication: 'bg-clay-soft text-clay-deep',
  appointment: 'bg-dusk-soft text-dusk-deep',
  task: 'bg-moss-soft text-moss-deep',
};

/** Deep type text color used for the muted "done" treatment. */
export const EVENT_TYPE_DEEP_TEXT: Record<EventType, string> = {
  medication: 'text-clay-deep',
  appointment: 'text-dusk-deep',
  task: 'text-moss-deep',
};

/**
 * True when the event is a medication that has been discontinued (inactivated).
 *
 * The Calendar GET returns every occurrence that was DUE BEFORE the discontinue
 * instant, so a calendar row CAN carry `discontinued_at` — these are historical
 * doses that keep their confirmation state (a dose logged taken still reads as
 * taken, a missed one as missed) and must never be filtered out client-side.
 * Occurrences after the discontinue instant are the ones the backend hides.
 *
 * Callers pair this with a VISIBLE "Inactive" label (never a color-only cue —
 * WCAG 2.1 AA 1.4.1) and add it to the row's aria-label.
 */
export function isInactiveMedication(event: CalendarEvent): boolean {
  return event.event_type === 'medication' && !!event.discontinued_at;
}

/**
 * Resolve a medication event's display status. Mirrors mobile semantics:
 * - confirmation taken/taken_late → taken
 * - confirmation skipped → skipped
 * - confirmation missed → missed
 * - no confirmation: past due IN THE CARE RECIPIENT'S TIMEZONE → missed,
 *   otherwise pending.
 * Returns null for non-medication events.
 */
export function getMedicationStatus(
  event: CalendarEvent,
  careRecipientTimezone: string,
  now: Date = new Date()
): MedicationStatus | null {
  if (event.event_type !== 'medication') return null;
  const confirmation = event.confirmation;
  if (confirmation) {
    if (confirmation.status === 'taken' || confirmation.status === 'taken_late') return 'taken';
    if (confirmation.status === 'skipped') return 'skipped';
    return 'missed';
  }
  return isEventPastDue(
    event.scheduled_date,
    event.scheduled_time ?? null,
    careRecipientTimezone,
    now
  )
    ? 'missed'
    : 'pending';
}

/**
 * Full class string (background + text color) for a timeline/chip block.
 * Pending/missed events are SOLID type-colored with white text (mobile
 * TimelineEventBlock). Done events (taken/skipped) use the muted soft-tint
 * treatment so they recede while staying type-identifiable AND meeting WCAG AA
 * — unlike the former `opacity-70`, which dimmed white text below 4.5:1.
 *
 * Review 2026-09-05 (Task 15): confirmed against mobile's own
 * `TimelineEventBlock.tsx:44-47` (`EVENT_TYPE_COLORS`) — mobile renders SOLID
 * per-type chips (clay/dusk/moss, white text), never a soft/deep tint for a
 * pending block. This file's solid-for-pending, soft-for-done split is
 * therefore correct as written; do not "fix" it toward soft/deep for pending.
 *
 * `status` is passed separately (not read off the event) so callers control it;
 * omitting it yields the solid pending look.
 */
export function getEventCardClass(
  event: CalendarEvent,
  status: MedicationStatus | null = null
): string {
  const isDone = status === 'taken' || status === 'skipped';
  return isDone
    ? EVENT_TYPE_DONE_CLASS[event.event_type]
    : `${EVENT_TYPE_BLOCK_CLASS[event.event_type]} text-cream`;
}

/**
 * Text color for the event block's title/time spans. Must be applied to the
 * spans directly (not just the block): MonthView/WeekView inline the mono
 * type scale (no color of their own, precisely so this is the only color
 * utility on the element) rather than using `<Text variant="mono">`, since its
 * `text-ink-3` and this color would be same-layer utilities whose override
 * order in the compiled stylesheet is not guaranteed. Pending/missed → white;
 * done → deep type color (on the soft surface).
 */
export function getEventTextClass(
  event: CalendarEvent,
  status: MedicationStatus | null = null
): string {
  const isDone = status === 'taken' || status === 'skipped';
  return isDone ? EVENT_TYPE_DEEP_TEXT[event.event_type] : 'text-cream';
}
