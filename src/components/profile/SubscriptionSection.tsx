import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Skeleton, Text, useToast } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useManageSubscription } from '@/hooks/useWebBilling';
import { isWebBillingConfigured } from '@/lib/webBillingConfig';

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
    <Card padding="lg" className="mt-6">
      <Text variant="h3" as="h2">
        {t('subscription.title')}
      </Text>
      <div className="mt-5 flex flex-col gap-5">
        {isLoading ? (
          <Skeleton className="h-7 w-44 rounded-full" />
        ) : isPremium ? (
          <div className="flex flex-col gap-2">
            <Badge variant="coral" className="w-fit">
              {t('subscription.premium')}
            </Badge>
            <Text variant="caption">{t('subscription.premiumDescription')}</Text>
            {/* Always rendered. This used to be gated on web billing being
                configured, which meant a premium subscriber could see their
                plan with no cancellation affordance at all. If the sub was
                bought in the app there is no portal URL, and handleManage
                falls back to telling the user exactly where to cancel. */}
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-fit"
              disabled={manage.isPending}
              onClick={handleManage}
            >
              {t('subscription.manageSubscription')}
            </Button>
          </div>
        ) : webBilling ? (
          <div className="flex flex-col gap-4">
            <div>
              <Text variant="bodyMedium">{t('subscription.freeTitle')}</Text>
              <Text variant="caption" className="mt-1">
                {t('subscription.upgradeBenefit')}
              </Text>
            </div>
            {/* Profile → Upgrade: the user came looking — GENERAL. */}
            <Button
              variant="primary"
              className="w-fit"
              onClick={() => navigate('/upgrade', { state: { paywallContext: 'general' } })}
            >
              {t('subscription.upgradeCta')}
            </Button>
            {/* A lapsed or billing-retry subscriber has isPremium === false while
                the Stripe subscription still exists and is still charging. This
                link is their only path to the billing portal — without it the
                cancel control vanished exactly when they most needed it. For a
                user who never subscribed, handleManage finds no portal URL and
                shows the manage-in-app guidance instead. */}
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              disabled={manage.isPending}
              onClick={handleManage}
            >
              {t('subscription.manageExisting')}
            </Button>
            <div>
              <Text variant="caption" className="mb-2">
                {t('subscription.orInApp')}
              </Text>
              <StoreBadges layout="row" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <Text variant="bodyMedium">{t('subscription.freeTitle')}</Text>
              <Text variant="caption" className="mt-1">
                {t('subscription.upgradeInApp')}
              </Text>
            </div>
            <StoreBadges layout="row" />
          </div>
        )}
      </div>
    </Card>
  );
}
