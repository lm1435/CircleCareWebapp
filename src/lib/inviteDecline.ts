/**
 * Invite decline (1.4.3): how the invitee's client reads a refused
 * `POST /invites/:id/decline`. Contract: docs/plans/invite-decline-1-4-3.md.
 * Mirrors mobile/src/utils/inviteDecline.ts (same codes, same copy keys).
 */

/** The backend's refusal codes for the decline route; anything else reports as 'other'. */
export const DECLINE_ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVITE_NOT_FOUND',
  'USER_NOT_FOUND',
  'EMAIL_MISMATCH',
  'INVITE_ALREADY_USED',
  'INVITE_CANCELLED',
  'INVITE_EXPIRED',
  // Decline BY CODE (1.4.3): the caller is the inviter or already a member.
  'NOT_INVITEE',
  'RATE_LIMIT',
  'SERVER_ERROR',
] as const;

export type DeclineErrorCode = (typeof DECLINE_ERROR_CODES)[number] | 'other';

export interface DeclineErrorReading {
  /** Analytics enum. */
  code: DeclineErrorCode;
  /** Copy key under `members:pending` (web) / `circles.pendingInvites` (mobile). */
  messageKey:
    | 'declineErrorUsed'
    | 'declineErrorInactive'
    | 'declineErrorExpired'
    | 'declineErrorRateLimit'
    | 'declineErrorGeneric';
  /**
   * Refetch the invitee's pending list: the row is stale (used / cancelled /
   * expired / gone / not theirs). False for a rate limit or a server error,
   * where the row is still valid and the user may retry.
   */
  refetch: boolean;
}

/** Reads a rejected decline. The axios client unwraps errors: the code is at `error.error.code`. */
export function readDeclineError(error: unknown): DeclineErrorReading {
  const raw = (error as { error?: { code?: unknown } } | null | undefined)?.error?.code;
  const code: DeclineErrorCode =
    typeof raw === 'string' && (DECLINE_ERROR_CODES as readonly string[]).includes(raw)
      ? (raw as DeclineErrorCode)
      : 'other';
  switch (code) {
    case 'INVITE_ALREADY_USED':
      return { code, messageKey: 'declineErrorUsed', refetch: true };
    case 'INVITE_CANCELLED':
    case 'INVITE_NOT_FOUND':
      return { code, messageKey: 'declineErrorInactive', refetch: true };
    case 'INVITE_EXPIRED':
      return { code, messageKey: 'declineErrorExpired', refetch: true };
    case 'RATE_LIMIT':
      return { code, messageKey: 'declineErrorRateLimit', refetch: false };
    case 'EMAIL_MISMATCH':
    case 'NOT_INVITEE':
    case 'VALIDATION_ERROR':
    case 'USER_NOT_FOUND':
      return { code, messageKey: 'declineErrorGeneric', refetch: true };
    default:
      return { code, messageKey: 'declineErrorGeneric', refetch: false };
  }
}
