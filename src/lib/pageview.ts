import posthog from 'posthog-js';
import { env } from './env';

/**
 * Privacy-safe pageview tracking (auto-capture stays OFF in lib/posthog.ts —
 * `capture_pageview: false` — because PostHog's built-in pageview would capture
 * the full URL, including the /auth/callback token fragment on initial load).
 *
 * Rules:
 * - Only the PATHNAME is ever captured — NEVER location.hash or location.search
 *   (both can carry tokens, OTP codes, or invite codes).
 * - Dynamic path segments are masked before capture so ids never reach PostHog:
 *     /circles/<uuid>/calendar → /circles/[id]/calendar
 *     /invite/<code>           → /invite/[code]
 *   plus defensive masks for any other obviously dynamic segment (numeric ids,
 *   long hex strings, long token-like strings) so future routes fail safe.
 */

/** Standard 8-4-4-4-12 UUID (circle ids, user ids, event ids). */
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Long hex blob (hashes, compact uuids). */
const HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
/** Purely numeric segment (database ids). */
const NUMERIC_SEGMENT = /^\d+$/;
/** Long url-safe token (base64url-ish invite/verification tokens). */
const LONG_TOKEN_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;

/**
 * Mask dynamic segments of a pathname so captured routes are PHI/id-free.
 * Anything after an `invite` segment is an invite code regardless of shape.
 */
export function sanitizePath(pathname: string): string {
  // Defense in depth: even if a caller passes a full URL-ish string, drop any
  // query/hash before sanitizing — they must never reach an event property.
  const pathOnly = pathname.split(/[?#]/)[0];
  const segments = pathOnly.split('/');
  const sanitized = segments.map((segment, index) => {
    if (segment === '') return segment;
    if (segments[index - 1] === 'invite') return '[code]';
    if (UUID_SEGMENT.test(segment)) return '[id]';
    if (NUMERIC_SEGMENT.test(segment) || HEX_SEGMENT.test(segment)) return '[id]';
    if (LONG_TOKEN_SEGMENT.test(segment)) return '[id]';
    return segment;
  });
  return sanitized.join('/') || '/';
}

/**
 * Capture a `$pageview` for the (sanitized) pathname. `$current_url` is rebuilt
 * from origin + sanitized path so hash/search never leak. No-op when PostHog
 * isn't configured (same `VITE_POSTHOG_KEY` guard as the rest of lib/posthog).
 */
export function trackPageview(pathname: string): void {
  if (!env.VITE_POSTHOG_KEY) return;
  const sanitized = sanitizePath(pathname);
  posthog.capture('$pageview', {
    $current_url: window.location.origin + sanitized,
    $pathname: sanitized,
  });
}
