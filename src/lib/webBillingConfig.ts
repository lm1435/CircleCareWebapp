import { env } from './env';

/**
 * Pure env predicate — whether RevenueCat Web Billing is configured.
 *
 * Deliberately split out of `src/lib/purchases.ts` (which owns the actual
 * `@revenuecat/purchases-js` SDK, ~177 KB gzip). Four modules only ever need
 * to know WHETHER checkout is available — not to touch the SDK itself
 * (InviteMemberModal's cap note, SubscriptionSection's CTA gate,
 * usePremiumGate's toast, useWebBilling's `enabled` guard) — and importing
 * this predicate from `purchases.ts` used to statically pull the whole SDK
 * into their (and therefore the entry chunk's) module graph.
 *
 * When false, the Upgrade CTA and /upgrade page are hidden (free users still
 * see the in-app upgrade pointer).
 */
export function isWebBillingConfigured(): boolean {
  return Boolean(env.VITE_REVENUECAT_WEB_BILLING_KEY);
}
