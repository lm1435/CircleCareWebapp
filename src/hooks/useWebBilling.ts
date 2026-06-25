import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrentUser } from '@/api/users';
import {
  getWebOffering,
  purchasePackage,
  getManagementUrl,
  toWebPlan,
  isWebBillingConfigured,
  type WebPlan,
} from '@/lib/purchases';

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
export function useWebPlans(): UseQueryResult<WebPlans> {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: queryKeys.webOfferings,
    // Only run when billing is configured AND a user is logged in (the RC app
    // user id must be the Supabase user id).
    enabled: isWebBillingConfigured() && Boolean(userId),
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

/** Purchase a plan; on success refresh entitlement-dependent caches. */
export function usePurchasePlan(): UseMutationResult<void, Error, WebPlan> {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (plan: WebPlan): Promise<void> => {
      if (!user?.id) throw new Error('Not authenticated');
      // Pre-fill RC's checkout with the REGISTERED email so the user can't pay
      // under a different address (RC skips its email field when one is passed).
      // The auth store copy can be blank right after a fresh login, so fall back
      // through the cached current user to a live fetch.
      const cached = queryClient.getQueryData<{ email?: string }>(queryKeys.currentUser);
      const email = user.email || cached?.email || (await getCurrentUser()).email;
      await purchasePackage(user.id, plan.rcPackage, email || undefined);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.circles }),
      ]);
    },
  });
}

/** Open the Stripe/RevenueCat subscription-management page in a new tab. */
export function useManageSubscription(): UseMutationResult<string | null, Error, void> {
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async (): Promise<string | null> => {
      if (!userId) throw new Error('Not authenticated');
      const url = await getManagementUrl(userId);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return url;
    },
  });
}
