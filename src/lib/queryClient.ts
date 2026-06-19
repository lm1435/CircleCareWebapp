import { QueryClient } from '@tanstack/react-query';

// Mirrors mobile's QueryClient configuration (mobile/App.tsx) so caching
// behavior ports 1:1 when write features arrive.
export const queryClient = new QueryClient({
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
