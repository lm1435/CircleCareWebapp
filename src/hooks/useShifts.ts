import { useCallback } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  assignShift,
  createShift,
  dropShift,
  getShifts,
  takeShift,
  updateShift,
  type CreateShiftRequest,
  type ShiftActionResult,
  type ShiftScope,
} from '@/api/shifts';
import { deleteEvent, getSeriesRoot, type CalendarEvent, type UpdateEventRequest } from '@/api/calendarEvents';
import { useToast } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import { classifyShiftFailure, describeShiftFailure } from '@/lib/shiftErrors';
import { failureContext, type FailureAction } from '@/lib/apiErrors';
import { queryKeys } from '@/lib/queryKeys';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import {
  canTakeFuture,
  countOpenUpcoming,
  isShiftRepeating,
  seriesDefaultOpen,
  isWithin24hOfStart,
  openShiftWindow,
  patchOccurrences,
  shiftRootId,
  targetFor,
  type OccurrenceTarget,
} from '@/components/shifts/shiftUtils';
import { getDateInTimezone } from '@/utils/timezone';

// Care shifts hooks (docs/plans/care-shifts.md, W1). Server state only — no
// store. Reads are their own query family (`queryKeys.shifts`), so the Schedule
// queries never share a cache entry with a shifts-only response.

// Module-level constant — never `?? []` inline in selectors/returns.
const EMPTY_SHIFTS: CalendarEvent[] = [];

/** The open-count window is cached for 60 s (spec: "one bounded 7-day range, cached for 60 s"). */
const OPEN_COUNT_STALE_MS = 60_000;

export interface UseShiftsResult {
  /** Exactly the rows the API returned for the window (never client-expanded). */
  shifts: CalendarEvent[];
}

/** Shifts in a window (`YYYY-MM-DD`, recipient frame). Disabled until `enabled` and both ends are known. */
export function useShiftsByRange(
  circleId: string,
  startDate: string,
  endDate: string,
  enabled = true
): UseQueryResult<CalendarEvent[]> & UseShiftsResult {
  const query = useQuery({
    queryKey: queryKeys.shiftsRange(circleId, { start_date: startDate, end_date: endDate }),
    queryFn: () => getShifts(circleId, startDate, endDate),
    enabled: enabled && !!circleId && !!startDate && !!endDate,
  });
  return { ...query, shifts: query.data ?? EMPTY_SHIFTS };
}

export interface UseOpenShiftCountResult {
  /** Open, not-yet-ended shifts from today through the next 7 days; `null` while loading (no count yet). */
  count: number | null;
}

function useBadgeWindowQuery<T>(
  circleId: string,
  timezone: string | null,
  enabled: boolean,
  select: (rows: CalendarEvent[]) => T
): UseQueryResult<T> {
  const win = timezone ? openShiftWindow(getDateInTimezone(timezone)) : null;
  return useQuery({
    queryKey: queryKeys.openShiftsWindow(circleId, {
      start_date: win?.start ?? '',
      end_date: win?.end ?? '',
    }),
    queryFn: () => getShifts(circleId, win?.start ?? '', win?.end ?? ''),
    enabled: enabled && !!circleId && !!win,
    staleTime: OPEN_COUNT_STALE_MS,
    select,
  });
}

/**
 * Open shifts over today .. today+6 in the
 * RECIPIENT's timezone, excluding shifts that have already ENDED. `null` until
 * the first answer arrives and on error. Feeds only the shifts_view_opened bucket
 * (the Shifts toggle badge was removed 2026-10-24).
 * `settled` is true once the window query answered OR failed (analytics).
 */
export function useOpenShiftCount(
  circleId: string,
  timezone: string | null,
  enabled: boolean
): UseOpenShiftCountResult & { settled: boolean } {
  const query = useBadgeWindowQuery(circleId, timezone, enabled, (rows) =>
    // Only the count is kept. The clock is read
    // per select run, so a shift that ended since the fetch drops on re-render.
    timezone ? countOpenUpcoming(rows, timezone) : 0
  );
  return {
    count: query.isSuccess ? (query.data as number) : null,
    settled: query.isSuccess || query.isError,
  };
}

/**
 * The same bounded window's rows (shares the open-count cache entry): the Shifts
 * empty state shows only when the visible range holds today AND this 7-day peek
 * is empty too. `undefined` until loaded.
 */
export function useShiftsPeek(
  circleId: string,
  timezone: string | null,
  enabled: boolean
): CalendarEvent[] | undefined {
  const query = useBadgeWindowQuery(circleId, timezone, enabled, (rows) => rows);
  return query.isSuccess ? query.data : undefined;
}

