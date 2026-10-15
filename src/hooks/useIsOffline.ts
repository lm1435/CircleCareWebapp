import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

/**
 * True only when the browser says it is offline.
 *
 * Reads React Query's `onlineManager`, which src/lib/queryClient.ts seeds from
 * `navigator.onLine` and feeds from the window `online` / `offline` events — the
 * same source the OfflineBanner, every write control and the api.ts write
 * backstop read, so none of them can disagree. Mobile twin:
 * mobile/src/hooks/useIsOffline.ts.
 */
function subscribe(onChange: () => void): () => void {
  // Defensive: a partial `@tanstack/react-query` mock has no onlineManager —
  // that is "online", never a crash.
  return onlineManager?.subscribe?.(onChange) ?? (() => {});
}

export function isOfflineNow(): boolean {
  return onlineManager?.isOnline?.() === false;
}

export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribe, isOfflineNow, () => false);
}
