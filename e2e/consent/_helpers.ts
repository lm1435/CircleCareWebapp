import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Request, type Response, type Route } from '@playwright/test';
import { SUPABASE_URL, assertLocalDbTargets, sqlExec, sqlRows, sqlStr } from '../db';
import { ACCOUNT_PASSWORD, createAccount, runScopedEmail } from '../isolation';
import type { CapturedEvent, PosthogCapture } from '../unhappy';

// ===========================================================================
// Helpers for the analytics-consent specs in e2e/consent/. Built only on the
// foundation (db.ts, isolation.ts, unhappy.ts); nothing here stubs PostHog —
// `posthogCapture` (the `posthog` fixture) does the intercept/decode.
// ===========================================================================

export const WITHDRAW_PATH = '/api/users/me/withdraw-analytics-consent';
export const RESTORE_PATH = '/api/users/me/restore-analytics-consent';
export const OAUTH_SESSION_PATH = '/api/auth/oauth-session';
export const USERS_ME_PATH = '/api/users/me';

/** src/lib/analyticsConsentSync.ts `PENDING_KEY` — the undelivered-decision map. */
export const PENDING_SYNC_KEY = 'analytics_consent_pending_sync';
/** src/lib/pendingAnalyticsConsent.ts `STORAGE_KEY` — '1' | '0' in sessionStorage. */
export const PARKED_ANALYTICS_KEY = 'cc_pending_analytics_consent';
/** en profile.json `analytics.enable` — the Profile > Privacy switch. */
export const CONSENT_SWITCH_NAME = 'Share usage data';

export interface TestAccount {
  email: string;
  password: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Server-side consent columns (users.analytics_consent_granted_at/withdrawn_at)
// ---------------------------------------------------------------------------

export interface ServerConsent {
  granted_at: string | null;
  withdrawn_at: string | null;
}

export function readServerConsent(userId: string): ServerConsent {
  assertLocalDbTargets('readServerConsent');
  const rows = sqlRows<ServerConsent>(
    `select analytics_consent_granted_at::text as granted_at,
            analytics_consent_withdrawn_at::text as withdrawn_at
       from public.users where id = ${sqlStr(userId)}`
  );
  if (rows.length !== 1) throw new Error(`readServerConsent: no public.users row for ${userId}`);
  return rows[0];
}

function writeServerConsent(userId: string, value: ServerConsent): void {
  assertLocalDbTargets('writeServerConsent');
  const ts = (v: string | null) => (v === null ? 'null' : `${sqlStr(v)}::timestamptz`);
  sqlExec(
    `update public.users
        set analytics_consent_granted_at = ${ts(value.granted_at)},
            analytics_consent_withdrawn_at = ${ts(value.withdrawn_at)}
      where id = ${sqlStr(userId)};`
  );
}

/**
 * Put the account's SERVER consent in `state` and return a closure restoring
 * the exact previous values. Register the closure for `afterEach` (it runs even
 * after a timeout) so worker accounts leave a test as they entered it.
 */
export function setServerConsent(userId: string, state: 'granted' | 'declined' | 'unasked'): () => void {
  const before = readServerConsent(userId);
  const now = new Date().toISOString();
  const next: ServerConsent =
    state === 'granted'
      ? { granted_at: now, withdrawn_at: null }
      : state === 'declined'
        ? { granted_at: before.granted_at, withdrawn_at: now }
        : { granted_at: null, withdrawn_at: null };
  writeServerConsent(userId, next);
  return () => writeServerConsent(userId, before);
}

// ---------------------------------------------------------------------------
// Accounts, sessions, OAuth tokens
// ---------------------------------------------------------------------------

/**
 * A brand-new run-scoped account (teardown purges it). `backdateMinutes` moves
 * `auth.users.created_at` into the past so a sign-in now is a RETURNING user's
 * (backend isNewAuthUser: |last_sign_in_at - created_at| <= 60s means new).
 */
export async function freshAccount(label: string, opts: { backdateMinutes?: number } = {}): Promise<TestAccount> {
  const unique = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const email = runScopedEmail(`${label}-${unique}`);
  const userId = await createAccount(email, 'premium');
  if (opts.backdateMinutes) {
    sqlExec(
      `update auth.users set created_at = now() - make_interval(mins => ${Math.floor(opts.backdateMinutes)})
        where id = ${sqlStr(userId)};`
    );
  }
  return { email, password: ACCOUNT_PASSWORD, userId };
}

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backend');
let cachedAnonKey: string | null = null;

/** The local stack's anon key: `PW_SUPABASE_ANON_KEY`, else `supabase status -o env` in backend/. */
export function localAnonKey(): string {
  if (cachedAnonKey) return cachedAnonKey;
  if (process.env.PW_SUPABASE_ANON_KEY) return (cachedAnonKey = process.env.PW_SUPABASE_ANON_KEY);
  let out: string;
  try {
    out = execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(
      `localAnonKey: \`supabase status -o env\` failed in ${BACKEND_DIR} ` +
        `(${err instanceof Error ? err.message : String(err)}); set PW_SUPABASE_ANON_KEY.`
    );
  }
  const m = /^ANON_KEY="?([^"\r\n]+)"?\s*$/m.exec(out);
  if (!m) throw new Error('localAnonKey: no ANON_KEY in `supabase status -o env` output');
  return (cachedAnonKey = m[1]);
}

