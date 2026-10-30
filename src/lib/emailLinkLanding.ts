// Email link landing: ONE `email_link_opened` event per link, fired after the
// link's target resolves (found or gone).
//
// Every email CTA carries `?src=<tag>` (backend emailService.buildEmailCtaUrl).
// The event says whether the visitor was already signed in, whether the intended
// route was reached, and whether the linked circle/item existed and was
// accessible. Enums and booleans only: never a circle id, item id, date or text.

import { useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Analytics } from '@/lib/analytics';

const LOGIN_MARKER_KEY = 'cc_email_link_login';

const DRIP_VARIANTS = [
  'create_circle',
  'first_entry',
  'invite_someone',
  'invite_pending',
  'team_checkin',
  'stuck',
] as const;

/** The known `src` values (backend buildEmailCtaUrl callers). Anything else reports as 'other'. */
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'welcome',
  'welcome_caregiver',
  'welcome_own_care',
  'trial_reminder',
  'weekly_digest',
  ...DRIP_VARIANTS.flatMap((v) => [`drip_d1_${v}`, `drip_d4_${v}`]),
]);

/** The `type` enum for a raw `?src=` value. */
export function emailLinkType(src: string): string {
  return KNOWN_TYPES.has(src) ? src : 'other';
}

/** The raw `src` of a `location.search`-shaped string, or null when absent/empty. */
export function readEmailSrc(search: string): string | null {
  const src = new URLSearchParams(search).get('src');
  return src ? src : null;
}

const pathOnly = (path: string): string => path.split('#')[0];

/**
 * LoginPage calls this when AuthGuard sent a visitor there from `path`. The
 * marker is matched to that exact path (pathname + search), so a stale one can
 * never tag a later, unrelated link as signed_out. Only parked for email links.
 */
export function markEmailLinkNeededLogin(path: string): void {
  try {
    const search = pathOnly(path).split('?')[1] ?? '';
    if (!readEmailSrc(search)) return;
    sessionStorage.setItem(LOGIN_MARKER_KEY, pathOnly(path));
  } catch {
    // Storage unavailable — the link is then reported as signed_in.
  }
}

function consumeLoginMarker(pathAndSearch: string): boolean {
  try {
    const stored = sessionStorage.getItem(LOGIN_MARKER_KEY);
    if (stored === null) return false;
    if (stored !== pathAndSearch) return false;
    sessionStorage.removeItem(LOGIN_MARKER_KEY);
    return true;
  } catch {
    return false;
  }
}

// In-memory, per page load: a link reports once even if several components
// (layout + page) or a StrictMode double-invoked effect ask. Keyed on
// pathname + src, NOT the whole search: pages scrub their own item params
// (`eventId`, `date`) from the URL once handled, and that must not re-arm it.
const reported = new Set<string>();

/** Test-only. */
export function __resetEmailLinkLandingForTests(): void {
  reported.clear();
}

/**
 * Item params that mean "a specific thing inside the circle". For these the
 * PAGE reports (it is the one that knows whether the item exists); the circle
 * layout only reports for links with no item target.
 */
export function hasEmailLinkItemTarget(pathname: string, search: string): boolean {
  const params = new URLSearchParams(search);
  if (/\/calendar\/?$/.test(pathname)) return params.has('eventId');
  if (/\/meds\/?$/.test(pathname)) return params.has('medication');
  if (/\/notes\/?$/.test(pathname)) return params.has('date');
  if (/\/daily-update(\/[^/]+)?\/?$/.test(pathname)) return true;
  return false;
}

export interface EmailLinkLanding {
  pathname: string;
  search: string;
  landed: boolean;
  targetFound: boolean;
}

/** Fire `email_link_opened` for a link that has resolved. No-op without `?src=`, or when already reported. */
export function reportEmailLinkLanding({
  pathname,
  search,
  landed,
  targetFound,
}: EmailLinkLanding): void {
  const src = readEmailSrc(search);
  if (!src) return;
  const key = `${pathname}|${src}`;
  if (reported.has(key)) return;
  reported.add(key);
  const signedOut = consumeLoginMarker(`${pathname}${search}`);
  Analytics.emailLinkOpened({
    type: emailLinkType(src),
    appState: signedOut ? 'signed_out' : 'signed_in',
    landed,
    targetFound,
  });
}

/**
 * For a page that owns an item target. Captures the URL at FIRST render (before
 * the page scrubs its own params) and returns `report(targetFound)`.
 */
export function useEmailLinkLanding(): (targetFound: boolean) => void {
  const location = useLocation();
  const captured = useRef({ pathname: location.pathname, search: location.search });
  return useCallback((targetFound: boolean) => {
    reportEmailLinkLanding({ ...captured.current, landed: true, targetFound });
  }, []);
}
