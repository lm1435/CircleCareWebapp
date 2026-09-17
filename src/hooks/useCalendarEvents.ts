import { useEffect, useMemo } from 'react';
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
  getEventsPresence,
  setMedicationStatus,
  updateEvent,
  type CalendarEvent,
  type CircleDetail,
  type CreateEventRequest,
  type DeleteEventOptions,
  type EventsPresence,
  type MedicationStatusResult,
  type MedicationStatusScope,
  type UpdateEventRequest,
} from '@/api/calendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import {
  classifyFailureCode,
  isDoseAlreadyLoggedError,
  isInvalidOccurrenceDateError,
  isNotFoundError,
  isPermissionDeniedError,
  isSubscriptionRequiredError,
} from '@/lib/apiErrors';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { addDays, daysBetween } from '@/components/calendar/dateMath';
import { Analytics } from '@/lib/analytics';

// Module-level constant — never `?? []` inline in selectors/returns.
const EMPTY_EVENTS: CalendarEvent[] = [];

export interface UseCalendarEventsResult {
  /** Exactly the instances the API returned for the window (never client-expanded). */
  events: CalendarEvent[];
}

export interface UseCalendarEventsOptions {
  /**
   * Prefetch the previous and next windows of the same span once this one
   * resolves, so week/month navigation feels instant. OFF by default.
   *
   * OPT-IN BECAUSE IT MULTIPLIES EVERY READ BY THREE. It used to be
   * unconditional, and Home paid for it: the checklist's 211-day presence
   * window dragged in two more 211-day lists (~1.4 MB each on the demo circle)
   * and UpcomingAppointments' 15-day window two 15-day ones — 8 requests and
   * 680 days of events to render three cards. Only a surface that actually
   * moves window-to-window (CalendarPage) should pass `true`.
   */
  prefetchAdjacent?: boolean;
}

/**
 * React Query hook for GET /circles/:circleId/events with a date window
 * (plan Task 21). Fetches exactly the requested window; with
 * `prefetchAdjacent: true` it also prefetches the previous/next windows of the
 * same span (see `UseCalendarEventsOptions`).
 * Dates are YYYY-MM-DD strings in the CARE RECIPIENT's timezone.
 */
export function useCalendarEvents(
  circleId: string,
  startDate: string,
  endDate: string,
  options: UseCalendarEventsOptions = {}
): UseQueryResult<CalendarEvent[]> & UseCalendarEventsResult {
  const queryClient = useQueryClient();
  const enabled = !!circleId && !!startDate && !!endDate;
  const prefetchAdjacent = options.prefetchAdjacent === true;

  const query = useQuery({
    queryKey: queryKeys.calendarEventsRange(circleId, {
      start_date: startDate,
      end_date: endDate,
    }),
    queryFn: () => getEvents(circleId, { start_date: startDate, end_date: endDate }),
    enabled,
  });

  // Prefetch adjacent windows once the visible one resolves — opt-in only.
  const { isSuccess } = query;
  useEffect(() => {
    if (!prefetchAdjacent || !enabled || !isSuccess) return;
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
  }, [prefetchAdjacent, enabled, isSuccess, circleId, startDate, endDate, queryClient]);

  return { ...query, events: query.data ?? EMPTY_EVENTS };
}

/**
 * True when a presence request failed because the ROUTE does not exist — an
 * older backend. There, GET /events/presence falls through to
 * GET /events/:eventId with eventId "presence" and answers 404 NOT_FOUND (the
 * apiClient interceptor rejects with that envelope, which carries no status);
 * a bare 404 with no body is accepted too.
 */
function isPresenceRouteMissing(error: unknown): boolean {
  if (isNotFoundError(error)) return true;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; response?: { status?: unknown } | null };
  return candidate.response?.status === 404 || candidate.status === 404;
}

function presenceFromEvents(events: CalendarEvent[]): EventsPresence {
  return {
    medication: events.some((e) => e.event_type === 'medication'),
    appointment: events.some((e) => e.event_type === 'appointment'),
    task: events.some((e) => e.event_type === 'task'),
  };
}

export interface UseEventsPresenceResult {
  /** Per-type presence in the window; undefined unless `isSuccess`. */
  data: EventsPresence | undefined;
  isSuccess: boolean;
  /** Still loading OR paused offline — never a settled "nothing exists". */
  isPending: boolean;
  isError: boolean;
  /** Answered by the full-range list fallback (backend without the route). */
  isFallback: boolean;
  /** Re-asks whichever read is deciding: the presence endpoint, or the fallback list. */
  refetch: () => Promise<unknown>;
}

