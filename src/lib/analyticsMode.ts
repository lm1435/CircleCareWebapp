import { getAnalyticsConsent } from './analyticsConsent';

/**
 * HOW MUCH ANALYTICS RUNS, given what the visitor chose.
 *
 * Mirrors mobile's `src/services/analyticsMode.ts` so the two clients behave
 * identically on consent. Read that file's notes too.
 *
 *   consented -> 'full'       identify(userId, { email }) + event capture
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
 * identify is what joins the data to a named account, and on this client it
 * carries the EMAIL.
 *
 * Note "no id at all" is not achievable: `distinct_id` is required on every
 * ingested event. Memory-only is as close as the SDK goes.
 */

/**
 * SHIPS FALSE. Flipping this is the entire activation, and it is a DECISION —
 * pending counsel — not a default to drift into.
 *
 * While false, a visitor who declines gets nothing at all, which is the
 * behaviour this app has always had. While true, they get event capture with no
 * account linkage and nothing persisted to their device.
 *
 * The cost of turning it on, stated plainly so nobody discovers it later: no
 * retention analysis, no returning-user analysis, and no funnel that spans page
 * loads, because a memory-only distinct id cannot be rejoined across sessions.
 * What survives is within-session behaviour — where most drop-off analysis
 * lives — plus crash reporting.
 */
export const ANONYMOUS_ANALYTICS_WHEN_DECLINED = false;

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
 * Not cached: consent can change mid-session from the Profile toggle, and a
 * stale mode would keep identifying — or keep collecting — after someone opted
 * out, which is the exact failure the emit-path gate exists to prevent.
 *
 * Lives HERE rather than in lib/posthog because `lib/analytics` needs it and
 * `lib/posthog` already imports `lib/analytics` (for the redaction helpers).
 * Putting it in posthog created an import cycle; this module is a leaf over
 * `analyticsConsent`, so nothing can cycle through it.
 */
export function currentAnalyticsMode(): AnalyticsMode {
  return resolveAnalyticsMode(getAnalyticsConsent());
}

/** May anything at all be sent right now? The emit-path gate. */
export function analyticsCollectionAllowed(): boolean {
  return collectionAllowed(currentAnalyticsMode());
}
