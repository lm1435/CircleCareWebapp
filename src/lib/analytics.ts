import { env } from './env';
import { analyticsCollectionAllowed } from './analyticsMode';
import { withPosthog } from './posthogLoader';
import { getSignupAttributionProps } from './signupAttribution';
import { DEFAULT_PAYWALL_CONTEXT, type PaywallContext } from './paywallContext';

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
  // CONSENT, checked on the EMIT path and not only at init.
  //
  // The boot gate in `initAnalytics` covers a visitor who never opted in, but
  // it says nothing about one who opts OUT mid-session: posthog-js stays
  // constructed, and until the page is reloaded every capture below would still
  // be transmitted. A privacy toggle has to take effect when it is flipped, not
  // at the next navigation.
  if (!analyticsCollectionAllowed()) return;
  // `withPosthog` calls posthog-js SYNCHRONOUSLY when it's already loaded and
  // configured; otherwise it queues this call (and kicks off the lazy load —
  // see lib/posthogLoader.ts) and replays it once `initAnalytics` finishes.
  withPosthog((posthog) => {
    try {
      posthog.capture(event, props);
    } catch {
      // Analytics is best-effort and OPTIONAL. Several call sites fire from
      // INSIDE a mutation's success path (e.g. the medication lifecycle events
      // below, captured right after the PATCH resolves and still inside the
      // caller's `try`). If a capture ever threw there — a half-initialized
      // posthog-js, a storage/quota failure inside its queue, an exotic property
      // value — the caller's `catch` would run and the user would be told a
      // mutation that actually SUCCEEDED had failed. Losing an event is fine;
      // losing a medication change is not.
    }
  });
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
 * A live invite code sitting in a URL path or query string.
 *
 * `/invite/:code` is a bearer credential: backend accept-by-code does NO email
 * match, so possession of the code is possession of access to that circle's PHI.
 * Codes are 6 chars, or 8 after five generation collisions
 * (backend/src/routes/invites.ts), so this deliberately matches any run of code
 * characters rather than a fixed length.
 */
