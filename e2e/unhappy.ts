import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';
import {
  ALLOW_NONLOCAL_ENV,
  assertLocalDbTargets,
  nonLocalTargetAllowed,
  sqlExec,
  sqlRows,
  sqlStr,
} from './db';
import { ACCOUNT_DOMAIN, ACCOUNT_PASSWORD, ACCOUNT_PREFIX, adminFetch } from './isolation';
import { currentRunId } from './runId';

// ===========================================================================
// UNHAPPY-PATH HELPERS
// ===========================================================================
//
// Request observation / fault injection, database assertions, the local mail
// catcher, and PostHog capture. Every helper here is proven by
// `e2e/unhappy.proof.spec.ts` (or `e2e/consent/posthog.proof.consent.spec.ts`)
// against a real request, including the case where the thing does NOT happen.
//
// PATH PATTERNS (`PathPattern`) match the URL PATHNAME only (query ignored):
//   '/api/circles/:id/notes'   `:name` and `*` match exactly one segment
//   '/api/circles/**'          `**` matches any remainder (incl. nothing)
//   /^\/api\/circles\/[^/]+$/  a RegExp is tested against the pathname as-is
// Top-level document navigations are never matched, so '/api/…' patterns can't
// catch an SPA route of the same shape. Anchor patterns at `/api/`.
//
// ROUTING DISABLES THE HTTP CACHE for the page (a Playwright rule), so
// `failRequest` / `holdRequest` make that test's page loads slower. Only use
// them in the tests that need them.
// ===========================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*';
export type PathPattern = string | RegExp;

