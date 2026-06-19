import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  getCircleDetail,
  getEvents,
  type CalendarEvent,
  type CircleDetail,
} from '@/api/calendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import { addDays, daysBetween } from '@/components/calendar/dateMath';

// Module-level constant — never `?? []` inline in selectors/returns.
const EMPTY_EVENTS: CalendarEvent[] = [];

export interface UseCalendarEventsResult {
  /** Exactly the instances the API returned for the window (never client-expanded). */
  events: CalendarEvent[];
}

/**
 * React Query hook for GET /circles/:circleId/events with a date window
 * (plan Task 21). Fetches the visible week/month window and prefetches the
 * adjacent previous/next windows of the same span so navigation feels instant.
 * Dates are YYYY-MM-DD strings in the CARE RECIPIENT's timezone.
 */
export function useCalendarEvents(
  circleId: string,
  startDate: string,
  endDate: string
): UseQueryResult<CalendarEvent[]> & UseCalendarEventsResult {
  const queryClient = useQueryClient();
  const enabled = !!circleId && !!startDate && !!endDate;

  const query = useQuery({
    queryKey: queryKeys.calendarEventsRange(circleId, {
      start_date: startDate,
      end_date: endDate,
    }),
    queryFn: () => getEvents(circleId, { start_date: startDate, end_date: endDate }),
    enabled,
  });

  // Prefetch adjacent windows once the visible one resolves.
  const { isSuccess } = query;
  useEffect(() => {
    if (!enabled || !isSuccess) return;
    const span = daysBetween(startDate, endDate) + 1;
    const adjacent = [
      { start_date: addDays(startDate, -span), end_date: addDays(startDate, -1) },
      { start_date: addDays(endDate, 1), end_date: addDays(endDate, span) },
    ];
    for (const range of adjacent) {
      void queryClient.prefetchQuery({
        queryKey: queryKeys.calendarEventsRange(circleId, range),
        queryFn: () => getEvents(circleId, range),
      });
    }
  }, [enabled, isSuccess, circleId, startDate, endDate, queryClient]);

  return { ...query, events: query.data ?? EMPTY_EVENTS };
}

export interface UseCareRecipientTimezoneResult {
  /**
   * The care recipient's IANA timezone, or null until the circle detail loads.
   * Backend fallback chain (GET /circles/:circleId →
   * data.circle.care_recipient_timezone): care recipient → circle owner →
   * 'America/New_York'.
   */
  timezone: string | null;
}

/**
 * Care recipient timezone for a circle — all calendar rendering happens in
 * this timezone (same as mobile), with a visible "Times shown in …" label.
 */
export function useCareRecipientTimezone(
  circleId: string
): UseQueryResult<CircleDetail> & UseCareRecipientTimezoneResult {
  const query = useQuery({
    queryKey: queryKeys.circleDetail(circleId),
    queryFn: () => getCircleDetail(circleId),
    enabled: !!circleId,
  });

  const timezone = query.data ? query.data.care_recipient_timezone || 'America/New_York' : null;

  return { ...query, timezone };
}
