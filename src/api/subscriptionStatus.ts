import { apiClient } from '@/lib/api';

// GET /api/subscription-status (backend/src/routes/subscriptionStatus.ts).
// NOTE: unlike most routes this one returns a BARE object — no
// `{ success, data }` envelope — so after the interceptor unwraps
// `response.data` the resolved value IS the status object.
// The plan documents `trialEndsAt` but the backend does not currently return
// it; it is typed optional so the field is forward-compatible.

export interface SubscriptionStatus {
  tier: string; // 'free' | 'premium'
  needsCircleSelection: boolean;
  trialEndsAt?: string | null;
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