/** Compile a PathPattern into a pathname predicate. */
export function pathMatcher(pattern: PathPattern): (pathname: string) => boolean {
  if (pattern instanceof RegExp) return (p) => pattern.test(p);
  const re = new RegExp(
    '^' +
      pattern
        .split('/')
        .map((seg) => {
          if (seg === '**') return '.*';
          if (seg === '*' || seg.startsWith(':')) return '[^/]+';
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/')
        // `/a/**` must also match `/a`.
        .replace(/\/\.\*$/, '(?:/.*)?') +
      '$'
  );
  return (p) => re.test(p);
}

function requestMatches(req: Request, method: HttpMethod, match: (p: string) => boolean): boolean {
  if (method !== '*' && req.method() !== method) return false;
  if (req.resourceType() === 'document') return false;
  try {
    return match(new URL(req.url()).pathname);
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// countRequests
// ---------------------------------------------------------------------------

export interface RequestCounter {
  /** Matching requests the page has SENT so far (fulfilled/aborted by a route still count). */
  readonly count: number;
  readonly requests: Request[];
  /**
   * Wait for the UI to settle, then assert the exact count. "Settled" = at least
   * `settleMs` (default 1000) with no new matching request. Waits up to
   * `timeoutMs` (default 15000) for the count to reach `expected` first, so a
   * slow first request is not a false failure. Fails on too few AND too many.
   */
  expectCount(
    expected: number,
    opts?: { settleMs?: number; timeoutMs?: number; message?: string }
  ): Promise<void>;
  /** Stop counting. Automatic when the page closes. */
  dispose(): void;
}

/**
 * Live counter of matching requests, e.g. to prove a double click sent ONE
 * POST: `const posts = countRequests(page, 'POST', '/api/circles/:id/care-notes');`
 * … click twice … `await posts.expectCount(1);`
 *
 * Start it BEFORE the action. Counts requests the browser issued, so a request
 * `failRequest` answers or `holdRequest` holds is still one request.
 */
export function countRequests(page: Page, method: HttpMethod, pattern: PathPattern): RequestCounter {
  const match = pathMatcher(pattern);
  const requests: Request[] = [];
  let lastAt = Date.now();
  const onRequest = (req: Request) => {
    if (!requestMatches(req, method, match)) return;
    requests.push(req);
    lastAt = Date.now();
  };
  page.on('request', onRequest);
  const label = `${method} ${String(pattern)}`;
  return {
    get count() {
      return requests.length;
    },
    requests,
    async expectCount(expected, opts = {}) {
      const settleMs = opts.settleMs ?? 1_000;
      const timeoutMs = opts.timeoutMs ?? 15_000;
      const started = Date.now();
      // Never let a request issued just BEFORE this call count as "quiet".
      lastAt = Math.max(lastAt, started);
      while (Date.now() - started < timeoutMs + settleMs) {
        const quiet = Date.now() - lastAt >= settleMs;
        if (requests.length > expected) break;
        if (requests.length === expected && quiet) break;
        if (requests.length < expected && Date.now() - started >= timeoutMs) break;
        await sleep(50);
      }
      expect(
        requests.length,
        opts.message ??
          `${label}: expected exactly ${expected} request(s); saw ${requests.length}: ` +
            requests.map((r) => `${r.method()} ${new URL(r.url()).pathname}`).join(', ')
      ).toBe(expected);
    },
    dispose() {
      page.off('request', onRequest);
    },
  };
}

// ---------------------------------------------------------------------------
// Backend error bodies
// ---------------------------------------------------------------------------

/**
 * The backend's error envelope: `{ success: false, error: { code, message, details? } }`
 * (every route; the webapp reads `err.error.code`). Presets copy real messages
 * from backend/src so copy that keys on them renders what production would.
 */
export const API_ERRORS = {
  /** AI chat / suggestions on a free owner's circle (routes/ai.ts:2743-2753). */
  aiSubscriptionRequired: { status: 402, code: 'SUBSCRIPTION_REQUIRED', message: 'Upgrade to use the AI assistant' },
  /** Create circle on the free tier (routes/circles.ts:438-447). */
  circleSubscriptionRequired: { status: 402, code: 'SUBSCRIPTION_REQUIRED', message: 'Upgrade to create more circles' },
  /** Write to a frozen circle (middleware/circleAccess.ts:70-88). */
  writeSubscriptionRequired: {
    status: 403,
    code: 'SUBSCRIPTION_REQUIRED',
    message:
      'This circle requires an active subscription. Only the owner and care recipient can make changes.',
    details: { accessLevel: 'view', isPremiumCircle: false, reason: 'Subscription required' },
  },
  /** Write by a view-only seat (middleware/circleAccess.ts:59-67). */
  viewOnly: { status: 403, code: 'VIEW_ONLY', message: 'View-only members cannot perform this action' },
  /** Access read failed (utils/accessUnavailable.ts). */
  serviceUnavailable: {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Could not verify your access right now. Please try again.',
  },
  serverError: { status: 500, code: 'SERVER_ERROR', message: 'Internal server error' },
  /** Upstream deadline (server.ts error handler). */
  upstreamTimeout: { status: 504, code: 'UPSTREAM_TIMEOUT', message: 'The request took too long. Please try again.' },
  /** express-rate-limit (middleware/rateLimit.ts). */
  rateLimit: { status: 429, code: 'RATE_LIMIT', message: 'Too many authentication attempts, please try again later' },
  /** validateBody (middleware/validation.ts). */
  validation: { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid request data' },
  notFound: { status: 404, code: 'NOT_FOUND', message: 'Not found' },
} as const;

const DEFAULT_CODE: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  402: 'SUBSCRIPTION_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMIT',
  500: 'SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
  504: 'UPSTREAM_TIMEOUT',
};

export interface FaultOptions {
  /** HTTP status (default 500). */
  status?: number;
  /** `error.code` (default derived from status, e.g. 402 → SUBSCRIPTION_REQUIRED). */
  code?: string;
  /** `error.message` (default "Injected <status> by e2e"). */
  message?: string;
  /** `error.details`, when set. */
  details?: unknown;
  /** Replace the WHOLE body (object → JSON, string → raw). Overrides code/message/details. */
  body?: unknown;
  /** Extra response headers (e.g. `{ 'retry-after': '60' }` for a 429). */
  headers?: Record<string, string>;
  /** Abort at the network layer instead of answering (`true` = 'failed'). */
  abort?: boolean | 'failed' | 'aborted' | 'timedout' | 'connectionrefused' | 'connectionreset' | 'internetdisconnected';
  /** Delay before answering/aborting, in ms. */
  delayMs?: number;
}

/** Answer (or abort) a route with a backend-shaped error. */
export async function fulfillFault(route: Route, opts: FaultOptions = {}): Promise<void> {
  if (opts.delayMs) await sleep(opts.delayMs);
  if (opts.abort) {
    await route.abort(opts.abort === true ? 'failed' : opts.abort);
    return;
  }
  const status = opts.status ?? 500;
  const body =
    opts.body !== undefined
      ? opts.body
      : {
          success: false,
          error: {
            code: opts.code ?? DEFAULT_CODE[status] ?? 'ERROR',
            message: opts.message ?? `Injected ${status} by e2e`,
            ...(opts.details !== undefined ? { details: opts.details } : {}),
          },
        };
  await route.fulfill({
    status,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// failRequest
// ---------------------------------------------------------------------------

export interface FaultHandle {
  /** Requests answered with the fault so far. */
  readonly hits: number;
  /** Faults left before requests pass through again. */
  readonly remaining: number;
  readonly requests: Request[];
  /** Wait (default 10s) until exactly `n` faults were served, then assert it. */
  expectHits(n: number, opts?: { timeoutMs?: number }): Promise<void>;
  /** Unregister; later requests reach the backend. */
  dispose(): Promise<void>;
}

/**
 * Inject a backend error (or a network abort) into the next `times` (default 1)
 * matching requests, then let the rest through untouched.
 *
 *   await failRequest(page, 'POST', '/api/circles/:id/care-notes', API_ERRORS.viewOnly);
 *   await failRequest(page, 'GET', '/api/circles/:id', { status: 503, times: 2 });
 *   await failRequest(page, 'POST', '/api/auth/login', { abort: true });
 *
 * Register BEFORE the action. Non-matching requests `fallback()` to any other
 * route, so helpers compose. The request never reaches the backend, so nothing
 * is written.
 */
export async function failRequest(
  page: Page,
  method: HttpMethod,
  pattern: PathPattern,
  opts: FaultOptions & { times?: number } = {}
): Promise<FaultHandle> {
  const match = pathMatcher(pattern);
  let remaining = opts.times ?? 1;
  const requests: Request[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    if (remaining <= 0 || !requestMatches(req, method, match)) {
      await route.fallback();
      return;
    }
    remaining -= 1;
    requests.push(req);
    await fulfillFault(route, opts).catch(() => undefined);
  };
  const urlFilter = (url: URL) => match(url.pathname);
  await page.route(urlFilter, handler);
  return {
    get hits() {
      return requests.length;
    },
    get remaining() {
      return remaining;
    },
    requests,
    async expectHits(n, { timeoutMs = 10_000 } = {}) {
      const started = Date.now();
      while (requests.length < n && Date.now() - started < timeoutMs) await sleep(50);
      expect(requests.length, `${method} ${String(pattern)}: injected faults served`).toBe(n);
    },
    async dispose() {
      await page.unroute(urlFilter, handler).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// holdRequest
// ---------------------------------------------------------------------------

export interface HoldHandle {
  /** Requests currently held (or held and since released). */
  readonly requests: Request[];
  /** Resolve once `n` (default 1) matching requests are being held. Rejects after `timeoutMs` (default 10s). */
  waitForHeld(n?: number, opts?: { timeoutMs?: number }): Promise<Request>;
  /** Let every held request (and all later ones) through to the backend. */
  release(): Promise<void>;
  /** Answer every held request (and later ones) with a fault instead. */
  releaseWith(fault: FaultOptions): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Keep matching requests PENDING until the test releases them — the tool for
 * double-click-while-pending tests:
 *
 *   const hold = await holdRequest(page, 'POST', '/api/circles/:id/care-notes');
 *   const posts = countRequests(page, 'POST', '/api/circles/:id/care-notes');
 *   await save.click();
 *   await hold.waitForHeld();
 *   await expect(save).toBeDisabled();     // the guard, while in flight
 *   await save.click({ force: true });
 *   await hold.release();
 *   await posts.expectCount(1);
 *
 * Holds EVERY matching request until released (after release, matching
 * requests pass straight through).
 */
export async function holdRequest(
  page: Page,
  method: HttpMethod,
  pattern: PathPattern
): Promise<HoldHandle> {
  const match = pathMatcher(pattern);
  const requests: Request[] = [];
  let outcome: { kind: 'continue' } | { kind: 'fault'; fault: FaultOptions } | null = null;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const handler = async (route: Route) => {
    const req = route.request();
    if (!requestMatches(req, method, match)) {
      await route.fallback();
      return;
    }
    if (outcome === null) {
      requests.push(req);
      await gate;
    }
    try {
      if (outcome?.kind === 'fault') await fulfillFault(route, outcome.fault);
      else await route.fallback();
    } catch {
      /* page closed while held */
    }
  };
  const urlFilter = (url: URL) => match(url.pathname);
  await page.route(urlFilter, handler);
  return {
    requests,
    async waitForHeld(n = 1, { timeoutMs = 10_000 } = {}) {
      const started = Date.now();
      while (requests.length < n) {
        if (Date.now() - started >= timeoutMs) {
          throw new Error(
            `holdRequest ${method} ${String(pattern)}: expected ${n} held request(s) within ${timeoutMs}ms, saw ${requests.length}`
          );
        }
        await sleep(25);
      }
      return requests[n - 1];
    },
    async release() {
      outcome = { kind: 'continue' };
      open();
    },
    async releaseWith(fault) {
      outcome = { kind: 'fault', fault };
      open();
    },
    async dispose() {
      if (outcome === null) {
        outcome = { kind: 'continue' };
        open();
      }
      await page.unroute(urlFilter, handler).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/**
 * Run a SELECT against the local database and get typed rows. Behind the
 * local-only guard (db.ts). The query is wrapped as a subquery, so it must be a
 * single SELECT (no trailing semicolon). Quote literals with `sqlStr`.
 */
export function dbQuery<T = Record<string, unknown>>(sql: string): T[] {
  assertLocalDbTargets('dbQuery');
  return sqlRows<T>(sql);
}

/** `select count(*)` over a SELECT: `dbCount(\`select 1 from care_notes where circle_id = ${sqlStr(id)}\`)`. */
export function dbCount(sql: string): number {
  assertLocalDbTargets('dbCount');
  return sqlRows<{ n: number }>(`select count(*)::int as n from (${sql}) q`)[0].n;
}

export { sqlStr };

// ---------------------------------------------------------------------------
// Authenticated API calls outside the browser session
// ---------------------------------------------------------------------------

export interface ApiSession {
  token: string;
  get(path: string): Promise<APIResponse>;
  post(path: string, data?: unknown): Promise<APIResponse>;
  put(path: string, data?: unknown): Promise<APIResponse>;
  patch(path: string, data?: unknown): Promise<APIResponse>;
  delete(path: string): Promise<APIResponse>;
}

/**
 * Log in through the backend in BODY mode (no cookie) and return a Bearer-token
 * client. Use the `request` fixture, NOT `page.request`: `page.request` shares
 * the browser's cookie jar, and a cookie-mode login there would replace the
 * page's own refresh cookie.
 */
export async function apiSession(
  request: APIRequestContext,
  account: { email: string; password: string }
): Promise<ApiSession> {
  const login = await request.post('/api/auth/login', {
    data: { email: account.email, password: account.password },
  });
  if (!login.ok()) {
    throw new Error(`apiSession: login failed for ${account.email}: ${login.status()} ${await login.text()}`);
  }
  const token = ((await login.json()) as { data?: { session?: { access_token?: string } } })?.data?.session
    ?.access_token;
  if (!token) throw new Error(`apiSession: no access_token in the login response for ${account.email}`);
  const headers = { Authorization: `Bearer ${token}` };
  return {
    token,
    get: (p) => request.get(p, { headers }),
    post: (p, data) => request.post(p, { headers, data }),
    put: (p, data) => request.put(p, { headers, data }),
    patch: (p, data) => request.patch(p, { headers, data }),
    delete: (p) => request.delete(p, { headers }),
  };
}

/** `body.error.code` of a response, or undefined. */
export async function errorCodeOf(res: APIResponse): Promise<string | undefined> {
  try {
    return ((await res.json()) as { error?: { code?: string } })?.error?.code;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Mail (local Mailpit) and signup OTPs
// ---------------------------------------------------------------------------

/** Mailpit (the local Supabase mail catcher; config key `[inbucket]`, port 55324). */
export const MAILPIT_URL = process.env.PW_MAILPIT_URL ?? 'http://127.0.0.1:55324';

function assertLocalMailpit(): void {
  const host = new URL(MAILPIT_URL).hostname;
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) || nonLocalTargetAllowed()) return;
  throw new Error(`[e2e local-only guard] PW_MAILPIT_URL host "${host}" is not local (set ${ALLOW_NONLOCAL_ENV}=1 to override)`);
}

async function mailpit(method: string, route: string, body?: unknown): Promise<unknown> {
  assertLocalMailpit();
  const res = await fetch(`${MAILPIT_URL}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Mailpit ${method} ${route} -> ${res.status}`);
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

interface MailpitSummary {
  ID: string;
  Created: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

/**
 * Read the newest 6-digit code mailed to `email` from Mailpit, polling up to
 * `timeoutMs` (default 20s). `since` ignores older messages (pass the time just
 * before the action that sends the mail).
 *
 * CURRENT LOCAL STACK: GoTrue's send_email HOOK is enabled
 * (backend/supabase/config.toml `[auth.hook.send_email]`, pointing at
 * http://host.docker.internal:3001/api/auth/send-email-hook). With the hook on,
 * auth mail never reaches Mailpit — it goes to whatever backend listens on
 * :3001 (Resend), and with nothing there GoTrue refuses the signup
 * (`422 hook_timeout_after_retry`, backend answers 400 SIGNUP_FAILED). So this
 * reader only sees mail when the hook is disabled for the local stack. For a
 * verification code that works either way, use `generateSignupOtp`.
 */
export async function readVerificationCode(
  email: string,
  opts: { timeoutMs?: number; since?: Date; pattern?: RegExp } = {}
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const pattern = opts.pattern ?? /\b(\d{6})\b/;
  const started = Date.now();
  const wanted = email.toLowerCase();
  for (;;) {
    const result = (await mailpit(
      'GET',
      `/api/v1/search?query=${encodeURIComponent(`to:"${wanted}"`)}&limit=20`
    )) as { messages?: MailpitSummary[] };
    const candidates = (result.messages ?? [])
      .filter((m) => m.To.some((t) => t.Address.toLowerCase() === wanted))
      .filter((m) => !opts.since || new Date(m.Created).getTime() >= opts.since.getTime())
      .sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
    for (const summary of candidates) {
      const msg = (await mailpit('GET', `/api/v1/message/${summary.ID}`)) as { Text?: string; HTML?: string };
      const text = `${msg.Text ?? ''}\n${(msg.HTML ?? '').replace(/<[^>]+>/g, ' ')}`;
      const found = pattern.exec(text);
      if (found) return found[1] ?? found[0];
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        `readVerificationCode: no message with a code to ${email} in Mailpit (${MAILPIT_URL}) after ` +
          `${timeoutMs}ms (${candidates.length} candidate message(s)). If GoTrue's send_email hook is ` +
          `enabled for the local stack, auth mail never reaches Mailpit — use generateSignupOtp().`
      );
    }
    await sleep(500);
  }
}

/** Drop a message into Mailpit directly (its HTTP send API). For proving readers, not the product. */
export async function sendMailpitMessage(to: string, subject: string, text: string): Promise<string> {
  const res = (await mailpit('POST', '/api/v1/send', {
    From: { Email: `noreply@${ACCOUNT_DOMAIN}` },
    To: [{ Email: to }],
    Subject: subject,
    Text: text,
    HTML: `<p>${text}</p>`,
  })) as { ID: string };
  return res.ID;
}

/** Delete every Mailpit message addressed to this run's accounts. Best-effort. */
export async function purgeRunMail(runId: string = currentRunId()): Promise<number> {
  const prefix = `${ACCOUNT_PREFIX}${runId}-`;
  const result = (await mailpit('GET', `/api/v1/search?query=${encodeURIComponent(`to:${prefix}`)}&limit=500`)) as {
    messages?: MailpitSummary[];
  };
  const ids = (result.messages ?? [])
    .filter((m) => m.To.some((t) => t.Address.toLowerCase().startsWith(prefix)))
    .map((m) => m.ID);
  if (ids.length > 0) await mailpit('DELETE', '/api/v1/messages', { IDs: ids });
  return ids.length;
}

function assertRunScoped(email: string): void {
  const prefix = `${ACCOUNT_PREFIX}${currentRunId()}-`;
  if (!email.toLowerCase().startsWith(prefix) || !email.toLowerCase().endsWith(`@${ACCOUNT_DOMAIN}`)) {
    throw new Error(
      `${email} is not run-scoped (${prefix}…@${ACCOUNT_DOMAIN}); build it with runScopedEmail() so teardown purges it.`
    );
  }
}

/**
 * The signup verification code for `email`, WITHOUT sending mail: GoTrue's admin
 * `generate_link` (type 'signup') creates the unconfirmed user if absent (with
 * `password`) and returns the OTP that `POST /api/auth/verify-otp` accepts
 * (it calls `verifyOtp({ type: 'signup' })`, routes/auth.ts:278-285). Does not
 * invoke the send_email hook. Minting again replaces the previous code.
 *
 * `email` must be run-scoped (`runScopedEmail('signup-…')`) so teardown
 * removes the user.
 *
 * NO REAL MAIL: a successful verify-otp calls `sendWelcomeOnce`
 * (routes/auth.ts:334-340), which sends through Resend when the backend has a
 * key — and `.test` is not on its blocklist. So this pre-claims the welcome
 * (`users.welcome_email_sent = true`, the claim `sendWelcomeOnce` makes before
 * sending, services/welcomeService.ts:105-110) and opts the user out of
 * marketing mail. Pass `{ keepWelcomeUnsent: true }` only to test that claim.
 */
export async function generateSignupOtp(
  email: string,
  password: string = ACCOUNT_PASSWORD,
  opts: { keepWelcomeUnsent?: boolean } = {}
): Promise<string> {
  assertRunScoped(email);
  const res = await adminFetch('POST', '/auth/v1/admin/generate_link', { type: 'signup', email, password });
  const otp = (res.json as { email_otp?: string } | null)?.email_otp;
  if (res.status >= 300 || !otp) {
    throw new Error(`generateSignupOtp(${email}) failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`);
  }
  if (!opts.keepWelcomeUnsent) {
    // The on_auth_user_created trigger mirrors the row in the same transaction.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const n = sqlRows<{ n: number }>(
        `select count(*)::int as n from public.users where email = ${sqlStr(email.toLowerCase())}`
      )[0].n;
      if (n > 0) break;
      await sleep(100);
    }
    sqlExec(
      `update public.users set welcome_email_sent = true, marketing_email_opt_out = true,
              email_digest_enabled = false
        where email = ${sqlStr(email.toLowerCase())};`
    );
  }
  return otp;
}

// ---------------------------------------------------------------------------
// PostHog capture
// ---------------------------------------------------------------------------

/** Every PostHog host posthog-js can reach (api `us.i.posthog.com`, assets `us-assets.i.posthog.com`, …). */
export const POSTHOG_URL_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*posthog\.com(?::\d+)?(?:[/?#]|$)/i;

/** The ONLY PostHog key an e2e server may carry: the consent server's fake one. */
export const POSTHOG_E2E_FAKE_KEY = 'phc_e2e_fake';

/** The Playwright project that runs `*.consent.spec.ts` against the consent server. */
export const CONSENT_PROJECT_NAME = 'consent';

/** Base URL of the consent Vite server (`VITE_POSTHOG_KEY=phc_e2e_fake`). Required by the consent project. */
export const CONSENT_BASE_URL_ENV = 'PW_CONSENT_BASE_URL';

/**
 * The `VITE_POSTHOG_KEY` a Vite DEV server is actually serving, read from its
 * transformed `src/lib/env.ts` (`import.meta.env = {…"VITE_POSTHOG_KEY": "…"…}`).
 * `''` = no key (analytics off). Throws when the server cannot be read — the
 * caller cannot vouch for a server it cannot see.
 */
export async function servedPosthogKey(baseURL: string): Promise<string> {
  const url = new URL('/src/lib/env.ts', baseURL).toString();
  let text: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    throw new Error(
      `[e2e analytics guard] cannot read ${url} to verify the served VITE_POSTHOG_KEY ` +
        `(${err instanceof Error ? err.message : String(err)}). Is the Vite dev server up at ${baseURL}?`
    );
  }
  const m = /"VITE_POSTHOG_KEY":\s*"([^"]*)"/.exec(text);
  if (!m) {
    // Absent from import.meta.env entirely = never defined = no key.
    if (/import\.meta\.env\s*=\s*\{/.test(text)) return '';
    throw new Error(`[e2e analytics guard] ${url} is not a Vite dev module; cannot verify the analytics key.`);
  }
  return m[1];
}

export interface CapturedEvent {
  event: string;
  /** `properties.distinct_id` — the user id after `$identify` in full mode, a random id otherwise. */
  distinctId: string | undefined;
  properties: Record<string, unknown>;
  /** `$set` / `$set_once` when present. */
  set?: unknown;
  setOnce?: unknown;
  uuid?: string;
  timestamp?: string;
  /** The endpoint path it was posted to, and the compression it arrived with. */
  endpoint: string;
  compression: string;
}

export interface InterceptedPosthogRequest {
  url: string;
  method: string;
  kind: 'capture' | 'flags' | 'asset' | 'other';
  compression: string;
  events: number;
  decodeError?: string;
}

export interface PosthogCapture {
  readonly events: CapturedEvent[];
  readonly requests: InterceptedPosthogRequest[];
  /** Events named `name` (all events when omitted). */
  captures(name?: string): CapturedEvent[];
  /** `$identify` events. */
  identifies(): CapturedEvent[];
  /** Resolve with the first matching event (already captured or arriving within `timeoutMs`, default 15s). */
  waitForEvent(name: string, opts?: { timeoutMs?: number; predicate?: (e: CapturedEvent) => boolean }): Promise<CapturedEvent>;
  /** Wait `settleMs` (default 5000 — posthog batches every ~3s) and assert no `name` event arrived. */
  expectNoEvent(name: string, opts?: { settleMs?: number; predicate?: (e: CapturedEvent) => boolean }): Promise<void>;
  clear(): void;
  dispose(): Promise<void>;
}

const POSTHOG_DIST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  'posthog-js',
  'dist'
);

/** Decode one posthog-js request body: gzip (`compression=gzip-js`), base64 form (`data=`), or JSON. */
export function decodePosthogBody(url: string, body: Buffer | null): { compression: string; payload: unknown } {
  const compression = new URL(url).searchParams.get('compression') ?? '';
  if (!body || body.length === 0) return { compression, payload: null };
  let text =
    compression.startsWith('gzip') || (body[0] === 0x1f && body[1] === 0x8b)
      ? zlib.gunzipSync(body).toString('utf8')
      : body.toString('utf8');
  if (text.startsWith('data=')) {
    const data = new URLSearchParams(text).get('data') ?? '';
    text = /^\s*[[{]/.test(data) ? data : Buffer.from(data, 'base64').toString('utf8');
  }
  return { compression: compression || 'none', payload: JSON.parse(text) };
}

function toEvents(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === 'object') {
    const batch = (payload as { batch?: unknown }).batch;
    if (Array.isArray(batch)) return batch as Array<Record<string, unknown>>;
    if ('event' in (payload as object)) return [payload as Record<string, unknown>];
  }
  return [];
}

/**
 * Intercept ALL PostHog traffic for the page's context and decode it. Nothing
 * is ever sent to posthog.com: capture endpoints get `{status:1}`, `/flags`
 * gets an empty flag set, lazy SDK assets are served from the local
 * `node_modules/posthog-js/dist`, anything else gets an empty 200.
 *
 * Only meaningful on the CONSENT server (Vite with `VITE_POSTHOG_KEY=phc_e2e_fake`,
 * see e2e/consent.ts); the main suite's Vite has no key and loads no SDK.
 * Register BEFORE the first navigation.
 *
 * BOT FILTER. posthog-js DROPS every capture from a browser it classifies as a
 * bot (`capture()` returns undefined; nothing is queued): `_is_bot()` in the
 * installed 1.386.6 dist tests the UA and `navigator.userAgentData.brands`
 * against a list that includes "headlesschrome", then `navigator.webdriver`.
 * Headless Playwright trips both, so without intervention NO event is ever
 * sent — which would make every "no event" assertion vacuous. This installs an
 * init script (for the context's future documents) that masks exactly those
 * three signals. Nothing else about the browser changes.
 */
export async function posthogCapture(page: Page): Promise<PosthogCapture> {
  const context = page.context();
  const events: CapturedEvent[] = [];
  const requests: InterceptedPosthogRequest[] = [];

  await context.addInitScript(() => {
    try {
      const nav = Navigator.prototype;
      Object.defineProperty(nav, 'webdriver', { get: () => false, configurable: true });
      const ua = navigator.userAgent.replace(/HeadlessChrome/g, 'Chrome');
      Object.defineProperty(nav, 'userAgent', { get: () => ua, configurable: true });
      const data = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string; version: string }> } })
        .userAgentData;
      if (data) {
        const brands = (data.brands ?? []).map((b) => ({ ...b, brand: b.brand.replace(/HeadlessChrome/g, 'Google Chrome') }));
        const masked = Object.create(Object.getPrototypeOf(data) as object, {
          brands: { get: () => brands },
          mobile: { get: () => (data as { mobile?: boolean }).mobile ?? false },
          platform: { get: () => (data as { platform?: string }).platform ?? '' },
        });
        Object.defineProperty(nav, 'userAgentData', { get: () => masked, configurable: true });
      }
    } catch {
      /* best-effort; waitForEvent reports if the SDK still drops events */
    }
  });

  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    try {
      if (/\/(flags|decide)\/?$/.test(p)) {
        requests.push({ url: req.url(), method: req.method(), kind: 'flags', compression: '', events: 0 });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ featureFlags: {}, featureFlagPayloads: {}, flags: {}, errorsWhileComputingFlags: false }),
        });
        return;
      }
      if (req.method() === 'POST' && /\/(e|i\/v0\/e|batch|capture|engage|track)\/?$/.test(p)) {
        const entry: InterceptedPosthogRequest = { url: req.url(), method: 'POST', kind: 'capture', compression: '', events: 0 };
        try {
          const { compression, payload } = decodePosthogBody(req.url(), req.postDataBuffer());
          entry.compression = compression;
          for (const e of toEvents(payload)) {
            const props = (e.properties ?? {}) as Record<string, unknown>;
            events.push({
              event: String(e.event),
              distinctId: (props.distinct_id ?? e.distinct_id) as string | undefined,
              properties: props,
              set: e.$set ?? props.$set,
              setOnce: e.$set_once ?? props.$set_once,
              uuid: e.uuid as string | undefined,
              timestamp: e.timestamp as string | undefined,
              endpoint: p,
              compression,
            });
            entry.events += 1;
          }
        } catch (err) {
          entry.decodeError = err instanceof Error ? err.message : String(err);
        }
        requests.push(entry);
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
        return;
      }
      const asset = path.join(POSTHOG_DIST, path.basename(p));
      if (/\.js$/.test(p) && asset.startsWith(POSTHOG_DIST) && fs.existsSync(asset)) {
        requests.push({ url: req.url(), method: req.method(), kind: 'asset', compression: '', events: 0 });
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(asset) });
        return;
      }
      requests.push({ url: req.url(), method: req.method(), kind: 'other', compression: '', events: 0 });
      await route.fulfill({
        status: 200,
        contentType: /\.js$/.test(p) ? 'application/javascript' : 'application/json',
        body: /\.js$/.test(p) ? '' : '{}',
      });
    } catch {
      /* context closed */
    }
  };
  await context.route(POSTHOG_URL_RE, handler);

  const find = (name: string, predicate?: (e: CapturedEvent) => boolean) =>
    events.find((e) => e.event === name && (!predicate || predicate(e)));

  return {
    events,
    requests,
    captures: (name) => (name ? events.filter((e) => e.event === name) : [...events]),
    identifies: () => events.filter((e) => e.event === '$identify'),
    async waitForEvent(name, { timeoutMs = 15_000, predicate } = {}) {
      const started = Date.now();
      for (;;) {
        const hit = find(name, predicate);
        if (hit) return hit;
        if (Date.now() - started >= timeoutMs) {
          throw new Error(
            `posthogCapture: no "${name}" event within ${timeoutMs}ms. Captured: ` +
              `[${events.map((e) => e.event).join(', ')}]; requests: ${requests.length}` +
              (requests.some((r) => r.decodeError) ? ` (decode errors: ${requests.filter((r) => r.decodeError).map((r) => r.decodeError).join('; ')})` : '')
          );
        }
        await sleep(100);
      }
    },
    async expectNoEvent(name, { settleMs = 5_000, predicate } = {}) {
      await sleep(settleMs);
      const hit = find(name, predicate);
      expect(hit, `posthogCapture: unexpected "${name}" event: ${JSON.stringify(hit?.properties ?? {}).slice(0, 300)}`).toBeUndefined();
    },
    clear() {
      events.length = 0;
      requests.length = 0;
    },
    async dispose() {
      await context.unroute(POSTHOG_URL_RE, handler).catch(() => undefined);
    },
  };
}