/**
 * "Does this window hold at least one medication / appointment / task?" —
 * GET /circles/:circleId/events/presence, per-type booleans, no rows.
 *
 * Replaces reading a 211-day events LIST just to call `.some()` on it (the
 * Get-started checklist and TodaysMeds' first-run split). Each boolean means
 * exactly "GET /events for this window would return >= 1 event of that type".
 *
 * KEY: `calendarEventsPresence` lives UNDER the `calendarEvents(circleId)`
 * prefix on purpose, so every event write's existing prefix invalidation (and
 * any refetch of that prefix, e.g. a Retry) refreshes presence too — adding the
 * first medication flips `medication` without a second invalidation to forget.
 *
 * DEPLOY-ORDER FALLBACK: if the backend has no presence route yet (404), the
 * query resolves to `null` and the hook derives presence from ONE full-range
 * `getEvents` read under the same range key the old code used, with no
 * adjacent prefetch — behaviour identical to before on an old backend. Any
 * OTHER failure is a plain error: no fallback download.
 */
export function useEventsPresence(
  circleId: string,
  startDate: string,
  endDate: string
): UseEventsPresenceResult {
  const enabled = !!circleId && !!startDate && !!endDate;
  const range = { start_date: startDate, end_date: endDate };

  const presenceQuery = useQuery<EventsPresence | null>({
    queryKey: queryKeys.calendarEventsPresence(circleId, range),
    queryFn: async () => {
      try {
        return await getEventsPresence(circleId, range);
      } catch (error) {
        // `null` = "this backend cannot answer" — a settled answer, so it is
        // not retried and the fallback below takes over.
        if (isPresenceRouteMissing(error)) return null;
        throw error;
      }
    },
    enabled,
  });

  const routeMissing = presenceQuery.isSuccess && presenceQuery.data === null;
  const fallbackQuery = useQuery({
    queryKey: queryKeys.calendarEventsRange(circleId, range),
    queryFn: () => getEvents(circleId, range),
    enabled: enabled && routeMissing,
  });
  const fallbackEvents = fallbackQuery.data;
  const fallbackPresence = useMemo(
    () => (fallbackEvents ? presenceFromEvents(fallbackEvents) : undefined),
    [fallbackEvents]
  );

  if (!routeMissing) {
    return {
      data: presenceQuery.isSuccess ? (presenceQuery.data ?? undefined) : undefined,
      isSuccess: presenceQuery.isSuccess,
      isPending: presenceQuery.isPending,
      isError: presenceQuery.isError,
      isFallback: false,
      refetch: presenceQuery.refetch,
    };
  }
  return {
    data: fallbackQuery.isSuccess ? fallbackPresence : undefined,
    isSuccess: fallbackQuery.isSuccess,
    isPending: fallbackQuery.isPending,
    isError: fallbackQuery.isError,
    isFallback: true,
    refetch: fallbackQuery.refetch,
  };
}

/**
 * Medication roster query — the ONLY web fetch that requests the full set of
 * discontinued meds (`includeDiscontinued=true`) so the Medications page can
 * split Active vs Inactive. Mirrors mobile's MedicationHistoryScreen roster
 * fetch exactly: no date range, so the backend applies its default window (15
 * days back, 30 days forward — wide enough to capture every med parent/instance
 * the roster needs). The calendar page keeps fetching WITHOUT the flag; it
 * still receives the historical occurrences that predate each discontinue
 * instant (rendered with an "Inactive" marker), just not the ones after it.
 *
 * Key shape matches mobile's ['calendarEvents', circleId, params], so the
 * shared `calendarEvents(circleId)` prefix invalidation in every write hook
 * refreshes the roster too.
 */
export function useMedicationRoster(
  circleId: string
): UseQueryResult<CalendarEvent[]> & UseCalendarEventsResult {
  const query = useQuery({
    queryKey: [...queryKeys.calendarEvents(circleId), { includeDiscontinued: true }],
    queryFn: () => getEvents(circleId, { includeDiscontinued: true }),
    enabled: !!circleId,
  });
  return { ...query, events: query.data ?? EMPTY_EVENTS };
}

/**
 * Snapshot of every calendar event ALREADY in the query cache for a circle —
 * all fetched windows plus the medication roster, deduped by event id. Reads
 * the cache only (no fetching, not reactive): used for history-based title
 * suggestions (docs/plans/condition-tags.md QP6), where a point-in-time
 * snapshot at form-open is exactly right.
 */
