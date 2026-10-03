import type { CalendarEvent } from '@/api/calendarEvents';

/**
 * Who an event is assigned to, as the calendar CHIP prints it. Same rule as
 * mobile's `TimelineEventBlock` (assigneeName): first + last name joined, else
 * the email, else nothing. No roster lookup and no "Unassigned" text — a chip
 * with no assignee simply shows no name, as on mobile.
 *
 * The list endpoint (GET /circles/:id/events) already embeds
 * `assigned_to_user` for every row it returns, virtual recurring instances
 * included (copied off the parent), and backfills the name of an assignee who
 * has since left the circle (no email in that case — see `EventUser.email`).
 */
export function eventAssigneeName(event: CalendarEvent): string | null {
  const user = event.assigned_to_user;
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || user.email || null;
}

/** Note count from the list endpoint's `event_notes(count)` embed; 0 when absent. */
export function eventNoteCount(event: CalendarEvent): number {
  const count = event.note_count ?? 0;
  return count > 0 ? count : 0;
}
