import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';
import { assertLocalDbTargets, sqlExec } from '../../db';
import { ACCOUNT_PASSWORD, SUPABASE_URL, adminFetch, createAccount, runScopedEmail } from '../../isolation';
import {
  apiSession,
  dbCount,
  dbQuery,
  pathMatcher,
  sqlStr,
  type ApiSession,
  type HttpMethod,
  type PathPattern,
} from '../../unhappy';

// ===========================================================================
// Helpers for the auth + invite unhappy-path specs in this folder only.
// Everything that creates an account uses `runScopedEmail`, so the run's
// globalTeardown purges it (and the circles it owns).
// ===========================================================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The storage keys the auth pages park across redirects (src/lib/pending*.ts). */
export const PARKED = {
  terms: 'cc_pending_terms_consent',
  analytics: 'cc_pending_analytics_consent',
  authMethod: 'cc_pending_auth_method',
  invite: 'cc_pending_invite_code',
} as const;

/** The durable analytics-consent record (src/lib/analyticsConsent.ts, analyticsConsentSync.ts). */
export const CONSENT_LOCAL_KEYS = [
  'cc_analytics_enabled',
  'cc_analytics_consent_user',
  'analytics_consent_pending_sync',
] as const;

/**
 * Where GoTrue's send_email hook points on the local stack
 * (backend/supabase/config.toml `[auth.hook.send_email]`:
 * http://host.docker.internal:3001/api/auth/send-email-hook — this machine's :3001).
 */
export const SEND_EMAIL_HOOK_PORT = 3001;

function portListening(host: string, port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * PRECONDITION for every test that makes GoTrue send auth mail for real (a real
 * signup, forgot-password, resend). Those tests are written for the stack with
 * NOTHING behind the hook: GoTrue times out on it, signup answers 400
 * SIGNUP_FAILED, no mail leaves the machine. If something listens on :3001 the
 * hook reaches it — a dev backend sends through Resend, so REAL mail could go
 * out, and the tests' expected outcomes stop meaning what they say. Fails the
 * test loudly instead (a TCP connect only; nothing is sent).
 */
export async function assertSendEmailHookUnreachable(): Promise<void> {
  const hosts = ['127.0.0.1', '::1'];
  const listening = (
    await Promise.all(hosts.map(async (h) => ((await portListening(h, SEND_EMAIL_HOOK_PORT)) ? h : null)))
  ).filter((h): h is string => h !== null);
  if (listening.length > 0) {
    throw new Error(
      `[e2e precondition] something is listening on :${SEND_EMAIL_HOOK_PORT} (${listening.join(', ')}). GoTrue's ` +
        `send_email hook (backend/supabase/config.toml, host.docker.internal:${SEND_EMAIL_HOOK_PORT}) would reach it: ` +
        `REAL auth mail could be sent, and this test assumes the hook is unreachable. Stop that server, or run ` +
        `this spec when nothing is on :${SEND_EMAIL_HOOK_PORT} (e2e/README.md, "Mail and signup").`
    );
  }
}

/** A lowercase, run-unique label valid for `runScopedEmail`. */
export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface ScopedAccount {
  email: string;
  password: string;
  userId: string;
}

/** A confirmed, run-scoped account with no circles. */
export async function createScopedAccount(prefix: string): Promise<ScopedAccount> {
  const email = runScopedEmail(uniq(prefix));
  await createAccount(email, 'premium');
  return { email, password: ACCOUNT_PASSWORD, userId: authUser(email).id };
}

/** Cookie-mode login for `context` (what fixtures.ts does for the worker account). */
export async function cookieLogin(
  context: BrowserContext,
  account: { email: string; password: string },
  baseURL: string | undefined
): Promise<void> {
  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const res = await context.request.post('/api/auth/login', {
    headers: { 'X-Session-Mode': 'cookie', Origin: origin },
    data: { email: account.email, password: account.password },
  });
  if (!res.ok()) throw new Error(`cookieLogin ${account.email}: ${res.status()} ${await res.text()}`);
}

/** True when the context holds the backend's httpOnly refresh cookie. */
export async function hasRefreshCookie(context: BrowserContext): Promise<boolean> {
  return (await context.cookies()).some((c) => c.name === 'cc_refresh' && c.value.length > 0);
}

/**
 * Put React Router location STATE on a route the way `navigate(path, { state })`
 * does (history.state = { usr, key, idx }), then reload so the app boots with it.
 * The URL never carries the state.
 */
export async function gotoWithRouterState(page: Page, route: string, state: unknown): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.evaluate((usr) => window.history.replaceState({ usr, key: 'e2e', idx: 0 }, ''), state);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

export async function sessionItems(page: Page, keys: readonly string[]): Promise<Record<string, string | null>> {
  return page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, sessionStorage.getItem(k)])), [...keys]);
}

export async function localItems(page: Page, keys: readonly string[]): Promise<Record<string, string | null>> {
  return page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), [...keys]);
}

