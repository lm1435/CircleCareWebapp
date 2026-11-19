import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useWebCustomerInfo } from '@/hooks/useWebBilling';
import { refreshSubscriptionStatus } from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import { Analytics } from '@/lib/analytics';
import { devError } from '@/constants/config';
import {
  ENTITLEMENT_READ_HOLD_MS,
  hasActiveEntitlement,
  reverseReported,
  syncedUsers,
} from '@/lib/effectivePremium';
import type { SubscriptionStatus } from '@/api/subscriptionStatus';

/**
 * 1.4.3 item 2: premium = backend tier OR an active entitlement from the web
 * customer info (see lib/effectivePremium.ts). One hook for every surface that
 * sells Premium.
 *
 *  - `isPremium`  backend OR entitled: hide the sell button. Never grants a feature.
 *  - `backendPremium`  the cache every write gate reads. The paywall shows "You're
 *    already Premium" ONLY once this is true (Fable S6).
 *  - `activating`  entitled but the backend has not caught up: "Activating your
 *    Premium" with Retry. Never a 402 loop: nothing here navigates to a paywall.
 *  - Entitled and backend free is a MISMATCH: `POST /users/me/refresh-subscription`
 *    runs ONCE per session per user (the webhook can lag a purchase made on
 *    another device or store), then subscription-status and circles refetch. A
 *    failed or still-free result leaves `activating` true with `retrySync`.
 *  - It does NOT delay the page (S7): `isPremium` is backend-only until the read
 *    returns. `entitlementChecking` is true only until the read settles, capped at
 *    ENTITLEMENT_READ_HOLD_MS, so the Subscribe button is held for at most that
 *    long and then FAILS OPEN toward selling (an unreadable RevenueCat is the
 *    backend's tier, exactly as before).
 */

export type EffectivePremiumSurface = 'paywall' | 'profile' | 'digest_row';

export interface EffectivePremium {
  isPremium: boolean;
  backendPremium: boolean;
  entitled: boolean;
  /** The subscription-status read has not answered yet. */
  statusLoading: boolean;
  activating: boolean;
  syncing: boolean;
  retrySync: () => void;
  /** The entitlement read is still in flight (and under its hold cap). */
  entitlementChecking: boolean;
}

export function useEffectivePremium(
  options: { surface?: EffectivePremiumSurface } = {}
): EffectivePremium {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const { data: status, isLoading: statusLoading } = useSubscriptionStatus();
  const customerInfo = useWebCustomerInfo(true);

  const backendPremium = status?.tier === 'premium';
  const entitled = hasActiveEntitlement(customerInfo.data);
  const statusKnown = status !== undefined;
  const mismatch = entitled && statusKnown && !backendPremium;

  // ── Hold the Subscribe button only briefly while the entitlement read is out ──
  const [holdExpired, setHoldExpired] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setHoldExpired(true), ENTITLEMENT_READ_HOLD_MS);
    return () => clearTimeout(id);
  }, []);
  const entitlementChecking = customerInfo.isPending && customerInfo.fetchStatus !== 'idle' && !holdExpired;

  // ── Re-sync the backend tier ─────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runSync = useCallback(async (): Promise<void> => {
    setSyncing(true);
    let resolved = false;
    try {
      await refreshSubscriptionStatus();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.circles }),
      ]);
      resolved =
        queryClient.getQueryData<SubscriptionStatus>(queryKeys.subscriptionStatus)?.tier ===
        'premium';
    } catch (err) {
      // The purchase is real (RevenueCat says so): a failed sync is retryable, never an error.
      devError('Entitlement sync failed; the webhook is the backstop:', err);
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
    Analytics.entitlementTierMismatch('rc_active_backend_free', resolved);
  }, [queryClient]);

  useEffect(() => {
    if (!mismatch || !userId || syncedUsers.has(userId)) return;
    syncedUsers.add(userId);
    void runSync();
  }, [mismatch, userId, runSync]);

  // The reverse drift, once per session per user: the backend says premium, RevenueCat
  // (read successfully, so not null) says no. Premium stays (the OR keeps it).
  useEffect(() => {
    if (!userId || !backendPremium || customerInfo.data == null || entitled) return;
    if (reverseReported.has(userId)) return;
    reverseReported.add(userId);
    Analytics.entitlementTierMismatch('backend_premium_rc_inactive', false);
  }, [userId, backendPremium, customerInfo.data, entitled]);

  // ── Suppressed sell surface (analytics) ──────────────────────────────────────
  const surface = options.surface;
  const suppressedRef = useRef(false);
  useEffect(() => {
    if (!surface || !mismatch || suppressedRef.current) return;
    suppressedRef.current = true;
    Analytics.paywallSuppressedEntitled(surface);
  }, [surface, mismatch]);

  return {
    isPremium: backendPremium || entitled,
    backendPremium,
    entitled,
    statusLoading,
    activating: mismatch,
    syncing,
    retrySync: () => {
      if (!syncing) void runSync();
    },
    entitlementChecking,
  };
}
