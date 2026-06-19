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
 * Full class string for a SOLID timeline/chip block matching mobile:
 * type-colored background + white text. Like mobile, the background is always
 * the event-type color regardless of medication status. The status only
 * affects subtle compact cues (handled by the caller via `getEventTextClass`).
 */
export function getEventCardClass(event: CalendarEvent): string {
  return `${EVENT_TYPE_BLOCK_CLASS[event.event_type]} text-cream`;
}

/**
 * Compact status cue applied to the block's title row — mobile shows skipped
 * with a strikethrough and renders confirmed/skipped meds muted. Returns an
 * (optionally empty) class string for the block wrapper.
 */
export function getEventStatusCue(status: MedicationStatus | null): string {
  if (status === 'taken' || status === 'skipped') return 'opacity-70';
  return '';
}