/** Type a 6-digit code into the OtpInput (six boxes, auto-advance). */
export async function typeOtp(page: Page, code: string): Promise<void> {
  await page.getByLabel('Digit 1 of 6').click();
  await page.keyboard.type(code, { delay: 20 });
}

// ---------------------------------------------------------------------------
// Response stubs / rewrites (counted)
// ---------------------------------------------------------------------------

export interface StubHandle {
  readonly requests: Request[];
  dispose(): Promise<void>;
}

function matches(req: Request, method: HttpMethod, match: (p: string) => boolean): boolean {
  if (req.resourceType() === 'document') return false;
  if (method !== '*' && req.method() !== method) return false;
  return match(new URL(req.url()).pathname);
}

/** Answer matching requests with a JSON body (default: every match). The backend never sees them. */
export async function stubJson(
  page: Page,
  method: HttpMethod,
  pattern: PathPattern,
  opts: { status?: number; body: unknown; times?: number }
): Promise<StubHandle> {
  const match = pathMatcher(pattern);
  const requests: Request[] = [];
  let remaining = opts.times ?? Number.POSITIVE_INFINITY;
  const handler = async (route: Route) => {
    const req = route.request();
    if (remaining <= 0 || !matches(req, method, match)) {
      await route.fallback();
      return;
    }
    remaining -= 1;
    requests.push(req);
    await route
      .fulfill({ status: opts.status ?? 200, contentType: 'application/json', body: JSON.stringify(opts.body) })
      .catch(() => undefined);
  };
  const filter = (url: URL) => match(url.pathname);
  await page.route(filter, handler);
  return { requests, dispose: () => page.unroute(filter, handler).catch(() => undefined) };
}

export interface CapturedResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export interface CaptureHandle {
  readonly responses: CapturedResponse[];
  /** The next not-yet-returned captured response (waits up to `timeoutMs`, default 25s). */
  next(timeoutMs?: number): Promise<CapturedResponse>;
  dispose(): Promise<void>;
}

/**
 * Pass matching requests through to the backend UNCHANGED and record the real
 * status + JSON body at interception time. Unlike `response.json()` on a
 * browser Response, the body can never be evicted by Chromium (seen as
 * "No resource with given identifier found" when the page moves on).
 */
export async function captureJson(page: Page, method: HttpMethod, pattern: PathPattern): Promise<CaptureHandle> {
  const match = pathMatcher(pattern);
  const responses: CapturedResponse[] = [];
  let returned = 0;
  const handler = async (route: Route) => {
    const req = route.request();
    if (!matches(req, method, match)) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    responses.push({ status: response.status(), json });
    await route.fulfill({ response, body: text }).catch(() => undefined);
  };
  const filter = (url: URL) => match(url.pathname);
  await page.route(filter, handler);
  return {
    responses,
    async next(timeoutMs = 25_000) {
      const started = Date.now();
      while (responses.length <= returned) {
        if (Date.now() - started >= timeoutMs) {
          throw new Error(`captureJson ${method} ${String(pattern)}: no response #${returned + 1} within ${timeoutMs}ms`);
        }
        await sleep(25);
      }
      return responses[returned++];
    },
    dispose: () => page.unroute(filter, handler).catch(() => undefined),
  };
}

/** Let matching requests reach the backend, then rewrite the JSON body before the app reads it. */
export async function rewriteJson(
  page: Page,
  method: HttpMethod,
  pattern: PathPattern,
  mutate: (json: Record<string, unknown>) => unknown
): Promise<StubHandle> {
  const match = pathMatcher(pattern);
  const requests: Request[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    if (!matches(req, method, match)) {
      await route.fallback();
      return;
    }
    requests.push(req);
    const response = await route.fetch();
    const json = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: mutate(json) });
  };
  const filter = (url: URL) => match(url.pathname);
  await page.route(filter, handler);
  return { requests, dispose: () => page.unroute(filter, handler).catch(() => undefined) };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface AuthUserRow {
  id: string;
  encrypted_password: string;
  email_confirmed_at: string | null;
}

export function authUser(email: string): AuthUserRow {
  const rows = dbQuery<AuthUserRow>(
    `select id::text as id, encrypted_password, email_confirmed_at::text as email_confirmed_at
       from auth.users where email = ${sqlStr(email.toLowerCase())}`
  );
  if (rows.length !== 1) throw new Error(`authUser(${email}): expected 1 auth.users row, found ${rows.length}`);
  return rows[0];
}

export function authUserCount(email: string): number {
  return dbCount(`select 1 from auth.users where email = ${sqlStr(email.toLowerCase())}`);
}

export interface ConsentRow {
  analytics_consent_withdrawn_at: string | null;
  analytics_consent_granted_at: string | null;
}

export function consentRow(userId: string): ConsentRow {
  return dbQuery<ConsentRow>(
    `select analytics_consent_withdrawn_at::text as analytics_consent_withdrawn_at,
            analytics_consent_granted_at::text as analytics_consent_granted_at
       from public.users where id = ${sqlStr(userId)}::uuid`
  )[0];
}

