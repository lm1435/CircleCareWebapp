import { apiClient } from '@/lib/api';

// VERIFIED against backend/src/routes/feedback.ts: `POST /api/feedback`
// (requireAuth + feedbackRateLimit 5/h) — body is a discriminated union on
// `type`; this module only sends the `cancellation` arm:
//   { type: 'cancellation', reason: CancelReason, description?: string(<=1000, trimmed) }
// Success: `{ success: true }`. Any non-2xx rejects (axios), which the caller
// treats as "not sent".

export const CANCEL_REASONS = [
  'auto_charge',
  'too_expensive',
  'something_broken',
  'missing_feature',
  'not_needed',
  'other',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export interface CancellationFeedbackPayload {
  type: 'cancellation';
  reason: CancelReason;
  description?: string;
  /**
   * Whether `cancelPrompt.isSandbox` (backend-cached RevenueCat
   * environment=SANDBOX) said this was a sandbox cancellation. Tags the
   * support email subject with `[Sandbox]` rather than excluding it — see
   * docs/plans/cancel-reason-prompt.md ("sandbox exclusion dropped
   * 2026-09-21").
   */
  isSandbox?: boolean;
}

export async function submitCancellationFeedback(
  payload: CancellationFeedbackPayload
): Promise<void> {
  await apiClient.post('/feedback', payload);
}
