import posthog from 'posthog-js';
import { redactInviteCode, sanitizeErrorText } from './analytics';
import { env } from './env';

/**
 * PostHog is OPTIONAL — when VITE_POSTHOG_KEY is unset the app runs with
 * analytics silently disabled (never crashes, never warns in production).
 *
 * Security posture (plan: Security section):
 * - maskAllInputs: session replay never captures form input.
 * - autocapture off: no accidental capture of PHI-adjacent text.
 * - memory persistence: nothing written to cookies/localStorage.
 * - Never put names, emails, or health data in event properties.
 * - `$ip: null` registered as a super property: PostHog treats a null $ip as
 *   "do not record", so no IP address is stored on any event and the GeoIP
 *   enrichment plugin has nothing to resolve. IP addresses are personal data
 *   under GDPR and we have no product use for them — caregiving analytics only
 *   ever needs counts and enums. Suppressing at the source beats retention
 *   policy: an IP we never store cannot leak, be subpoenaed, or be exported.
 *   TRADE-OFF (intentional): this also drops the derived geo properties
 *   ($geoip_country_code, $geoip_city_name, $geoip_time_zone, ...), so
 *   country/region breakdowns are NOT available for web events. If geography is
 *   ever needed, add an explicit coarse property rather than re-enabling $ip.
 * - Free-text error strings are scrubbed via `sanitizeErrorText` before capture
 *   (see lib/analytics.ts) — including `$exception` messages below.
 * - `sanitize_properties` strips invite codes from EVERY event. posthog-js reads
 *   `$current_url` / `$pathname` / `$referrer` from `location.href` on every
 *   capture (`capture_pageview: false` does NOT prevent this), so an event fired
 *   on `/invite/ABC123` published a still-redeemable invite code — and
 *   `$referrer` carried it onto the next page. Accept-by-code does no email
 *   match, so that code IS access to the circle's PHI. Doing this at init covers
 *   every current and future call site, plus posthog's own auto-properties;
 *   fixing one page would not.
 */
/**
 * Depth-limited recursive redaction of every string in a property tree.
 *
 * Cycles are impossible in the JSON posthog serialises, but the depth cap makes
 * that a guarantee rather than an assumption. Non-string leaves are returned
 * untouched, so numbers, booleans and nulls keep their types.
 */
function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') return redactInviteCode(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(inner, depth + 1);
    }
    return out;
  }
  return value;
}

export function initAnalytics(): void {
  if (!env.VITE_POSTHOG_KEY) return;

  posthog.init(env.VITE_POSTHOG_KEY, {
    autocapture: false,
    capture_pageview: false,
    // Capture unhandled errors/rejections as $exception events so crashes feed
    // the admin error digest. Distinct from `autocapture` (DOM events), which
    // stays off to avoid capturing PHI-adjacent text.
    capture_exceptions: true,
    persistence: 'memory',
    session_recording: {
      maskAllInputs: true,
    },
    // Runs on every event, including posthog's own auto-properties. Only string
    // values are touched, and only the invite credential inside them is removed
    // -- the invite EVENTS themselves (sent/accepted counts) are untouched,
    // since those drive the activation funnel.
    //
    // `before_send`, not `sanitize_properties`: the latter is deprecated, and it
    // only ever saw TOP-LEVEL properties. `$current_url` / `$pathname` are
    // top-level so the invite code was caught there, but nested payloads were
    // not -- most importantly `$exception_list`, an array of objects whose
    // `value` and `stacktrace` frames can carry the URL the crash happened on,
    // i.e. `/invite/<code>` verbatim. This walks the whole property tree.
    before_send: (event) => {
      if (!event) return event;
      try {
        return { ...event, properties: redactDeep(event.properties) as typeof event.properties };
      } catch {
        // Analytics must never break the app. Dropping the EVENT is safer than
        // sending one that skipped redaction, since the thing being redacted is
        // a live credential.
        return null;
      }
    },
  });

  // Tag EVERY event with `platform: 'web'` so the shared PostHog project can
  // separate web from mobile (which sends the same event names) while still
  // aggregating cross-platform on the event name. `app_env` lets the admin error
  // digest exclude dev/testing activity (e.g. a dev running the site locally).
  // `$ip: null` suppresses IP capture + GeoIP enrichment on EVERY event (see the
  // security posture note above) — it must be a super property, not an init
  // option, so it also covers $exception and session-replay-adjacent events.
  posthog.register({
    platform: 'web',
    app_env: import.meta.env.DEV ? 'development' : 'production',
    $ip: null,
  });
}

/**
 * Associate subsequent events with a user id, plus the user's email as the ONLY
 * person property (disclosed in the privacy policy's PostHog row — needed so
 * founders can correlate analytics with support requests). No other traits are
 * ever attached. No-op when PostHog isn't initialized (optional key).
 */
export function identifyUser(userId: string, email?: string): void {
  if (!env.VITE_POSTHOG_KEY) return;
  if (email) {
    posthog.identify(userId, { email });
  } else {
    posthog.identify(userId);
  }
}

/**
 * Reset the analytics identity (call on logout so the next user starts fresh).
 * No-op when PostHog isn't initialized.
 */
export function resetAnalytics(): void {
  if (!env.VITE_POSTHOG_KEY) return;
  posthog.reset();
}

/**
 * Return an Error whose `message` has been run through `sanitizeErrorText`.
 *
 * An ErrorBoundary error message can legitimately embed user data — a failed
 * fetch reports the URL it was called with (query string and all), and a thrown
 * validation error can quote the value it rejected. The digest identifies errors
 * by name + message shape, and the sanitizer only redacts emails/tokens/query
 * strings while preserving the rest, so identifiability is unaffected.
 *
 * The original error is NEVER mutated (ErrorBoundary still logs it in DEV and
 * React may re-throw it): when redaction changes anything we send a clone that
 * keeps the original `name` and `stack`, with the message rewritten inside the
 * stack's header line too. Stack FRAMES are left intact — they are bundle URLs,
 * not user data, and mangling them would break digest triage.
 */
function withSanitizedMessage(error: Error): Error {
  try {
    const message = typeof error?.message === 'string' ? error.message : '';
    const safe = sanitizeErrorText(message);
    if (safe === message) return error;

    const clone = new Error(safe);
    clone.name = typeof error.name === 'string' ? error.name : 'Error';
    if (typeof error.stack === 'string') {
      clone.stack = message.length > 0 ? error.stack.replace(message, safe) : error.stack;
    }
    return clone;
  } catch {
    // Exotic/proxied error object — never let analytics break error reporting.
    return error;
  }
}

/**
 * Report a render error caught by an ErrorBoundary as a `$exception` event so it
 * feeds the admin error digest. `capture_exceptions` only auto-catches UNHANDLED
 * errors; a boundary "handles" the error, so we forward it explicitly. PHI-safe:
 * only the error name/sanitized message/stack and a non-PHI `boundary` tag are
 * sent. No-op when PostHog isn't initialized.
 */
export function captureException(error: Error, boundary: string): void {
  if (!env.VITE_POSTHOG_KEY) return;
  posthog.captureException(withSanitizedMessage(error), { boundary, platform: 'web' });
}
