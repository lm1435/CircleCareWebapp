// Shared API error classification for the web companion.
//
// The apiClient response interceptor (src/lib/api.ts) rejects with the backend
// envelope (`{ success: false, error: { code, message } }`), NOT an AxiosError:
//   - 402 Payment Required → `error.response.data` (envelope) — purchase flow is
//     mobile-only, so the web caller shows "open the app to upgrade".
//   - 403 / other failures → `error.response.data` (envelope) via the final
//     `Promise.reject(error.response?.data || error)`.
// So every write hook can classify a rejection by reading `err.error.code`.
//
// This generalizes the `isPermissionDeniedError` helper that originally lived in
// src/api/medicationConfirmations.ts so all write hooks classify 402/403 the
// same way and can distinguish "subscription required" (open app to upgrade)
// from "no permission" (view/read-only).

interface ApiErrorEnvelope {
  success?: boolean;
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * 402 Payment Required codes — the user must upgrade to perform this write.
 * Web cannot transact (RevenueCat is mobile-SDK-only), so the caller shows an
 * "open the CircleCare app to upgrade" affordance.
 */
export const SUBSCRIPTION_ERROR_CODES = new Set(['SUBSCRIPTION_REQUIRED', 'PAYMENT_REQUIRED']);

/**
 * 403 Forbidden codes — the user does not have edit permission on this circle
 * (membership view-only, or non-selected free-tier circle = read-only). The
 * caller shows a "you don't have permission" toast and refetches circle flags.
 */
export const ACCESS_ERROR_CODES = new Set(['VIEW_ONLY', 'FORBIDDEN', 'READ_ONLY']);

/**
 * 413 Payload Too Large codes — the PREMIUM circle has hit its hard storage cap
 * (1GB) and no upgrade can lift it (unlike the free-tier 402 path). The caller
 * shows "storage full", NOT "open the app to upgrade". Backend emits this from
 * the documents upload route (backend/src/routes/documents.ts) once a premium
 * circle exceeds PREMIUM_STORAGE_BYTES.
 */
export const STORAGE_FULL_ERROR_CODES = new Set(['STORAGE_LIMIT_EXCEEDED']);

/**
 * Union of all 402/403 access-rejection codes from `requireCircleEditAccess`
 * and friends. Kept verbatim from the original medicationConfirmations helper
 * so nothing that imported it changes behavior.
 */
export const PERMISSION_ERROR_CODES = new Set([
  ...SUBSCRIPTION_ERROR_CODES,
  ...ACCESS_ERROR_CODES,
]);

/** Extract the backend error code from an apiClient rejection, if present. */
function errorCode(err: unknown): string | undefined {
  const code = (err as ApiErrorEnvelope | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * True when the rejection is any 402/403 access rejection — the caller cannot
 * perform this write. Prefer `isSubscriptionRequiredError` /
 * `isAccessDeniedError` when the UI needs to distinguish the two.
 */
export function isPermissionDeniedError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && PERMISSION_ERROR_CODES.has(code);
}

/**
 * True for a 402 `SUBSCRIPTION_REQUIRED` / `PAYMENT_REQUIRED` rejection — the
 * write is premium-gated and the user must upgrade. Web shows "open the app to
 * upgrade" (no web purchase flow).
 */
export function isSubscriptionRequiredError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && SUBSCRIPTION_ERROR_CODES.has(code);
}

/**
 * True for a 403 view-only / read-only rejection — the user lacks edit
 * permission on this circle. Web shows "no permission" and refetches flags.
 */
export function isAccessDeniedError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && ACCESS_ERROR_CODES.has(code);
}

// ---------------------------------------------------------------------------
// Invite caregiver-cap detail (402 SUBSCRIPTION_REQUIRED on the invite paths)
// ---------------------------------------------------------------------------
// Both POST /circles/:circleId/invites and POST /invites/:inviteId/resend
// reject a free-tier circle with 402 SUBSCRIPTION_REQUIRED, but the reason
// splits in two and the UI must NOT treat them alike:
//   - `members_full`         — every caregiver seat is taken by a real member.
//                              Nothing to free; the only way forward is Premium.
//   - `pending_invite_seat`  — a still-pending invite to somebody ELSE is
//                              holding the last seat. Cancelling that invite
//                              frees it, so a paywall is the wrong message.
// `error.details` is ADDITIVE and OPTIONAL: a web build can reach a backend
// that predates it, so a missing/unrecognized payload must fall back to the
// original upgrade prompt.

/** Why a free-tier invite/resend was refused. */
export type InviteCapReason = 'pending_invite_seat' | 'members_full';

/** The pending invite occupying the last free caregiver seat. */
export interface BlockingInvite {
  id: string;
  invited_email: string;
}