export interface PasswordGrantSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type?: string;
}

/** A REAL GoTrue session for `account` (local `/auth/v1/token?grant_type=password`, anon key). */
export async function mintPasswordSession(account: { email: string; password: string }): Promise<PasswordGrantSession> {
  assertLocalDbTargets('mintPasswordSession');
  const key = localAnonKey();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as Partial<PasswordGrantSession>;
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(`mintPasswordSession(${account.email}) failed: ${res.status}`);
  }
  return json as PasswordGrantSession;
}

/**
 * `/auth/callback#…` shaped like Supabase's implicit-flow OAuth redirect.
 * AuthCallbackPage reads only `access_token`, `refresh_token` and `error*`
 * from the fragment; the rest mirrors what GoTrue appends.
 */
export function oauthCallbackPath(session: PasswordGrantSession): string {
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    expires_at: String(session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in),
    expires_in: String(session.expires_in),
    refresh_token: session.refresh_token,
    token_type: session.token_type ?? 'bearer',
  });
  return `/auth/callback#${fragment.toString()}`;
}

/** Cookie-mode login for `account` in the page's context (what fixtures.ts does for the worker account). */
export async function loginWithCookie(page: Page, account: TestAccount, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error('loginWithCookie: project has no baseURL');
  const res = await page.context().request.post('/api/auth/login', {
    headers: { 'X-Session-Mode': 'cookie', Origin: new URL(baseURL).origin },
    data: { email: account.email, password: account.password },
  });
  if (!res.ok()) throw new Error(`loginWithCookie(${account.email}) failed: ${res.status()}`);
}

// ---------------------------------------------------------------------------
// Browser-side consent state
// ---------------------------------------------------------------------------

export interface LocalConsent {
  enabled: string | null;
  owner: string | null;
  pending: Record<string, { enabled: boolean; token: string }> | null;
  parked: string | null;
}

export async function readLocalConsent(page: Page): Promise<LocalConsent> {
  return page.evaluate(
    ([pendingKey, parkedKey]) => {
      const raw = localStorage.getItem(pendingKey);
      return {
        enabled: localStorage.getItem('cc_analytics_enabled'),
        owner: localStorage.getItem('cc_analytics_consent_user'),
        pending: raw === null ? null : (JSON.parse(raw) as Record<string, { enabled: boolean; token: string }>),
        parked: sessionStorage.getItem(parkedKey),
      };
    },
    [PENDING_SYNC_KEY, PARKED_ANALYTICS_KEY] as const
  );
}

/** Park a signup analytics answer exactly as SignUpPage's `setPendingAnalyticsConsent` does. */
export async function parkSignupAnalyticsAnswer(page: Page, accepted: boolean): Promise<void> {
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [PARKED_ANALYTICS_KEY, accepted ? '1' : '0'] as const);
}

// ---------------------------------------------------------------------------
// Decoded PostHog events
// ---------------------------------------------------------------------------

export const nowSec = (): number => Date.now() / 1000;

/** posthog-js stamps `properties.$time` (epoch seconds, browser clock = this machine's) on every event. */
export function eventTimeSec(e: CapturedEvent): number {
  const t = Number(e.properties.$time);
  if (!Number.isFinite(t)) throw new Error(`event ${e.event} has no numeric properties.$time`);
  return t;
}

export function eventsSince(posthog: PosthogCapture, sinceSec: number, name?: string): CapturedEvent[] {
  return posthog.events.filter((e) => eventTimeSec(e) >= sinceSec && (!name || e.event === name));
}

