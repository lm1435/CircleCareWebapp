import { useMemo } from 'react';
import { addDays } from '@/components/calendar/dateMath';
import { buildNextUp, type NextUpItem } from '@/components/overview/nextUpItems';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useMedsForDate, useTodaysMeds } from '@/hooks/useMedConfirmation';
import { useTasks } from '@/hooks/useTasks';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { TodaysMedication } from '@/api/medicationConfirmations';
import { getDateInTimezone } from '@/utils/timezone';

const EMPTY_MEDS: TodaysMedication[] = [];
const EMPTY_EVENTS: CalendarEvent[] = [];

/** The calendar window Today shares across Next up, Quick access and refill counts. */
export const TODAY_WINDOW_DAYS = 14;

export interface UseNextUpResult {
  items: NextUpItem[];
  /** Every read that decides the list has answered (success or error). */
  settled: boolean;
  isError: boolean;
  today: string;
  refetch: () => void;
}

/**
 * Today's meds, appointments and open tasks merged in time order. Uses the
 * same queries (and cache keys) as TodaysMeds, UpcomingAppointments and the
 * Tasks page, so nothing here is a new request shape.
 */
export function useNextUp(circleId: string, timezone: string | null): UseNextUpResult {
  const today = timezone ? getDateInTimezone(timezone) : '';
  const medsQuery = useTodaysMeds(circleId, timezone ?? undefined);
  // Yesterday's unanswered doses stay reachable here (they used to sit under "Needs attention"
  // on the old Home): a dose nobody answered must not vanish at midnight.
  const yesterdayQuery = useMedsForDate(circleId, today ? addDays(today, -1) : undefined);
  const eventsQuery = useCalendarEvents(
    circleId,
    today,
    today ? addDays(today, TODAY_WINDOW_DAYS) : ''
  );
  const tasksQuery = useTasks(circleId, { status: 'open' });

  const medsToday = medsQuery.data;
  const medsYesterday = yesterdayQuery.data;
  const medsData = useMemo(
    () => [...(medsYesterday ?? EMPTY_MEDS), ...(medsToday ?? EMPTY_MEDS)],
    [medsToday, medsYesterday]
  );
  const eventsData = eventsQuery.data;
  const tasksData = tasksQuery.data?.tasks;

  const items = useMemo(
    () =>
      timezone
        ? buildNextUp({
            meds: medsData,
            events: eventsData ?? EMPTY_EVENTS,
            tasks: tasksData ?? EMPTY_EVENTS,
            timezone,
            today,
            now: new Date(),
          })
        : [],
    [medsData, eventsData, tasksData, timezone, today]
  );

  // A failed YESTERDAY read only costs the backlog: it never blocks or errors the list.
  const queries = [medsQuery, eventsQuery, tasksQuery];
  return {
    items,
    settled:
      !!timezone &&
      queries.every((q) => q.isSuccess || q.isError) &&
      (yesterdayQuery.isSuccess || yesterdayQuery.isError),
    isError: queries.some((q) => q.isError),
    today,
    refetch: () => queries.forEach((q) => void q.refetch()),
  };
}
