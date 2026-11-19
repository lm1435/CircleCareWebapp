import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';

/**
 * Test shim for `@/hooks/useEffectivePremium` (1.4.3 item 2): the pre-1.4.3
 * behaviour, premium = the backend tier only, read through whatever
 * `useSubscriptionStatus` mock the test already installed. Suites that predate
 * the entitlement-aware paywall mock the hook with this so they keep exercising
 * the page, not RevenueCat; the entitlement behaviour has its own suites
 * (useEffectivePremium.test.tsx, UpgradePage.entitled.test.tsx).
 *
 *   vi.mock('@/hooks/useEffectivePremium', async () => import('@/test/backendOnlyEffectivePremium'));
 */
export function useEffectivePremium() {
  const result = useSubscriptionStatus() as { data?: { tier?: string }; isLoading?: boolean } | undefined;
  const backendPremium = result?.data?.tier === 'premium';
  return {
    isPremium: backendPremium,
    backendPremium,
    entitled: false,
    statusLoading: result?.isLoading === true,
    activating: false,
    syncing: false,
    retrySync: () => {},
    entitlementChecking: false,
  };
}
