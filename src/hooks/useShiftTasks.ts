import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { CalendarEvent } from '@/api/calendarEvents';
import {
  createShiftTask,
  getShiftTaskDeleteImpact,
  type CreateShiftTaskBody,
  type ShiftTaskDeleteImpact,
} from '@/api/shiftTasks';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useTasks } from '@/hooks/useTasks';
import { queryKeys } from '@/lib/queryKeys';
import { shiftWindow } from '@/components/shifts/shiftTasks';
import { useShiftMutationOnError } from '@/hooks/useShifts';

// Shift tasks hooks (docs/plans/shift-tasks.md). Server state only.

// Module-level constants: never `?? []` inline in a selector / return.
const EMPTY_EVENTS: CalendarEvent[] = [];

/**
 * Every non-shift event in one shift occurrence's window: the shift's date, plus the next day for an
 * overnight shift. This is the ordinary `getEvents` read (the Schedule's own cache entries), so a
 * completed task or a confirmed dose refreshes it through the normal invalidations.
 */
export function useShiftOccurrenceEvents(
  circleId: string,
  shift: CalendarEvent | null,
  enabled = true
): { events: CalendarEvent[]; isLoading: boolean; isError: boolean; refetch: () => void } {
  const window = useMemo(() => (shift ? shiftWindow(shift) : null), [shift]);
  const query = useCalendarEvents(
    circleId,
    window ? window.start.slice(0, 10) : '',
    window ? window.end.slice(0, 10) : '',
    { enabled: enabled && !!shift }
  );
  return {
    events: query.events,
    isLoading: query.isLoading,
    isError: query.isError && !query.data,
    refetch: () => void query.refetch(),
  };
}

/** POST .../shift/tasks. The caller fires the analytics (it knows the entry point). */
export function useAddShiftTask(
  circleId: string
): UseMutationResult<CalendarEvent, unknown, { shift: CalendarEvent; body: CreateShiftTaskBody }> {
  const queryClient = useQueryClient();
  // The cache / paywall half of a failed shift write; the words are the form's (inline or toast).
  const onError = useShiftMutationOnError(circleId, 'create');
  return useMutation({
    mutationFn: ({ shift, body }) => createShiftTask(circleId, shift.id, body),
    onError,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts(circleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
    },
  });
}

/**
 * What each delete scope would remove: drives the delete-confirm line "This also removes its N
 * upcoming tasks". Read only; `undefined` until it answers (the line stays hidden, never guessed).
 */
export function useShiftTaskDeleteImpact(
  circleId: string,
  shift: CalendarEvent | null,
  enabled = true
): ShiftTaskDeleteImpact | undefined {
  const { data } = useQuery({
    // NOT under `queryKeys.shifts`: the delete itself invalidates that family, and the still-open
    // confirm would refetch the impact of a shift that is already gone (a 404 in the console).
    queryKey: ['shiftTaskImpact', circleId, shift?.id ?? '', shift?.scheduled_date ?? ''],
    queryFn: () => getShiftTaskDeleteImpact(circleId, shift!.id, shift!.scheduled_date),
    enabled: enabled && !!circleId && !!shift,
    // Never serve a count that predates a task add / complete.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return data;
}

/** Open tasks (physical rows) for the shift-edit warning: those carrying a `shift` link. */
export function useLinkedOpenTasks(circleId: string, enabled: boolean): CalendarEvent[] {
  const { data } = useTasks(circleId, { status: 'open', enabled });
  return data?.tasks ?? EMPTY_EVENTS;
}
