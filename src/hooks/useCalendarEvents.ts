import { useEffect } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  completeEvent,
  createEvent,
  deleteEvent,
  getCircleDetail,
  getEvents,
  updateEvent,
  type CalendarEvent,
  type CircleDetail,
  type CreateEventRequest,
  type DeleteEventOptions,
  type UpdateEventRequest,
} from '@/api/calendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import { isPermissionDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { addDays, daysBetween } from '@/components/calendar/dateMath';
import { Analytics } from '@/lib/analytics';

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

// ===========================================================================
// Event WRITE hooks (Task 1.3)
// ---------------------------------------------------------------------------
// Mirror the SHIPPED mutation pattern in useMedConfirmation.ts: mutationFn →
// onSuccess invalidates the same query families mobile's useCalendarEvents
// hook invalidates (calendarEvents, calendarEvent, tasks, activityFeed, plus
// the medicationTodaySummary / circle keys mobile also touches) → onError
// distinguishes permission/subscription rejection (toast + refetch circle
// flags) from a conflict (refetch state).
// ===========================================================================

/**
 * Invalidate every query family a successful event write affects. Mirrors
 * mobile/src/hooks/useCalendarEvents.ts invalidation set.
 */
function invalidateEventQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string,
  eventId?: string
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
  if (eventId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(circleId, eventId) });
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.medicationTodaySummary(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.circle(circleId) });
}

/**
 * Shared onError for event mutations: on a 402/403 rejection
 * (requireCircleEditAccess), surface the right toast and refetch circle flags
 * so the stale can_edit/view_only/read_only state refreshes — the backend
 * enforces access regardless of cached UI state.
 */
function useEventMutationOnError(circleId: string): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('calendar');

  return (error: unknown) => {
    if (isSubscriptionRequiredError(error)) {
      // Web cannot transact — point the user at the app to upgrade.
      showToast(t('errors.subscriptionRequired'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    } else {
      // Conflict / parallel-edit path: refetch current state.
      showToast(t('errors.saveFailed'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
    }
  };
}

/** POST /circles/:circleId/events — create an event. */
export function useCreateEvent(
  circleId: string
): UseMutationResult<CalendarEvent, unknown, CreateEventRequest> {
  const queryClient = useQueryClient();
  const onError = useEventMutationOnError(circleId);

  return useMutation({
    mutationFn: (data: CreateEventRequest) => createEvent(circleId, data),
    onSuccess: (event) => {
      // PHI-safe: only circle_id, the event_type enum, and a recurring boolean.
      Analytics.eventCreated(circleId, event.event_type, !!event.recurrence_rule);
      invalidateEventQueries(queryClient, circleId, event?.id);
    },
    onError,
  });
}

export interface UpdateEventVariables {
  /** Edits target the PARENT series: caller passes `parent_event_id || id`. */
  eventId: string;
  data: UpdateEventRequest;
}

/**
 * PATCH /circles/:circleId/events/:eventId — edit the parent series. Callers
 * MUST pass `eventId = event.parent_event_id || event.id`; the hook does a plain
 * PATCH with no scope param (mobile has no "this event only" edit).
 */
export function useUpdateEvent(
  circleId: string
): UseMutationResult<CalendarEvent, unknown, UpdateEventVariables> {
  const queryClient = useQueryClient();
  const onError = useEventMutationOnError(circleId);

  return useMutation({
    mutationFn: ({ eventId, data }: UpdateEventVariables) => updateEvent(circleId, eventId, data),
    onSuccess: (_event, variables) => {
      invalidateEventQueries(queryClient, circleId, variables.eventId);
    },
    onError,
  });
}

export interface DeleteEventVariables extends DeleteEventOptions {
  eventId: string;
}

/**
 * DELETE /circles/:circleId/events/:eventId — scoped delete. Recurring events
 * pass `deleteScope` (`single` | `future`) + `scheduledDate`; non-recurring
 * pass neither.
 */
export function useDeleteEvent(
  circleId: string
): UseMutationResult<void, unknown, DeleteEventVariables> {
  const queryClient = useQueryClient();
  const onError = useEventMutationOnError(circleId);

  return useMutation({
    mutationFn: ({ eventId, deleteScope, scheduledDate }: DeleteEventVariables) =>
      deleteEvent(circleId, eventId, { deleteScope, scheduledDate }),
    onSuccess: (_void, variables) => {
      invalidateEventQueries(queryClient, circleId, variables.eventId);
    },
    onError,
  });
}

/** POST /circles/:circleId/events/:eventId/complete — complete a task/appt. */
export function useCompleteEvent(
  circleId: string
): UseMutationResult<CalendarEvent, unknown, string> {
  const queryClient = useQueryClient();
  const onError = useEventMutationOnError(circleId);

  return useMutation({
    mutationFn: (eventId: string) => completeEvent(circleId, eventId),
    onSuccess: (event, eventId) => {
      // PHI-safe: only circle_id. Branch on the event_type enum so appointments
      // and tasks land on the matching mobile event names.
      if (event?.event_type === 'appointment') {
        Analytics.appointmentCompleted(circleId);
      } else {
        Analytics.taskCompleted(circleId);
      }
      invalidateEventQueries(queryClient, circleId, eventId);
    },
    onError,
  });
}
