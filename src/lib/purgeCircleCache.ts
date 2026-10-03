import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';

// The QueryCache callback hands out `Query<unknown, unknown>` while `findAll`
// returns `Query<unknown, Error>`; the helper only needs identity + setState.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = Query<any, any, any, any>;

/**
 * A device that loses a circle must stop holding that circle's PHI.
 *
 * React Query keeps `data` when a refetch fails, so without this a removed
 * caregiver (or anyone whose circle was deleted) keeps seeing the emergency
 * info, medications, documents, events, notes and vitals already read.
 *
 * Runs ONLY for the two codes that mean "you are not in this circle any more"
 * (FORBIDDEN, NOT_FOUND) on the circle read itself. VIEW_ONLY, READ_ONLY_MEMBER,
 * SUBSCRIPTION_REQUIRED and PAYMENT_REQUIRED mean the user is STILL a member
 * (accessRefusal / invalidateCircleAccessFlags refetch access for those) and 5xx / network errors
 * are transient: none of them purge.
 *
 * Twin: mobile/src/utils/purgeCircleCache.ts — keep the two identical.
 */

const CIRCLE_LOST_CODES = new Set(['FORBIDDEN', 'NOT_FOUND']);

/** Roots of the circle READ: ['circles', id] (detail) and mobile's singular ['circle', id]. */
const CIRCLE_DETAIL_ROOTS = new Set(['circles', 'circle']);

function errorCode(error: unknown): unknown {
  return (error as { error?: { code?: unknown } } | null | undefined)?.error?.code;
}

/** True when this error means the user no longer belongs to the circle. */
export function isCircleLostError(error: unknown): boolean {
  const code = errorCode(error);
  return typeof code === 'string' && CIRCLE_LOST_CODES.has(code);
}

/** The circle id when `key` is a circle DETAIL read (['circles'|'circle', id]), else null. */
export function circleIdOfDetailKey(key: QueryKey): string | null {
  if (key.length !== 2) return null;
  const [root, id] = key;
  if (typeof root !== 'string' || !CIRCLE_DETAIL_ROOTS.has(root)) return null;
  return typeof id === 'string' && id ? id : null;
}

/** Does any part of the key (string element, or a plain-object param) name this circle? */
function keyMentionsCircle(key: QueryKey, circleId: string): boolean {
  return key.some((part) => {
    if (part === circleId) return true;
    if (part && typeof part === 'object') {
      const o = part as Record<string, unknown>;
      return o.circleId === circleId || o.circle_id === circleId;
    }
    return false;
  });
}

/** Drop the circle from the cached circles LIST and mark the list stale. */
function dropFromCirclesList(qc: QueryClient, circleId: string): void {
  qc.setQueryData(['circles'], (old: unknown) =>
    Array.isArray(old) ? old.filter((c) => (c as { id?: unknown })?.id !== circleId) : old
  );
  qc.invalidateQueries({ queryKey: ['circles'], exact: true });
}

/**
 * Remove every query scoped to `circleId` and drop the circle from the list.
 *
 * @param keep a query to keep in place with its DATA cleared but its error
 *   intact (the failing circle read: screens key their "no longer available"
 *   state on error + no data).
 */
export function purgeCircleCache(qc: QueryClient, circleId: string, keep?: AnyQuery): void {
  purgeScopedQueries(qc, circleId, keep);
  dropFromCirclesList(qc, circleId);
}

function purgeScopedQueries(qc: QueryClient, circleId: string, keep?: AnyQuery): void {
  const cache = qc.getQueryCache();
  for (const query of cache.findAll({
    predicate: (q) => keyMentionsCircle(q.queryKey, circleId),
  })) {
    if (query === keep) {
      query.setState({ data: undefined, dataUpdatedAt: 0 });
      continue;
    }
    // reset() notifies mounted observers (they drop to an empty state and the
    // screen stops rendering the data); remove() then evicts the entry.
    query.reset();
    cache.remove(query);
  }
}

/** QueryCache `onError`: purge when the circle READ says we are no longer a member. */
export function purgeCircleCacheOnLostAccess(
  error: unknown,
  query: AnyQuery,
  qc: QueryClient
): void {
  const circleId = circleIdOfDetailKey(query.queryKey);
  if (!circleId || !isCircleLostError(error)) return;
  purgeCircleCache(qc, circleId, query);
}

/**
 * QueryCache `onSuccess`: a COMPLETE, SUCCESSFUL refetch of the circles LIST
 * (['circles']) that no longer contains a circle we hold circle-scoped queries for
 * means we lost that circle — purge it exactly like the 403/404 path. Without this
 * the purge only fires when the circle READ itself fails, so a Back navigation
 * inside staleTime paints the cached PHI.
 *
 * Safety: `GET /circles` is not paginated or filtered (every membership, minus
 * archived circles); an errored refetch never reaches onSuccess; a malformed
 * payload (non-array, entry without a string id) is ignored; `setQueryData`
 * (optimistic delete / rollback / our own list drop) never fires onSuccess, so
 * optimistic edits cannot trigger it; a create/join invalidates the list and
 * React Query cancels the older in-flight fetch, so its response is discarded.
 * An empty successful list DOES purge (a user removed from their only circle).
 * The list cannot tell "archived" from "removed"; a cached detail already
 * carrying archived_at is kept, anything else is just evicted (refetchable).
 * Only circles with a cached detail read (['circles'|'circle', id]) are candidates; one whose
 * detail read is ALREADY in a lost-access error is skipped (the 403 path did the purge).
 */
export function purgeCirclesAbsentFromList(
  data: unknown,
  query: AnyQuery,
  qc: QueryClient
): void {
  const key = query.queryKey;
  if (key.length !== 1 || key[0] !== 'circles') return;
  if (!Array.isArray(data)) return;
  const present = new Set<string>();
  for (const c of data) {
    const id = (c as { id?: unknown } | null | undefined)?.id;
    if (typeof id !== 'string' || !id) return;
    present.add(id);
  }
  const lost = new Set<string>();
  for (const q of qc.getQueryCache().findAll()) {
    const id = circleIdOfDetailKey(q.queryKey);
    if (!id || present.has(id)) continue;
    const archivedAt = (q.state.data as { archived_at?: unknown } | undefined)?.archived_at;
    if (archivedAt) continue;
    // Already handled by the 403/404 path: the detail read sits in its lost-access error
    // (data cleared, error kept for the "access removed" screen). Purging it AGAIN would
    // evict the query the screen renders from, its observer would refetch, the 403 would
    // purge + invalidate the list, and the list would purge again: a livelock.
    if (q.state.data === undefined && isCircleLostError(q.state.error)) continue;
    lost.add(id);
  }
  for (const id of lost) purgeScopedQueries(qc, id);
}
