import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Skeleton, useToast } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useManageSubscription } from '@/hooks/useWebBilling';
import { isWebBillingConfigured } from '@/lib/purchases';

/**
 * Subscription card on the profile page.
 *
 * Shows the user's plan (Premium / Free) from the cached `plan_tier` returned by
 * GET /subscription-status — the same value that gates the rest of the app, kept
 * in sync with RevenueCat by the backend webhook.
 *
 * When Web Billing is configured, free users get a real "Upgrade to Premium" CTA
 * (→ /upgrade, RevenueCat Web Billing checkout) and premium users get a
 * "Manage subscription" link. When it isn't configured the card degrades to the
 * original in-app upgrade pointer + store badges.
 */
export function SubscriptionSection(): ReactElement {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data, isLoading } = useSubscriptionStatus();
  const manage = useManageSubscription();
  const isPremium = data?.tier === 'premium';
  const webBilling = isWebBillingConfigured();

  // A web-managed (Stripe) subscription returns a portal URL; an Apple/Google
  // sub purchased in the mobile app has no web-manageable URL — point the user
  // back to the app instead of opening a store deep link in the browser.
  const handleManage = (): void => {
    manage.mutate(undefined, {
      onSuccess: (url) => {
        if (!url) showToast(t('subscription.manageInApp'), 'info');
      },
      onError: () => showToast(t('subscription.manageInApp'), 'info'),
    });
  };

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
            {webBilling && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-fit"
                disabled={manage.isPending}
                onClick={handleManage}
              >
                {t('subscription.manageSubscription')}
              </Button>
            )}
          </div>
        ) : webBilling ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="m-0 font-medium text-ink">{t('subscription.freeTitle')}</p>
              <p className="mt-1 text-sm text-ink-3">{t('subscription.upgradeBenefit')}</p>
            </div>
            <Button variant="terracotta" className="w-fit" onClick={() => navigate('/upgrade')}>
              {t('subscription.upgradeCta')}
            </Button>
            <div>
              <p className="m-0 mb-2 text-xs text-ink-3">{t('subscription.orInApp')}</p>
              <StoreBadges layout="row" />
            </div>
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
