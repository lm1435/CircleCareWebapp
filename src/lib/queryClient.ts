import { onlineManager, QueryCache, QueryClient } from '@tanstack/react-query';
import { purgeCircleCacheOnLostAccess, purgeCirclesAbsentFromList } from './purgeCircleCache';

// React Query's onlineManager starts ONLINE and only learns of a change from a
// later `online` / `offline` event, so a tab opened (or restored) while already
// offline would believe it was online. Seed it from `navigator.onLine` and keep
// the same two window events. Everything offline-aware reads this one source:
// paused queries, useIsOffline (banner + write controls) and the api.ts backstop.
// Seeded ONCE, at load: the listener is re-attached whenever React Query's
// subscribers come back from zero, and by then the events have kept it right
// (re-reading `navigator.onLine` there would also stomp a test's
// `onlineManager.setOnline(false)`).
let onlineSeeded = false;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  onlineManager.setEventListener((setOnline) => {
    if (
      !onlineSeeded &&
      typeof navigator !== 'undefined' &&
      typeof navigator.onLine === 'boolean'
    ) {
      onlineSeeded = true;
      setOnline(navigator.onLine);
    }
    const onOnline = (): void => setOnline(true);
    const onOffline = (): void => setOnline(false);
    window.addEventListener('online', onOnline, false);
    window.addEventListener('offline', onOffline, false);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  });
}

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
      // ALWAYS refetch what is on screen when the connection returns (ignores
      // staleTime, like focus above): whatever was shown offline may have been
      // answered by another caregiver meanwhile. `true` skipped data younger
      // than staleTime, so a short drop left the offline view on screen.
      refetchOnReconnect: 'always',
      networkMode: 'online', // Only fetch when online (no stale cache serving)
    },
    mutations: {
      // NO OFFLINE WRITE QUEUE (owner decision 2026-10-14). Under 'online' a
      // mutation fired offline was PAUSED and silently replayed on reconnect —
      // a dose marked offline could land on top of another caregiver's answer
      // given meanwhile. 'always' runs it at once, so an offline write fails
      // immediately (src/lib/api.ts refuses it with code OFFLINE before it is
      // sent) through the screen's own failure path. Nothing is ever replayed.
      // Write controls are disabled offline in the first place (lib/offlineWrite.ts).
      //
      // Queries stay 'online': an offline READ pauses (no request, no error
      // state) so the page keeps showing what it already loaded, and
      // `refetchOnReconnect` refreshes it the moment the connection returns.
      networkMode: 'always',
    },
  },
});
