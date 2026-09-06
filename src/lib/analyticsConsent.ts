/**
 * Analytics consent for the web companion.
 *
 * DEFAULTS OFF, AND UNLIKE MOBILE THERE IS NO GRANDFATHERING. That divergence
 * is forced, not a preference:
 *
 *   1. `authStore` deliberately persists NOTHING ("auth state must never touch
 *      localStorage/sessionStorage" — the session lives in an httpOnly cookie).
 *      So there is no local marker that can distinguish a returning user from a
 *      first-time visitor, which is exactly what mobile's migration keys off.
 *   2. Gating on "is authenticated" instead would silently opt in every NEW
 *      signup, since they become authenticated too — a hole mobile closes with
 *      a signup checkbox that this app does not have.
 *   3. The grandfathering rationale on mobile was measurement continuity for
 *      the value-gated paywall experiment. That experiment is mobile-only
 *      (web payments are a later phase), so it buys nothing here.
 *
 * The web surface is also already privacy-hardened in ways mobile is not:
 * memory-only persistence (nothing in cookies or localStorage from PostHog),
 * `$ip: null` so no IP or derived geo is stored, and autocapture off. Defaulting
 * off costs little and matches the marketing site, which has required an
 * explicit "accepted" since launch.
 */

const CONSENT_KEY = 'cc_analytics_enabled';

let cached: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();

/**
 * Read consent. Defaults to FALSE — an absent key means the visitor has never
 * been asked, and "never asked" cannot mean yes.
 *
 * Never throws: localStorage is unavailable in private mode on some browsers
 * and behind certain enterprise policies, and an analytics preference must not
 * be able to break the app. An unreadable store fails CLOSED.
 */
export function getAnalyticsConsent(): boolean {
  if (cached !== null) return cached;
  try {
    cached = localStorage.getItem(CONSENT_KEY) === 'true';
  } catch {
    cached = false;
  }
  return cached;
}

export function setAnalyticsConsent(enabled: boolean): void {
  cached = enabled;
  try {
    localStorage.setItem(CONSENT_KEY, enabled ? 'true' : 'false');
  } catch {
    // Keep the in-memory value so the current session still honours the choice.
  }
  listeners.forEach((fn) => fn(enabled));
}

export function subscribeToAnalyticsConsent(fn: (enabled: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam only. */
export function __resetAnalyticsConsentCache(): void {
  cached = null;
  listeners.clear();
}
