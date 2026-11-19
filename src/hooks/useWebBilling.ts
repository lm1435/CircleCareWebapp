import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrentUser, refreshSubscriptionStatus } from '@/api/users';
import { devError } from '@/constants/config';
import {
  getWebOffering,
  purchasePackage,
  getManagementUrl,
  getWebCustomerInfo,
  toWebPlan,
  type WebPlan,
  type CustomerInfo,
} from '@/lib/purchases';
import { isWebBillingConfigured } from '@/lib/webBillingConfig';

/**
 * Hooks for the RevenueCat Web Billing purchase flow.
 *
 * Entitlement is granted server-side by the existing RC webhook, so after a
 * successful purchase we invalidate `subscription-status` + `circles` to flip
 * the Premium badge and lift read-only gating without a reload.
 */

export interface WebPlans {
  monthly: WebPlan | null;
  annual: WebPlan | null;
}

/** Fetch the web offering's monthly/annual packages (with live Stripe prices). */
export function useWebPlans(enabled = true): UseQueryResult<WebPlans> {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: queryKeys.webOfferings,
    // Only run when billing is configured AND a user is logged in (the RC app
    // user id must be the Supabase user id). `enabled` lets the profile card
    // read prices only while a web trial is showing.
    enabled: enabled && isWebBillingConfigured() && Boolean(userId),
    staleTime: 5 * 60 * 1000, // prices rarely change; avoid refetch churn
    queryFn: async (): Promise<WebPlans> => {
      const offering = await getWebOffering(userId as string);
      return {
        monthly: offering.monthly ? toWebPlan(offering.monthly) : null,
        annual: offering.annual ? toWebPlan(offering.annual) : null,
      };
    },
  });
}

/**
 * Purchase a plan; on success refresh entitlement-dependent caches. Resolves
 * with RevenueCat's CustomerInfo from the purchase, so the success state can
 * state the exact trial end / first charge (lib/trialCharge.ts).
 */
export function usePurchasePlan(): UseMutationResult<CustomerInfo | null, Error, WebPlan> {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (plan: WebPlan): Promise<CustomerInfo | null> => {
      if (!user?.id) throw new Error('Not authenticated');
      // Pre-fill RC's checkout with the REGISTERED email so the user can't pay
      // under a different address (RC skips its email field when one is passed).
      // The auth store copy can be blank right after a fresh login, so fall back
      // through the cached current user to a live fetch.
      const cached = queryClient.getQueryData<{ email?: string }>(queryKeys.currentUser);
      const email = user.email || cached?.email || (await getCurrentUser()).email;
      const result = await purchasePackage(user.id, plan.rcPackage, email || undefined);
      return result?.customerInfo ?? null;
    },
    onSuccess: async () => {
      // Re-sync the cached tier with RevenueCat BEFORE refetching: the status
      // read and every write gate use the cached `users.plan_tier`, which only
      // the RC webhook writes, so refetching first re-caches `free`. Mirrors
      // mobile/src/utils/entitlementSync.ts. A failed sync must never report
      // the (already paid) purchase as failed; the webhook is the backstop.
      try {
        await refreshSubscriptionStatus();
      } catch (err) {
        devError('Entitlement sync failed; falling back to the webhook:', err);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.circles }),
        // The entitlement just changed: the next read must be fresh, not the cached "free".
        queryClient.invalidateQueries({ queryKey: ['webCustomerInfo'] }),
      ]);
    },
  });
}

/**
 * RevenueCat's CustomerInfo for the signed-in user, for the trial line on the
 * profile's subscription card. RevenueCat holds every store's entitlement, so
 * an App Store / Play trial shows here too. Only with Web Billing configured
 * (the SDK needs its key). 1.4.3 item 2: also the entitlement half of "who is
 * Premium" on the surfaces that sell it (hooks/useEffectivePremium.ts), so it is
 * read whatever the cached tier says; `null` means unreadable (fail open).
 */
export function useWebCustomerInfo(enabled: boolean): UseQueryResult<CustomerInfo | null> {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: ['webCustomerInfo', userId],
    enabled: enabled && isWebBillingConfigured() && Boolean(userId),
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      try {
        // Capped: an unreadable RevenueCat is "unknown" (null), never a spinner that
        // outlives the page (1.4.3 item 2). The backend tier then decides, as before.
        return await withTimeout(getWebCustomerInfo(userId as string), CUSTOMER_INFO_TIMEOUT_MS);
      } catch {
        return null;
      }
    },
  });
}

const CUSTOMER_INFO_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(id);
        reject(error);
      }
    );
  });
}

/** Open the Stripe/RevenueCat subscription-management page in a new tab. */
export function useManageSubscription(): UseMutationResult<string | null, Error, void> {
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async (): Promise<string | null> => {
      if (!userId) throw new Error('Not authenticated');
      const url = await getManagementUrl(userId);
      if (url) {
        // This runs after an await, i.e. outside the click's user-gesture
        // stack, so Safari and Chrome routinely block the popup. window.open
        // then returns null and, before this check existed, the button
        // silently did nothing — a cancellation dead-end. Fall back to
        // same-tab navigation, which popup blockers never intercept.
        //
        // NO 'noopener'/'noreferrer' feature string: per the HTML spec it makes
        // window.open return null even when the tab opened, so the fallback below
        // ran every time and the app tab navigated away too (BH-025). Sever the
        // opener by hand instead, which keeps the same isolation.
        const win = window.open(url, '_blank');
        if (win) {
          try {
            win.opener = null;
          } catch {
            // cross-origin tab already detached
          }
        } else {
          window.location.assign(url);
        }
      }
      return url;
    },
  });
}
