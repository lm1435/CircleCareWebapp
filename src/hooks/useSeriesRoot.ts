import { useQuery } from '@tanstack/react-query';
import { getSeriesRoot, type CalendarEvent, type SeriesRoot } from '@/api/calendarEvents';
import { queryKeys } from '@/lib/queryKeys';

export interface UseSeriesRootResult {
  /**
   * The series root the event form edits: the event itself when it IS a root
   * (or a one-off), the cached/fetched root when it is an occurrence, and null
   * while creating. `undefined` means "not known yet" — the form must not save
   * until it is, because the save PATCHes the root with the form's values.
   */
  root: SeriesRoot | null | undefined;
}

/**
 * THE ROOT, NEVER THE TAPPED OCCURRENCE.
 *
 * The Calendar hands the form whatever row was clicked — often a VIRTUAL
 * instance (`${parent.id}_${date}`), which carries the parent's rule but neither
 * its anchor `scheduled_date` nor `recurrence_days`
 * (`backend/src/utils/recurrence.ts` `generateVirtualInstances`); the Tasks page
 * hands it a materialized CHILD, which carries no rule at all. Edits always
 * PATCH the root, so the anchor, the "has this series started" check, the
 * locked start weekday and the stored day set must all come from the root.
 *
 * Resolution order: the event itself (no `parent_event_id`) → the root row
 * already in the calendar cache → one GET of the root, narrowed to scheduling
 * fields (`getSeriesRoot`). A failed fetch falls back to the occurrence itself —
 * the form's behavior before this hook existed — rather than locking the user
 * out of editing.
 */
export function useSeriesRoot(
  circleId: string,
  event: CalendarEvent | null | undefined,
  cachedEvents: readonly CalendarEvent[]
): UseSeriesRootResult {
  const parentId = event?.parent_event_id ?? null;
  const cachedRoot = parentId
    ? cachedEvents.find((e) => e.id === parentId && !e.parent_event_id && !e.is_virtual)
    : undefined;
  const needsFetch = !!parentId && !cachedRoot;

  const query = useQuery({
    // Under the single-event key so the update hook's invalidation of the
    // root (`calendarEvent(circleId, parentId)`, a prefix match) refreshes it;
    // the 'seriesRoot' suffix keeps this NARROWED shape from ever being read
    // as a full event by some future consumer of that key.
    queryKey: [...queryKeys.calendarEvent(circleId, parentId ?? ''), 'seriesRoot'],
    queryFn: () => getSeriesRoot(circleId, parentId as string),
    enabled: needsFetch && !!circleId,
    staleTime: 0,
    retry: 1,
  });

  if (!event) return { root: null };
  if (!parentId) return { root: event };
  if (cachedRoot) return { root: cachedRoot };
  if (query.data) return { root: query.data };
  if (query.isError) return { root: event };
  return { root: undefined };
}
