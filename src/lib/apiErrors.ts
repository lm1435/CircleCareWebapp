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
 * 403 Forbidden codes — the user does not have edit permission on this circle.
 * The caller shows a "you don't have permission" toast and refetches circle
 * flags via `invalidateCircleAccessFlags`.
 *
 * THESE ARE THE CODES THE SERVER SENDS, NOT PLAUSIBLE NAMES FOR THEM. The
 * backend's entire 403 access vocabulary is three strings (verified by
 * `grep -rhoE "code: '[A-Z_]+'" backend/src/routes backend/src/middleware`):
 *
 *   VIEW_ONLY          membership-level view-only seat — `rejectIfViewOnlySeat`
 *                      and friends. No purchase by this member lifts it; only
 *                      the owner handing them a full seat does.
 *   FORBIDDEN          not a member of the circle at all, or not the resource's
 *                      owner/uploader.
 *   READ_ONLY_MEMBER   the FROZEN-circle refusal: a free-tier owner's
 *                      NON-SELECTED circle, where `view_only` is false and
 *                      `can_edit` is false. Emitted from exactly three places —
 *                      `backend/src/routes/documents.ts:673` and
 *                      `backend/src/routes/upload.ts:328` / `:487`.
 *
 * `READ_ONLY_MEMBER` MATTERS MORE THAN ITS ONE CALL SITE SUGGESTS.
 * `documents.ts` was widened so a frozen circle's member is now refused on
 * document upload / rename / delete — writes that used to succeed. Because
 * every write hook classifies through `isPermissionDeniedError` /
 * `isAccessDeniedError`, a code missing from this set does not fail loudly: it
 * falls to the caller's generic branch, which shows "couldn't save" (wrong —
 * nothing was wrong with the save) AND skips the flag refetch, so both gating
 * caches stay stale and the Edit / Delete / Upload affordances keep being
 * offered on a circle the server refuses every write on.
 *
 * `READ_ONLY` (no `_MEMBER`) WAS A PHANTOM AND HAS BEEN DROPPED. No backend
 * revision ever emitted it: `git log --all -S'READ_ONLY' -- src` over
 * `backend/` finds the single commit that introduced `READ_ONLY_MEMBER`, and no
 * commit's tree contains a bare `READ_ONLY` under `backend/src`. It was a
 * guessed name that happened to describe this exact frozen-circle case while
 * matching nothing that arrives. Pinned by
 * `src/lib/__tests__/apiErrors.test.ts` ("the backend 403 vocabulary, exactly")
 * so the set cannot drift back to names nobody sends.
 */
export const ACCESS_ERROR_CODES = new Set(['VIEW_ONLY', 'FORBIDDEN', 'READ_ONLY_MEMBER']);

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

/**
 * True for the FROZEN-CIRCLE refusal specifically — a free-tier owner's
 * non-selected circle, where `view_only` is false and `can_edit` is false.
 *
 * A NARROWER TEST THAN `isAccessDeniedError`, AND WHY IT HAS TO EXIST. The
 * three codes in `ACCESS_ERROR_CODES` share exactly one property: the caller
 * cannot buy their way past them. That is a fact about what the CLIENT should
 * not offer next (no paywall), not about the REMEDY — and any surface that
 * words its message in terms of the remedy has to tell them apart. "Ask the
 * circle owner for full access" is right for `VIEW_ONLY` (a seat) and wrong
 * for `READ_ONLY_MEMBER`, which no seat change fixes: the circle is frozen
 * until a subscription covers it.
 *
 * Use it AFTER `isAccessDeniedError` has decided nothing may be sold, never
 * instead of it.
 */