export function useCachedCircleEvents(circleId: string): CalendarEvent[] {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const cached = queryClient.getQueriesData<CalendarEvent[]>({
      queryKey: queryKeys.calendarEvents(circleId),
    });
    const seen = new Set<string>();
    const events: CalendarEvent[] = [];
    for (const [, data] of cached) {
      if (!Array.isArray(data)) continue;
      for (const event of data) {
        if (event?.id && !seen.has(event.id)) {
          seen.add(event.id);
          events.push(event);
        }
      }
    }
    return events;
  }, [queryClient, circleId]);
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
 *
 * RETURNS the calendar-events refetch so a caller that must not announce
 * success before the calendar has caught up can await it (see
 * `useMedicationStatus`). Every other family is fire-and-forget, as before —
 * nothing on screen at that moment is waiting on them. Callers that do not
 * need the wait `void` the result.
 */
function invalidateEventQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string,
  eventId?: string
): Promise<void> {
  const calendarRefreshed = queryClient.invalidateQueries({
    queryKey: queryKeys.calendarEvents(circleId),
  });
  if (eventId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(circleId, eventId) });
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.medicationTodaySummary(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.circle(circleId) });
  return calendarRefreshed;
}

/**
 * How long a caller may be held waiting for the post-mutation calendar refetch
 * before it announces success anyway.
 *
 * The wait must be bounded: this app runs React Query in `networkMode:
 * 'online'` (lib/queryClient.ts), where a refetch attempted while offline is
 * PAUSED rather than failed, and a paused refetch's promise does not settle
 * until connectivity returns. A connection that drops between the PATCH
 * succeeding and the refetch starting would otherwise swallow the confirmation
 * entirely — the caregiver sees no toast at all and re-runs an action that
 * already worked. Past the cap the toast shows and the refetch finishes in the
 * background; the data still lands, just after the toast.
 */
const CALENDAR_REFRESH_WAIT_MS = 2500;

/**
 * Resolve when the calendar refetch lands, or at the cap — whichever is first.
 *
 * The timer is ALWAYS cleared, including when the refetch wins the race: a
 * stray 2.5s timer per mutation keeps the event loop awake for nothing (and
 * holds Vitest's process open in tests). Losing the race does NOT cancel the
 * refetch — it keeps running and still updates the cache, the caller simply
 * stops waiting on it.
 */
