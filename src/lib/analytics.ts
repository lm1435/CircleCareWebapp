import posthog from 'posthog-js';
import { env } from './env';

/**
 * Typed analytics wrapper for the web companion — mirrors mobile's
 * `Analytics` object (mobile/src/services/analytics.ts) so the SAME event names
 * land in the SAME PostHog project, separated only by the `platform: 'web'`
 * super-property registered in lib/posthog.ts.
 *
 * PHI RULES (match mobile):
 * - Event properties carry ONLY ids (circle_id, event_id), counts, enums
 *   (role, event_type, method, status, category, vital_type), booleans, and
 *   short error codes/messages.
 * - NEVER names, emails, DOB, medication names, health conditions, note/message
 *   text, or AI prompt/response text.
 *
 * OPTIONAL: PostHog has no API key in many environments. `capture` no-ops
 * safely when uninitialized (guarded on `env.VITE_POSTHOG_KEY`, the same signal
 * `initAnalytics` uses), so every call below is safe to make unconditionally.
 */
function capture(event: string, props?: Record<string, unknown>): void {
  if (!env.VITE_POSTHOG_KEY) return;
  posthog.capture(event, props);
}

/** Max length of any free-text error property we forward to PostHog. */
const MAX_ERROR_TEXT_LENGTH = 200;

/** RFC-ish email detector — deliberately loose so near-misses are still redacted. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** JWTs always start with the base64 of `{"` → `eyJ`, then two more segments. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g;

/**
 * Any other long unbroken opaque run (API keys, session ids, signed URLs' path
 * segments). 40 is above a UUID (36) and far above every real word/error code,
 * so identifiable codes like `SUBSCRIPTION_REQUIRED` survive untouched.
 */
const OPAQUE_TOKEN_RE = /\b[A-Za-z0-9_-]{40,}\b/g;

