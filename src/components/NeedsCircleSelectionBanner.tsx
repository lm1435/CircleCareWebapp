import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';

/**
 * Persistent, dismissal-free banner shown when GET /subscription-status
 * returns `needsCircleSelection: true` (owner downgraded with 2+ circles and
 * hasn't picked which one to keep). Plan Task 39b. Web does NOT implement the
 * selection flow — it directs the user to the app.
 */
export function NeedsCircleSelectionBanner(): ReactElement | null {
  const { t } = useTranslation('freemium');
  const { data } = useSubscriptionStatus();

  if (!data?.needsCircleSelection) return null;

  return (
    <div
      role="status"
      className="border-b border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
    >
      {t('circleSelection.banner')}
    </div>
  );
}
