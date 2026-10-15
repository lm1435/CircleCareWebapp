import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui/Icon';
import { useIsOffline } from '@/hooks/useIsOffline';

/**
 * THE OFFLINE BANNER: slim, calm, non-blocking (owner decision 2026-10-14).
 * Web twin of mobile/src/components/OfflineBanner.tsx, same two lines:
 *
 *   [cloud]  You're offline
 *            Showing saved info. Connect to make changes.
 *
 *  - IN FLOW at the top of the page content, under the header — never over the
 *    header, the sidebar or the nav pill, never over a control.
 *  - Offline the app is READ-ONLY: every page keeps what it already loaded, and
 *    every write control explains instead of writing (lib/offlineWrite.ts).
 *    There is no persisted cache on web — a reload offline has nothing to show.
 *  - Announced ONCE per offline spell: the `role="status"` region is always
 *    mounted and only its contents appear, so a screen reader reads the
 *    sentence when it arrives and never again until the next offline spell.
 *  - Reduced motion: appears without the fade.
 *  - On reconnect it goes at once; React Query's `refetchOnReconnect`
 *    refreshes what is on screen. Nothing is replayed — writes are never
 *    queued (queryClient `mutations.networkMode: 'always'`).
 *
 * No "Try again": unlike mobile's NetInfo there is nothing on the web to
 * re-probe — the browser's own `online` event is the signal.
 */
export function OfflineBanner(): ReactElement {
  const { t } = useTranslation('common');
  const offline = useIsOffline();

  return (
    <div role="status" data-testid="offline-banner-region">
      {offline && (
        <div
          data-testid="offline-banner"
          className="flex items-start gap-2 border-b border-line bg-dusk-soft px-4 py-2 sm:px-6 animate-[fade-in_200ms_ease-out] motion-reduce:animate-none"
        >
          <Icon name="cloud-offline-outline" size="inline" className="mt-0.5 text-dusk-deep" />
          <p className="min-w-0 text-sm leading-snug text-ink">
            <span className="font-semibold">{t('offline.title')}</span>
            <span className="sr-only">. </span>
            <span className="block text-ink-2">{t('offline.bannerSubtitle')}</span>
          </p>
        </div>
      )}
    </div>
  );
}
