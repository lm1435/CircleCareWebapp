import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui';
import { isWebBillingConfigured } from '@/lib/webBillingConfig';
import { DEFAULT_PAYWALL_CONTEXT, type PaywallContext } from '@/lib/paywallContext';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { getCircleOwnerName, viewerOwnsCircle } from '@/lib/premiumOwnership';
import { useAuthStore } from '@/store/authStore';
import type { CircleDetail } from '@/api/circleMembers';

export interface PremiumGateOptions {
  /**
   * Makes this a CIRCLE-level gate: the circle whose premium status (= its
   * OWNER's tier) the rejected action depended on. With it, only the circle's
   * owner is offered Upgrade; everyone else gets an owner-only notice with no
   * action (see `lib/premiumOwnership.ts`). Omit it for gates on the viewer's
   * OWN plan (creating a circle, their email digest).
   */
  circleId?: string | null;
}

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
 *
 * OWNER-AWARE WHEN GIVEN A CIRCLE. Pass `{ circleId }` for a gate the server
 * decided from the circle OWNER's tier. Mirrors mobile's `useCirclePremiumGate`:
 *   - owner            -> unchanged (Upgrade action / in-app pointer);
 *   - view-only seat   -> the seat explanation (the server reports
 *                         `is_premium_circle: false` for a seat even when the
 *                         owner pays, so "Premium feature" would be false);
 *   - other non-owner  -> "Only Ana, the circle owner, can upgrade." -- no
 *                         action, no navigation;
 *   - unknown          -> non-owner.
 * Ownership is read from the circle-detail cache AT CALL TIME (the singleton
 * client, same as `useAdherenceExport`): every circle surface has already
 * loaded that detail through `useCircle`, and reading it lazily adds no query
 * observer or request to the many mutation hooks that call this. No analytics
 * are fired from here in either branch.
 *
 * @param context WHY the paywall is being offered, carried to `/upgrade` and
 *   from there onto every `plan_selection_*` / `paywall_dismissed` event as
 *   `paywall_context`. Mobile splits its whole paywall funnel on this property
 *   (mobile/src/services/analytics.ts:1211-1227), so a gate that leaves it at
 *   the default silently pools with the "user went looking for it" bucket and
 *   makes limit-moment conversion unreadable. Pick 'capacity' for a hard limit
 *   (circles, frozen circle) and 'feature' for a premium-only surface. Pick
 *   'invite_cap' for the caregiver SEAT cap hit from an invite (create,
 *   resend, the in-modal cap card) — it is NOT the circle cap, and keeping it
 *   separate is what makes the invite paywall readable on its own.
 */
export function usePremiumGate(
  context: PaywallContext = DEFAULT_PAYWALL_CONTEXT,
  options?: PremiumGateOptions
): {
  promptUpgrade: (message?: string, forCircleId?: string) => void;
  promptLapsed: (forCircleId?: string) => void;
} {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { showToast } = useToast();
  const circleId = options?.circleId ?? null;

  /**
   * @param message Optional replacement for the generic gate copy, for callers
   *   that can say something more useful about WHY the gate fired (e.g. "your
   *   one invitation is currently held by X"). For the owner the Upgrade action
   *   is kept either way -- a more specific explanation must not cost the user
   *   their route to actually buying more. For a non-owner of a circle-level
   *   gate the message is shown as-is, with no action.
   * @param forCircleId The circle the gated write was actually SENT to, when it
   *   can differ from the hook's own `options.circleId` (a deferred undo-window
   *   commit carries the circle it was tapped in). The owner check must ask
   *   about that circle, not whichever one is rendered now.
   */
  const promptUpgrade = useCallback(
    (message?: string, forCircleId?: string) => {
      const gateCircleId = forCircleId ?? circleId;
      if (gateCircleId) {
        const circle = queryClient.getQueryData<CircleDetail>(
          queryKeys.circleDetail(gateCircleId)
        );
        const userId = useAuthStore.getState().user?.id;
        if (!viewerOwnsCircle(circle, userId)) {
          let notice: string;
          if (message) {
            notice = message;
          } else if (circle?.view_only === true) {
            notice = t('upgradeGate.viewOnlySeat');
          } else {
            const ownerName = getCircleOwnerName(circle);
            notice = ownerName
              ? t('upgradeGate.ownerOnlyNamed', { ownerName })
              : t('upgradeGate.ownerOnly');
          }
          showToast(notice, 'info');
          return;
        }
      }
      if (isWebBillingConfigured()) {
        showToast(message ?? t('upgradeGate.message'), 'info', {
          label: t('upgradeGate.action'),
          onClick: () => navigate('/upgrade', { state: { paywallContext: context } }),
        });
      } else {
        showToast(message ?? t('errors.subscriptionRequired'), 'error');
      }
    },
    [navigate, showToast, t, context, circleId]
  );

  /**
   * PK18 -- the refusal for a write on a LAPSED (frozen) circle: a 403
   * SUBSCRIPTION_REQUIRED from `requireCircleEditAccess` means the circle's
   * OWNER's subscription ended, NOT "that feature isn't in the free plan", so
   * the generic gate copy would be false. Same structure as `promptUpgrade`
   * with mobile's accurate wording:
   *   - owner            -> "Your subscription has ended, so this circle is
   *                         read-only for everyone. Your data is safe." with an
   *                         Upgrade action -> /upgrade (context 'capacity');
   *   - everyone else    -> the owner-resubscribes notice (named when known),
   *                         NO action, never a paywall. Unknown ownership is
   *                         treated as a non-owner.
   * Draft handling is the caller's (forms stay open on a failed save).
   */
  const promptLapsed = useCallback(
    (forCircleId?: string) => {
      const gateCircleId = forCircleId ?? circleId;
      const circle = gateCircleId
        ? queryClient.getQueryData<CircleDetail>(queryKeys.circleDetail(gateCircleId))
        : undefined;
      const userId = useAuthStore.getState().user?.id;
      if (!gateCircleId || !viewerOwnsCircle(circle, userId)) {
        const ownerName = getCircleOwnerName(circle);
        showToast(
          ownerName
            ? t('upgradeGate.lapsedMemberNamed', { ownerName })
            : t('upgradeGate.lapsedMember'),
          'info'
        );
        return;
      }
      if (isWebBillingConfigured()) {
        showToast(t('upgradeGate.lapsedOwner'), 'info', {
          label: t('upgradeGate.action'),
          onClick: () => navigate('/upgrade', { state: { paywallContext: 'capacity' } }),
        });
      } else {
        showToast(t('upgradeGate.lapsedOwner'), 'info');
      }
    },
    [navigate, showToast, t, circleId]
  );

  return { promptUpgrade, promptLapsed };
}
