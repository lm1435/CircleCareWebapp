import { env } from './env';
import { analyticsCollectionAllowed } from './analyticsMode';
import { withPosthog } from './posthogLoader';
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
 * Auth-callback credentials, in any string that reaches PostHog.
 *
 * Defence in depth behind `mask_personal_data_properties`. That option closes
 * the known vector ($initial_person_info capturing the landing URL before
 * AuthCallbackPage scrubs the hash), but a token can reach a property by other
 * routes — a sanitized error message quoting the URL it failed on, a future
 * property someone adds. A live credential is the one thing worth stripping
 * twice.
 *
 * Matches the Supabase hash/query params by NAME, so it does not depend on
 * guessing what a JWT looks like.
 */
const AUTH_TOKEN_RE =
  /\b(access_token|refresh_token|provider_token|provider_refresh_token|id_token)=[^&\s#]+/gi;

export function redactAuthTokens(value: string): string {
  try {
    if (typeof value !== 'string' || value.length === 0) return value;
    return value.replace(AUTH_TOKEN_RE, '$1=[redacted]');
  } catch {
    return value;
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

  // --- Members ---
  /** Owner removed a member. Deliberately NO removed-user id — that member's
   *  identity is not this event's business, only that a removal happened. */
  memberRemoved: (circleId: string) => capture('member_removed', { circle_id: circleId }),
  /** The current member voluntarily left the circle. */
  circleLeft: (circleId: string) => capture('circle_left', { circle_id: circleId }),

  // --- Invites ---
  inviteStarted: (circleId: string) => capture('invite_started', { circle_id: circleId }),
  inviteSent: (circleId: string, role: string) =>
    capture('invite_sent', { circle_id: circleId, role }),
  inviteFailed: (circleId: string, error: string) =>
    capture('invite_failed', { circle_id: circleId, error: sanitizeErrorText(error) }),
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
    opts: { surface: MedicationLifecycleSurface; scope: MedicationDeleteScope }
  ) =>
    capture('medication_deleted', {
      circle_id: circleId,
      surface: opts.surface,
      scope: opts.scope,
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
    source: 'form' | 'wizard' = 'form'
  ) =>
    capture('medication_created', {
      circle_id: circleId,
      has_recurrence: hasRecurrence,
      source,
    }),

  /** The user typed into the first meaningful field. Once per entry, never per keystroke. */
  entryFieldEntered: (circleId: string, entityType: string, source: 'form' | 'wizard' = 'form') =>
    capture('entry_field_entered', { circle_id: circleId, entity_type: entityType, source }),

  entryScheduleSet: (circleId: string, entityType: string, source: 'form' | 'wizard' = 'form') =>
    capture('entry_schedule_set', { circle_id: circleId, entity_type: entityType, source }),

  entrySaveTapped: (circleId: string, entityType: string, source: 'form' | 'wizard' = 'form') =>
    capture('entry_save_tapped', { circle_id: circleId, entity_type: entityType, source }),

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
  entrySaveFailed: (circleId: string, entityType: string, reason: string) =>
    capture('entry_save_failed', {
      circle_id: circleId,
      entity_type: entityType,
      reason: sanitizeErrorText(reason),
    }),

  // --- First-run wizard (post-circle-create) ---

  firstRunStepViewed: (
    circleId: string | undefined,
    step: 'choose' | 'what' | 'when' | 'repeat'
  ) =>
    capture('first_run_step_viewed', {
      ...(circleId ? { circle_id: circleId } : {}),
      step,
    }),

  firstRunActionSelected: (
    circleId: string | undefined,
    action: 'medication' | 'appointment' | 'invite' | 'emergency'
  ) =>
    capture('first_run_action_selected', {
      ...(circleId ? { circle_id: circleId } : {}),
      action,
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
    preset: 'everyMorning' | 'everyEvening' | 'twiceDaily' | 'threeTimesDaily' | 'custom';
    recurrence: 'daily' | 'every_other_day' | 'weekly' | 'none';
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
  /** A daily care note was EDITED. Mirrors `care_note_added`: a category COUNT
   *  and nothing else — never mood, body, or category names. */
  careNoteUpdated: (circleId: string, opts: { categoryCount: number }) =>
    capture('care_note_updated', {
      circle_id: circleId,
      category_count: opts.categoryCount,
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

  // --- Activity feed (web-new) ---
  activityFeedViewed: (circleId: string) =>
    capture('activity_feed_viewed', { circle_id: circleId }),

  // --- Settings (web-new) ---
  languageChanged: (language: string) => capture('language_changed', { language }),
  timezoneChanged: (timezone: string) => capture('timezone_changed', { timezone }),

  // --- Help (web-new) ---
  /** `itemKey` is the i18n key / stable id of the FAQ item — never its
   *  rendered question/answer text. */
  helpItemExpanded: (itemKey: string) => capture('help_item_expanded', { item_key: itemKey }),

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
  /** Failed question. `reason` separates rate limits from everything else.
   *  Typed as the closed `AiChatErrorKind` set from hooks/useAiChat.ts (the
   *  only caller) rather than `string`, so a message can never be passed. */
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
};

/**
 * Mirrors `AiChatErrorKind` in hooks/useAiChat.ts. Declared here (not
 * imported) so lib/ never depends on hooks/; `useAiChat`'s `classifyAiError`
 * return type is assignable to this, and the compiler enforces that the two
 * stay in step.
 */
export type AiChatFailureReason =
  | 'subscriptionRequired'
  | 'rateLimited'
  | 'unavailable'
  | 'sendFailed';

export default Analytics;