/**
 * May the viewer take "this and every future one" of `event`? Same rule as
 * mobile's `useCanTakeFuture`: when the loaded rows don't say who holds the
 * series default, fetch the root (one read, cached 60 s) so a physical row whose
 * root sits outside the loaded window still gets the option.
 */
export function useCanTakeFuture(
  circleId: string,
  event: CalendarEvent | null,
  loaded: readonly CalendarEvent[],
  canAssignOthers: boolean
): boolean {
  const rootId = event ? shiftRootId(event) : '';
  const needsRoot =
    !!event &&
    isShiftRepeating(event) &&
    !canAssignOthers &&
    seriesDefaultOpen(event, loaded) === undefined;
  const { data: root } = useQuery({
    queryKey: [...queryKeys.shifts(circleId), 'seriesRoot', rootId],
    queryFn: () => getSeriesRoot(circleId, rootId),
    enabled: needsRoot && !!circleId && !!rootId,
    staleTime: OPEN_COUNT_STALE_MS,
  });
  return event ? canTakeFuture(event, loaded, canAssignOthers, root ?? null) : false;
}

/**
 * The row whose recurrence rule describes `event`'s series: itself when it
 * carries a rule, else (a child row: `parent_event_id`, no rule) the series root,
 * fetched under the same key as `useCanTakeFuture` so the two share one read.
 * `null` while loading / on error.
 */
export function useShiftSeriesRoot(
  circleId: string,
  event: CalendarEvent | null
): Pick<CalendarEvent, 'id' | 'assigned_to' | 'recurrence_rule' | 'recurrence_days'> | null {
  const rootId = event ? shiftRootId(event) : '';
  const needsRoot = !!event && !!event.parent_event_id && !event.recurrence_rule;
  const { data: root } = useQuery({
    queryKey: [...queryKeys.shifts(circleId), 'seriesRoot', rootId],
    queryFn: () => getSeriesRoot(circleId, rootId),
    enabled: needsRoot && !!circleId && !!rootId,
    staleTime: OPEN_COUNT_STALE_MS,
  });
  if (!event) return null;
  if (event.recurrence_rule) return event;
  return root ?? null;
}

function invalidateShifts(queryClient: ReturnType<typeof useQueryClient>, circleId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.shifts(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
}

/** Shared failure handling for every shift write (see `docs/plans/care-shifts.md` UI States). */
type ShiftAction = 'take' | 'drop' | 'assign' | 'save' | 'delete';

/**
 * The cache-side half of a failed write (the words are the CALLER's, via
 * `useHandleShiftFailure`, so a dialog can stay open inline for a retryable
 * failure): refetch what the server has NOW (the loser of a take race sees the
 * winner; a stale row disappears), prompt the owner-aware paywall, refresh the
 * access flags on a permission refusal.
 */
function useShiftMutationOnError(
  circleId: string,
  action: FailureAction
): (error: unknown) => void {
  const queryClient = useQueryClient();
  // Owner-aware: only the circle's OWNER is offered Upgrade; everyone else gets
  // the owner-only notice (premium = the OWNER's tier).
  const { promptUpgrade } = usePremiumGate('shifts', { circleId });

  return useCallback(
    (error: unknown) => {
      // `error_occurred` for the admin digest: enums only, no circle_id.
      Analytics.errorOccurred('shifts', `shifts_${action}_failed`, failureContext('shifts', action, error));
      const kind = classifyShiftFailure(error);
      if (kind === 'already_taken') Analytics.shiftTakeConflict();
      if (kind === 'subscription') {
        promptUpgrade();
        invalidateCircleAccessFlags(queryClient, circleId);
        return;
      }
      if (kind === 'permission') invalidateCircleAccessFlags(queryClient, circleId);
      invalidateShifts(queryClient, circleId);
    },
    [circleId, promptUpgrade, queryClient, action]
  );
}

/**
 * The words of a failed shift write. Returns `{ close, message }`: a classified
 * failure (taken, gone, not allowed, ...) toasts and tells the caller to CLOSE
 * its dialog; a network / server failure (and nothing else) returns the inline
 * `message` and `close: false` so the dialog stays open with a retry. A paywall
 * refusal closes with no toast (the upgrade prompt is the feedback).
 */
export function useHandleShiftFailure(): (
  error: unknown,
  verb: ShiftAction | 'edit'
) => { close: boolean; message: string } {
  const { showToast } = useToast();
  const { t } = useTranslation('shifts');
  return useCallback(
    (error, verb) => {
      const { kind, message, specific } = describeShiftFailure(t, error, verb);
      if (kind === 'subscription') return { close: true, message: '' };
      if (specific) {
        showToast(message, 'error');
        return { close: true, message: '' };
      }
      return { close: false, message };
    },
    [showToast, t]
  );
}

// ---------------------------------------------------------------------------
// Optimistic assignee patch
// ---------------------------------------------------------------------------

type Snapshot = Array<[readonly unknown[], CalendarEvent[] | undefined]>;

/**
 * Patch the rows an action touches in every cached shifts range, returning a
 * snapshot for rollback. Uses the same rules as mobile's `patchOccurrences`: a
 * `future` action patches the tapped date plus later rows the SERVER will move
 * (a take moves OPEN rows only; a drop / assign moves rows held by the same
 * person), never someone else's explicit rows. The server's response (and the
 * refetch after it) is the truth: this only makes the card flip at once.
 */
function patchCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string,
  target: OccurrenceTarget,
  patch: Partial<CalendarEvent>
): Snapshot {
  const entries = queryClient.getQueriesData<CalendarEvent[]>({
    queryKey: queryKeys.shifts(circleId),
  });
  const snapshot: Snapshot = [];
  for (const [key, rows] of entries) {
    if (!Array.isArray(rows)) continue;
    snapshot.push([key, rows]);
    queryClient.setQueryData<CalendarEvent[]>(key, patchOccurrences(rows, target, patch));
  }
  return snapshot;
}

