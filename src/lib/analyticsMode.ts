import { getAnalyticsConsentState, type AnalyticsConsentState } from './analyticsConsent';

/**
 * HOW MUCH ANALYTICS RUNS, given what the visitor chose.
 *
 * Mirrors mobile's `src/services/analyticsMode.ts` so the two clients behave
 * identically on consent. Read that file's notes too.
 *
 *   consented -> 'full'       identify(userId) + event capture
 *   declined  -> 'anonymous'  event capture, NO identify        (flag ON)
 *   declined  -> 'off'        nothing is constructed at all     (flag OFF)
 *
 * ── ONE IMPORTANT DIFFERENCE FROM MOBILE ─────────────────────────────────
 *
 * Mobile's anonymous mode has to switch `persistence` from 'file' to 'memory',
 * because ePrivacy attaches its consent requirement to STORING or READING
 * information on the device — a random-but-PERSISTED id is exactly what the
 * rule targets, and "it isn't a user id" is not a defence. Writing nothing is
 * the line.
 *
 * The web client already passes `persistence: 'memory'` UNCONDITIONALLY
 * (lib/posthog.ts), so nothing has ever been written to this device by PostHog
 * in any mode. That property is already satisfied here and must not be
 * regressed — if anyone ever switches web to 'localStorage' for retention, the
 * anonymous mode below stops meaning anything and this whole module has to be
 * revisited.
 *
 * So on web the delta between 'full' and 'anonymous' is exactly ONE thing:
 * whether `identify()` is called. That is also the delta that matters most —
 * identify is what joins the data to a named account and creates a durable
 * PostHog PERSON, which outlives the events and any `before_send` redaction.
 * (It used to carry the account's EMAIL as well; as of 2026-09-10 it sends the
 * opaque id and nothing else, matching mobile — see lib/posthog.ts.)
 *
 * Note "no id at all" is not achievable: `distinct_id` is required on every
 * ingested event. Memory-only is as close as the SDK goes.
 */

/**
 * ON — founder decision, 2026-09-07. Flipping this is the entire activation.
 *
 * WHY ON: a visitor who declines still has to produce anonymous, memory-only
 * usage and crash data, so the team can see what fails and when for the people
 * who said no — otherwise the declined cohort is invisible exactly when it
 * breaks. Nothing is written to their device (memory persistence, see above),
 * `identify()` is never called, and `before_send` strips every stable id
 * property (circle_id, event_id, ...) so the events cannot be joined back to
 * an account through our own database either (lib/posthog.ts).
 *
 * While false, a visitor who declines gets nothing constructed at all — the
 * behaviour this app shipped with. The 'off' branches downstream are kept
 * correct so turning it back off is a one-line change.
 *
 * The cost of ON, stated plainly so nobody discovers it later: no retention
 * analysis, no returning-user analysis, and no funnel that spans page loads
 * for the declined cohort, because a memory-only distinct id cannot be rejoined
 * across sessions — and with ids stripped, no per-circle breakdowns either.
 * What survives is within-session behaviour — where most drop-off analysis
 * lives — plus crash reporting.
 */
export const ANONYMOUS_ANALYTICS_WHEN_DECLINED = true;

/**
 * OFF — founder decision, 2026-09-08. Web does NOT grandfather.
 *
 * A visitor this browser has no answer from ('unasked') is treated exactly
 * like one who declined: anonymous, never identified. Existing web users
 * therefore see NO CHANGE from this release — same mode, same events, same
 * Profile toggle — and the population that has genuinely never been asked
 * shrinks on its own as new signups pass through the consent moment.
 *
 * WHY THIS DOES NOT CONTRADICT MOBILE, which grandfathers pre-gate installs ON
 * (detected by a persisted auth session in SecureStore): both platforms apply
 * the same principle — a consent gate must not change what is already
 * happening to people who were never asked — and land on opposite booleans
 * because their status quos were opposite. Mobile was already collecting fully
 * and identifying, so ON preserved that. Web has NEVER identified anybody:
 * consent has defaulted off since the gate shipped and nothing ever asked, so
 * ON here would not preserve a status quo, it would START identifying — with
 * the account's EMAIL — a population that has never said yes. Turning that on
 * silently is the one thing a consent gate exists to prevent.
 *
 * It is also unimplementable honestly on this client even if we wanted it:
 * `authStore` persists NOTHING by design (the session lives in an httpOnly
 * cookie), so there is no local marker that distinguishes a returning user
 * from a first-time visitor, and the obvious substitute — "is authenticated" —
 * would sweep in every brand-new signup too.
 *
 * Flipping this to true is a decision to record in this file's diff, not a
 * drift: it would opt in every visitor who has not been asked.
 */
