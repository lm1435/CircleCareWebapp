import { QueryCache, QueryClient } from '@tanstack/react-query';
import { purgeCircleCacheOnLostAccess, purgeCirclesAbsentFromList } from './purgeCircleCache';

// Mirrors mobile's QueryClient configuration (mobile/App.tsx) so caching
// behavior ports 1:1 when write features arrive.
export const queryClient: QueryClient = new QueryClient({
  // A circle READ that answers FORBIDDEN / NOT_FOUND means this user is no longer
  // in that circle: purge everything cached for it (PHI must not outlive access).
  // VIEW_ONLY / *_REQUIRED / 5xx never purge — see lib/purgeCircleCache.ts.
  queryCache: new QueryCache({
    onError: (error, query) => purgeCircleCacheOnLostAccess(error, query, queryClient),
    // A successful, complete circles LIST that no longer holds a circle we cache = removed.
    onSuccess: (data, query) => purgeCirclesAbsentFromList(data, query, queryClient),
  }),
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 min — mutations bypass via invalidateQueries
      gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes for back navigation
      retry: 1,
      refetchOnMount: true, // Respects staleTime
      refetchOnWindowFocus: 'always', // ALWAYS refetch when tab regains focus (ignores staleTime)
      refetchOnReconnect: true, // Refetch when network reconnects
      networkMode: 'online', // Only fetch when online (no stale cache serving)
    },
    mutations: {
      networkMode: 'online', // Only mutate when online
    },
  },
});