function rollback(queryClient: ReturnType<typeof useQueryClient>, snapshot: Snapshot | undefined): void {
  for (const [key, rows] of snapshot ?? []) queryClient.setQueryData(key, rows);
}

export interface ShiftActionVariables {
  shift: CalendarEvent;
  scope: ShiftScope;
}

export interface TakeShiftVariables extends ShiftActionVariables {
  /** Only when the taker changed it from the shift's own value; null = Off. */
  reminder?: 60 | 120 | 240 | 1440 | null;
}

export interface AssignShiftVariables extends ShiftActionVariables {
  userId: string;
}

interface OptimisticContext {
  snapshot?: Snapshot;
}

/** POST .../shift/take — "Take shift". */
export function useTakeShift(
  circleId: string
): UseMutationResult<ShiftActionResult, unknown, TakeShiftVariables, OptimisticContext> {
  const queryClient = useQueryClient();
  const onError = useShiftMutationOnError(circleId, 'update');
  const me = useAuthStore((s) => s.user);

  return useMutation({
    mutationFn: ({ shift, scope, reminder }: TakeShiftVariables) =>
      takeShift(circleId, shift.id, {
        scope,
        scheduledDate: shift.scheduled_date,
        ...(reminder !== undefined ? { reminder_lead_minutes: reminder } : {}),
      }),
    onMutate: async ({ shift, scope, reminder }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.shifts(circleId) });
      return {
        snapshot: patchCaches(
          queryClient,
          circleId,
          targetFor(shift, scope, 'take'),
          me
            ? {
                assigned_to: me.id,
                assigned_to_user: {
                  id: me.id,
                  first_name: me.first_name ?? null,
                  last_name: me.last_name ?? null,
                  email: me.email ?? null,
                },
                ...(reminder !== undefined ? { reminder_lead_minutes: reminder } : {}),
              }
            : { assigned_to: null, assigned_to_user: null }
        ),
      };
    },
    onSuccess: (_result, { scope, reminder }) => {
      Analytics.shiftTaken({ scope, reminderChanged: reminder !== undefined });
    },
    onError: (error, _vars, context) => {
      rollback(queryClient, context?.snapshot);
      onError(error);
    },
    // Refetch either way: a `future` take splits the series (new root id).
    onSettled: () => invalidateShifts(queryClient, circleId),
  });
}

