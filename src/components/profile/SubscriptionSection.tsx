import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Skeleton } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';

/**
 * Subscription card on the profile page.
 *
 * Shows the user's plan (Premium / Free) from the cached `plan_tier` returned by
 * GET /subscription-status — the same value that gates the rest of the app, kept
 * in sync with RevenueCat by the backend webhook. The web has no purchase flow,
 * so free users get an in-app upgrade pointer (upgrades happen in the mobile app).
 */
export function SubscriptionSection(): ReactElement {
  const { t } = useTranslation('profile');
  const { data, isLoading } = useSubscriptionStatus();
  const isPremium = data?.tier === 'premium';

  return (
    <Card className="mt-6">
      <h2 className="m-0 text-lg font-semibold text-ink">{t('subscription.title')}</h2>
      <div className="mt-5 flex flex-col gap-5">
        {isLoading ? (
          <Skeleton className="h-7 w-44 rounded-full" />
        ) : isPremium ? (
          <div className="flex flex-col gap-2">
            <span className="inline-flex w-fit items-center rounded-full bg-terracotta-deep px-3 py-1 text-sm font-semibold text-white">
              {t('subscription.premium')}
            </span>
            <p className="m-0 text-sm text-ink-3">{t('subscription.premiumDescription')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="m-0 font-medium text-ink">{t('subscription.freeTitle')}</p>
              <p className="mt-1 text-sm text-ink-3">{t('subscription.upgradeInApp')}</p>
            </div>
            <StoreBadges layout="row" />
          </div>
        )}
      </div>
    </Card>
  );
}