export function waitForEventSince(
  posthog: PosthogCapture,
  name: string,
  sinceSec: number,
  opts: { timeoutMs?: number; predicate?: (e: CapturedEvent) => boolean } = {}
): Promise<CapturedEvent> {
  return posthog.waitForEvent(name, {
    timeoutMs: opts.timeoutMs ?? 20_000,
    predicate: (e) => eventTimeSec(e) >= sinceSec && (!opts.predicate || opts.predicate(e)),
  });
}

export function expectNoEventSince(posthog: PosthogCapture, name: string, sinceSec: number, settleMs = 5_000): Promise<void> {
  return posthog.expectNoEvent(name, { settleMs, predicate: (e) => eventTimeSec(e) >= sinceSec });
}

const IDENTIFIER_KEY_RE = /(^|_)id$/i;

/** Top-level `*_id` / `id` keys the anonymous pipeline must strip (SDK `$…` keys and `distinct_id` exempt). */
export function identifierKeys(props: Record<string, unknown>): string[] {
  return Object.keys(props).filter((k) => IDENTIFIER_KEY_RE.test(k) && !k.startsWith('$') && k !== 'distinct_id');
}

/** Every `path: needle` where a string anywhere in `value` contains a needle. */
export function findStrings(value: unknown, needles: string[], at = '$'): string[] {
  const wanted = needles.filter((n) => n.length > 0);
  const hits: string[] = [];
  const walk = (v: unknown, p: string, depth: number) => {
    if (depth > 20) return;
    if (typeof v === 'string') {
      for (const n of wanted) if (v.includes(n)) hits.push(`${p} contains ${JSON.stringify(n)}`);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`, depth + 1));
    } else if (v && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) walk(inner, `${p}.${k}`, depth + 1);
    }
  };
  walk(value, at, 0);
  return hits;
}

export interface Identity {
  userId: string;
  email: string;
  circleIds?: string[];
}

/** The email and its local part (createAccount also writes the local part as last_name). */
export function personNeedles(identity: Identity): string[] {
  return [identity.email, identity.email.replace(/@.*$/, '')];
}

/**
 * Assert every event is ANONYMOUS: not `$identify`, distinct id is not the
 * account, no top-level `*_id`, and no string anywhere (properties, $set,
 * $set_once) carries the user id, a circle id, the email or its local part.
 * Requires at least one event — an empty list is a failure, not a pass.
 */
export function expectAnonymousEvents(events: CapturedEvent[], identity: Identity, label: string): void {
  expect(events.length, `${label}: positive control — events were captured`).toBeGreaterThan(0);
  const needles = [identity.userId, ...(identity.circleIds ?? []), ...personNeedles(identity)];
  const problems: string[] = [];
  for (const e of events) {
    if (e.event === '$identify') problems.push('$identify was sent');
    if (e.distinctId === identity.userId) problems.push(`${e.event}: distinct_id is the account id`);
    const ids = identifierKeys(e.properties);
    if (ids.length > 0) problems.push(`${e.event}: identifier keys ${ids.join(', ')}`);
    problems.push(...findStrings(e, needles, e.event));
  }
  expect(problems, `${label}: every decoded event is anonymous`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Count RESPONSES (not requests) with `status` — an aborted request never counts. */
export function countResponses(page: Page, method: string, pathname: string, status = 200): { readonly count: number; dispose(): void } {
  const hits: Response[] = [];
  const on = (r: Response) => {
    try {
      if (r.request().method() === method && new URL(r.url()).pathname === pathname && r.status() === status) hits.push(r);
    } catch {
      /* unparsable url: not ours */
    }
  };
  page.on('response', on);
  return {
    get count() {
      return hits.length;
    },
    dispose() {
      page.off('response', on);
    },
  };
}

export interface HeldRead {
  /** True once the first matching GET is held and the server's answer to it has been fetched. */
  readonly fetched: boolean;
  readonly released: boolean;
  /** The server's JSON answer, fetched the moment the read was issued (so it is the PRE-change answer). */
  readonly json: unknown;
  waitForFetched(opts?: { timeoutMs?: number }): Promise<void>;
  /** Hand that (by now possibly stale) answer to the page and wait until the page has received it. */
  releaseAndWait(opts?: { timeoutMs?: number }): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Hold ONLY the first `GET <pathname>` the page issues from now on. Its answer
 * is fetched from the real backend immediately (the server's state at the time
 * of the read) but not delivered until `releaseAndWait`. Every later matching
 * request passes straight through, so pages that read the same endpoint still
 * render while the first read is held.
 *
 * Register it immediately before the action whose read must be first. On
 * `signIn`, the reconcile's `GET /users/me` is issued synchronously inside the
 * store action, before the session state is set and any query can mount.
 */
export async function holdFirstRead(page: Page, pathname: string): Promise<HeldRead> {
  let taken = false;
  let fetched = false;
  let released = false;
  let json: unknown;
  let held: Request | null = null;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const handler = async (route: Route) => {
    const req = route.request();
    if (taken || req.method() !== 'GET' || req.resourceType() === 'document') {
      await route.fallback();
      return;
    }
    taken = true;
    held = req;
    try {
      const response = await route.fetch();
      const text = await response.text();
      try {
        json = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        json = text;
      }
      fetched = true;
      await gate;
      await route.fulfill({ response, body: text });
    } catch {
      /* page closed while held */
    }
  };
  const filter = (url: URL) => url.pathname === pathname;
  await page.route(filter, handler);
  const until = async (cond: () => boolean, timeoutMs: number, what: string) => {
    const started = Date.now();
    while (!cond()) {
      if (Date.now() - started >= timeoutMs) throw new Error(`holdFirstRead GET ${pathname}: ${what} within ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return {
    get fetched() {
      return fetched;
    },
    get released() {
      return released;
    },
    get json() {
      return json;
    },
    async waitForFetched({ timeoutMs = 20_000 } = {}) {
      await until(() => fetched, timeoutMs, taken ? 'the held read was not answered by the backend' : 'no read was issued');
    },
    async releaseAndWait({ timeoutMs = 20_000 } = {}) {
      released = true;
      open();
      const req = held as Request | null;
      if (!req) throw new Error(`holdFirstRead GET ${pathname}: nothing was held`);
      const res = await Promise.race([
        req.response(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!res) throw new Error(`holdFirstRead GET ${pathname}: the page did not receive the released answer within ${timeoutMs}ms`);
    },
    async dispose() {
      released = true;
      open();
      await page.unroute(filter, handler).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export function consentSwitch(page: Page) {
  return page.getByRole('switch', { name: CONSENT_SWITCH_NAME });
}

/** Header account menu → a menu item (en common.json nav.profile / nav.help / header.logout). */
export async function openAccountMenuItem(page: Page, name: 'Profile' | 'Help & FAQ' | 'Sign out'): Promise<void> {
  // Retried as a unit: right after an SPA navigation the header re-renders and
  // an open menu's item can detach mid-click. Opens the menu only when the
  // item is not already showing, and the retry ends on the first click that lands.
  await expect(async () => {
    const item = page.getByRole('menuitem', { name, exact: true });
    if (!(await item.isVisible())) await page.getByRole('button', { name: 'Account', exact: true }).click();
    await item.click({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

/** Sign out through the account menu and its confirm dialog; waits for /login. */
export async function signOutViaMenu(page: Page): Promise<void> {
  await openAccountMenuItem(page, 'Sign out');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
}

/** Sign in through the real /login form (authStore.signIn path). */
export async function signInViaForm(page: Page, account: { email: string; password: string }): Promise<void> {
  // Same selectors as e2e/auth.setup.ts (the labels carry "(required)").
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

// ---------------------------------------------------------------------------
// Storage written by PostHog
// ---------------------------------------------------------------------------

/** Any storage key / cookie name posthog-js would use (`ph_<token>_posthog`, `__ph_opt_in_out_<token>`, …). */
export const POSTHOG_STORAGE_RE = /(^|_)ph_|posthog|__ph/i;
/** Keys this app itself writes to localStorage. */
export const APP_LOCAL_KEY_RE = /^(cc_|cc:|analytics_consent_pending_sync$)/;

/** Record localStorage/sessionStorage keys and document.cookie at document start (before any app/SDK script). */
export async function recordStorageAtDocumentStart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eStorageAtStart?: unknown };
    try {
      if (w.__e2eStorageAtStart) return;
      w.__e2eStorageAtStart = {
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
        cookie: document.cookie,
      };
    } catch {
      /* storage blocked: the snapshot stays undefined and readStorage reports null */
    }
  });
}

export interface StorageState {
  atStart: { local: string[]; session: string[]; cookie: string } | null;
  local: Record<string, string | null>;
  session: Record<string, string | null>;
  cookie: string;
}

export async function readStorage(page: Page): Promise<StorageState> {
  return page.evaluate(() => {
    const w = window as unknown as { __e2eStorageAtStart?: StorageState['atStart'] };
    return {
      atStart: w.__e2eStorageAtStart ?? null,
      local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
      session: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])),
      cookie: document.cookie,
    };
  });
}

export function cookieNames(cookie: string): string[] {
  return cookie
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter((n) => n.length > 0)
    .sort();
}