const INVITE_PATH_RE = /(\/invite\/)[A-Za-z0-9]+/gi;
const INVITE_QUERY_RE = /([?&](?:code|invite|invite_code|inviteCode)=)[^&#\s]+/gi;

/**
 * Redact invite codes from any string that might become an event property.
 *
 * WHY THIS EXISTS: posthog-js attaches `$current_url`, `$pathname` and
 * `$referrer` to EVERY capture, read from `location.href` — `capture_pageview:
 * false` does not stop that. So any event fired while the user sits on
 * `/invite/ABC123` published a still-redeemable invite code to PostHog, and
 * `$referrer` carried it onto the next page too. Anyone with PostHog read access
 * could redeem those invites.
 *
 * We still WANT the invite events themselves (sent / accepted counts drive the
 * activation funnel) — only the credential is removed. Never throws.
 */
/**
 * Credential-bearing URL parameters, in any string that reaches PostHog.
 *
 * THIS IS THE ONLY LAYER THAT REMOVES THEM. `mask_personal_data_properties`
 * (lib/posthog.ts) masks posthog-js's built-in AD-CLICK / campaign params
 * (gclid, fbclid, …) — it does NOT touch `access_token`, `refresh_token` or any
 * other credential. Proven by e2e/consent/granted-identify.consent.spec.ts: a
 * consented user landing on `/profile?access_token=…#refresh_token=…` had the
 * raw values stored on their PostHog PERSON via `$identify`'s
 * `$set_once.$current_url` / `$initial_current_url`, while `gclid` came out
 * `<masked>`. `before_send` now runs this over the event's properties AND its
 * `$set` / `$set_once` payloads.
 *
 * Matching rules:
 *   - by parameter NAME, case-insensitive, so it never depends on guessing what
 *     a token value looks like;
 *   - WHOLE names only: the name must start the string or follow `?`, `&`, `#`,
 *     `;`, whitespace, or their percent-encoded forms (`%3F`, `%26`, `%23`, for
 *     a callback URL nested inside `redirect_to=`), and be followed by `=` /
 *     `%3D`. So `tokenizer=1`, `keyboard=1`, `my_token=1` are left alone;
 *   - query string AND hash fragment alike (the same delimiters);
 *   - the name is kept and only the value becomes `[redacted]`, so dashboards
 *     can still see WHICH flow the URL was;
 *   - Supabase's `type=` companion is redacted only when it names an auth flow
 *     (recovery, magiclink, …) — `type=event` is ordinary.
 *
 * Deliberately a string rewrite, not `new URL()`: there is no parse step to
 * fail on a malformed or relative URL, and `URLSearchParams` would re-encode
 * every untouched param (and `[redacted]` itself). If the rewrite ever throws,
 * the fallback cuts everything from the first `?` / `#` — losing the params
 * beats sending them.
 */
const SENSITIVE_PARAM_NAMES =
  'access_token|refresh_token|provider_token|provider_refresh_token|id_token|token_hash|' +
  'token|code|otp|secret|password|api_key|apikey|key|signature|sig';
const PARAM_START = '(^|[?&#;\\s]|%3F|%26|%23)';
const PARAM_EQ = '(=|%3D)';
/** Value runs until the next raw or percent-encoded `&` / `#`, or whitespace. */
const PARAM_VALUE = '(?:(?!%26|%23)[^&#\\s])+';
const SENSITIVE_PARAM_RE = new RegExp(
  `${PARAM_START}(${SENSITIVE_PARAM_NAMES})${PARAM_EQ}${PARAM_VALUE}`,
  'gi'
);
const AUTH_FLOW_TYPE_RE = new RegExp(
  `${PARAM_START}(type)${PARAM_EQ}(?:recovery|magiclink|signup|invite|email_change|email)(?=$|[&#\\s]|%26|%23)`,
  'gi'
);
const QUERY_OR_FRAGMENT_RE = /[?#][^\s]*/g;

export function redactAuthTokens(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return value;
  try {
    return value
      .replace(SENSITIVE_PARAM_RE, '$1$2$3[redacted]')
      .replace(AUTH_FLOW_TYPE_RE, '$1$2$3[redacted]');
  } catch {
    try {
      return value.replace(QUERY_OR_FRAGMENT_RE, '');
    } catch {
      return '';
    }
  }
}

export function redactInviteCode(value: string): string {
  try {
    if (typeof value !== 'string' || value.length === 0) return value;
    return value.replace(INVITE_PATH_RE, '$1[redacted]').replace(INVITE_QUERY_RE, '$1[redacted]');
  } catch {
    return value;
  }
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

/**
 * `$exception` scrubber (1.3.1 privacy change). A JS error MESSAGE can carry
 * user content ("Cannot read 'Metformin'", an email, a note). Runs inside
 * `before_send`, AFTER credential redaction, in BOTH consent modes, for
 * events named `$exception` only. Mirrors mobile/src/services/analytics.ts.
 *
 * Message fields (posthog-js dist `$exception_message`/`$exception_values`/
 * `$exception_list[].value`; @posthog/core `$exception_list[].value`):
 * quoted substrings -> `[redacted]`, `sanitizeErrorText` (emails, tokens, URL
 * queries, 200 cap), digit runs of 3+ -> `#`. `$exception_steps` (breadcrumb
 * text) is dropped. Kept: `type`, frame file/function/line. Removed from
 * frames: `context_line`, `pre_context`, `post_context` (source literals).
 * Never throws: a field that cannot be scrubbed is dropped, not the event.
 */
const QUOTED_PATTERN = /'[^']*'|"[^"]*"|`[^`]*`|“[^”]*”/g;
const DIGIT_RUN_PATTERN = /\d{3,}/g;
const FRAME_SOURCE_KEYS = ['context_line', 'pre_context', 'post_context'];

function scrubExceptionText(raw: unknown): string | undefined {
  try {
    if (typeof raw !== 'string') return undefined;
    return sanitizeErrorText(raw.replace(QUOTED_PATTERN, '[redacted]')).replace(
      DIGIT_RUN_PATTERN,
      '#',
    );
  } catch {
    return undefined;
  }
}

function scrubExceptionFrame(frame: unknown): unknown {
  try {
    if (!frame || typeof frame !== 'object') return frame;
    const out: Record<string, unknown> = { ...(frame as Record<string, unknown>) };
    for (const key of FRAME_SOURCE_KEYS) delete out[key];
    return out;
  } catch {
    return undefined;
  }
}

function scrubExceptionEntry(entry: unknown): unknown {
  try {
    if (!entry || typeof entry !== 'object') return undefined;
    const out: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
    if ('value' in out) {
      const v = scrubExceptionText(out.value);
      if (v === undefined) delete out.value;
      else out.value = v;
    }
    const st = out.stacktrace as Record<string, unknown> | undefined;
    if (st && typeof st === 'object') {
      const frames = Array.isArray(st.frames)
        ? st.frames.map(scrubExceptionFrame).filter((f) => f !== undefined)
        : st.frames;
      out.stacktrace = { ...st, frames };
    }
    return out;
  } catch {
    return undefined;
  }
}

export function scrubExceptionEvent<E extends { event?: string; properties?: unknown }>(
  event: E,
): E {
  try {
    if (!event || event.event !== '$exception') return event;
    const props = event.properties;
    if (!props || typeof props !== 'object') return event;
    const p: Record<string, unknown> = { ...(props as Record<string, unknown>) };
    if ('$exception_message' in p) {
      const m = scrubExceptionText(p.$exception_message);
      if (m === undefined) delete p.$exception_message;
      else p.$exception_message = m;
    }
    if ('$exception_values' in p) {
      if (Array.isArray(p.$exception_values)) {
        p.$exception_values = p.$exception_values
          .map(scrubExceptionText)
          .filter((v) => v !== undefined);
      } else {
        delete p.$exception_values;
      }
    }
    if ('$exception_list' in p) {
      if (Array.isArray(p.$exception_list)) {
        p.$exception_list = p.$exception_list
          .map(scrubExceptionEntry)
          .filter((v) => v !== undefined);
      } else {
        delete p.$exception_list;
      }
    }
    delete p.$exception_steps;
    return { ...event, properties: p };
  } catch {
    // Drop the message fields rather than the event or a leak.
    try {
      const p: Record<string, unknown> = { ...((event.properties as object) ?? {}) };
      for (const k of ['$exception_message', '$exception_values', '$exception_list', '$exception_steps']) {
        delete p[k];
      }
      return { ...event, properties: p };
    } catch {
      return event;
    }
  }
}

/**
 * CRASH EVENTS ARE NEVER LINKED TO A PERSON (owner decision, 1.3.1; keeps the
 * App Store "Diagnostics - Not Linked" label true), in BOTH consent modes.
 * Crash = `$exception` or our boundary event `error_occurred` with
 * `fatal: true`. Other events pass through untouched.
 */
const CRASH_STRIPPED_KEYS = [
  '$set',
  '$set_once',
  '$groups',
  '$user_id',
  '$anon_distinct_id',
  '$device_id',
  '$session_id',
  '$window_id',
  '$sentry_event_id',
];

function randomCrashId(): string {
  return `crash-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function isCrashEvent(event: { event?: string; properties?: unknown }): boolean {
  if (event.event === '$exception') return true;
  const p = event.properties as Record<string, unknown> | null | undefined;
  return event.event === 'error_occurred' && !!p && typeof p === 'object' && p.fatal === true;
}

export function anonymizeCrashEvent<E extends { event?: string; properties?: unknown }>(
  event: E,
): E | null {
  try {
    if (!event || !isCrashEvent(event)) return event;
    const props = (event.properties ?? {}) as Record<string, unknown>;
    const p: Record<string, unknown> = { ...props };
    for (const k of CRASH_STRIPPED_KEYS) delete p[k];
    if (typeof p.error === 'string') p.error = scrubExceptionText(p.error) ?? '';
    p.$process_person_profile = false;
    p.$is_identified = false;
    // posthog-js sends `data: c` AFTER before_send (module.js `Pn(c)` then the
    // request), and ingestion reads `properties.distinct_id`, so a fresh random
    // id here is what is sent: no person, no stitching to the identified user.
    p.distinct_id = randomCrashId();
    const out: Record<string, unknown> = { ...event, properties: p };
    delete out.$set;
    delete out.$set_once;
    return out as E;
  } catch {
    // Cannot prove it is unlinked: drop the crash rather than send it linked.
    return null;
  }
}

// 'oauth' is a web-only, provider-agnostic fallback: when an OAuth callback
// fires a completion event but the specific provider couldn't be recovered
// (e.g. the user deep-linked straight to /auth/callback, or Safari private-mode
// blocked the sessionStorage handoff), we report the honest 'oauth' rather than
// falsely attributing the sign-in to a guessed provider.
type AuthMethod = 'email' | 'google' | 'apple' | 'oauth';
type MedicationStatus = 'taken' | 'taken_late' | 'skipped';

/** Verbatim subset of mobile's MedicationConfirmSource — keep the two in step. */
export type MedicationConfirmSource = 'calendar' | 'care_profile';

/**
 * The surfaces a medication LIFECYCLE action (open the action set / discontinue
 * / reactivate / delete) can actually be triggered from on the web companion.
 *
 * SAME enum as mobile's `MedicationLifecycleSurface`
 * (mobile/src/services/analytics.ts) so a single breakdown reads across both
 * platforms:
 *  - 'calendar'     — the calendar page's event detail modal.
 *  - 'meds_tab'     — the Medications page (roster cards + their detail modal).
 *  - 'care_profile' — mobile only today; kept in the union so the property's
 *    value space is identical on both platforms.
 *
 * There is no 'med_detail' surface: the detail modal is not a destination of
 * its own, it is opened BY the pages above, and the question is which page a
 * caregiver reached for.
 */
export type MedicationLifecycleSurface = 'calendar' | 'meds_tab' | 'care_profile';

/**
 * Delete scope, matching exactly what DeleteEventDialog actually offers:
 *  - 'single'  — the recurring dialog's "this event only".
 *  - 'future'  — the recurring dialog's "this and future".
 *  - 'series'  — the unscoped DELETE a NON-recurring medication gets (no scope
 *                picker is shown; the whole record goes).
 */
export type MedicationDeleteScope = 'single' | 'future' | 'series';

/**
 * How this browser first saw the user reach "onboarded" (has >= 1 circle):
 * - 'created'  — their first circle was created here.
 * - 'joined'   — they accepted an invite here with no prior circles.
 * - 'existing' — they arrived already having circles (device swap / signed in
 *   on another platform first). Filterable in funnels.
 */
export type OnboardingPath = 'created' | 'joined' | 'existing';

/** Subscription term, spelled exactly as mobile spells it in `plan`. */
export type PlanKey = 'monthly' | 'annual';

/**
 * Where a PDF export failed. The WEB subset of mobile's
 * `ExportFailureStage` ('print' | 'move' | 'share' | 'timeout'): the web has no
 * file move or share sheet — 'print' is the iframe render / print request,
 * 'timeout' the document never loading. Never a message or a path.
 */
export type ExportFailureStage = 'print' | 'timeout';

/** Coerce an unknown value to one of a fixed set; anything else gets the fallback. */
function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Buckets for `provider_visits_opened.visit_count_bucket` (identical on mobile). */
export const PROVIDER_VISIT_BUCKETS = ['0', '1-5', '6-20', '21+'] as const;
export type ProviderVisitBucket = (typeof PROVIDER_VISIT_BUCKETS)[number];

/** Bucket a number of past visits: 0 | 1-5 | 6-20 | 21+. Anything non-finite or negative is 0. */
export function providerVisitBucket(count: number): ProviderVisitBucket {
  if (!Number.isFinite(count) || count < 1) return '0';
  if (count <= 5) return '1-5';
  if (count <= 20) return '6-20';
  return '21+';
}

const AS_NEEDED_SURFACES = ['home', 'meds_tab', 'detail'] as const;

// Care shifts: the closed enums behind the `shift*` events (identical on mobile).
const SHIFT_RANGES = ['day', 'week', 'month'] as const;
const SHIFT_ACCESS = ['full', 'readonly'] as const;
const SHIFT_RECURRENCES = ['none', 'daily', 'weekly', 'days'] as const;
const SHIFT_REMINDERS = ['off', '1h', '2h', '4h', '1d'] as const;
const SHIFT_SOURCES = ['add_menu', 'shifts_view', 'empty_state', 'add_next'] as const;
const SHIFT_SCOPES = ['occurrence', 'future'] as const;
const SHIFT_DROP_ROLES = ['self', 'manager', 'owner'] as const;
const SHIFT_ASSIGN_ROLES = ['owner', 'manager'] as const;
const SHIFT_TEASER_SOURCES = ['toggle', 'add_menu', 'shifts_nudge'] as const;

/** `open_count_bucket`: '0' | '1-2' | '3+'. */
function shiftOpenCountBucket(count: number): '0' | '1-2' | '3+' {
  if (!(count > 0)) return '0';
  return count <= 2 ? '1-2' : '3+';
}

/** `duration_bucket`: <4h (<240 min) · 4-8h (240-480) · 8-12h (481-720) · >12h. */
function shiftDurationBucket(minutes: number): '<4h' | '4-8h' | '8-12h' | '>12h' {
  if (minutes < 240) return '<4h';
  if (minutes <= 480) return '4-8h';
  if (minutes <= 720) return '8-12h';
  return '>12h';
}

/** `actor_role` on invite_sent / member_removed: who performed it. */
const ACTOR_ROLES = ['owner', 'manager'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

/** `daily_update_row_tapped.row`: which Daily update row (card or page) was tapped. */
const DAILY_UPDATE_ROWS = ['tasks', 'appointment', 'note', 'full_update', 'invite'] as const;
export type DailyUpdateRow = (typeof DAILY_UPDATE_ROWS)[number];

/** Simple-UI form funnel (docs/plans/simple-ui-1-3-1.md): same names/values as mobile. */
export type EntryFormType = 'medication' | 'appointment' | 'task' | 'note' | 'shift';
export type EntryFormOrigin =
  | 'add_menu'
  | 'next_step'
  | 'quick_access'
  | 'empty_state'
  | 'voice'
  // Onboarding 1.3.1: the setup wizard's "Add {{name}}'s first med" opens the same form.
  | 'first_run'
  | 'other';
export type EntryFormStep = 'what' | 'when' | 'how_often' | 'who';
export type TimeChipId = 'morning' | 'midday' | 'evening' | 'bedtime' | 'other';
export type AppointmentAbandonField =
  | 'title'
  | 'date'
  | 'time'
  | 'who'
  | 'more_details'
  | 'none';
export type LargeTextScreen = 'today' | 'add_menu' | 'med_form' | 'appt_form' | 'meds';
/** How the notifications inbox was reached (inbox_viewed `source`). */
export type InboxSource = 'circle_list' | 'today_bell' | 'header_bell' | 'other';

/** Mobile's rounding: 5s buckets up to a minute, 30s buckets after. */
function bucketSecondsOpen(seconds: number): number {
  const s = Math.max(0, seconds);
  return s <= 60 ? Math.round(s / 5) * 5 : Math.round(s / 30) * 30;
}

export const Analytics = {
  // --- Auth ---
  signupStarted: (method: AuthMethod) => capture('signup_started', { method }),
  signupCompleted: (method: AuthMethod) =>
    capture('signup_completed', { method, ...getSignupAttributionProps() }),
  // `error` is expected to be a stable backend CODE; `sanitizeErrorText` is a
  // guard for future call sites that pass a raw message (see its doc comment).
  signupFailed: (method: AuthMethod, error: string) =>
    capture('signup_failed', { method, error: sanitizeErrorText(error) }),

  loginStarted: (method: AuthMethod) => capture('login_started', { method }),
  loginCompleted: (method: AuthMethod) => capture('login_completed', { method }),
  loginFailed: (method: AuthMethod, error: string) =>
    capture('login_failed', { method, error: sanitizeErrorText(error) }),

  logout: () => capture('logout'),

  /** Fires at the TOP of the delete-account success handler, before
   *  `queryClient.clear()` and `signOut()` — `signOut` resets analytics
   *  (clears the distinct id), and posthog-js batches captures, so queuing
   *  this AFTER either would risk it never being flushed. */
  accountDeleted: () => capture('account_deleted'),

  // --- Password reset / OTP recovery (web-new) — no props on any of these:
  // the funnel only needs counts, and there is no identifying property to add
  // that a stable backend error code (already sanitized where one exists)
  // would improve on. ---
  /** Fired once after the forgot-password request settles, success or
   *  failure — the page shows the same neutral success screen either way to
   *  avoid account enumeration, so the event can't distinguish outcomes. */
  passwordResetRequested: () => capture('password_reset_requested'),
  passwordResetCompleted: () => capture('password_reset_completed'),
  passwordResetFailed: () => capture('password_reset_failed'),
  otpVerified: () => capture('otp_verified'),
  otpFailed: () => capture('otp_failed'),
  /** The "Have a verification code?" email step was opened. No properties. */
  verifyRequestOpened: () => capture('verify_request_opened'),
  otpResent: () => capture('otp_resent'),

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

  // --- Subscription & paywall ---
  //
  // SAME event names and SAME properties as mobile
  // (mobile/src/services/analytics.ts:1116-1228), so web and mobile paywall
  // views land in ONE funnel split only by `platform`. Until now the web
  // companion fired NO paywall analytics at all: `/upgrade` was reachable from
  // four places and every view, purchase and bounce was invisible.
  //
  // `paywall_context` is the load-bearing property — see lib/paywallContext.ts.
  // Every event below carries it, always, including the default, so the
  // property is never missing on a subset of events (a missing property and a
  // zero are indistinguishable in a PostHog funnel breakdown).

  /** The paywall was shown. The denominator of every conversion rate. */
  planSelectionViewed: (paywallContext: PaywallContext = DEFAULT_PAYWALL_CONTEXT) =>
    capture('plan_selection_viewed', { paywall_context: paywallContext }),

  /**
   * The user took the explicit "continue on the free plan" affordance, which
   * exists only on the `onboarding` context (mobile
   * PlanSelectionScreen.tsx:733-746). Mobile fires this AND then dismisses, so
   * a free-selection produces both this and `paywall_dismissed`; web matches.
   */
  planSelectionFreeSelected: (paywallContext: PaywallContext = DEFAULT_PAYWALL_CONTEXT) =>
    capture('plan_selection_free_selected', { paywall_context: paywallContext }),

  /** Checkout completed. `plan` matches mobile's 'monthly' | 'annual'. */
  planSelectionSubscribed: (plan: PlanKey, paywallContext: PaywallContext = DEFAULT_PAYWALL_CONTEXT) =>
    capture('plan_selection_subscribed', { plan, paywall_context: paywallContext }),

  /** Fired IN ADDITION to `plan_selection_subscribed` when the purchase that
   *  completed carried a free trial — mobile does the same rather than making
   *  it an either/or, so `subscribed` stays the single conversion count. */
  planSelectionTrialStarted: (plan: PlanKey, paywallContext: PaywallContext = DEFAULT_PAYWALL_CONTEXT) =>
    capture('plan_selection_trial_started', { plan, paywall_context: paywallContext }),

  /** The user opened checkout and backed out of it. Distinct from
   *  `paywall_dismissed`: they engaged with the offer and then declined at the
   *  payment step, which is a different signal from never starting. */
  planSelectionPurchaseCancelled: (
    plan: PlanKey,
    paywallContext: PaywallContext = DEFAULT_PAYWALL_CONTEXT
  ) => capture('plan_selection_purchase_cancelled', { plan, paywall_context: paywallContext }),

  /**
   * The user left the paywall without buying.
   *
   * PROPERTY NOTE — this event carries BOTH `trigger` and `paywall_context`,
   * set to the same value, and that is deliberate. Mobile calls
   * `Analytics.paywallDismissed(paywallContext)`
   * (PlanSelectionScreen.tsx:446), and mobile's signature names that parameter
   * `trigger` (analytics.ts:1130-1132) — so the shipped mobile event is
   * `{ trigger: 'onboarding' }`, NOT `{ paywall_context: 'onboarding' }`.
   * Sending only `paywall_context` would split this one event away from every
   * mobile dismissal already in PostHog; sending only `trigger` would make it
   * the one paywall event that cannot be broken down alongside the others.
   * Sending both keeps existing mobile queries working AND lets a single
   * breakdown span all five events. Costs one duplicated short enum.
   */
  paywallDismissed: (paywallContext: PaywallContext = DEFAULT_PAYWALL_CONTEXT) =>
    capture('paywall_dismissed', { trigger: paywallContext, paywall_context: paywallContext }),

  // --- Circles ---
  circleCreationStarted: () => capture('circle_creation_started'),
  circleCreated: (isSelfCare: boolean) => capture('circle_created', { is_self_care: isSelfCare }),
  circleCreationFailed: (error: string) =>
    capture('circle_creation_failed', { error: sanitizeErrorText(error) }),
  circleViewed: (circleId: string) => capture('circle_viewed', { circle_id: circleId }),
  /** Owner edited the circle (recipient name / DOB / conditions). */
  circleUpdated: (circleId: string) => capture('circle_updated', { circle_id: circleId }),
  /** Owner deleted (archived) the circle. */
  circleDeleted: (circleId: string) => capture('circle_deleted', { circle_id: circleId }),

  // --- Circle Home (Overview) ---
  // The Home surface had NO instrumentation on web (and the checklist / solo
  // card had none on mobile either), so nothing about the new-circle empty
  // state could be measured. NO circle_id on any of these: they are new
  // events, and the 2026-09-04 decision is that an identifier is not added to
  // an event that never carried one. Enums and counts are all these need —
  // per-circle questions are answered from Postgres, not PostHog. (Mobile's
  // `quick_access_tapped` predates that decision and still sends circle_id;
  // web's deliberately does not.)
  /** A Quick Access row was opened. `destination` is the row id (e.g. 'calendar'). */
  quickAccessTapped: (destination: string) => capture('quick_access_tapped', { destination }),

  // --- Today (simple UI 1.3.1; docs/plans/simple-ui-1-3-1.md "Analytics contract") ---
  // Same names and props as mobile. Enums, counts and booleans only; NO circle_id.
  /** Today opened. `coaching` is the ONE coaching element shown ('none' when no card/hint). */
  todayViewed: (props: {
    has_items: boolean;
    next_up_count: number;
    coaching: 'next_step' | 'shifts' | 'dose_hint' | 'none';
  }) => capture('today_viewed', props),
  /** A Next-up row's primary action (or the row itself, 'open') was pressed. */
  nextUpAction: (props: {
    action: 'taken' | 'done' | 'open';
    item_type: 'medication' | 'appointment' | 'task';
    position: number;
  }) => capture('next_up_action', props),
  /** "All of today" was opened. */
  todayAllItemsOpened: () => capture('today_all_items_opened', {}),
  nextStepShown: (step: 'first_med' | 'invite' | 'reminders') =>
    capture('next_step_shown', { step }),
  nextStepTapped: (step: 'first_med' | 'invite' | 'reminders') =>
    capture('next_step_tapped', { step }),
  nextStepDismissed: (step: 'first_med' | 'invite' | 'reminders') =>
    capture('next_step_dismissed', { step }),
  nextStepCompleted: (step: 'first_med' | 'invite' | 'reminders') =>
    capture('next_step_completed', { step }),
  coachingHintShown: (hint: 'first_dose' | 'shifts_second_caregiver', opts: { upsell?: boolean } = {}) =>
    capture('coaching_hint_shown', { hint, upsell: opts.upsell === true }),
  coachingHintDismissed: (hint: 'first_dose' | 'shifts_second_caregiver', opts: { upsell?: boolean } = {}) =>
    capture('coaching_hint_dismissed', { hint, upsell: opts.upsell === true }),
  coachingHintActed: (hint: 'first_dose' | 'shifts_second_caregiver', opts: { upsell?: boolean } = {}) =>
    capture('coaching_hint_acted', { hint, upsell: opts.upsell === true }),
  /** The Add (New) menu opened. */
  addMenuOpened: (from: 'nav' = 'nav') => capture('add_menu_opened', { from }),
  addMenuOptionTapped: (option: 'medication' | 'appointment' | 'task' | 'note' | 'shift') =>
    capture('add_menu_option_tapped', { option }),
  /** The Add menu closed without a choice. */
  addMenuClosedEmpty: () => capture('add_menu_closed_empty', {}),
  /** Once per screen per session: whether the large-text layout is active. */
  largeTextLayout: (screen: LargeTextScreen, active: boolean) =>
    capture('large_text_layout', { screen, active }),
  /** A pending Get-started step's action button was pressed. `step` is the step key ('event' | 'invite' | 'emergency'). */
  gettingStartedStepTapped: (step: string) => capture('getting_started_step_tapped', { step }),
  /** The Get-started checklist was dismissed, with how far along it was. */
  gettingStartedDismissed: (doneCount: number, total: number) =>
    capture('getting_started_dismissed', { done_count: doneCount, total }),
  /** The solo-owner "Invite your first caregiver" button was pressed. */
  soloInviteTapped: () => capture('solo_invite_tapped'),
  /** A Home empty-state CTA was pressed ("Add a medication" / "Add your first task"). */
  homeEmptyCtaTapped: (section: 'medications' | 'tasks') =>
    capture('home_empty_cta_tapped', { section }),
  /** The Home medications empty-state CTA was pressed. Web only ever offers 'add' (voice is mobile-only). */
  medsEmptyStateCtaTapped: (action: 'add' | 'voice') =>
    capture('meds_empty_state_cta_tapped', { action }),
  /**
   * The pre-auth "See how it works" walkthrough (/how-it-works) opened — the
   * same event mobile's Preview screen fires. `source` is the page whose link
   * opened it; 'direct' is a visit with no in-app link (typed URL, bookmark).
   */
  previewOpened: (source: 'welcome' | 'signup' | 'login' | 'direct') =>
    capture('preview_opened', { source }),
  /** The walkthrough's final "Get started" CTA; `step` is the 1-based screen. */
  previewGetStartedTapped: (step: number) => capture('preview_get_started_tapped', { step }),

  // --- Daily update (docs/plans/daily-update.md §7) ---
  // Booleans and enums ONLY: no circle_id (2026-09-04 decision), no names, no
  // counts. Household questions are answered from Postgres. Web has no push, so
  // `daily_update_push_opened` / `source: 'push'` are mobile-only.
  /** The Home card rendered. Fired once per circle per recipient-day per browser. */
  dailyUpdateCardShown: (props: { is_owner: boolean; is_solo: boolean; has_still_to_do: boolean }) =>
    capture('daily_update_card_shown', props),
  /** The full update / dated view opened. */
  dailyUpdateOpened: (source: 'card' | 'link', dated: boolean) =>
    capture('daily_update_opened', { source, dated }),
  /** The card's X was pressed (hidden until the recipient's midnight). */
  dailyUpdateDismissed: () => capture('daily_update_dismissed'),
  /**
   * The calendar's "Reminders go to you" notice (owner, no care recipient and no
   * medication-responsible member) was closed. No properties (never circle_id).
   * Same name as mobile.
   */
  reminderRoutingNoticeDismissed: () => capture('reminder_routing_notice_dismissed'),
  /** A tappable row on the card or the full page. Enums only: which row, and where. */
  dailyUpdateRowTapped: (row: DailyUpdateRow, source: 'card' | 'page') =>
    capture('daily_update_row_tapped', {
      row: pickEnum(row, DAILY_UPDATE_ROWS, 'full_update'),
      source: pickEnum(source, ['card', 'page'], 'card'),
    }),
  /** The solo-owner "Invite someone to share this" line was pressed. */
  dailyUpdateInviteTapped: () => capture('daily_update_invite_tapped'),

  // --- Members ---
  /** Owner or manager removed a member. Deliberately NO removed-user id — that
   *  member's identity is not this event's business, only that a removal
   *  happened. `actor_role` says who did it ('owner' | 'manager'); same name
   *  and shape as mobile. */
  memberRemoved: (circleId: string, actorRole: ActorRole = 'owner') =>
    capture('member_removed', {
      circle_id: circleId,
      actor_role: pickEnum(actorRole, ACTOR_ROLES, 'owner'),
    }),
  /**
   * The owner made a member a manager (`role: 'manager'`) or took the role
   * back (`role: 'member'`). Enum only — NO circle_id, NO member id (new
   * events carry no identifiers: memory feedback_conservative_analytics_identifiers).
   */
  memberRoleChanged: (role: 'manager' | 'member') =>
    capture('member_role_changed', { role: pickEnum(role, ['manager', 'member'], 'member') }),
  /** The current member voluntarily left the circle. */
  circleLeft: (circleId: string) => capture('circle_left', { circle_id: circleId }),

  // --- Invites ---
  inviteStarted: (circleId: string) => capture('invite_started', { circle_id: circleId }),
  /** `actor_role`: who sent it, the owner or a manager (mobile parity). */
  inviteSent: (circleId: string, role: string, actorRole: ActorRole = 'owner') =>
    capture('invite_sent', {
      circle_id: circleId,
      role,
      actor_role: pickEnum(actorRole, ACTOR_ROLES, 'owner'),
    }),
  inviteFailed: (circleId: string, error: string) =>
    capture('invite_failed', { circle_id: circleId, error: sanitizeErrorText(error) }),
  /**
   * The free-tier caregiver seat cap was surfaced to the inviter (the in-modal
   * cap / pending-seat card after a 402). Fired once per time the card
   * appears — the paywall's own `plan_selection_viewed` only counts those who
   * then press Upgrade, so without this the cap moment itself was invisible.
   * Same name and shape as mobile's `inviteCapReached`; web has no caregiver
   * count at that moment (the 402 is the first it hears of the cap) so it
   * carries NO properties (no circle_id: founder rule, memory
   * feedback_conservative_analytics_identifiers).
   */
  inviteCapReached: () => capture('invite_cap_reached'),
  /**
   * The inviter handed the link to someone directly rather than relying on our
   * email being the only delivery channel. Event names MIRROR mobile so the
   * funnel aggregates across platforms — the `platform` super-property is what
   * separates them when you want them separate.
   *
   * PHI-safe: circle id and role enum only. NEVER the code or the URL — the
   * code grants circle access and must not land in an analytics store.
   */
  inviteLinkShared: (circleId: string, role: string) =>
    capture('invite_link_shared', { circle_id: circleId, role }),
  inviteLinkCopied: (circleId: string, role: string) =>
    capture('invite_link_copied', { circle_id: circleId, role }),
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

  // --- Onboarding 1.3.1 (invitee welcome) --- same names/props as mobile.
  // Enums and counts only: never names, circle_id or the invite code.
  /** The post-join welcome screen was shown. `items` = how many rows it lists. */
  inviteeWelcomeViewed: (role: 'caregiver' | 'view_only', items: number) =>
    capture('invitee_welcome_viewed', { role, items }),
  /** "Go to Today" pressed; `seconds` = whole seconds the screen was on view. */
  inviteeWelcomeContinued: (seconds: number) => capture('invitee_welcome_continued', { seconds }),

  // --- Medications ---
  /**
   * `source` mirrors mobile's `MedicationConfirmSource` so the two platforms
   * land in ONE series and `$lib` separates them. Web shipped this event
   * without a source, which put every web confirm in the same unlabelled bucket
   * as pre-instrumentation mobile builds — so "does anyone answer doses on
   * web?" could not be told apart from "does anyone run an old build?".
   *
   * Web has two confirm surfaces, not mobile's three: the Overview card (the
   * circle home, hence `care_profile`) and the calendar. The Medications roster
   * carries no dose-confirmation control on either platform.
   */
  medicationConfirmed: (
    circleId: string,
    status: MedicationStatus,
    source: MedicationConfirmSource
  ) => capture('medication_confirmed', { circle_id: circleId, status, source }),

  /**
   * A confirm whose POST REJECTED ambiguously (timeout, network, 5xx) but whose
   * dose a re-read of the day showed RECORDED — the caregiver saw the success
   * toast, not an error. Mobile parity (`medication_confirm_recovered`, same
   * properties minus mobile's `screen`). `code` is `classifyFailureCode`'s
   * closed set, never a message. Test-gap audit 2026-09-29 #3.
   */
  medicationConfirmRecovered: (
    circleId: string,
    status: MedicationStatus,
    source: MedicationConfirmSource,
    code: string
  ) => capture('medication_confirm_recovered', { circle_id: circleId, status, source, code }),

  /**
   * PK1 (2026-09-29): a Take/Skip the server refused because ANOTHER caregiver
   * had already answered the dose (409 DOSE_ALREADY_RECORDED). Not an error —
   * never `error_occurred`. Same event and properties as mobile: the surface
   * and the answer tried. No circle id, no name, no time.
   */
  medicationConfirmAlreadyRecorded: (status: MedicationStatus, source: MedicationConfirmSource) =>
    capture('medication_confirm_already_recorded', { source, status }),

  /**
   * PK29 (2026-09-30): "Change answer" after a 409 DOSE_ALREADY_RECORDED
   * succeeded. Same event and properties as mobile (`surface` = where it was
   * done). No circle id, no names, no time.
   */
  medicationConfirmOverwritten: (status: 'taken' | 'skipped', surface: MedicationConfirmSource) =>
    capture('medication_confirm_overwritten', { status, surface }),

  /**
   * PK5 (2026-09-30): an Emergency Info save was refused 409
   * EMERGENCY_INFO_CHANGED and the editor reloaded. `field_count` = sections that
   * conflicted. No circle id, no field contents.
   */
  emergencyInfoConflict: (fieldCount: number) =>
    capture('emergency_info_conflict', { field_count: fieldCount }),

  /**
   * Member colour feature (2026-09-30): saved a new avatar colour. `color` is the
   * closed palette key, or 'default' when reset to the name-derived colour.
   */
  avatarColorChanged: (color: string) => capture('avatar_color_changed', { color }),

  /**
   * PK10 (2026-09-30): profile time-zone change prompt. `circles` = how many
   * circles were listed, `confirmed` = the user went ahead. No ids, names, zones.
   */
  timezoneChangeWarning: (circles: number, confirmed: boolean) =>
    capture('timezone_change_warning', { circles, confirmed }),

  // --- Value-gated upsell (PK28(1), 2026-09-30) ---
  //
  // Same event names and properties as mobile's upsell funnel so one PostHog
  // dashboard covers both. Eligibility is server-side (`GET /subscription-status`
  // `upsell`), so impressions and the 14-day cap are shared across platforms.
  // Fire `upsell_eligible` only on the FALSE->TRUE transition and
  // `upsell_suppressed` only when the reason CHANGES (never per poll).

  upsellEligible: (trigger: string, impressionNumber: number) =>
    capture('upsell_eligible', { trigger, impression_number: impressionNumber }),

  upsellSuppressed: (reason: string) => capture('upsell_suppressed', { reason }),

  upsellShown: (trigger: string, impressionNumber: number) =>
    capture('upsell_shown', { trigger, impression_number: impressionNumber }),

  upsellDismissed: (trigger: string, impressionNumber: number, secondsVisible: number) =>
    capture('upsell_dismissed', {
      trigger,
      impression_number: impressionNumber,
      seconds_visible: secondsVisible,
    }),

  upsellCtaTapped: (trigger: string, impressionNumber: number) =>
    capture('upsell_cta_tapped', { trigger, impression_number: impressionNumber }),

  // --- Medication lifecycle (discontinue / reactivate / delete) ---
  //
  // Shipped in 1.1.9 on both platforms with ZERO instrumentation: "has anyone
  // actually discontinued a medication?" could only be answered by a raw prod
  // SQL query. Every helper below fires on CONFIRMED SUCCESS — after the
  // mutation resolves, never on the confirm click; an event fired on intent
  // makes the funnel lie about a mutation that then 500s.
  //
  // PHI-safe by construction: ids, counts, booleans, enums and a whole-day
  // duration. NEVER a medication name, dosage, title, or note.

  /**
   * The per-medication ACTION SET was opened — the step BEFORE any action.
   *
   * Prod shows real adoption of discontinue is zero, and the action events
   * alone cannot tell "nobody needed it" from "nobody could find it". Pairing
   * this with the action events gives the funnel: opened -> action chosen, vs
   * opened -> nothing. NOT an impression event — it fires only from a
   * deliberate click that opens the actions, and only when `canEdit` means the
   * actions are genuinely offered.
   *
   * `isDiscontinued` says WHICH menu was offered: an inactive medication gets
   * Reactivate where an active one gets Discontinue, so the two are different
   * funnels and must not be pooled.
   */
  medicationActionsMenuOpened: (
    circleId: string,
    opts: { surface: MedicationLifecycleSurface; isDiscontinued: boolean }
  ) =>
    capture('medication_actions_menu_opened', {
      circle_id: circleId,
      surface: opts.surface,
      is_discontinued: opts.isDiscontinued,
    }),

  // -- As-needed (PRN) medications ----------------------------------------
  //
  // PHI-free by construction: every prop is an enum or a boolean, each coerced
  // through a whitelist so an arbitrary string can never ride along. NEVER a
  // circle id, dose/event id, medication name, note, reason or clock time.

  /** An as-needed medication was created. Web only has the form. */
  asNeededMedicationCreated: (opts: { source?: string; has_reason?: boolean }) =>
    capture('as_needed_medication_created', {
      source: pickEnum(opts.source, ['form', 'scan', 'voice'], 'form'),
      has_reason: opts.has_reason === true,
    }),

  /** A dose was logged (POST succeeded and was not a replay). */
  asNeededDoseLogged: (opts: {
    surface?: string;
    with_note?: boolean;
    backdated_bucket?: string;
    actor?: string;
    after_recent_prompt?: boolean;
    minutes_since_last_bucket?: string;
  }) =>
    capture('as_needed_dose_logged', {
      surface: pickEnum(opts.surface, AS_NEEDED_SURFACES, 'home'),
      with_note: opts.with_note === true,
      backdated_bucket: pickEnum(
        opts.backdated_bucket,
        ['none', '<1h', '1-4h', '4-12h', '>12h'],
        'none'
      ),
      actor: pickEnum(opts.actor, ['caregiver', 'recipient'], 'caregiver'),
      after_recent_prompt: opts.after_recent_prompt === true,
      minutes_since_last_bucket: pickEnum(
        opts.minutes_since_last_bucket,
        ['first', '<1h', '1-4h', '4-12h', '12-24h', '>24h'],
        'first'
      ),
    }),

  /** Undo cancelled a pending (not yet sent) dose. */
  asNeededDoseUndone: (opts: { surface?: string }) =>
    capture('as_needed_dose_undone', { surface: pickEnum(opts.surface, AS_NEEDED_SURFACES, 'home') }),

  /** A logged dose was removed (tombstoned). */
  asNeededDoseRemoved: (opts: { age_bucket?: string; own?: boolean }) =>
    capture('as_needed_dose_removed', {
      age_bucket: pickEnum(opts.age_bucket, ['<1h', '<24h', 'older'], 'older'),
      own: opts.own === true,
    }),

  /** Logging a dose failed. */
  asNeededDoseLogFailed: (opts: { reason?: string }) =>
    capture('as_needed_dose_log_failed', {
      reason: pickEnum(opts.reason, ['network', 'discontinued', 'permission', 'error'], 'error'),
    }),

  /** The user answered the "just logged by someone else" prompt. */
  asNeededRecentConflict: (opts: { resolution?: string }) =>
    capture('as_needed_recent_conflict', {
      resolution: pickEnum(opts.resolution, ['logged_another', 'dismissed'], 'dismissed'),
    }),

  /** A dose history was opened. */
  asNeededHistoryViewed: (opts: { scope?: string }) =>
    capture('as_needed_history_viewed', {
      scope: pickEnum(opts.scope, ['all', 'medication'], 'medication'),
    }),

  /**
   * A medication was discontinued (inactivated).
   *
   * @param opts.seriesCount      how many series roots were mutated — discontinue
   *                              acts on EVERY series sharing name + dosage
   * @param opts.daysActive       whole days from the series start to today,
   *                              computed in the care recipient's timezone
   * @param opts.hadConfirmations whether this med had any logged dose — i.e.
   *                              whether real history is being preserved by the
   *                              keep-past-occurrences behaviour
   */
  medicationDiscontinued: (
    circleId: string,
    opts: {
      surface: MedicationLifecycleSurface;
      seriesCount: number;
      daysActive: number;
      hadConfirmations: boolean;
    }
  ) =>
    capture('medication_discontinued', {
      circle_id: circleId,
      surface: opts.surface,
      series_count: opts.seriesCount,
      days_active: opts.daysActive,
      had_confirmations: opts.hadConfirmations,
    }),

  /**
   * A discontinued medication was brought back. Fires for BOTH reactivate
   * paths: the explicit Reactivate action and the "editing an inactive med?
   * reactivate first" prompt, which is the same mutation from a different
   * intent. No `days_active` — how many series came back is the number that
   * matters, and the discontinue event already dates the pause.
   */
  medicationReactivated: (
    circleId: string,
    opts: { surface: MedicationLifecycleSurface; seriesCount: number }
  ) =>
    capture('medication_reactivated', {
      circle_id: circleId,
      surface: opts.surface,
      series_count: opts.seriesCount,
    }),

  /**
   * A medication was DELETED — the counterpart to `medication_discontinued`.
   * Delete destroys the record and its history; discontinue preserves it.
   * Comparing the two is the only way to tell whether caregivers understand the
   * difference 1.1.9 introduced. Medications only — task/appointment deletes
   * are a separate question and stay uninstrumented.
   */
  medicationDeleted: (
    circleId: string,
    opts: {
      surface: MedicationLifecycleSurface;
      scope: MedicationDeleteScope;
      /** PK3: the whole-medication delete kept its recorded doses (soft delete). */
      historyKept?: boolean;
    }
  ) =>
    capture('medication_deleted', {
      circle_id: circleId,
      surface: opts.surface,
      scope: opts.scope,
      ...(opts.historyKept !== undefined ? { history_kept: opts.historyKept } : {}),
    }),

  // --- Medication creation funnel (first-run wizard) ---
  //
  // SAME event names, properties and default values as mobile
  // (mobile/src/services/analytics.ts) so the funnel aggregates cross-platform
  // and `platform` is the only thing separating the two.
  //
  // PHI: ids, closed enums, booleans and counts ONLY. Screen ② of the wizard
  // collects a DRUG NAME and a DOSAGE, and neither ever reaches PostHog — see
  // docs/analytics-data-inventory.md, which commits to that in writing.

  /**
   * A medication creation ATTEMPT began.
   *
   * `source` is a defaulted trailing parameter so no existing call site
   * changes. 'wizard_handoff' IS ITS OWN VALUE, not a flavour of 'wizard': the
   * wizard hands a multi-dose/non-daily combination to the full form
   * (constraint 4), and the form is a second start for ONE user attempt. Left
   * undifferentiated, the wizard segment carries a denominator with no
   * reachable numerator (a hand-off can never fire `medication_created` as
   * 'wizard') and the form segment is inflated by attempts it did not
   * originate.
   */
  medicationCreationStarted: (
    circleId: string,
    source: 'form' | 'wizard' | 'wizard_handoff' = 'form'
  ) => capture('medication_creation_started', { circle_id: circleId, source }),

  /** A medication row was persisted. NEVER the drug name or dosage. */
  medicationCreated: (
    circleId: string,
    hasRecurrence: boolean,
    source: 'form' | 'wizard' = 'form',
    startsNextDose: boolean = false
  ) =>
    capture('medication_created', {
      circle_id: circleId,
      has_recurrence: hasRecurrence,
      source,
      starts_next_dose: startsNextDose,
    }),

  /** The user typed into the first meaningful field. Once per entry, never per keystroke. */
  entryFieldEntered: (circleId: string, entityType: string, source: 'form' | 'wizard' = 'form') =>
    capture('entry_field_entered', { circle_id: circleId, entity_type: entityType, source }),

  entryScheduleSet: (circleId: string, entityType: string, source: 'form' | 'wizard' = 'form') =>
    capture('entry_schedule_set', { circle_id: circleId, entity_type: entityType, source }),

  /**
   * A save was attempted (fired before validation, so it counts EVERY attempt).
   * `is_editing` separates creates from revisions — the same split mobile uses,
   * so `entry_save_tapped ÷ event_created` is only read with `is_editing: false`.
   */
  entrySaveTapped: (
    circleId: string,
    entityType: string,
    source: 'form' | 'wizard' = 'form',
    isEditing = false
  ) =>
    capture('entry_save_tapped', {
      circle_id: circleId,
      entity_type: entityType,
      source,
      is_editing: isEditing,
    }),

  /**
   * A save was BLOCKED before it left the client: a validation rule, or the user
   * cancelling the past-time notice. NOT a failure — these used to be filed
   * under `entry_save_failed` and drowned the real ones (~90% of its volume).
   * Same event, `reason` values and `type` as mobile. No circle_id.
   *
   * `invalid_field` is web-only: a field rule the shared Zod schema rejects
   * (a value too long, a malformed field) that mobile blocks with its own alert.
   */
  entryValidationBlocked: (
    reason:
      | 'missing_name'
      | 'missing_time'
      | 'missing_end_time'
      | 'missing_start_time'
      | 'end_time_after_start'
      | 'past_time_cancelled'
      | 'as_needed_unsupported'
      | 'invalid_field',
    type: string
  ) => capture('entry_validation_blocked', { reason, type }),

  /**
   * The add-medication form was closed without saving (never on edit). Once per
   * form session. Enums, booleans and an integer only — no names, no ids.
   * `last_field` is the last field whose value changed. `entry` is how the form
   * was started: always 'form' on web (voice add is mobile-only).
   */
  medicationFormAbandoned: (props: {
    lastField: 'name' | 'dosage' | 'time' | 'repeat' | 'more_details' | 'none';
    hasName: boolean;
    hasSchedule: boolean;
    entry: 'form' | 'voice';
    /** How the form was opened (same values as `entry_form_opened.entry`). */
    entrySource: EntryFormOrigin;
    secondsOpen: number;
  }) =>
    capture('medication_form_abandoned', {
      last_field: props.lastField,
      has_name: props.hasName,
      has_schedule: props.hasSchedule,
      entry: props.entry,
      entry_source: props.entrySource,
      seconds_open: bucketSecondsOpen(props.secondsOpen),
    }),

  /** An add form was opened (simple-UI funnel). Enums only; no circle_id. */
  entryFormOpened: (props: { type: EntryFormType; entry: EntryFormOrigin }) =>
    capture('entry_form_opened', { type: props.type, entry: props.entry }),

  /** A step of the add form was completed for the first time ("What", "When", ...). */
  entryFormStepCompleted: (props: { type: EntryFormType; step: EntryFormStep }) =>
    capture('entry_form_step_completed', { type: props.type, step: props.step }),

  /** A time chip (or "Other time") was chosen on the new-medication form. */
  timeChipSelected: (props: { chip: TimeChipId }) =>
    capture('time_chip_selected', { chip: props.chip }),

  /**
   * The add-appointment form was closed without saving (create only). Once per
   * form session; `seconds_open` is bucketed exactly as in medication_form_abandoned.
   */
  appointmentFormAbandoned: (props: {
    lastField: AppointmentAbandonField;
    /** How the form was opened (same values as `entry_form_opened.entry`); mobile sends it too. */
    entrySource: EntryFormOrigin;
    secondsOpen: number;
  }) =>
    capture('appointment_form_abandoned', {
      last_field: props.lastField,
      entry_source: props.entrySource,
      seconds_open: bucketSecondsOpen(props.secondsOpen),
    }),

  /**
   * A save attempt did NOT produce the medication the caregiver asked for.
   *
   * `reason` is an app-authored literal at every call site
   * (`timezone_unresolved`, `past_time_cancelled`, `create_failed`,
   * `additional_dose_create_failed`), but it is typed as a free string and
   * mobile sends it UNSANITIZED — a gap the inventory records. Web routes it
   * through `sanitizeErrorText` so a future call site that reaches for
   * `err.message` cannot publish an email, a JWT or an invite code.
   */
  entrySaveFailed: (
    circleId: string,
    entityType: string,
    reason: string,
    details?: { errorCode?: string; httpStatus?: number }
  ) =>
    capture('entry_save_failed', {
      circle_id: circleId,
      entity_type: entityType,
      reason: sanitizeErrorText(reason),
      // Both OMITTED when absent, as on mobile. `errorCode` must come from
      // `classifyFailureCode` (a closed set), never a message.
      ...(details?.errorCode ? { error_code: sanitizeErrorText(details.errorCode) } : {}),
      ...(typeof details?.httpStatus === 'number' ? { http_status: details.httpStatus } : {}),
    }),

  // --- First-run wizard (post-circle-create) ---

  firstRunStepViewed: (
    circleId: string | undefined,
    step: 'choose' | 'what' | 'when' | 'repeat' | 'first_med'
  ) =>
    capture('first_run_step_viewed', {
      ...(circleId ? { circle_id: circleId } : {}),
      step,
    }),

  /**
   * Onboarding 1.3.1: `tier` says WHICH Setup (1) control was used, 'primary' =
   * the one big "Add {{name}}'s first med", 'secondary' = a quiet "OR START WITH"
   * row. Optional only so a caller outside Setup (none today) keeps compiling.
   */
  firstRunActionSelected: (
    circleId: string | undefined,
    action: 'medication' | 'appointment' | 'invite' | 'emergency',
    tier?: 'primary' | 'secondary'
  ) =>
    capture('first_run_action_selected', {
      ...(circleId ? { circle_id: circleId } : {}),
      action,
      ...(tier ? { tier } : {}),
    }),

  /**
   * `via` separates the explicit "Skip for now" affordance from closing the
   * wizard outright. 'close' names what actually happens on web (Escape, the ×,
   * or a backdrop click) — there is no 'dismiss'.
   */
  firstRunSkipped: (circleId: string | undefined, via: 'skip_button' | 'close') =>
    capture('first_run_skipped', {
      ...(circleId ? { circle_id: circleId } : {}),
      via,
    }),

  /**
   * The wizard saved a medication. Enums, booleans and counts ONLY — never the
   * drug name, the dosage value, or an rxcui.
   *
   * `doseCount` is INTENT, not creations: on a partial failure it still reports
   * the number of doses the caregiver ASKED for, while fewer rows exist.
   * Deliberate — `entry_save_failed` fires alongside with the reason, so the
   * discrepancy is recoverable in analysis, and reporting the created count
   * would make this event disagree with the funnel it belongs to.
   */
  firstRunMedicationSaved: (opts: {
    circleId?: string;
    // Onboarding 1.3.1: the folded form reports the time CHIP picked ('other' = a typed time);
    // the pre-1.3.1 wizard presets stay in the union for old call sites and tests.
    preset:
      | 'everyMorning'
      | 'everyEvening'
      | 'twiceDaily'
      | 'threeTimesDaily'
      | 'custom'
      | 'morning'
      | 'midday'
      | 'evening'
      | 'bedtime'
      | 'other';
    recurrence: 'daily' | 'every_other_day' | 'weekly' | 'none' | 'days_of_week' | 'as_needed';
    dosageFilled: boolean;
    doseCount: number;
  }) =>
    capture('first_run_medication_saved', {
      ...(opts.circleId ? { circle_id: opts.circleId } : {}),
      preset: opts.preset,
      recurrence: opts.recurrence,
      dosage_filled: opts.dosageFilled,
      dose_count: opts.doseCount,
    }),

  /**
   * The "No medications to track? See what else" toggle on wizard step ①, on
   * every tap. `open` is the state AFTER the tap. Same name and shape as mobile.
   */
  firstRunMoreOptionsToggled: (open: boolean) =>
    capture('first_run_more_options_toggled', { open }),

  /**
   * What the user did with the invite prompt after the first medication saved:
   * 'invite' (primary), 'not_now' (secondary) or 'close' (the X / Escape).
   */
  onboardingPayoffViewed: () => capture('onboarding_payoff_viewed'),

  firstRunInvitePromptAction: (action: 'invite' | 'not_now' | 'close') =>
    capture('first_run_invite_prompt_action', { action }),

  // --- Onboarding 1.3.1 (web flow: Mark it, suggestion outcome, paywall timing) ---
  // Enums and booleans only: no circle_id, no names, no free text (CLAUDE.md 4).

  /** The "Already given today? Mark it" line was put in front of the user. */
  markItShown: (surface: 'payoff' | 'today') => capture('mark_it_shown', { surface }),

  /** "Mark it" was tapped; `success` is whether the Taken was recorded. */
  markItTapped: (surface: 'payoff' | 'today', success: boolean) =>
    capture('mark_it_tapped', { surface, success }),

  /** "Use as typed" row chosen in the drug suggestions: bucket + boolean only, no text. */
  drugSuggestionUseAsTyped: (hadSuggestions: boolean, typedLength: number) =>
    capture('drug_suggestion_use_as_typed', {
      had_suggestions: hadSuggestions,
      typed_length_bucket: typedLength <= 3 ? '1-3' : typedLength <= 10 ? '4-10' : '11+',
    }),

  /**
   * How the medication NAME was chosen, on save of a create form: a drug
   * suggestion was picked, the name was typed with no suggestion offered/used, or
   * the "Use typed name as typed" row was chosen.
   */
  medNameSuggestionOutcome: (outcome: 'suggestion' | 'typed' | 'as_typed') =>
    capture('med_name_suggestion_outcome', { outcome }),

  /**
   * The onboarding paywall was put on screen. `trigger`: right after the first
   * medication's payoff, or (no first med) the next time Today showed.
   * `voice_try_used` is always false on web (voice is mobile only).
   */
  paywallShown: (trigger: 'after_first_med' | 'onboarding', voiceTryUsed = false) =>
    capture('paywall_shown', { trigger, voice_try_used: voiceTryUsed }),

  // --- Calendar & events ---
  eventCreated: (circleId: string, eventType: string, recurring: boolean) =>
    capture('event_created', { circle_id: circleId, event_type: eventType, recurring }),
  taskCompleted: (circleId: string) => capture('task_completed', { circle_id: circleId }),
  /**
   * A circle was picked from the picker list ('circle_list') or on the
   * downgrade circle-selection modal ('circle_selection') — the same event and
   * enum as mobile. `position` is 1-based. Integers and an enum only: NO
   * circle_id, so it cannot be joined to a household.
   */
  circleSelected: (p: {
    position: number;
    circleCount: number;
    source: 'circle_list' | 'circle_selection';
  }) =>
    capture('circle_selected', {
      position: p.position,
      circle_count: p.circleCount,
      source: p.source,
    }),
  taskUndone: (circleId: string) => capture('task_undone', { circle_id: circleId }),
  appointmentCompleted: (circleId: string) =>
    capture('appointment_completed', { circle_id: circleId }),
  calendarViewed: (circleId: string, view: string) =>
    capture('calendar_viewed', { circle_id: circleId, view }),

  // --- Care shifts (docs/plans/care-shifts.md) — SAME names and props as mobile.
  // Enums / booleans / counts ONLY, each coerced through a whitelist so nothing
  // else can ride along. NEVER `circle_id`, a shift/event id, a name, a title or
  // a clock time. They go through `capture`, so they are identified when the
  // user consented and ride the anonymous pipeline when they declined.
  shiftsViewOpened: (opts: { range: string; openCount: number; access?: string }) =>
    capture('shifts_view_opened', {
      range: pickEnum(opts.range, SHIFT_RANGES, 'day'),
      open_count_bucket: shiftOpenCountBucket(opts.openCount),
      access: pickEnum(opts.access, SHIFT_ACCESS, 'full'),
    }),
  shiftCreated: (opts: {
    repeats: boolean;
    recurrence: string;
    assigned: boolean;
    assignedSelf: boolean;
    reminder: string;
    overnight: boolean;
    durationMinutes: number;
    source: string;
  }) =>
    capture('shift_created', {
      repeats: opts.repeats === true,
      recurrence: pickEnum(opts.recurrence, SHIFT_RECURRENCES, 'none'),
      assigned: opts.assigned === true,
      assigned_self: opts.assignedSelf === true,
      reminder: pickEnum(opts.reminder, SHIFT_REMINDERS, 'off'),
      overnight: opts.overnight === true,
      duration_bucket: shiftDurationBucket(opts.durationMinutes),
      source: pickEnum(opts.source, SHIFT_SOURCES, 'shifts_view'),
    }),
  shiftAddNextTapped: () => capture('shift_add_next_tapped', {}),
  shiftTaken: (opts: { scope: string; reminderChanged?: boolean }) =>
    capture('shift_taken', {
      scope: pickEnum(opts.scope, SHIFT_SCOPES, 'occurrence'),
      // The taker picked a different reminder than the shift's own.
      reminder_changed: opts.reminderChanged === true,
    }),
  shiftTakeConflict: () => capture('shift_take_conflict', {}),
  shiftDropped: (opts: { scope: string; within24h: boolean; byRole: string }) =>
    capture('shift_dropped', {
      scope: pickEnum(opts.scope, SHIFT_SCOPES, 'occurrence'),
      within_24h: opts.within24h === true,
      by_role: pickEnum(opts.byRole, SHIFT_DROP_ROLES, 'self'),
    }),
  shiftAssigned: (opts: { scope: string; byRole: string }) =>
    capture('shift_assigned', {
      scope: pickEnum(opts.scope, SHIFT_SCOPES, 'occurrence'),
      by_role: pickEnum(opts.byRole, SHIFT_ASSIGN_ROLES, 'manager'),
    }),
  shiftEdited: (opts: { timeChanged: boolean; scope: string }) =>
    capture('shift_edited', {
      time_changed: opts.timeChanged === true,
      scope: pickEnum(opts.scope, SHIFT_SCOPES, 'occurrence'),
    }),
  shiftDeleted: (opts: { scope: string }) =>
    capture('shift_deleted', { scope: pickEnum(opts.scope, SHIFT_SCOPES, 'occurrence') }),
  shiftsTeaserShown: (opts: { source: string }) =>
    capture('shifts_teaser_shown', { source: pickEnum(opts.source, SHIFT_TEASER_SOURCES, 'toggle') }),
  shiftsTeaserCtaTapped: () => capture('shifts_teaser_cta_tapped', {}),

  // --- Event notes (notes-first-class plan) — NEVER include note text.
  // Same event as mobile's Analytics.dataExportDownloaded — no properties (a GDPR
  // export must not add identifiers to analytics).
  dataExportDownloaded: () => capture('data_export_downloaded', {}),

  // Same event names + shape as mobile's Analytics.eventNoteAdded/Updated/Deleted
  // (mobile/src/services/analytics.ts ~2400-2408). ---
  eventNoteAdded: (circleId: string) => capture('event_note_added', { circle_id: circleId }),
  eventNoteUpdated: (circleId: string) => capture('event_note_updated', { circle_id: circleId }),
  eventNoteDeleted: (circleId: string) => capture('event_note_deleted', { circle_id: circleId }),

  // --- Daily care notes (daily-care-notes plan) — NEVER include note body. ---
  careNotesViewed: (circleId: string) => capture('care_notes_viewed', { circle_id: circleId }),
  /** WB8: mood REMOVED from this payload — it's user-authored health content,
   *  not an id/count. Only how many categories were tagged is sent. */
  careNoteAdded: (
    circleId: string,
    // `backdated` / `daysBack`: filed under a past day, and how many days back
    // (0 when today). Never the date itself.
    opts: { categoryCount: number; backdated: boolean; daysBack: number }
  ) =>
    capture('care_note_added', {
      circle_id: circleId,
      category_count: opts.categoryCount,
      backdated: opts.backdated,
      days_back: opts.daysBack,
    }),
  /** "Show older notes" pressed: `page` = how many 92-day pages back (1 = first). */
  careNotesOlderLoaded: (opts: { page: number }) =>
    capture('care_notes_older_loaded', { page: opts.page }),
  /** A daily care note was EDITED. Mirrors `care_note_added`: a category COUNT
   *  and nothing else — never mood, body, or category names. */
  careNoteUpdated: (
    circleId: string,
    opts: { categoryCount: number; backdated: boolean; daysBack: number }
  ) =>
    capture('care_note_updated', {
      circle_id: circleId,
      category_count: opts.categoryCount,
      backdated: opts.backdated,
      days_back: opts.daysBack,
    }),
  careNoteDeleted: (circleId: string) => capture('care_note_deleted', { circle_id: circleId }),

  // --- Documents (web-new) ---
  documentUploaded: (circleId: string, category: string, fileType: string) =>
    capture('document_uploaded', { circle_id: circleId, category, file_type: fileType }),
  documentUpdated: (circleId: string) => capture('document_updated', { circle_id: circleId }),
  documentDeleted: (circleId: string) => capture('document_deleted', { circle_id: circleId }),

  // --- Vitals (web-new) ---
  vitalLogged: (circleId: string, vitalType: string) =>
    capture('vital_logged', { circle_id: circleId, vital_type: vitalType }),
  vitalUpdated: (circleId: string) => capture('vital_updated', { circle_id: circleId }),
  vitalDeleted: (circleId: string) => capture('vital_deleted', { circle_id: circleId }),

  // --- Emergency info (web-new) — never the contents, only that a view/edit
  // happened and WHICH top-level fields changed. ---
  emergencyInfoViewed: (circleId: string) =>
    capture('emergency_info_viewed', { circle_id: circleId }),
  /** `fieldsUpdated` is FIELD NAMES only (e.g. `Object.keys(partial)`) —
   *  never the values, which can carry PHI (blood type, allergies, DOB). */
  emergencyInfoUpdated: (circleId: string, fieldsUpdated: string[]) =>
    capture('emergency_info_updated', {
      circle_id: circleId,
      fields_updated: fieldsUpdated,
    }),

  // --- Notes by doctor (docs/plans/notes-by-doctor.md) — same event names and
  // properties as mobile. Enums, a count and a boolean ONLY: never a doctor's
  // name or id, a visit title, a note, or circle_id. ---
  /** The Visits & notes page for one doctor was opened (fires once its first page lands).
   *  `visit_count_bucket` buckets the PAST visits that first page returned (never a raw
   *  count); `has_notes` is whether any of them carries a note. Same shape as mobile. */
  providerVisitsOpened: (opts: {
    source?: string;
    visit_count_bucket?: string;
    has_notes?: boolean;
  }) =>
    capture('provider_visits_opened', {
      source: pickEnum(opts.source, ['medical_info', 'appointment', 'ai_chat'], 'medical_info'),
      visit_count_bucket: pickEnum(opts.visit_count_bucket, PROVIDER_VISIT_BUCKETS, '0'),
      has_notes: opts.has_notes === true,
    }),
  /** An appointment was saved WITH a (new) doctor. `source` = the add or edit form. */
  providerLinked: (opts: { source?: string }) =>
    capture('provider_linked', { source: pickEnum(opts.source, ['add', 'edit'], 'add') }),
  /** An appointment that had a doctor was saved with none. */
  providerUnlinked: () => capture('provider_unlinked', {}),

  // --- Activity feed (web-new) ---
  activityFeedViewed: (circleId: string) =>
    capture('activity_feed_viewed', { circle_id: circleId }),

  // --- Settings (web-new) ---
  languageChanged: (language: string) => capture('language_changed', { language }),
  /** Store-review ask (web): shown only to users with a registered mobile device. */
  storeReviewAskShown: (platform: 'ios' | 'android') =>
    capture('store_review_ask_shown', { platform }),
  storeReviewAskResolved: (action: 'rated' | 'dismissed', platform: 'ios' | 'android') =>
    capture('store_review_ask_resolved', { action, platform }),
  /** Browser auto-translate detected; banner offered switching the account language. */
  translatePromptShown: (suggested: string) => capture('translate_prompt_shown', { suggested }),
  translatePromptResolved: (action: 'accepted' | 'dismissed', suggested: string) =>
    capture('translate_prompt_resolved', { action, suggested }),
  timezoneChanged: (timezone: string) => capture('timezone_changed', { timezone }),
  /** Profile > Appearance > Theme. Enums + a boolean only: `theme` is the NEW
   *  preference, `previous` the old one, `effective` what is now painted. */
  themePreferenceChanged: (props: {
    theme: 'system' | 'light' | 'dark';
    previous: 'system' | 'light' | 'dark';
    system_dark: boolean;
    effective: 'light' | 'dark';
  }) => capture('theme_preference_changed', props),
  /** Super properties on every later event: `theme` (what is painted) and
   *  `theme_preference` (what was chosen). lib/posthog.ts re-registers the same
   *  pair after init and after every reset; this is the on-change path. */
  registerThemeProperties: (props: {
    theme: 'light' | 'dark';
    theme_preference: 'system' | 'light' | 'dark';
  }): void => {
    if (!env.VITE_POSTHOG_KEY) return;
    if (!analyticsCollectionAllowed()) return;
    withPosthog((posthog) => {
      try {
        posthog.register(props);
      } catch {
        // Best-effort, like capture().
      }
    });
  },
  /** Profile > Notifications group switch. Enums/booleans only (no circle id,
   *  no names). `confirmed` is present only for the Medications-off confirm. */
  notificationGroupToggled: (props: {
    group: 'medications' | 'tasks' | 'notes' | 'tips' | 'shifts';
    enabled: boolean;
    was_mixed: boolean;
    confirmed?: boolean;
  }) => capture('notification_group_toggled', props),

  // --- Help (web-new) ---
  /** `itemKey` is the i18n key / stable id of the FAQ item — never its
   *  rendered question/answer text. */
  helpItemExpanded: (itemKey: string) => capture('help_item_expanded', { item_key: itemKey }),

  // --- In-app help center + videos (1.3.0, docs/plans/in-app-help.md) ---
  // Enums only. `slug` is always an article slug from the bundled content.json
  // (a fixed list), never free text; the search query is NEVER sent.
  helpCenterOpened: (source: 'profile' | 'login' | 'signup' | 'home_card' | 'contextual') =>
    capture('help_center_opened', { source }),
  helpArticleViewed: (props: {
    slug: string;
    source: 'hub' | 'search' | 'related' | 'contextual';
    locale: 'en' | 'es';
  }) => capture('help_article_viewed', props),
  helpSearchUsed: (resultCountBucket: '0' | '1-3' | '4+') =>
    capture('help_search_used', { result_count_bucket: resultCountBucket }),
  helpVideoStarted: (slug: string) => capture('help_video_started', { slug }),
  helpVideoCompleted: (slug: string) => capture('help_video_completed', { slug }),
  helpVideoFailed: (slug: string) => capture('help_video_failed', { slug }),

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
  /**
   * The assistant answered a notes question (FIND_NOTES) by pointing to where the
   * notes are. Enums, booleans and a count only: never the doctor's name, the
   * typed question or circle_id. Same name + props as mobile.
   */
  aiNotesPathSuggested: (opts: {
    target?: string;
    doctor_named?: boolean;
    doctor_matched?: boolean;
    action_count?: number;
  }) =>
    capture('ai_notes_path_suggested', {
      target: pickEnum(opts.target, ['doctor', 'doctor_list', 'notes'], 'notes'),
      doctor_named: opts.doctor_named === true,
      doctor_matched: opts.doctor_matched === true,
      action_count: Math.max(0, Math.min(6, Math.floor(Number(opts.action_count) || 0))),
    }),
  /** A button on that reply was tapped. `action` is the destination kind, never the doctor. */
  aiNotesPathActionTapped: (opts: { action?: string }) =>
    capture('ai_notes_path_action_tapped', {
      action: pickEnum(opts.action, ['open_provider', 'open_notes', 'open_doctors'], 'open_notes'),
    }),
  /** Failed question. `reason` separates rate limits from everything else.
   *  Typed as the closed `AiChatFailureReason` set declared below rather than
   *  `string`, so a message can never be passed. That set is NOT the same as
   *  `AiChatErrorKind` in hooks/useAiChat.ts (its only caller): the hook has a
   *  fifth kind, `'viewOnly'`, which is deliberately not an analytics reason —
   *  `analyticsReason` folds it into `'sendFailed'`. See the note on the type. */
  aiChatFailed: (
    circleId: string,
    opts: { reason: AiChatFailureReason; latencyMs: number; turnIndex: number }
  ) =>
    capture('ai_chat_failed', {
      circle_id: circleId,
      reason: opts.reason,
      latency_ms: opts.latencyMs,
      turn_index: opts.turnIndex,
    }),

  // ============================================
  // PDF EXPORTS (mobile parity: services/analytics.ts ~L1828-1857)
  // ============================================
  /**
   * The adherence report was handed to the browser's print dialog. Mobile
   * fires this on share hand-off; the dialog is modal and unobservable, so
   * web fires when the dialog is REQUESTED (plan decision 7). Same name, same
   * shape — `period` is the '7d' | … | 'all' enum, never a date.
   */
  adherenceReportExported: (circleId: string, period: string) =>
    capture('adherence_report_exported', { circle_id: circleId, period }),

  /**
   * The care summary was handed off — `format` mirrors mobile's two shares.
   *
   * `notesOptions` (notes-first-class plan, task 30): booleans ONLY — never
   * note text, count of notes, or mood. Omitted entirely for a caller that
   * never asked about notes at all (keeps the event's shape byte-identical to
   * every pre-Slice-4 capture).
   */
  careSummaryShared: (
    circleId: string,
    format: 'pdf' | 'text',
    notesOptions?: { includeVisitNotes: boolean; includeCareNotes: boolean }
  ) =>
    capture('care_summary_shared', {
      circle_id: circleId,
      format,
      ...(notesOptions
        ? {
            include_visit_notes: notesOptions.includeVisitNotes,
            include_care_notes: notesOptions.includeCareNotes,
          }
        : {}),
    }),

  /**
   * The Emergency Info PDF export failed. `stage` and a coarse `code` ONLY —
   * no `circle_id` (not needed to count failures), and never the error
   * message or document title: the title carries the care recipient's name.
   */
  careSummaryExportFailed: (opts: { stage: ExportFailureStage; code: string }) =>
    capture('care_summary_export_failed', { stage: opts.stage, code: opts.code }),

  /** Same contract as `careSummaryExportFailed`, for the adherence report. */
  adherenceReportExportFailed: (opts: { stage: ExportFailureStage; code: string }) =>
    capture('adherence_report_export_failed', { stage: opts.stage, code: opts.code }),

  // ============================================
  // ERRORS (mobile parity: services/analytics.ts `errorOccurred`)
  // ============================================
  /**
   * A handled failure worth counting — the web half of mobile's
   * `error_occurred` event, SAME name and SAME shape so the admin digest and a
   * cross-platform breakdown join on `screen` / `error` / `code`.
   *
   * - `screen`: a stable non-PHI label for where it happened (a hook domain
   *   such as 'medication_confirm', 'calendar_events', 'profile').
   * - `error`: a short identifier of WHAT failed. Sanitized here regardless, so
   *   an upstream message slipping through is scrubbed of emails/tokens/query
   *   strings and truncated — but callers should pass a constant such as
   *   'medication_confirm_error', never `error.message` or toast copy.
   * - `context`: passed through UNSANITIZED, exactly like mobile. Enums, ids
   *   and counts ONLY — `circle_id`, `status`, `source`, and a `code` that
   *   comes from `classifyFailureCode` (lib/apiErrors.ts), which is a closed
   *   set by construction. Never a message, a name, a medication, a note.
   */
  errorOccurred: (screen: string, error: string, context?: Record<string, unknown>) =>
    capture('error_occurred', { screen, error: sanitizeErrorText(error), ...context }),

  // --- Cancel-reason prompt (docs/plans/cancel-reason-prompt.md) ---
  // Same names and properties as mobile. No circle_id, no free text, no price.
  cancelReasonPromptShown: (props: {
    periodType: string;
    daysSinceUnsubscribe: number;
    entitlementActive: boolean;
    isSandbox: boolean;
  }) =>
    capture('cancel_reason_prompt_shown', {
      period_type: props.periodType,
      days_since_unsubscribe: props.daysSinceUnsubscribe,
      entitlement_active: props.entitlementActive,
      is_sandbox: props.isSandbox,
    }),
  cancelReasonPromptSubmitted: (props: {
    reason: string;
    hasComment: boolean;
    periodType: string;
    isSandbox: boolean;
  }) =>
    capture('cancel_reason_prompt_submitted', {
      reason: props.reason,
      has_comment: props.hasComment,
      period_type: props.periodType,
      is_sandbox: props.isSandbox,
    }),
  cancelReasonPromptDismissed: (props: { periodType: string; hadSelection: boolean; isSandbox: boolean }) =>
    capture('cancel_reason_prompt_dismissed', {
      period_type: props.periodType,
      had_selection: props.hadSelection,
      is_sandbox: props.isSandbox,
    }),

  // --- Email click signal (docs/plans/email-lifecycle-overhaul.md, "CTA URLs
  // and click measurement"; landing outcome added in 1.3.1) ---
  /**
   * A visitor followed an email CTA into the web companion (any page reached
   * with a `?src=` query param) and the link's target RESOLVED. Fired once per
   * link by `lib/emailLinkLanding.ts`, never directly. Enums and booleans only:
   * `type` is the known `src` value (else 'other'), `app_state` is whether the
   * visitor had to sign in first, `landed` is whether the intended route was
   * reached, `target_found` is whether the linked circle/item existed and was
   * accessible. Never a circle id, item id, date or text.
   */
  emailLinkOpened: (props: {
    type: string;
    appState: 'signed_in' | 'signed_out';
    landed: boolean;
    targetFound: boolean;
  }) =>
    capture('email_link_opened', {
      type: props.type,
      app_state: props.appState,
      landed: props.landed,
      target_found: props.targetFound,
    }),

  // ── Notifications inbox (enums, counts and booleans only: never a circle id,
  // row id or text) ─────────────────────────────────────────────────────────

  /**
   * The inbox page was opened and loaded. `unreadBucket`: '0' | '1_3' | '4_9' | '10_plus'.
   * `source`: how it was reached ('circle_list' = a circle card's count, 'today_bell' =
   * the bell inside a circle, 'header_bell' = the bell outside a circle, 'other' =
   * direct URL, email link, the "All notifications" link). `scoped`: one circle's inbox.
   */
  inboxViewed: (props: {
    unreadBucket: '0' | '1_3' | '4_9' | '10_plus';
    source: InboxSource;
    scoped: boolean;
  }) =>
    capture('inbox_viewed', {
      unread_bucket: props.unreadBucket,
      source: props.source,
      scoped: props.scoped,
    }),

  /**
   * The circle list showed at least one card with an unread count. Once per page
   * view. `circlesWithUnread`: how many cards showed a count, capped at 10.
   */
  circleListUnreadShown: (props: { circlesWithUnread: number }) =>
    capture('circle_list_unread_shown', {
      circles_with_unread: Math.min(10, Math.max(0, Math.floor(props.circlesWithUnread))),
    }),

  /** A row was opened. `type` is the push type enum ('other' for an unknown one). */
  inboxRowOpened: (props: { type: string; targetFound: boolean }) =>
    capture('inbox_row_opened', { type: props.type, target_found: props.targetFound }),

  /** "Mark all read" was used; `count` is how many unread rows it covered. */
  inboxMarkAllRead: (props: { count: number }) =>
    capture('inbox_mark_all_read', { count: props.count }),
};

/**
 * The analytics vocabulary for `ai_chat_failed`. Declared here (not imported)
 * so lib/ never depends on hooks/.
 *
 * IT IS A SUBSET OF `AiChatErrorKind` (hooks/useAiChat.ts), NOT A MIRROR OF IT.
 * This comment used to say the two mirrored each other and that
 * `classifyAiError`'s return type was assignable to this — both were true until
 * `'viewOnly'` was added to `AiChatErrorKind`. `AiChatErrorKind` now has five
 * members to this type's four, and `'viewOnly'` is NOT assignable here: a
 * view-only 403 is reported as the generic `'sendFailed'` bucket rather than
 * widening an analytics grouping dimension from outside the module that owns
 * it. A direct assignment of a `classifyAiError` result to an
 * `AiChatFailureReason` no longer compiles, and should not.
 *
 * WHAT ACTUALLY KEEPS THE TWO IN STEP is neither assignability nor this
 * comment: it is the exhaustive `switch` in `analyticsReason`
 * (hooks/useAiChat.ts) — a different mechanism, in a different file. Every
 * `AiChatErrorKind` has an arm there, and the function's declared
 * `AiChatFailureReason` return type has no `default`, so adding a sixth kind to
 * `AiChatErrorKind` fails to compile until somebody decides which bucket it
 * reports as. Adding a member HERE, by contrast, is not caught by anything —
 * it only widens what the switch is allowed to return. Widen this set only
 * deliberately, and update `analyticsReason` in the same change.
 */
export type AiChatFailureReason =
  | 'subscriptionRequired'
  | 'rateLimited'
  | 'unavailable'
  | 'sendFailed';

export default Analytics;
