import type { CancelPromptStatus } from '@/api/subscriptionStatus';

/**
 * Post-cancel "why did you turn off renewal?" prompt — the pure half, web port
 * of mobile/src/services/cancelReasonPrompt.ts. Spec:
 * docs/plans/cancel-reason-prompt.md ("Web companion").
 *
 * Everything that decides WHETHER to ask lives here, away from React, so the
 * eligibility table can be tested against plain fixtures and a fixed `now`.
 * The component (components/subscription/CancelReasonPrompt) owns WHEN and
 * the UI; it never re-derives any of this.
 *
 * OPTION B (decided 2026-09-21): this reads GET /subscription-status's
 * `cancelPrompt` field — a webhook-synced cache on `public.users`
 * (backend/supabase/migrations/20260921120000_users_renewal_off_cache.sql) —
 * NOT RevenueCat in the browser. purchases-js and its ~177 KB chunk are gone
 * from this whole feature; see components/subscription/CancelReasonPrompt.tsx
 * for what that removed. Everything below this comment converts to epoch
 * millis once, so the key's unsubscribe suffix stays the same shape mobile's
 * key uses (the user part is hashed on web — see cancelAskKey).
 */

/** How long after RevenueCat detected the unsubscribe the question is still worth asking. */
export const CANCEL_ASK_WINDOW_MS = 30 * 24 * 3600 * 1000;

/**
 * The show-once key: `circlecare_install:cancel_ask:<userHash>:<unsubscribeMs>`.
 * Same prefix and unsubscribe-millis suffix as mobile's key.
 *
 * `circlecare_install:` is NOT touched by web sign-out: `authStore`'s
 * `clearLocalSession` removes only the session-hint cookie, the parked invite
 * code (sessionStorage) and in-memory state — it never calls
 * `localStorage.clear()` or iterates keys — so signing out and back in does not
 * re-ask. Keyed by user AND unsubscribe instant for the same reasons as mobile
 * (shared browser; cancel -> resubscribe -> cancel asks once more).
 *
 * NO RAW USER ID IN THE KEY. Because the key outlives sign-out, a raw Supabase
 * user id here would sit in the browser's storage indefinitely, readable by the
 * next person on a shared machine. `userHash` is a one-way SHA-256 of a
 * fixed-prefix string (`cancel_ask:<userId>`), hex, truncated to 16 chars (64
 * bits — ample to keep a handful of accounts on one browser apart). Same user →
 * same key, so show-once still holds across sessions.
 *
 * Async because `crypto.subtle.digest` is. Rejects if WebCrypto is unavailable
 * (non-secure context); the two callers below turn that into fail-quiet.
 */
const USER_HASH_PREFIX = 'cancel_ask:';
const USER_HASH_HEX_CHARS = 16;

async function hashUserId(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${USER_HASH_PREFIX}${userId}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex.slice(0, USER_HASH_HEX_CHARS);
}

export async function cancelAskKey(userId: string, unsubscribeDetectedAtMs: number): Promise<string> {
  return `circlecare_install:cancel_ask:${await hashUserId(userId)}:${unsubscribeDetectedAtMs}`;
}

export type CancelReasonEligibility =
  | { eligible: false }
  | {
      eligible: true;
      entitlementActive: boolean;
      /** Epoch millis; formatted for display by the component. */
      expirationDateMs: number;
      periodType: string;
      unsubscribeDetectedAtMs: number;
      /**
       * Surfaced (not filtered — dropped 2026-09-21), straight passthrough of
       * `cancelPrompt.isSandbox`, so sandbox answers can be tagged rather than
       * excluded. See `CancelPromptStatus.isSandbox` in api/subscriptionStatus.ts.
       */
      isSandbox: boolean;
    };

const NOT_ELIGIBLE: CancelReasonEligibility = { eligible: false };

