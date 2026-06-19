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
    persistence: 'memory',
    session_recording: {
      maskAllInputs: true,
    },
  });
}
