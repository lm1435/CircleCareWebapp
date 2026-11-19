import { useEffect, useRef, useSyncExternalStore, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui';
import {
  dismissFailedWrites,
  getFailedCount,
  retryFailedWrites,
  subscribeWriteRetry,
} from '@/lib/writeRetryQueue';

/** Give-ups that land close together become ONE notice, not one per item. */
export const NOTICE_SETTLE_MS = 500;

/**
 * THE ONE AGGREGATED NOTICE (1.4.3 item 7). Mounted once, inside the
 * ToastProvider. When quick saves gave up on the network it says "Couldn't save
 * N updates" with a Retry action, once per burst: 11 failures at the same moment
 * are one toast with N = 11, never 11 toasts (the 2026-11-18 incident). Retry
 * re-sends every given-up write with a fresh budget (lib/writeRetryQueue.ts).
 *
 * The toast is the platform's own surface (components/ui/Toast.tsx, with its
 * action button); mobile shows the same words in a non-modal notice.
 */
export function WriteRetryNoticeHost(): ReactElement | null {
  const { t } = useTranslation('common');
  const { showToast } = useToast();
  const count = useSyncExternalStore(subscribeWriteRetry, getFailedCount, () => 0);
  const shownFor = useRef(0);
  const generation = useRef(0);

  useEffect(() => {
    if (count === 0) {
      shownFor.current = 0;
      return;
    }
    if (count === shownFor.current) return;
    // Wait for the burst to settle so the count is the whole count.
    const id = setTimeout(() => {
      const current = getFailedCount();
      if (current === 0 || current === shownFor.current) return;
      shownFor.current = current;
      const mine = ++generation.current;
      showToast(t('writeRetry.notice', { count: current }), 'error', {
        label: t('writeRetry.retry'),
        onClick: retryFailedWrites,
        // Closed without Retry: forget what gave up. A toast REPLACED by a newer notice
        // (more give-ups) must not dismiss the newer entries, hence the generation check.
        onClose: () => {
          if (generation.current === mine) dismissFailedWrites();
        },
      });
    }, NOTICE_SETTLE_MS);
    return () => clearTimeout(id);
  }, [count, showToast, t]);

  return null;
}