/** Matches a whitespace-delimited token that STARTS like a URL or absolute path. */
const URL_TOKEN_RE = /^([([{'"]*)((?:https?:\/\/|\/)\S*)$/i;

/**
 * Drop the query string / fragment from a URL-looking token, keeping the path so
 * the error stays identifiable. Only tokens that begin like a URL are touched,
 * so prose such as "and/or?" is left alone.
 */
function stripUrlQuery(token: string): string {
  const match = URL_TOKEN_RE.exec(token);
  if (!match) return token;
  const [, prefix, url] = match;
  const cut = url.search(/[?#]/);
  return cut === -1 ? token : prefix + url.slice(0, cut);
}

/**
 * Scrub free-text error strings before they become PostHog event properties.
 *
 * Every CURRENT call site already passes a stable backend error CODE (verified:
 * LoginPage, SignUpPage, CreateCircleModal, useInvites), so this is
 * defense-in-depth for future call sites that might reach for `err.message` —
 * raw messages can carry the user's email, a token from an auth callback URL, or
 * a query string with invite codes.
 *
 * Rules, in order: collapse whitespace → strip URL query strings/fragments →
 * redact emails → redact JWTs and long opaque tokens → truncate to 200 chars.
 * Never throws and is null/undefined-safe (returns '' for non-strings), because
 * analytics must never break the flow that failed.
 */
export function sanitizeErrorText(raw: string): string {
  try {
    if (typeof raw !== 'string' || raw.length === 0) return '';
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    const cleaned = collapsed
      .split(' ')
      .map(stripUrlQuery)
      .join(' ')
      .replace(EMAIL_RE, '[email]')
      .replace(JWT_RE, '[token]')
      .replace(OPAQUE_TOKEN_RE, '[token]');
    return cleaned.length > MAX_ERROR_TEXT_LENGTH
      ? cleaned.slice(0, MAX_ERROR_TEXT_LENGTH)
      : cleaned;
  } catch {
    return '';
  }
}

// 'oauth' is a web-only, provider-agnostic fallback: when an OAuth callback
// fires a completion event but the specific provider couldn't be recovered
// (e.g. the user deep-linked straight to /auth/callback, or Safari private-mode
// blocked the sessionStorage handoff), we report the honest 'oauth' rather than
// falsely attributing the sign-in to a guessed provider.
type AuthMethod = 'email' | 'google' | 'apple' | 'oauth';
type MedicationStatus = 'taken' | 'taken_late' | 'skipped';

/**
 * How this browser first saw the user reach "onboarded" (has >= 1 circle):
 * - 'created'  — their first circle was created here.
 * - 'joined'   — they accepted an invite here with no prior circles.
 * - 'existing' — they arrived already having circles (device swap / signed in
 *   on another platform first). Filterable in funnels.
 */
export type OnboardingPath = 'created' | 'joined' | 'existing';

export const Analytics = {
  // --- Auth ---
  signupStarted: (method: AuthMethod) => capture('signup_started', { method }),
  signupCompleted: (method: AuthMethod) => capture('signup_completed', { method }),
  // `error` is expected to be a stable backend CODE; `sanitizeErrorText` is a
  // guard for future call sites that pass a raw message (see its doc comment).
  signupFailed: (method: AuthMethod, error: string) =>
    capture('signup_failed', { method, error: sanitizeErrorText(error) }),

  loginStarted: (method: AuthMethod) => capture('login_started', { method }),
  loginCompleted: (method: AuthMethod) => capture('login_completed', { method }),
  loginFailed: (method: AuthMethod, error: string) =>
    capture('login_failed', { method, error: sanitizeErrorText(error) }),

  logout: () => capture('logout'),

  // --- Onboarding funnel (R4-5) ---
  // SAME event names as mobile (mobile/src/services/analytics.ts) so the funnel
  // aggregates cross-platform. Guard/dedupe logic lives in
  // lib/onboardingAnalytics.ts — call these ONLY through that module.
  onboardingStarted: () => capture('onboarding_started'),
  onboardingFlowCompleted: (path: OnboardingPath) =>
    capture('onboarding_flow_completed', {
      path,
      // posthog-js supports $set_once inside capture properties: sets the
      // person property only if it isn't already set (first completion wins,
      // cross-platform — mobile sends the same property).
      $set_once: { onboarded_at: new Date().toISOString() },
    }),

  // --- Circles ---
  circleCreationStarted: () => capture('circle_creation_started'),
  circleCreated: (isSelfCare: boolean) => capture('circle_created', { is_self_care: isSelfCare }),
  circleCreationFailed: (error: string) =>
    capture('circle_creation_failed', { error: sanitizeErrorText(error) }),
  circleViewed: (circleId: string) => capture('circle_viewed', { circle_id: circleId }),

  // --- Invites ---
  inviteStarted: (circleId: string) => capture('invite_started', { circle_id: circleId }),
  inviteSent: (circleId: string, role: string) =>
    capture('invite_sent', { circle_id: circleId, role }),
  inviteFailed: (circleId: string, error: string) =>
    capture('invite_failed', { circle_id: circleId, error: sanitizeErrorText(error) }),
  // `circleId` is optional because the invite landing page accepts by CODE and
  // the unauthenticated preview endpoint never exposes the circle id. Omit the
  // property entirely rather than sending a placeholder, so breakdowns on
  // circle_id stay clean. `source` separates the landing page ('invite_link'),
  // the pending-invites list ('in_app'), and the join-by-code modal
  // ('code_entry') — WB4: the code-entry path previously fired no event at all.
  inviteAccepted: (circleId?: string, source?: 'invite_link' | 'in_app' | 'code_entry') =>
    capture('invite_accepted', {
      ...(circleId ? { circle_id: circleId } : {}),
      ...(source ? { source } : {}),
    }),

  // --- Medications ---
  medicationConfirmed: (circleId: string, status: MedicationStatus) =>
    capture('medication_confirmed', { circle_id: circleId, status }),

  // --- Calendar & events ---
  eventCreated: (circleId: string, eventType: string, recurring: boolean) =>
    capture('event_created', { circle_id: circleId, event_type: eventType, recurring }),
  taskCompleted: (circleId: string) => capture('task_completed', { circle_id: circleId }),
  taskUndone: (circleId: string) => capture('task_undone', { circle_id: circleId }),
  appointmentCompleted: (circleId: string) =>
    capture('appointment_completed', { circle_id: circleId }),
  calendarViewed: (circleId: string, view: string) =>
    capture('calendar_viewed', { circle_id: circleId, view }),

  // --- Daily care notes (daily-care-notes plan) — NEVER include note body. ---
  careNotesViewed: (circleId: string) => capture('care_notes_viewed', { circle_id: circleId }),
  /** WB8: mood REMOVED from this payload — it's user-authored health content,
   *  not an id/count. Only how many categories were tagged is sent. */
  careNoteAdded: (circleId: string, opts: { categoryCount: number }) =>
    capture('care_note_added', {
      circle_id: circleId,
      category_count: opts.categoryCount,
    }),

  // --- Documents (web-new) ---
  documentUploaded: (circleId: string, category: string, fileType: string) =>
    capture('document_uploaded', { circle_id: circleId, category, file_type: fileType }),

  // --- Vitals (web-new) ---
  vitalLogged: (circleId: string, vitalType: string) =>
    capture('vital_logged', { circle_id: circleId, vital_type: vitalType }),

  // --- AI (web-new) — NEVER include message text. ---
  /** `usedSuggestion` separates a tapped suggestion chip from a typed question
   *  (mobile sends the same `used_suggestion` property), so the suggestions
   *  feature's pull-through is measurable. Always emitted — defaults to false —
   *  so the property is never missing on a subset of events. */
  aiChatMessageSent: (
    circleId: string,
    opts: { turnIndex: number; messageLength: number; usedSuggestion?: boolean }
  ) =>
    capture('ai_chat_message_sent', {
      circle_id: circleId,
      turn_index: opts.turnIndex,
      message_length: opts.messageLength,
      used_suggestion: opts.usedSuggestion ?? false,
    }),
  /** Successful answer. `intent` is the classifier label only — never its params,
   *  which can carry a medication name. The UNKNOWN rate measures questions the
   *  assistant cannot yet answer. */
  aiChatResponseReceived: (
    circleId: string,
    opts: { intent: string; latencyMs: number; turnIndex: number }
  ) =>
    capture('ai_chat_response_received', {
      circle_id: circleId,
      intent: opts.intent,
      latency_ms: opts.latencyMs,
      turn_index: opts.turnIndex,
    }),
  /** Failed question. `reason` separates rate limits from everything else. */
  aiChatFailed: (
    circleId: string,
    opts: { reason: string; latencyMs: number; turnIndex: number }
  ) =>
    capture('ai_chat_failed', {
      circle_id: circleId,
      reason: opts.reason,
      latency_ms: opts.latencyMs,
      turn_index: opts.turnIndex,
    }),
};

export default Analytics;