export const GRANDFATHER_UNASKED_WEB_USERS = false;

export type AnalyticsMode = 'full' | 'anonymous' | 'off';

/**
 * The mode for a given consent answer.
 *
 * Takes consent as an ARGUMENT rather than reading it, so callers cannot
 * accidentally resolve a mode from a consent value they have not actually
 * loaded yet — see the `consentLoaded` note in lib/posthog.
 */
export function resolveAnalyticsMode(consented: boolean): AnalyticsMode {
  if (consented) return 'full';
  return ANONYMOUS_ANALYTICS_WHEN_DECLINED ? 'anonymous' : 'off';
}

/**
 * The mode for a recorded consent STATE — the three-way version.
 *
 * 'unasked' is the state the boolean resolver cannot express, and the whole
 * reason this exists: what it resolves to IS the grandfathering rule. With
 * `GRANDFATHER_UNASKED_WEB_USERS` off it collapses onto the declined branch,
 * so nobody is identified on the strength of a question they were never asked.
 */
export function resolveAnalyticsModeForState(state: AnalyticsConsentState): AnalyticsMode {
  if (state === 'granted') return 'full';
  if (state === 'unasked' && GRANDFATHER_UNASKED_WEB_USERS) return 'full';
  return ANONYMOUS_ANALYTICS_WHEN_DECLINED ? 'anonymous' : 'off';
}

/** May anything at all be sent in this mode? */
export function collectionAllowed(mode: AnalyticsMode): boolean {
  return mode !== 'off';
}

/**
 * May `identify()` be called in this mode?
 *
 * ONLY in 'full'. Calling it in 'anonymous' would hand PostHog the exact key
 * the mode exists to withhold, and nothing else about the client would look
 * any different — which is precisely why this is a named function with its own
 * test rather than an inline `mode === 'full'`.
 */
export function identifyAllowed(mode: AnalyticsMode): boolean {
  return mode === 'full';
}

/**
 * The mode this client is running in, resolved FRESH from consent on each read.
 *
 * Not cached: consent can change mid-session from the Profile toggle or the
 * signup flow, and a stale mode would keep identifying — or keep collecting —
 * after someone opted out, which is the exact failure the emit-path gate
 * exists to prevent.
 *
 * SYNCHRONOUS, and that is a property worth naming: mobile needs a
 * `consentLoaded` gate because AsyncStorage makes the read async, so an event
 * fired in that window could escape the gate. localStorage is synchronous, so
 * on web there is no window — the answer (including "no answer") is known
 * before the first capture can run, and reads the tri-state rather than a
 * boolean that could not tell a decline from a silence.
 *
 * Lives HERE rather than in lib/posthog because `lib/analytics` needs it and
 * `lib/posthog` already imports `lib/analytics` (for the redaction helpers).
 * Putting it in posthog created an import cycle; this module is a leaf over
 * `analyticsConsent`, so nothing can cycle through it.
 */
export function currentAnalyticsMode(): AnalyticsMode {
  return resolveAnalyticsModeForState(getAnalyticsConsentState());
}

/** May anything at all be sent right now? The emit-path gate. */
export function analyticsCollectionAllowed(): boolean {
  return collectionAllowed(currentAnalyticsMode());
}
