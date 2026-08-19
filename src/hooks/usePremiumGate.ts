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
export function usePremiumGate(): { promptUpgrade: (message?: string) => void } {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { showToast } = useToast();

  /**
   * @param message Optional replacement for the generic gate copy, for callers
   *   that can say something more useful about WHY the gate fired (e.g. "your
   *   one invitation is currently held by X"). The Upgrade action is kept
   *   either way -- a more specific explanation must not cost the user their
   *   route to actually buying more, since more seats genuinely do cost money.
   */
  const promptUpgrade = useCallback(
    (message?: string) => {
      if (isWebBillingConfigured()) {
        showToast(message ?? t('upgradeGate.message'), 'info', {
          label: t('upgradeGate.action'),
          onClick: () => navigate('/upgrade'),
        });
      } else {
        showToast(message ?? t('errors.subscriptionRequired'), 'error');
      }
    },
    [navigate, showToast, t]
  );

  return { promptUpgrade };
}
