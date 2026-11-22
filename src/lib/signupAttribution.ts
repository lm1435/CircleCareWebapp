// Signup attribution — WHERE did this browser session come from?
//
// Captured once at boot from the landing URL into sessionStorage (it must
// survive the OAuth full-page redirect and the login -> signup -> verify-email
// hops, which a React state could not). First touch wins: a field already
// captured this session is never overwritten by a later URL.
//
// Sent (optional, additive) on POST /auth/signup and POST /auth/oauth-session
// as top-level `signup_source` + `signup_source_detail`, and mirrored onto the
// `signup_completed` PostHog event. The backend normalizes/strips everything
// and can never fail a request over it.
//
// REFERRER: when the landing URL has no `ref` param, the HOSTNAME of
// document.referrer is recorded as `ref` (first touch), e.g. `circlecare.app`
// or `www.google.com`. Never the full referrer URL, path or query string. A
// referrer on this app's own host (my.circlecare.app, or whatever host serves
// it) is ignored. `ref` is sent only when it is a bare hostname; the backend
// enforces the same shape.
//
// PRIVACY: invite-code PRESENCE is a boolean only. The code itself (which
// grants circle access) is never stored here, sent as attribution, or put in
// analytics. No emails, no circle ids.
//
// DERIVATION (signup_source), first match wins:
//   1. 'invite' — landed on /invite/:code, or an invite code is parked
//   2. 'email'  — an `src` param was present (our email CTAs set it)
//   3. 'web'    — utm_*/ref captured (same value; detail keeps the params)
//   4. 'web'    — plain default, so web vs mobile acquisition stays distinguishable
import { peekPendingInviteCode } from './pendingInviteCode';

const STORAGE_KEY = 'cc_signup_attribution';
const MAX_LEN = 128;
/** Bare hostname: lowercase letters, digits, dots, hyphens; no scheme/path/query/port. */
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
/** Hosts that serve this app: a referrer from them is internal navigation, not a source. */
const OWN_HOSTS: readonly string[] = ['my.circlecare.app'];

type StoredField = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'src' | 'ref';
const FIELDS: readonly StoredField[] = ['utm_source', 'utm_medium', 'utm_campaign', 'src', 'ref'];

interface Stored extends Partial<Record<StoredField, string>> {
  invite?: boolean;
}

export interface SignupAttributionDetail {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  src?: string;
  /** Referrer hostname of the first landing (or the `ref` param, if it is one). */
  ref?: string;
  invite_code_present?: boolean;
}

export interface SignupAttribution {
  signup_source: string;
  signup_source_detail: SignupAttributionDetail;
}

function clean(raw: string | null): string | null {
  if (raw === null) return null;
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_LEN);
  return v.length > 0 ? v : null;
}

/** A bare lowercase hostname, or null. Never returns a URL, path or query. */
function asHostname(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v.length === 0 || v.length > MAX_LEN || v.includes('..') || !HOSTNAME_RE.test(v)) return null;
  return v;
}

/** Hostname of a referrer URL, or null for empty / unparseable / own-host referrers. */
function referrerHost(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const host = asHostname(new URL(referrer).hostname);
    if (!host) return null;
    let here = '';
    try {
      here = window.location.hostname.toLowerCase();
    } catch {
      // no window.location — fine
    }
    if (OWN_HOSTS.includes(host) || host === here) return null;
    return host;
  } catch {
    return null;
  }
}

function read(): Stored {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Stored = {};
    const obj = parsed as Record<string, unknown>;
    for (const f of FIELDS) {
      if (typeof obj[f] === 'string' && obj[f]) out[f] = obj[f] as string;
    }
    if (obj.invite === true) out.invite = true;
    return out;
  } catch {
    return {};
  }
}

/**
 * Capture attribution from the landing URL. Call once at boot. Idempotent and
 * first-touch: existing stored fields are kept. Never throws.
 */
export function captureSignupAttribution(
  search: string = window.location.search,
  pathname: string = window.location.pathname,
  referrer: string = typeof document !== 'undefined' ? document.referrer : ''
): void {
  try {
    const stored = read();
    const params = new URLSearchParams(search);
    let changed = false;
    for (const f of FIELDS) {
      if (stored[f] !== undefined) continue;
      // `ref` is stored only when it is a bare hostname: a URL in it is dropped
      // here, so it never even sits in sessionStorage.
      const v = f === 'ref' ? asHostname(clean(params.get(f))) : clean(params.get(f));
      if (v) {
        stored[f] = v;
        changed = true;
      }
    }
    // No usable `ref` param on this landing (and none stored): fall back to
    // the referrer's hostname. Only the host is ever read from document.referrer.
    if (stored.ref === undefined) {
      const host = referrerHost(referrer);
      if (host) {
        stored.ref = host;
        changed = true;
      }
    }
    if (!stored.invite && /^\/invite\/[^/]+/.test(pathname)) {
      stored.invite = true;
      changed = true;
    }
    if (changed) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable (Safari private mode, blocked) — attribution is best-effort.
  }
}

/** Current attribution for a signup request / analytics event. Never throws. */
export function getSignupAttribution(): SignupAttribution {
  const s = read();
  const invite = s.invite === true || peekPendingInviteCode() !== null;
  const signup_source = invite ? 'invite' : s.src ? 'email' : 'web';
  const detail: SignupAttributionDetail = {};
  if (s.utm_source) detail.utm_source = s.utm_source;
  if (s.utm_medium) detail.utm_medium = s.utm_medium;
  if (s.utm_campaign) detail.utm_campaign = s.utm_campaign;
  if (s.src) detail.src = s.src;
  const ref = asHostname(s.ref);
  if (ref) detail.ref = ref;
  if (invite) detail.invite_code_present = true;
  return { signup_source, signup_source_detail: detail };
}

/**
 * Flat, conservative PostHog props: source + utm params + src only. The referrer hostname (`ref`) is
 * deliberately NOT sent to PostHog (free text; CLAUDE.md rule 4): it goes to the backend only, which
 * stores it in users.signup_source_detail for acquisition reporting.
 */
export function getSignupAttributionProps(): Record<string, string> {
  const { signup_source, signup_source_detail: d } = getSignupAttribution();
  const props: Record<string, string> = { source: signup_source };
  if (d.utm_source) props.utm_source = d.utm_source;
  if (d.utm_medium) props.utm_medium = d.utm_medium;
  if (d.utm_campaign) props.utm_campaign = d.utm_campaign;
  if (d.src) props.src = d.src;
  return props;
}