export function isFrozenCircleError(err: unknown): boolean {
  return errorCode(err) === 'READ_ONLY_MEMBER';
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
 * 400 `INVALID_OCCURRENCE_DATE` — the `scheduled_date` posted alongside a
 * series root is not an occurrence of that series
 * (`backend/src/routes/calendarEvents.ts`, the complete route's on-pattern
 * check). Emitted only after the row was drawn, so it is a STALE-SNAPSHOT
 * condition, not user error: another member shortening `recurrence_end_date` or
 * editing the pattern while this tab holds its 60s-stale calendar is enough.
 *
 * It has to be distinguished from a generic failure because the request can
 * never succeed — retrying re-posts the same off-pattern date — so the caller
 * must say what happened and refetch, not offer "try again".
 */
export function isInvalidOccurrenceDateError(err: unknown): boolean {
  return errorCode(err) === 'INVALID_OCCURRENCE_DATE';
}

/**
 * 404 `NOT_FOUND` — the addressed row is gone. Same shape as the above: the
 * client is holding a snapshot of something another member has deleted, so the
 * answer is "it no longer exists" plus a refetch, never a retry.
 */
export function isNotFoundError(err: unknown): boolean {
  return errorCode(err) === 'NOT_FOUND';
}

/**
 * 400 `INVALID_MESSAGE` — the AI chat route's prompt-injection detector
 * refused the message (`backend/src/routes/ai.ts`, `detectPromptInjection`).
 * Terminal for that exact text: sending it again produces the same 400, so the
 * assistant must ask for a rephrase rather than offering a retry.
 */
export function isInvalidMessageError(err: unknown): boolean {
  return errorCode(err) === 'INVALID_MESSAGE';
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

// ─────────────────────────────────────────────────────────────────────────────
// FAILURE CODE CLASSIFICATION (for analytics `error` properties)
// ─────────────────────────────────────────────────────────────────────────────
//
// MIRRORED ON MOBILE. An identical implementation lives at
// `mobile/src/utils/apiError.ts` (`classifyFailureCode`, same vocabulary, same
// ordering, same `ANALYTICS_CODE_SHAPE`). The two trees are separate npm
// projects with no shared package, so the copy is deliberate — change BOTH or
// the admin daily digest, which groups `circle_creation_failed` by
// `properties.error` across platforms (backend/src/services/adminDigestService.ts),
// splits one bucket in two.

/**
 * The CLOSED fallback vocabulary — every value `classifyFailureCode` can return
 * that is NOT a backend error code and NOT `http_<status>`.
 *
 * Derived from what `src/lib/api.ts` can actually reject with. Its interceptor
 * rejects `error.response?.data || error`, exactly as mobile's does, so the
 * shapes — and therefore this list — are the same on both platforms:
 *
 *  - 'timeout'           — axios `ECONNABORTED` / `ETIMEDOUT` (the `API_TIMEOUT`
 *                          fired), or a fetch-adapter `AbortError`. No response,
 *                          so there is no status to report.
 *  - 'network_error'     — axios `ERR_NETWORK`: offline, DNS failure, TLS
 *                          refused, or a CORS rejection (the browser reports
 *                          those as a network failure with no status readable
 *                          from script).
 *  - 'api_error_no_code' — the backend envelope arrived but named no usable
 *                          code, or `error.code` was prose rather than a
 *                          constant. Our API failed in a way we did not name.
 *  - 'non_json_response' — the rejection is a bare STRING: the interceptor
 *                          rejects `response.data` whenever it is truthy, so an
 *                          edge error page (LiteSpeed/Cloudflare HTML, a
 *                          text/plain 502) arrives as its body with the status
 *                          discarded. An infrastructure signal.
 *  - 'client_error'      — an `Error` thrown by our own code, no response and no
 *                          envelope (a storage failure, a TypeError in the
 *                          success path).
 *  - 'unknown_error'     — the residual: `null`, `undefined`, a number, an
 *                          object with nothing readable.
 *
 * 'unknown_error' matches the value MOBILE has been sending for this event since
 * it shipped, so the digest's existing series continues rather than restarting.
 * Web previously sent `'CIRCLE_CREATE_FAILED'` as its own codeless fallback
 * (CreateCircleModal.tsx); that value is retired — it named the ACTION, not the
 * failure, and could not be compared with anything mobile sent.
 */
export const FAILURE_FALLBACK_CODES = [
  'timeout',
  'network_error',
  'api_error_no_code',
  'non_json_response',
  'client_error',
  'unknown_error',
] as const;

export type FailureFallbackCode = (typeof FAILURE_FALLBACK_CODES)[number];

/**
 * What `classifyFailureCode` returns: a backend error code, `http_<status>`, or
 * a fallback category. Typed as `string` because the backend's code space is
 * open — but the VALUE is always bounded.
 */
export type FailureCode = FailureFallbackCode | string;

/**
 * A CODE IS A SHOUTED CONSTANT — anything else is prose wearing a code's field
 * name. `error.code` is not a field we control; a proxy, an SDK or a future
 * backend handler can put anything in it, and an analytics grouping dimension
 * has to be a closed set. Kept identical to mobile's copy (and to
 * `CODE_SHAPE` in `mobile/src/lib/oauth.ts`, where an unbounded version once
 * sent a user's email address to PostHog as a property).
 *
 * WHAT THIS BOUNDS IS THE SHAPE, NOT THE CONTENT. Free text and any multi-token
 * identifier become unforwardable — no whitespace, no `@`, no `.`, no `://`,
 * nothing over 64 characters — which is the class the leak above belonged to.
 * It does not inspect meaning: a lone token like `Lisinopril` or `Margaret`
 * matches and passes through verbatim (pinned in
 * `__tests__/failureCodeIsBounded.test.ts`, describe 6b). The remaining space is
 * safe because of the backend, not this regex: every `code` in the envelope is
 * an app-authored SHOUTED literal, never interpolated from request input.
 */
const ANALYTICS_CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function asBoundedCode(value: unknown): string | undefined {
  return typeof value === 'string' && ANALYTICS_CODE_SHAPE.test(value) ? value : undefined;
}

/** A real HTTP status off either rejection shape, or undefined. */
function httpStatusOf(err: object): number | undefined {
  const candidate = err as { status?: unknown; response?: { status?: unknown } | null };
  const status =
    typeof candidate.response?.status === 'number'
      ? candidate.response.status
      : typeof candidate.status === 'number'
        ? candidate.status
        : undefined;
  // Bounded on purpose: `http_${status}` is a grouping value, so it must never
  // become `http_NaN` or an arbitrary number off a foreign object.
  if (status === undefined || !Number.isInteger(status) || status < 100 || status > 599) {
    return undefined;
  }
  return status;
}

/** True when the value looks like the backend's `{ success, error: {...} }` body. */
function hasErrorEnvelope(err: object): boolean {
  const candidate = err as { success?: unknown; error?: unknown };
  return (
    candidate.success === false || (typeof candidate.error === 'object' && candidate.error !== null)
  );
}

/**
 * Turn a caught API failure into a BOUNDED analytics value.
 *
 * Resolution order, and why:
 *   1. The backend CODE, from the unwrapped envelope or (defensively) from a
 *      raw AxiosError that bypassed the interceptor. Already an app-authored
 *      literal and the most useful signal, so it wins over everything.
 *   2. Explicit transport codes — only an AxiosError carries these, and only
 *      when there was no response at all.
 *   3. `http_<status>`, when a response exists but named no code — a 502 with an
 *      empty body is an EDGE failure and must not read as an app bug.
 *   4. Message heuristics for adapters that report a timeout/network failure
 *      without a code. Deliberately AFTER the status check so a status-bearing
 *      error is never reclassified by a word in its message.
 *   5. Envelope-but-no-code, then our own thrown Error, then the residual.
 *
 * NEVER returns free text, and never throws — it is called from `onError`
 * handlers, so it must not become the reason a failure handler fails.
 */
export function classifyFailureCode(err: unknown): FailureCode {
  try {
    // A bare string is `response.data` from a non-JSON error body. It is NOT
    // returned — only its existence is.
    if (typeof err === 'string') {
      return err.trim().length > 0 ? 'non_json_response' : 'unknown_error';
    }
    if (err === null || typeof err !== 'object') return 'unknown_error';

    const candidate = err as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      response?: { data?: unknown } | null;
    };

    // 1. The backend's own code.
    const envelopeCode =
      asBoundedCode((err as ApiErrorEnvelope).error?.code) ??
      asBoundedCode((candidate.response?.data as ApiErrorEnvelope | undefined)?.error?.code);
    if (envelopeCode) return envelopeCode;

    // 2. Transport codes axios sets on the error itself, never in a body.
    const transportCode = typeof candidate.code === 'string' ? candidate.code : '';
    if (transportCode === 'ECONNABORTED' || transportCode === 'ETIMEDOUT') return 'timeout';
    if (transportCode === 'ERR_NETWORK') return 'network_error';
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';

    // 3. A response reached us but named no code.
    const status = httpStatusOf(err);
    if (status !== undefined) return `http_${status}`;

    // 4. Codeless transport failures, by message.
    const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
    if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
    if (message === 'network error' || message.includes('network request failed')) {
      return 'network_error';
    }

    // 5. An envelope with no usable code, then our own throw, then the residual.
    if (hasErrorEnvelope(err)) return 'api_error_no_code';
    if (err instanceof Error) return 'client_error';

    return 'unknown_error';
  } catch {
    return 'unknown_error';
  }
}