/** POST .../shift/drop — assignee, owner or manager. */
export function useDropShift(
  circleId: string
): UseMutationResult<ShiftActionResult, unknown, ShiftActionVariables, OptimisticContext> {
  const queryClient = useQueryClient();
  const onError = useShiftMutationOnError(circleId, 'update');
  const meId = useAuthStore((s) => s.user?.id ?? null);
  const { viewerRole, timezone } = useCircle(circleId);

  return useMutation({
    mutationFn: ({ shift, scope }: ShiftActionVariables) =>
      dropShift(circleId, shift.id, { scope, scheduledDate: shift.scheduled_date }),
    onMutate: async ({ shift, scope }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.shifts(circleId) });
      return {
        snapshot: patchCaches(queryClient, circleId, targetFor(shift, scope, 'other'), {
          assigned_to: null,
          assigned_to_user: null,
        }),
      };
    },
    onSuccess: (_result, { shift, scope }) => {
      const within24h = timezone ? isWithin24hOfStart(shift, timezone) : false;
      Analytics.shiftDropped({
        scope,
        within24h,
        byRole: shift.assigned_to && shift.assigned_to === meId ? 'self' : viewerRole,
      });
    },
    onError: (error, _vars, context) => {
      rollback(queryClient, context?.snapshot);
      onError(error);
    },
    onSettled: () => invalidateShifts(queryClient, circleId),
  });
}

/** POST .../shift/assign — owner / manager only. */
export function useAssignShift(
  circleId: string
): UseMutationResult<ShiftActionResult, unknown, AssignShiftVariables, OptimisticContext> {
  const queryClient = useQueryClient();
  const onError = useShiftMutationOnError(circleId, 'update');
  const { viewerRole, members } = useCircle(circleId);

  return useMutation({
    mutationFn: ({ shift, scope, userId }: AssignShiftVariables) =>
      assignShift(circleId, shift.id, { scope, scheduledDate: shift.scheduled_date, userId }),
    onMutate: async ({ shift, scope, userId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.shifts(circleId) });
      const person = members.find((m) => m.id === userId);
      return {
        snapshot: patchCaches(queryClient, circleId, targetFor(shift, scope, 'other'), {
          assigned_to: userId,
          assigned_to_user: person
            ? {
                id: person.id,
                first_name: person.first_name ?? null,
                last_name: person.last_name ?? null,
                email: person.email ?? null,
              }
            : null,
        }),
      };
    },
    onSuccess: (_result, { scope }) => {
      Analytics.shiftAssigned({ scope, byRole: viewerRole });
    },
    onError: (error, _vars, context) => {
      rollback(queryClient, context?.snapshot);
      onError(error);
    },
    onSettled: () => invalidateShifts(queryClient, circleId),
  });
}

/** POST /events (event_type 'shift'). Analytics are fired by the form (it knows the source). */
export function useCreateShift(
  circleId: string
): UseMutationResult<CalendarEvent, unknown, CreateShiftRequest> {
  const queryClient = useQueryClient();
  const onError = useShiftMutationOnError(circleId, 'create');
  return useMutation({
    mutationFn: (data: CreateShiftRequest) => createShift(circleId, data),
    onSuccess: () => invalidateShifts(queryClient, circleId),
    onError,
  });
}

export interface UpdateShiftVariables {
  /** The series ROOT (`parent_event_id ?? id`) — a web edit rewrites the series. */
  eventId: string;
  data: UpdateEventRequest;
}

/** PATCH /events/:id on the series root. Analytics are fired by the form. */
export function useUpdateShift(
  circleId: string
): UseMutationResult<CalendarEvent, unknown, UpdateShiftVariables> {
  const queryClient = useQueryClient();
  const onError = useShiftMutationOnError(circleId, 'update');
  return useMutation({
    mutationFn: ({ eventId, data }: UpdateShiftVariables) => updateShift(circleId, eventId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
      invalidateShifts(queryClient, circleId);
    },
    onError,
  });
}

export interface DeleteShiftVariables {
  shift: CalendarEvent;
  /** 'occurrence' deletes just this one; 'future' this and every later one. */
  scope: ShiftScope;
}

/** DELETE with the existing event delete scopes (`single` | `future`). */
export function useDeleteShift(
  circleId: string
): UseMutationResult<unknown, unknown, DeleteShiftVariables> {
  const queryClient = useQueryClient();
  const onError = useShiftMutationOnError(circleId, 'delete');
  return useMutation({
    mutationFn: ({ shift, scope }: DeleteShiftVariables) => {
      const recurring = !!shift.recurrence_rule || !!shift.parent_event_id;
      return recurring
        ? deleteEvent(circleId, shiftRootId(shift), {
            deleteScope: scope === 'future' ? 'future' : 'single',
            scheduledDate: shift.scheduled_date,
          })
        : deleteEvent(circleId, shift.id);
    },
    onSuccess: (_result, { scope }) => {
      Analytics.shiftDeleted({ scope });
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
      invalidateShifts(queryClient, circleId);
    },
    onError,
  });
}
