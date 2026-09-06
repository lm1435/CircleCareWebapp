import { useAuthStore } from '@/store/authStore';

/**
 * Namespace a browser-storage key by the signed-in user.
 *
 * WB7: the onboarding funnel guards used to be a single un-namespaced key per
 * browser. On a shared device, the SECOND account to sign in inherited the
 * FIRST account's "already onboarded" flag and its funnel silently never fired
 * — indistinguishable from a real completion. The onboarding PAYWALL flag has
 * the same failure mode with a worse outcome: the second user would inherit
 * "already asked" and never be shown the paywall at all.
 *
 * Falls back to a shared 'anon' bucket pre-auth, which matches the prior
 * behaviour for that edge case.
 *
 * EXTRACTED from onboardingAnalytics.ts (its original home) so
 * onboardingPaywall.ts can share the one definition WITHOUT importing that
 * module — several component tests replace `@/lib/onboardingAnalytics`
 * wholesale with a two-function mock, and a paywall that reached its storage
 * through that module would explode inside those tests.
 */
export function scopedKey(base: string): string {
  const userId = useAuthStore.getState().user?.id ?? 'anon';
  return `${base}:${userId}`;
}