export interface InviteCapDetails {
  reason: InviteCapReason;
  active_caregivers?: number;
  caregiver_limit?: number;
  /** null when `reason` is `members_full` — nothing is blocking, the seats are used. */
  blocking_invite?: BlockingInvite | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse the optional `error.details` payload off a 402 invite rejection.
 * Returns null when this is not a subscription rejection, when `details` is
 * absent (older backend), or when `reason` is not one we understand — every one
 * of those cases must behave exactly like the pre-`details` upgrade prompt.
 */
export function getInviteCapDetails(err: unknown): InviteCapDetails | null {
  if (!isSubscriptionRequiredError(err)) return null;
  const details = (err as ApiErrorEnvelope | null)?.error?.details;
  if (!isRecord(details)) return null;
  const reason = details.reason;
  if (reason !== 'pending_invite_seat' && reason !== 'members_full') return null;

  const blocking = isRecord(details.blocking_invite) ? details.blocking_invite : null;
  return {
    reason,
    active_caregivers:
      typeof details.active_caregivers === 'number' ? details.active_caregivers : undefined,
    caregiver_limit:
      typeof details.caregiver_limit === 'number' ? details.caregiver_limit : undefined,
    blocking_invite:
      blocking != null &&
      typeof blocking.id === 'string' &&
      typeof blocking.invited_email === 'string'
        ? { id: blocking.id, invited_email: blocking.invited_email }
        : null,
  };
}

/**
 * Non-null when the free caregiver seat is held by a PENDING invite the user
 * can cancel (`reason === 'pending_invite_seat'`) — i.e. "you already used your
 * invite", not "you hit the cap". `email` is null when the backend did not name
 * the blocking invite, so callers still have a message to show.
 *
 * Every other 402 (including a `details`-less one from an older backend)
 * returns null and stays on the upgrade path.
 */
export function getPendingInviteSeat(err: unknown): { email: string | null } | null {
  const details = getInviteCapDetails(err);
  if (details === null || details.reason !== 'pending_invite_seat') return null;
  const email = details.blocking_invite?.invited_email;
  return { email: typeof email === 'string' && email.trim().length > 0 ? email : null };
}

/**
 * 409 Conflict codes from the medication write paths
 * (backend/src/routes/calendarEvents.ts + medication confirm):
 *   - `DOSE_ALREADY_LOGGED` — a PATCH tried to change the time of a confirmed
 *     child dose; edit history is immutable, so the time can't move.
 *   - `MEDICATION_DISCONTINUED` — a confirm targeted an inactive medication;
 *     it must be reactivated before doses can be logged.
 * Both are state conflicts, not failures — the caller shows a specific message
 * instead of the generic "try again" retry copy.
 */
export const CONFLICT_ERROR_CODES = new Set(['DOSE_ALREADY_LOGGED', 'MEDICATION_DISCONTINUED']);

/**
 * True for any 409 medication-state conflict. Prefer the specific helpers when
 * the UI needs to distinguish the two messages.
 */
export function isMedicationConflictError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && CONFLICT_ERROR_CODES.has(code);
}

/**
 * True for a 409 `DOSE_ALREADY_LOGGED` rejection — an edit tried to change the
 * time of a dose that was already confirmed. The caller explains that a logged
 * dose's time can't be changed (mobile parity).
 */
export function isDoseAlreadyLoggedError(err: unknown): boolean {
  return errorCode(err) === 'DOSE_ALREADY_LOGGED';
}

/**
 * True for a 409 `MEDICATION_DISCONTINUED` rejection — a confirm targeted an
 * inactive (discontinued) medication. The caller points at reactivation instead
 * of offering a retry that can never succeed.
 */
export function isMedicationDiscontinuedError(err: unknown): boolean {
  return errorCode(err) === 'MEDICATION_DISCONTINUED';
}

/**
 * 429 Too Many Requests codes — the express rate limiters
 * (backend/src/middleware/rateLimit.ts) all reject with `RATE_LIMIT`; the
 * alternates are kept defensively for per-route limiters. E.g. the GDPR data
 * export allows 5 downloads/day — the caller shows "try again tomorrow"
 * rather than a generic failure.
 */
export const RATE_LIMIT_ERROR_CODES = new Set(['RATE_LIMIT', 'RATE_LIMITED', 'TOO_MANY_REQUESTS']);

/**
 * True for a 429 rate-limit rejection — the user has exhausted a per-user or
 * per-IP quota and should retry later (the UI says when, per endpoint).
 */
export function isRateLimitError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && RATE_LIMIT_ERROR_CODES.has(code);
}

/**
 * True for a 413 `STORAGE_LIMIT_EXCEEDED` rejection — a PREMIUM circle has hit
 * its 1GB hard cap. Distinct from `isSubscriptionRequiredError` (the free-tier
 * 402 path): there is nothing to upgrade to, so the caller shows "storage full"
 * rather than "open the app to upgrade".
 */
export function isStorageFullError(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && STORAGE_FULL_ERROR_CODES.has(code);
}
