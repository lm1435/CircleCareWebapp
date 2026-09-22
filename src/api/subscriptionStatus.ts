import { apiClient } from '@/lib/api';

// GET /api/subscription-status (backend/src/routes/subscriptionStatus.ts).
// NOTE: unlike most routes this one returns a BARE object — no
// `{ success, data }` envelope — so after the interceptor unwraps
// `response.data` the resolved value IS the status object.
// The plan documents `trialEndsAt` but the backend does not currently return
// it; it is typed optional so the field is forward-compatible.

/**
 * The web cancel-reason prompt's ONLY input (docs/plans/cancel-reason-prompt.md,
 * "Web companion"). Webhook-synced cache — see
 * backend/supabase/migrations/20260921120000_users_renewal_off_cache.sql —
 * never a RevenueCat call from the browser. The backend has already applied
 * the 30-day window; `webapp/src/lib/cancelReasonPrompt.ts` re-checks it
 * defensively against `renewalOffAt` (a long-open tab could hold a stale
 * response past the window).
 */
export interface CancelPromptStatus {
  renewalOffAt: string;
  accessEndsAt: string;
  periodType: string | null;
  entitlementActive: boolean;
  /**
   * Whether the CANCELLATION that set this cache arrived from RevenueCat with
   * environment=SANDBOX. Surfaced, not filtered — dropped 2026-09-21: custom
   * Xcode builds mean the TestFlight binary IS the production binary, so a
   * sandbox flag can never distinguish a real customer from us testing.
   * Threaded into the `/feedback` submission and analytics events the same
   * way mobile threads `entitlement.isSandbox`, so sandbox answers can be
   * filtered out of real cancellation-reason analytics later.
   */
  isSandbox: boolean;
}

export interface SubscriptionStatus {
  tier: string; // 'free' | 'premium'
  needsCircleSelection: boolean;
  trialEndsAt?: string | null;
  // `null` for the vast majority of users (never cancelled, or outside the
  // 30-day ask window). Optional too, so an older cached response (mid-
  // rollout, or a client that hasn't refetched) degrades to "not eligible"
  // rather than a crash.
  cancelPrompt?: CancelPromptStatus | null;
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return (await apiClient.get('/subscription-status')) as unknown as SubscriptionStatus;
}

/**
 * POST /api/subscription-status/select-downgrade-circle — a downgraded owner of
 * 2+ circles picks the ONE circle to keep with free access; the rest become
 * read-only. Returns `{ success: true }`; throws the backend envelope on a
 * business-rule violation (e.g. already selected).
 */
export async function selectDowngradeCircle(circleId: string): Promise<void> {
  await apiClient.post('/subscription-status/select-downgrade-circle', { circleId });
}
