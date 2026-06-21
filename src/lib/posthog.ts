import posthog from 'posthog-js';
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
 */
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
  });

  // Tag EVERY event with `platform: 'web'` so the shared PostHog project can
  // separate web from mobile (which sends the same event names) while still
  // aggregating cross-platform on the event name. `app_env` lets the admin error
  // digest exclude dev/testing activity (e.g. a dev running the site locally).
  posthog.register({
    platform: 'web',
    app_env: import.meta.env.DEV ? 'development' : 'production',
  });
}

/**
 * Associate subsequent events with a user id. NO PII traits are ever attached —
 * only the opaque user id. No-op when PostHog isn't initialized (optional key).
 */
export function identifyUser(userId: string): void {
  if (!env.VITE_POSTHOG_KEY) return;
  posthog.identify(userId);
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
 * Report a render error caught by an ErrorBoundary as a `$exception` event so it
 * feeds the admin error digest. `capture_exceptions` only auto-catches UNHANDLED
 * errors; a boundary "handles" the error, so we forward it explicitly. PHI-safe:
 * only the error name/message/stack and a non-PHI `boundary` tag are sent.
 * No-op when PostHog isn't initialized.
 */
export function captureException(error: Error, boundary: string): void {
  if (!env.VITE_POSTHOG_KEY) return;
  posthog.captureException(error, { boundary, platform: 'web' });
}