/**
 * Should this user be asked why they turned off renewal?
 *
 * `cancelPrompt` is `GET /subscription-status`'s `cancelPrompt` field — `null`
 * for everyone who never cancelled, or whose cancellation fell outside the
 * server's own 30-day window. Everything FAMILY_SHARED / sandbox /
 * billing-issue / cancel_reason used to filter here is now filtered by the
 * webhook BEFORE it ever writes the cache (backend/src/routes/webhooks.ts,
 * the CANCELLATION case) — this function no longer has that data to
 * re-check, and does not need it: a non-null `cancelPrompt` already means a
 * real subscriber's own account genuinely turned auto-renew off.
 *
 * The one thing worth re-deriving on the client is the 30-day window itself,
 * defensively: the server clock already gated it at response time, but a
 * long-open tab could hold onto a stale response past the window, and
 * `renewalOffAt` is cheap to re-check against `nowMs`.
 */
export function evaluateCancelReasonEligibility(
  cancelPrompt: CancelPromptStatus | null | undefined,
  userId: string | null | undefined,
  nowMs: number
): CancelReasonEligibility {
  if (!cancelPrompt || !userId) return NOT_ELIGIBLE;

  const unsubscribedAt = Date.parse(cancelPrompt.renewalOffAt);
  const expirationMs = Date.parse(cancelPrompt.accessEndsAt);
  if (Number.isNaN(unsubscribedAt) || Number.isNaN(expirationMs)) return NOT_ELIGIBLE;
  if (nowMs - unsubscribedAt > CANCEL_ASK_WINDOW_MS) return NOT_ELIGIBLE;

  return {
    eligible: true,
    entitlementActive: cancelPrompt.entitlementActive,
    expirationDateMs: expirationMs,
    // The migration's `renewal_off_period_type` is nullable (RevenueCat did
    // not send `period_type` on the CANCELLATION); '' rather than a made-up
    // enum value, since the only readers are analytics properties, never
    // copy — same convention as mobile's optional fields.
    periodType: cancelPrompt.periodType ?? '',
    unsubscribeDetectedAtMs: unsubscribedAt,
    isSandbox: cancelPrompt.isSandbox,
  };
}

/**
 * Has this user already been asked about this cancellation?
 *
 * FAILS QUIET: a key we cannot compute (no WebCrypto) or a storage read we
 * cannot make (Safari private mode, blocked site data) is answered "already
 * asked" — missing one answer costs nothing, re-asking a departing customer on
 * every load is a nag. Never rejects.
 */
export async function hasAskedCancelReason(
  userId: string,
  unsubscribeDetectedAtMs: number
): Promise<boolean> {
  try {
    const key = await cancelAskKey(userId, unsubscribeDetectedAtMs);
    return window.localStorage.getItem(key) !== null;
  } catch {
    return true;
  }
}

/**
 * Record that the question was answered or explicitly dismissed. Hashing and
 * write failures are swallowed — never rejects, so callers may fire and forget.
 */
export async function markCancelReasonAsked(
  userId: string,
  unsubscribeDetectedAtMs: number
): Promise<void> {
  try {
    const key = await cancelAskKey(userId, unsubscribeDetectedAtMs);
    window.localStorage.setItem(key, 'true');
  } catch {
    // Worst case: asked once more on a later load.
  }
}

// ── Page-load session state ─────────────────────────────────────────────────
// MODULE SCOPE (mobile: per cold start): the component remounts on every
// sign-in and across AuthGuard's bootstrap spinner, and a ref would forget that
// this page load was already evaluated.

let evaluatedThisPageLoad = false;

export function wasCancelReasonEvaluatedThisPageLoad(): boolean {
  return evaluatedThisPageLoad;
}

export function markCancelReasonEvaluatedThisPageLoad(): void {
  evaluatedThisPageLoad = true;
}

/**
 * Give the page load its evaluation back. Only for a prompt that was PRESENTED
 * and then unmounted without an explicit close (sign-out mid-modal): nothing
 * was written, so the next sign-in in this tab re-evaluates, per spec.
 */
export function resetCancelReasonEvaluation(): void {
  evaluatedThisPageLoad = false;
}

/** Test-only: return the module to a fresh page load. */
export function __resetCancelReasonPromptForTests(): void {
  evaluatedThisPageLoad = false;
}
