import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Analytics } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { recordUpsellEvent, type UpsellTrigger } from '@/api/subscriptionStatus';
import {
  EARNED_CONTEXT_BY_TRIGGER,
  hasPresentedEarnedUpsellThisSession,
  markEarnedUpsellPresented,
  shouldReportUpsellEligible,
  shouldReportUpsellSuppressed,
} from '@/lib/earnedUpsellSession';

/** Let the page settle (and any modal that opens on arrival mount) before asking. */
const SETTLE_MS = 800;

function dialogIsOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') !== null;
}

/**
 * Web twin of mobile's `useEarnedUpsell` (PK28(1)). The SERVER decides
 * (`GET /subscription-status` `upsell`: free owner, >= 24 h old, a co-member
 * joined or >= 3 doses, < 3 impressions, 14-day cooldown, per-trigger
 * dismissal), so the cap is shared with mobile. This hook only decides WHEN:
 *
 *   - `enabled` is the caller's "safe moment" (free-circle OWNER, nothing open);
 *   - never over an open dialog (re-checked when the timer fires);
 *   - once per signed-in session (module guard keyed by user);
 *   - it opens the EXISTING `/upgrade` page in an `earned_*` context, no new UI.
 *
 * `upsell_eligible` / `upsell_suppressed` fire on CHANGE only, not per poll.
 */
export function useEarnedUpsell(enabled: boolean): void {
  const { data } = useSubscriptionStatus();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const upsell = data?.upsell;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Report the server's decision, on change only.
  useEffect(() => {
    if (!upsell || !userId) return;
    if (upsell.eligible && upsell.trigger) {
      if (shouldReportUpsellEligible(userId, upsell.trigger)) {
        Analytics.upsellEligible(upsell.trigger, upsell.impressionNumber);
      }
      return;
    }
    if (upsell.reason && shouldReportUpsellSuppressed(userId, upsell.reason)) {
      Analytics.upsellSuppressed(upsell.reason);
    }
  }, [userId, upsell?.eligible, upsell?.trigger, upsell?.reason, upsell?.impressionNumber]);

  const trigger: UpsellTrigger | null = upsell?.eligible ? (upsell.trigger ?? null) : null;
  const impressionNumber = upsell?.impressionNumber ?? 0;

  useEffect(() => {
    if (!enabled || !trigger || !userId) return;
    if (hasPresentedEarnedUpsellThisSession(userId)) return;
    const timer = window.setTimeout(() => {
      // Re-check at fire time: something may have opened (or the session
      // guard been taken by a StrictMode twin) during the settle window.
      if (!enabledRef.current || dialogIsOpen()) return;
      if (hasPresentedEarnedUpsellThisSession(userId)) return;

      const shownAt = Date.now();
      Analytics.upsellShown(trigger, impressionNumber);
      // Starts the server cooldown and advances the shared lifetime cap.
      void recordUpsellEvent('shown', trigger);
      // The ask is answered on /upgrade, so the outcome handlers close over THIS
      // trigger (the refetch below changes the current decision to ineligible).
      markEarnedUpsellPresented(userId, {
        onDismissed: () => {
          Analytics.upsellDismissed(
            trigger,
            impressionNumber,
            Math.round((Date.now() - shownAt) / 1000)
          );
          void recordUpsellEvent('dismissed', trigger);
        },
        // Taking the offer is not declining it: no durable dismissal.
        onAccepted: () => Analytics.upsellCtaTapped(trigger, impressionNumber),
      });
      navigate('/upgrade', { state: { paywallContext: EARNED_CONTEXT_BY_TRIGGER[trigger] } });
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionStatus });
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, trigger, impressionNumber, userId, navigate, queryClient]);
}
