import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, Icon, IconTile, SectionHeader, Skeleton } from '@/components/ui';
import { addDays } from '@/components/calendar/dateMath';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useHourCycle } from '@/hooks/useHourCycle';
import {
  formatEventTimeCompact,
  getDateInTimezone,
  isEventPastDue,
  zoneReferenceInstant,
} from '@/utils/timezone';
import type { CalendarEvent } from '@/api/calendarEvents';

// Spec §6.3.5 — port of mobile/src/components/calendar/UpcomingAppointments.tsx.

/** Mobile's window and cap, verbatim. */
const WINDOW_DAYS = 14;
const MAX_ROWS = 3;

/**
 * YYYY-MM-DD `days` from `now`, in the care recipient's timezone.
 *
 * Composition of the two existing date-key helpers, not a third
 * reimplementation: `getDateInTimezone` resolves "today" in the recipient's
 * zone, then `addDays` (src/components/calendar/dateMath.ts) does calendar
 * arithmetic on that DATE KEY, never `now + days * 86_400_000`. A fixed 24
 * hours is not a day, so across a DST transition in the recipient's zone a +1
 * shift can land back on today or skip one — which would mislabel "Tomorrow"
 * or clip a day off the 14-day window.
 */
export function dateOffsetInTimezone(timezone: string, days: number, now: Date): string {
  return addDays(getDateInTimezone(timezone, now), days);
}

/**
 * Upcoming = an appointment, not completed, NOT ALREADY PAST, chronological.
 *
 * "Not past" is judged at the scheduled INSTANT in the care recipient's zone,
 * not at day granularity — mobile's bug report was a 9:33 PM appointment still
 * listed as upcoming at 10:13 PM, pushing a genuinely upcoming row past the
 * 3-row cap. `isEventPastDue`'s treatment of a null time is exactly right
 * here: an all-day appointment is not past due on its own day and drops off at
 * that zone's midnight.
 *
 * Tie-broken on id so the order is TOTAL — this list is SLICED, so a tie
 * decides which appointments the caregiver SEES, not merely their sequence.
 */
export function upcomingAppointments(
  events: CalendarEvent[],
  timezone: string,
  now: Date
): CalendarEvent[] {
  return events
    .filter(
      (e) =>
        e.event_type === 'appointment' &&
        !e.completed_at &&
        !isEventPastDue(e.scheduled_date, e.scheduled_time ?? null, timezone, now)
    )
    .sort((a, b) => {
      if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date < b.scheduled_date ? -1 : 1;
      const at = a.scheduled_time ?? '';
      const bt = b.scheduled_time ?? '';
      if (at !== bt) return at < bt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

export interface UpcomingAppointmentsProps {
  circleId: string;
  /** The care recipient's IANA timezone — all date/time math runs in it. */
  timezone: string;
}

/**
 * The next three appointments, or nothing at all.
 *
 * Hidden entirely when nothing is upcoming (mirrors mobile and TodaysMeds):
 * an "Upcoming appointments / none" card is a heading over a hole.
 */
export function UpcomingAppointments({
  circleId,
  timezone,
}: UpcomingAppointmentsProps): ReactElement | null {
  const { t, i18n } = useTranslation(['overview', 'common']);
  const cycle = useHourCycle();

  // ONE instant for the whole render — three separate `new Date()` calls could
  // straddle midnight in the recipient's zone and disagree about "today".
  const now = new Date();
  const today = getDateInTimezone(timezone, now);
  const tomorrow = dateOffsetInTimezone(timezone, 1, now);
  const windowEnd = dateOffsetInTimezone(timezone, WINDOW_DAYS, now);

  // Web's events query takes a date window only (no server-side event_type
  // filter, unlike mobile's) — the appointment filter is applied client-side
  // in `upcomingAppointments`, and the window is shared with the calendar
  // page's cache rather than minting a second key.
  const { events, isLoading } = useCalendarEvents(circleId, today, windowEnd);
  const upcoming = upcomingAppointments(events, timezone, now);
  const visible = upcoming.slice(0, MAX_ROWS);
  const base = `/circles/${circleId}`;

  if (isLoading) {
    return (
      <section aria-busy="true">
        <SectionHeader title={t('appointments.title')} tone="dusk" />
        <span role="status" className="sr-only">
          {t('common:loading')}
        </span>
        <Card padding="none" className="overflow-hidden">
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </Card>
      </section>
    );
  }

  if (visible.length === 0) return null;

  const dateLabel = (dateStr: string): string => {
    if (dateStr === today) return t('appointments.today');
    if (dateStr === tomorrow) return t('appointments.tomorrow');
    try {
      // `scheduled_date` is a naive local date — anchor it at noon UTC so
      // formatting can never roll it over into the neighbouring day.
      return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(i18n.language, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <section aria-labelledby="upcoming-appointments-heading">
      <SectionHeader
        id="upcoming-appointments-heading"
        title={t('appointments.title')}
        tone="dusk"
        to={`${base}/calendar`}
        linkLabel={t('appointments.viewAll')}
      />
      <Card padding="none" className="overflow-hidden">
        {visible.map((event) => {
          const time = event.scheduled_time
            ? formatEventTimeCompact(
                event.scheduled_time,
                timezone,
                cycle,
                // Judged at the appointment's OWN day: whether two zones differ
                // is a question with a date in it (Phoenix / Denver).
                zoneReferenceInstant(event.scheduled_date)
              )
            : null;
          const meta = [dateLabel(event.scheduled_date), time, event.location]
            .filter(Boolean)
            .join(' · ');
          return (
            <Link
              key={event.id}
              to={`${base}/calendar`}
              className="flex min-h-[56px] items-center gap-3 border-t border-line-2 px-4 py-3 transition-colors duration-fast first:border-t-0 hover:bg-bg-2"
            >
              <IconTile size={32} tone="dusk" name="calendar-outline" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-md text-ink">{event.title}</span>
                <span className="truncate text-sm text-ink-2">{meta}</span>
              </span>
              <Icon name="chevron-forward" size="inline" className="text-ink-3" />
            </Link>
          );
        })}
        {upcoming.length > MAX_ROWS ? (
          <Link
            to={`${base}/calendar`}
            className="block border-t border-line-2 px-4 py-3 text-center text-sm text-dusk transition-colors duration-fast hover:bg-bg-2"
          >
            {t('appointments.viewAll')}
          </Link>
        ) : null}
      </Card>
    </section>
  );
}

export default UpcomingAppointments;