/** Make an account RETURNING: GoTrue's newness is created_at vs last_sign_in_at (backend utils/authUserNewness.ts). */
export function backdateAuthUser(userId: string): void {
  sqlExec(`update auth.users set created_at = now() - interval '2 days' where id = ${sqlStr(userId)}::uuid;`);
}

// ---------------------------------------------------------------------------
// Local Supabase: password-grant tokens, forged-expired JWT, recovery OTP
// ---------------------------------------------------------------------------

let statusEnv: Record<string, string> | null = null;
function supabaseStatus(): Record<string, string> {
  if (statusEnv) return statusEnv;
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../backend');
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: backendDir, encoding: 'utf8', timeout: 30_000 });
  statusEnv = Object.fromEntries(
    out
      .split('\n')
      .map((line) => /^([A-Z_]+)="(.*)"$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]])
  );
  return statusEnv;
}

/** A real Supabase session for an existing account (`/auth/v1/token?grant_type=password`). */
export async function passwordGrant(email: string, password: string): Promise<{ access_token: string; refresh_token: string }> {
  assertLocalDbTargets('passwordGrant');
  const anon = process.env.PW_SUPABASE_ANON_KEY ?? supabaseStatus().ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(`passwordGrant(${email}) failed: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token };
}

/** A well-formed access token for `userId`, signed with the LOCAL JWT secret, that expired an hour ago. */
export function expiredAccessToken(userId: string, email: string): string {
  assertLocalDbTargets('expiredAccessToken');
  const secret = process.env.PW_SUPABASE_JWT_SECRET ?? supabaseStatus().JWT_SECRET;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    sub: userId,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now - 7200,
    exp: now - 3600,
    session_id: crypto.randomUUID(),
  });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** A real password-recovery OTP for an existing account (admin generate_link; sends no mail). */
export async function recoveryOtp(email: string): Promise<string> {
  const res = await adminFetch('POST', '/auth/v1/admin/generate_link', { type: 'recovery', email });
  const otp = (res.json as { email_otp?: string } | null)?.email_otp;
  if (res.status >= 300 || !otp) throw new Error(`recoveryOtp(${email}) failed (${res.status})`);
  return otp;
}

/** Push the recovery code's issue time past otp_expiry (3600s, backend/supabase/config.toml). */
export function expireRecoveryOtp(userId: string): void {
  sqlExec(`update auth.users set recovery_sent_at = now() - interval '2 hours' where id = ${sqlStr(userId)}::uuid;`);
}

// ---------------------------------------------------------------------------
// Circles / invites (owner side, through the real API)
// ---------------------------------------------------------------------------

export async function ownerApi(request: APIRequestContext, account: { email: string; password: string }): Promise<ApiSession> {
  return apiSession(request, account);
}

/** A fresh circle owned by the worker account, so invite side effects stay out of the cloned circles. */
export async function createCircle(api: ApiSession, label: string): Promise<string> {
  const res = await api.post('/api/circles', { recipient_name: `E2E ${label}`.slice(0, 100) });
  expect(res.status(), `create circle: ${await res.text()}`).toBe(201);
  return ((await res.json()) as { data: { circle: { id: string } } }).data.circle.id;
}

export async function createInvite(api: ApiSession, circleId: string): Promise<{ id: string; code: string }> {
  const res = await api.post(`/api/circles/${circleId}/invites`, {
    email: `${uniq('e2e-invitee')}@example.com`,
    member_type: 'caregiver',
  });
  expect(res.status(), `create invite: ${await res.text()}`).toBeLessThan(300);
  const invite = ((await res.json()) as { data: { invite: { id: string; invite_code: string } } }).data.invite;
  expect(invite.invite_code, 'invite_code in the create response').toMatch(/^[A-Z0-9]+$/);
  return { id: invite.id, code: invite.invite_code };
}

export async function archiveCircle(api: ApiSession, circleId: string): Promise<void> {
  const res = await api.delete(`/api/circles/${circleId}`);
  expect(res.ok(), `archive circle: ${await res.text()}`).toBe(true);
}

export function expireInvite(inviteId: string): void {
  sqlExec(`update invites set expires_at = now() - interval '1 hour' where id = ${sqlStr(inviteId)}::uuid;`);
}

export function membershipCount(circleId: string, userId: string): number {
  return dbCount(
    `select 1 from circle_memberships where circle_id = ${sqlStr(circleId)}::uuid and user_id = ${sqlStr(userId)}::uuid`
  );
}

export function inviteStatus(inviteId: string): string {
  return dbQuery<{ status: string }>(`select status from invites where id = ${sqlStr(inviteId)}::uuid`)[0].status;
}

/** Wait `ms` with nothing else to observe — used only AFTER a positive signal, before a count/absence check. */
export async function settle(ms = 750): Promise<void> {
  await sleep(ms);
}
