import { useQuery } from '@tanstack/react-query';
import { getFirstMedRoot, type FirstMedLiveRoot } from '@/api/calendarEvents';
import { isNotFoundError } from '@/lib/apiErrors';

/**
 * The cache key of the first-med card's live root. NESTED UNDER THE CIRCLE'S `calendarEvents`
 * PREFIX on purpose (same reasoning as `calendarEventsPresence`): every write that can change the
 * medication (edit, delete, discontinue/pause, reactivate, confirm, Mark it) already invalidates
 * `calendarEvents(circleId)`, so the card follows all of them without a write path of its own to
 * forget. Its data is an OBJECT, never an array, so nothing that scans the prefix for cached
 * events (they keep their `Array.isArray` guard) reads it as an events page.
 */
export function firstMedRootQueryKey(circleId: string, eventId: string) {
  return ['calendarEvents', circleId, 'firstMedRoot', eventId] as const;
}

/** 404 = the medication is gone (hard delete or `deleted_at`): a settled answer, not an error. */
function isGone(error: unknown): boolean {
  if (isNotFoundError(error)) return true;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; response?: { status?: unknown } | null };
  return candidate.response?.status === 404 || candidate.status === 404;
}

export async function fetchFirstMedRoot(
  circleId: string,
  eventId: string
): Promise<{ root: FirstMedLiveRoot | null }> {
  try {
    return { root: await getFirstMedRoot(circleId, eventId) };
  } catch (error) {
    if (isGone(error)) return { root: null };
    throw error;
  }
}

/**
 * The first-med note's series root as the server has it NOW (utils/firstMedLive).
 *
 * `eventId` null = no note: no request at all. With a note: ONE `GET /events/:id`, cached under
 * the key above and refetched only when a calendar write invalidates it, it goes stale and Today
 * remounts, or the tab regains focus (the app-wide default), so the card costs one small read
 * on the one day it can show. `undefined` while loading or after a failure; `null` when the
 * server says the medication is gone.
 */
export function useFirstMedRoot(
  circleId: string,
  eventId: string | null
): FirstMedLiveRoot | null | undefined {
  const query = useQuery({
    queryKey: firstMedRootQueryKey(circleId, eventId ?? ''),
    queryFn: () => fetchFirstMedRoot(circleId, eventId as string),
    enabled: !!circleId && !!eventId,
    staleTime: 60 * 1000,
    retry: 1,
  });
  // A failed (re)fetch hides the card even when an older answer is cached: the card's contract is
  // "failed to load = hidden" (utils/firstMedLive), and a stale root may offer a dose that is gone.
  if (!eventId || query.isError || !query.data) return undefined;
  return query.data.root;
}
