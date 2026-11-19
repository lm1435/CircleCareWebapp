import { TRIAL_ENTITLEMENT_ID } from '@/lib/trialCharge';

/**
 * 1.4.3 item 2 (docs/plans/purchase-trial-gaps-1-4-3.md, Fable review S6/S7).
 *
 * WHO IS PREMIUM, on the surfaces that SELL it (the paywall, the profile card,
 * the digest row): `backend tier === 'premium'` OR an active
 * `CircleCare Premium` entitlement in RevenueCat's CustomerInfo. Web is DB-first
 * (memory project_web_subscription_parity): every write gate still reads the
 * backend's cached `plan_tier`, so the entitlement only ever REMOVES a sell
 * button from someone RevenueCat says is paying; it never grants a feature.
 *
 * It is user-level, not circle-level. A member of a free circle who is Premium
 * themself is still refused circle-level premium features by the owner-aware
 * gate (`usePremiumGate` / `lib/premiumOwnership.ts`): nothing here is read by
 * those gates.
 */

interface CustomerInfoLike {
  entitlements?: { active?: Record<string, unknown> | null } | null;
}

/** True when RevenueCat reports an ACTIVE Premium entitlement (any store). */
export function hasActiveEntitlement(info: CustomerInfoLike | null | undefined): boolean {
  const active = info?.entitlements?.active;
  return Boolean(active && active[TRIAL_ENTITLEMENT_ID]);
}

/** The entitlement's period type ('TRIAL' | 'INTRO' | 'NORMAL' | ...), upper-cased, or null. */
export function entitlementPeriodType(
  info: { entitlements?: { active?: Record<string, { periodType?: string | null } | undefined> } | null } | null | undefined
): string | null {
  const ent = info?.entitlements?.active?.[TRIAL_ENTITLEMENT_ID];
  if (!ent) return null;
  const type = String(ent.periodType ?? '').toUpperCase();
  return type || null;
}

/** Longest the sell button waits for the entitlement read before it fails open. */
export const ENTITLEMENT_READ_HOLD_MS = 3000;

/** Users whose mismatch has already been synced this session (cleared on sign-out). */
export const syncedUsers = new Set<string>();
/** Users whose reverse mismatch (backend premium, RC inactive) was already reported. */
export const reverseReported = new Set<string>();

/** Sign-out / account switch: the next session starts clean (authStore.clearLocalSession). */
export function resetEffectivePremiumSession(): void {
  syncedUsers.clear();
  reverseReported.clear();
}