function withCalendarRefreshCap(refreshed: Promise<void>): Promise<unknown> {
  let capTimer: ReturnType<typeof setTimeout>;
  const capped = new Promise((resolve) => {
    capTimer = setTimeout(resolve, CALENDAR_REFRESH_WAIT_MS);
  });
  return Promise.race([refreshed, capped]).finally(() => clearTimeout(capTimer));
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
  // Premium-gated write on a free-tier read-only circle — FEATURE.
  const { promptUpgrade } = usePremiumGate('feature');
  const { t } = useTranslation('calendar');

  return (error: unknown) => {
    // Counted before it is classified for the UI — every failed event write
    // reaches the admin digest as `error_occurred`. ids/enums only: `code` is
    // the closed-set `classifyFailureCode` value, never the toast copy.
    Analytics.errorOccurred('calendar_events', 'calendar_events_mutation_error', {
      circle_id: circleId,
      code: classifyFailureCode(error),
    });
    if (isSubscriptionRequiredError(error)) {
      // Web cannot transact — point the user at the app to upgrade.
      promptUpgrade();
      invalidateCircleAccessFlags(queryClient, circleId);
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      invalidateCircleAccessFlags(queryClient, circleId);
    } else if (isInvalidOccurrenceDateError(error)) {
      // 400 INVALID_OCCURRENCE_DATE: the day this row was drawn for is no
      // longer an occurrence of the series — someone else shortened the
      // recurrence or changed its pattern while this tab held a 60s-stale
      // calendar. The request can NEVER succeed (a retry re-posts the same
      // off-pattern date), so "Couldn't save, try again" was both wrong and
      // useless. Say what happened, then refetch: leaving the dead row on
      // screen only sets up the next press to fail the same way.
      showToast(t('errors.invalidOccurrenceDate'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
    } else if (isNotFoundError(error)) {
      // 404: the row was deleted by another member between render and press.
      // Same stale-snapshot shape, same remedy.
      showToast(t('errors.eventNotFound'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
    } else if (isDoseAlreadyLoggedError(error)) {
      // 409 DOSE_ALREADY_LOGGED: the edit tried to move a confirmed dose's
      // time. Not retryable — say exactly why, then refetch the real state.
      showToast(t('errors.doseAlreadyLogged'), 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
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
      void invalidateEventQueries(queryClient, circleId, event?.id);
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
      void invalidateEventQueries(queryClient, circleId, variables.eventId);
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
      void invalidateEventQueries(queryClient, circleId, variables.eventId);
    },
    onError,
  });
}

export interface MedicationStatusVariables {
  /** Any instance id (parent or child) — backend resolves the series root. */
  eventId: string;
  /** true = discontinue/inactivate, false = reactivate. */
  discontinued: boolean;
  /**
   * `'medication'` widens the change to EVERY series root sharing this
   * medication's name + dosage, resolved server-side. Omitted = the backend's
   * `'series'` default (root + physical children only).
   */
  scope?: MedicationStatusScope;
}

/**
 * PATCH /circles/:circleId/events/:eventId/medication-status — discontinue or
 * reactivate a medication. Invalidates the same query families a delete does
 * (calendar/med/today-summary) because a discontinue drops the med's FUTURE
 * occurrences out of the Calendar GET (the earlier ones stay, refetched with
 * `discontinued_at` set so they render as inactive), and a reactivate brings
 * the full series back.
 *
 * DISCONTINUE / REACTIVATE CANNOT BE PATCHED INTO THE CACHE, SO THE CALLER
 * WAITS FOR THE REFETCH INSTEAD.
 *
 * Which occurrences a stop or a reinstatement adds or removes is decided
 * entirely server-side — the response carries counts, not rows. There is no
 * correct client-side edit to apply, so the calendar and the medication roster
 * can only become right again by refetching.
 *
 * That refetch is therefore AWAITED (returned from `onSuccess`, so
 * `mutateAsync` resolves after it), because every caller announces success the
 * instant it resolves — `MedicationsPage.handleReactivateForEdit`,
 * `DiscontinueMedDialog` and `EventDetailActions` all raise a toast. Without
 * the wait the toast lands over a roster that still shows the med in its old
 * section, and it only moves a round trip later — read as a lag or a stale
 * cache. The wait is the same length either way; this spends it before the
 * confirmation rather than after, while the action is still disabled by
 * `isPending`. Bounded by `CALENDAR_REFRESH_WAIT_MS` — see the note there.
 */
export function useMedicationStatus(
  circleId: string
): UseMutationResult<MedicationStatusResult, unknown, MedicationStatusVariables> {
  const queryClient = useQueryClient();
  const onError = useEventMutationOnError(circleId);

  return useMutation({
    mutationFn: ({ eventId, discontinued, scope }: MedicationStatusVariables) =>
      setMedicationStatus(circleId, eventId, discontinued, scope),
    onSuccess: (_result, variables) =>
      withCalendarRefreshCap(invalidateEventQueries(queryClient, circleId, variables.eventId)),
    onError,
  });
}

export interface CompleteEventVariables {
  /**
   * THE MUTATION TARGET. A recurring series is addressed by its ROOT
   * (`parent_event_id || id`) — its later occurrences are virtual rows with a
   * composite id no `id` column can match.
   */
  eventId: string;
  /**
   * WHICH OCCURRENCE, for a series addressed by its root. Left undefined when
   * the target IS the row being completed (a one-off, or a physical row opened
   * by its own id), which keeps that request body-less and unchanged.
   */
  scheduledDate?: string;
}

/** POST /circles/:circleId/events/:eventId/complete — complete a task/appt. */
export function useCompleteEvent(
  circleId: string
): UseMutationResult<CalendarEvent, unknown, CompleteEventVariables> {
  const queryClient = useQueryClient();
  const onError = useEventMutationOnError(circleId);

  return useMutation({
    mutationFn: ({ eventId, scheduledDate }: CompleteEventVariables) =>
      completeEvent(circleId, eventId, scheduledDate),
    onSuccess: (event, variables) => {
      // PHI-safe: only circle_id. Branch on the event_type enum so appointments
      // and tasks land on the matching mobile event names.
      if (event?.event_type === 'appointment') {
        Analytics.appointmentCompleted(circleId);
      } else {
        Analytics.taskCompleted(circleId);
      }
      void invalidateEventQueries(queryClient, circleId, variables.eventId);
    },
    onError,
  });
}
