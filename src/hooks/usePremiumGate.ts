import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui';
import { isWebBillingConfigured } from '@/lib/purchases';

/**
 * Shared affordance for a premium gate (a 402 SUBSCRIPTION_REQUIRED write).
 *
 * When web billing is configured, surfaces a toast with an "Upgrade" action that
 * routes to `/upgrade` (where the user can pay online OR choose to upgrade in the
 * mobile app). When it isn't configured, falls back to the original "open the app
 * to upgrade" pointer, so behavior degrades gracefully if the key is ever unset.
 *
 * Replaces the scattered `showToast(t('errors.subscriptionRequired'), 'error')`
 * calls so every premium gate offers the same online + in-app upgrade path.
 */
export function usePremiumGate(): { promptUpgrade: () => void } {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { showToast } = useToast();

  const promptUpgrade = useCallback(() => {
    if (isWebBillingConfigured()) {
      showToast(t('upgradeGate.message'), 'info', {
        label: t('upgradeGate.action'),
        onClick: () => navigate('/upgrade'),
      });
    } else {
      showToast(t('errors.subscriptionRequired'), 'error');
    }
  }, [navigate, showToast, t]);

  return { promptUpgrade };
}
