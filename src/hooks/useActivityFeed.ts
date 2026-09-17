import { useInfiniteQuery, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getActivityFeed, type ActivityFeedPage } from '@/api/activityFeed';
import { queryKeys } from '@/lib/queryKeys';

// PORT of mobile/src/hooks/useActivityFeed.ts (Task 27): limit/offset
// pagination via useInfiniteQuery. The next offset is the total number of
// items fetched so far (backend contract: GET /circles/:circleId/activity).

const DEFAULT_PAGE_SIZE = 30;

export function useActivityFeed(circleId: string, options?: { pageSize?: number }) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;

  return useInfiniteQuery<ActivityFeedPage>({
    queryKey: queryKeys.activityFeed(circleId, pageSize),
    queryFn: ({ pageParam = 0 }) =>
      getActivityFeed(circleId, { limit: pageSize, offset: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, page) => sum + page.activities.length, 0);
    },
    // Cap cached pages to bound memory growth (mirrors mobile, RQ v5).
    maxPages: 20,
    enabled: !!circleId,
  });
}

/**
 * The FIRST THREE activity rows for one circle — the lightweight twin of
 * `useActivityFeed`, for surfaces that want to name a circle's most recent
 * activity rather than page through it.
 *
 * Why not `useActivityFeed`: the circle picker renders one of these per card,
 * and `useInfiniteQuery` with a 30-row page size is ~10x the payload for a
 * single line of copy (and caches pages nobody will ever scroll).
 *
 * Why THREE and not one: nearly every circle carries a `circle_created` row,
 * and older circles often carry the founding member_joined rows right behind
 * it. Callers skip those and take the first row that describes real care
 * activity; three is enough to clear the founding rows without paying for a
 * page.
 *
 * `circleId` is `string | undefined` and `undefined` DISABLES the query —
 * the same shape as `useMedicationTodaySummary`, so a caller that must not
 * fetch (a restricted circle) expresses that by passing nothing.
 *
 * No `staleTime` override, also matching `useMedicationTodaySummary`: the
 * client default (60s, lib/queryClient.ts) is the right freshness for a line
 * that says "2d ago", and every write path already invalidates the
 * `activityFeed(circleId)` prefix this key sits under.
 */
export function useLatestActivity(
  circleId: string | undefined
): UseQueryResult<ActivityFeedPage> {
  return useQuery({
    queryKey: queryKeys.latestActivity(circleId ?? ''),
    queryFn: () => getActivityFeed(circleId!, { limit: 3, offset: 0 }),
    enabled: !!circleId,
  });
}
