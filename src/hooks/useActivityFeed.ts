import { useInfiniteQuery } from '@tanstack/react-query';
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
