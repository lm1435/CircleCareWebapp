/**
 * WHERE THE PAYWALL WAS TRIGGERED FROM — the closed enum mobile sends, value
 * for value.
 *
 * PORT of `mobile/src/navigation/types.ts` `PaywallContext`. Every paywall
 * event on both platforms carries one of these as `paywall_context`, and the
 * whole onboarding-paywall ABA analysis (1.1.3–1.1.5 no paywall, 2.9%
 * conversion; 1.1.6–1.1.10 paywall at circle creation, 22.1%) is computed by
 * splitting that property. A value that does not match mobile's spelling does
 * not merge into a mismatched cohort — it silently creates a THIRD one, and
 * every rate computed from the funnel is wrong by an unknown amount. So:
 *
 *   DO NOT rename, re-case, or "tidy" these strings.
 *
 * `earned_meds` / `earned_invite` are mobile-only today (the value-gated
 * upsell has no web surface yet). They are listed because this is a mirror of
 * mobile's enum, not a subset of it, and because `asPaywallContext` must
 * accept them if a future web surface starts sending them.
 */
export const PAYWALL_CONTEXTS = [
  /** A hard limit was hit — seat cap, circle cap, a 402 on a create. */
  'capacity',
  /** A premium-only feature was reached (AI assistant, vitals, documents…). */
  'feature',
  /** The user went looking for it (profile Upgrade, re-subscribe banner). */
  'general',
  /** The once-ever ask immediately after the FIRST circle is created. */
  'onboarding',
  'earned_meds',
  'earned_invite',
] as const;

export type PaywallContext = (typeof PAYWALL_CONTEXTS)[number];

/**
 * Mobile's `Analytics.planSelection*` helpers default a missing context to
 * `'general'` (mobile/src/services/analytics.ts:1211-1227). Web does the same
 * so a paywall reached by an un-instrumented route still lands in the funnel
 * under the same bucket rather than as `undefined`.
 */
export const DEFAULT_PAYWALL_CONTEXT: PaywallContext = 'general';

/**
 * Narrow an untrusted value (it arrives via `location.state`, which a user can
 * forge through `history.pushState`) to the enum. Anything unrecognised
 * degrades to `'general'` — never to an arbitrary string, which would invent a
 * cohort inside PostHog.
 */
export function asPaywallContext(value: unknown): PaywallContext {
  return typeof value === 'string' && (PAYWALL_CONTEXTS as readonly string[]).includes(value)
    ? (value as PaywallContext)
    : DEFAULT_PAYWALL_CONTEXT;
}

/** The `location.state` shape every route into `/upgrade` should carry. */
export interface UpgradeLocationState {
  paywallContext?: PaywallContext;
}
