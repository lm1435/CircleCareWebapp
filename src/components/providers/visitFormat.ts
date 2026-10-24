import type { ProviderVisit } from '@/api/providers';
import { calendarEventPath } from '@/lib/dailyUpdateLinks';

/**
 * The id the calendar deep link wants for a visit (PROVIDERS_API_CONTRACT §1.5,
 * "Opening a visit / adding a note"):
 *   - a physical visit: its own event id (a one-off, a series root on its own
 *     start date, or a materialized occurrence);
 *   - a VIRTUAL visit (`<rootId>_<date>`, a future occurrence not yet minted):
 *     the series ROOT, with the visit's `scheduled_date`. The calendar resolves
 *     that pair to the occurrence, and the notes API materializes it on the
 *     first note.
 */
export function visitEventId(visit: Pick<ProviderVisit, 'id' | 'series_id' | 'is_virtual'>): string {
  return visit.is_virtual && visit.series_id ? visit.series_id : visit.id;
}

/** `/circles/:id/calendar?date=&eventId=[&panel=notes]` for a visit. */
export function visitCalendarPath(
  circleId: string,
  visit: Pick<ProviderVisit, 'id' | 'series_id' | 'is_virtual' | 'scheduled_date'>,
  panel?: 'notes'
): string {
  return calendarEventPath(circleId, visit.scheduled_date, visitEventId(visit), panel);
}

/** Past visits grouped by calendar year, in the order given (newest first). */
export interface VisitYearGroup {
  year: string;
  visits: ProviderVisit[];
}

export function groupVisitsByYear(visits: readonly ProviderVisit[]): VisitYearGroup[] {
  const groups: VisitYearGroup[] = [];
  for (const visit of visits) {
    const year = visit.scheduled_date.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.visits.push(visit);
    else groups.push({ year, visits: [visit] });
  }
  return groups;
}

/** A note author's display name; '' when the author has no name at all. */
export function noteAuthorName(
  author: { first_name: string | null; last_name: string | null } | null | undefined
): string {
  return [author?.first_name, author?.last_name].filter(Boolean).join(' ').trim();
}
