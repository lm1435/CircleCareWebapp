import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIRequestContext, BrowserContext, Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { SUPABASE_URL, sqlExec } from '../db';
import { dbCount, dbQuery, pathMatcher, sqlStr, type ApiSession, type HttpMethod } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { circleTimezone, createDailyMedication, dateInTz, uniqueSuffix } from '../notesFirstClassShared';
import { apiCreateCareNote, apiCreateEvent, escapeRe, openCalendarEvent } from '../unhappy/writes/_helpers';

// ===========================================================================
// O5 WRITE GATE, ARMED — the web app end to end (security audit 2026-10-01, F3).
//
// The gate (backend/supabase/migrations/20261001120000_api_write_gate.sql) is a
// statement-level trigger on the 13 tables `authenticated` can write. Once an
// `app_settings` row `api_write_gate_sha256*` exists, an `authenticated`/`anon`
// write is refused (42501 -> PostgREST 403) unless it carries
// `x-circlecare-api-key` whose SHA-256 matches a row. Only the backend's
// user-scoped client sends it (API_WRITE_GATE_KEY).
//
// WHAT THIS PROVES, in a real signed-in browser:
//   1. the user's OWN access token + the public anon key cannot write the gated
//      tables straight through /rest/v1 (PATCH calendar_events, INSERT
//      activity_feed, PATCH users, DELETE care_notes, rpc apply_refill_decrement),
//      and nothing changed (read back through the API and the DB);
//   2. the SAME actions through the app UI succeed (and persist across a reload);
//   3. a backend holding the WRONG key fails every save gracefully: an error
//      message, no crash, the input kept, nothing written — and the retry
//      through the right backend lands exactly once;
//   4. rotation: with both `api_write_gate_sha256` and `api_write_gate_sha256_next`
//      rows, a backend with EITHER key writes; dropping `_next` refuses it again;
//   5. disarm (deleting the rows) takes effect on the very next statement, and
//      re-arming refuses again — no backend restart in between.
//
// RUN ONLY ARMED. Skipped unless PW_WRITE_GATE_ARMED=1. Then:
//   - the DB must be armed with sha256(<the MAIN backend's API_WRITE_GATE_KEY>);
//     test 0 FAILS (it does not skip) when no arm row exists, so a mis-set flag
//     is a red run, not a vacuous green;
//   - PW_WRITE_GATE_ALT_API_URL = a second backend on the same DB whose
//     API_WRITE_GATE_KEY is a DIFFERENT key (not armed). The spec forwards single
//     UI writes to it with page.route + route.fetch, so the page, its session and
//     every read stay on the main backend;
//   - PW_WRITE_GATE_ALT_KEY_FILE = a file holding that alt key (read here only to
//     compute its SHA-256 for the rotation row; never logged).
//   Tests 4 and 5 rewrite the GLOBAL arm rows (they restore what they found):
//   run this file on its own, `--workers=1`, never inside a full-suite run.
//
// FALSIFIER: run it with the flag set against an UNARMED DB (test 0 aside): the
// refusal asserts in 1, 3, 4 and 5 go red (the direct writes land, the wrong-key
// saves land) while 2 stays green.
// ===========================================================================

const ARMED = process.env.PW_WRITE_GATE_ARMED === '1';
const ALT_API = (process.env.PW_WRITE_GATE_ALT_API_URL ?? '').replace(/\/+$/, '');
const ALT_KEY_FILE = process.env.PW_WRITE_GATE_ALT_KEY_FILE ?? '';
// The well-known local `supabase start` anon key (webapp/.env.development) — public by design.
const ANON_KEY =
  process.env.PW_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const ARM_PREFIX = 'api_write_gate_sha256';
const NEXT_ROW = 'api_write_gate_sha256_next';
const GATED_TABLES = [
  'activity_feed', 'calendar_events', 'care_circles', 'care_notes', 'emergency_info',
  'event_notes', 'health_vitals', 'invites', 'medication_as_needed_doses', 'medication_confirmations',
  'medication_pause_periods', 'push_tokens', 'user_color_preferences', 'users',
];

test.skip(!ARMED, 'write gate not armed for this run (set PW_WRITE_GATE_ARMED=1; see the header)');
// In order, one worker, each test retried on its own (no serial skip-cascade):
// tests 4 and 5 move global DB state the others read.
test.describe.configure({ mode: 'default', timeout: 150_000 });
// Every test signs in its OWN scoped account (fresh circle), not the worker's.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function altKeyHash(): string {
  expect(ALT_KEY_FILE, 'PW_WRITE_GATE_ALT_KEY_FILE is required').not.toBe('');
  const key = readFileSync(ALT_KEY_FILE, 'utf8').trim();
  expect(key.length, 'alt key file is empty').toBeGreaterThan(15);
  return sha256(key);
}

const armRows = () =>
  dbQuery<{ key: string; value: string }>(
    `select key, value from app_settings where starts_with(key, ${sqlStr(ARM_PREFIX)}) order by key`
  );

function requireAlt(): void {
  expect(ALT_API, 'PW_WRITE_GATE_ALT_API_URL is required').not.toBe('');
}

interface Owner {
  owner: ScopedAccount;
  api: ApiSession;
  circleId: string;
  tz: string;
}

/** A fresh premium account with one fresh circle, signed in (cookie mode) in `context`. */
async function scopedOwner(
  request: APIRequestContext,
  context: BrowserContext,
  baseURL: string | undefined,
  label: string
): Promise<Owner> {
  const owner = await createScopedAccount(label);
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq(label));
  const tz = await circleTimezone(api, circleId);
  await cookieLogin(context, owner, baseURL);
  return { owner, api, circleId, tz };
}

/**
 * The access token the PAGE itself sends to the API — exactly what a member
 * sees in DevTools. Captured from a real request, not minted by the test.
 */
async function pageAccessToken(page: Page, circleId: string): Promise<string> {
  const sent = page.waitForRequest(
    (r) => new URL(r.url()).pathname.startsWith('/api/') && /^Bearer\s+\S+/.test(r.headers()['authorization'] ?? ''),
    { timeout: 30_000 }
  );
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  return (await sent).headers()['authorization'].replace(/^Bearer\s+/, '');
}

interface RestResult {
  status: number;
  body: { code?: string; message?: string } | null | unknown;
}

/** A raw PostgREST call FROM THE BROWSER: public anon key + the user's own JWT. */
async function directRest(
  page: Page,
  token: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<RestResult> {
  return page.evaluate(
    async ({ url, anon, token: t, method: m, body: b }) => {
      const res = await fetch(url, {
        method: m,
        headers: {
          apikey: anon,
          Authorization: `Bearer ${t}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: res.status, body: parsed };
    },
    { url: `${SUPABASE_URL}/rest/v1/${path}`, anon: ANON_KEY, token, method, body }
  );
}

function expectGateRefused(r: RestResult, what: string, soft = false): void {
  const b = (r.body ?? {}) as { code?: string; message?: string };
  (soft ? expect.soft : expect)(
    { status: r.status, code: b.code, gate: String(b.message ?? '').includes('cc_api_write_gate') },
    `${what}: refused by the write gate (got ${JSON.stringify(r)})`
  ).toEqual({ status: 403, code: '42501', gate: true });
}

/** The page never crashed: no uncaught error, no error boundary. */
function watchCrashes(page: Page): { errors: string[]; check(): Promise<void> } {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return {
    errors,
    async check() {
      expect(errors, 'uncaught page errors').toEqual([]);
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
    },
  };
}

interface ViaHandle {
  /** Status codes the alternate backend answered with. */
  readonly answered: number[];
  dispose(): Promise<void>;
}

/**
 * Send the next `times` matching UI requests to `base` (another backend on the
 * same DB) instead of the page's own backend, and hand its REAL answer back to
 * the page. Everything else — the session, every read — stays on the main
 * backend. The request goes out with the page's own headers and body.
 */
async function routeVia(page: Page, method: HttpMethod, pattern: string, base: string, times = 1): Promise<ViaHandle> {
  const match = pathMatcher(pattern);
  let remaining = times;
  const answered: number[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    if (remaining <= 0 || req.resourceType() === 'document' || (method !== '*' && req.method() !== method)) {
      await route.fallback();
      return;
    }
    remaining -= 1;
    const u = new URL(req.url());
    const response = await route.fetch({ url: `${base}${u.pathname}${u.search}` });
    answered.push(response.status());
    await route.fulfill({ response });
  };
  const filter = (url: URL) => match(url.pathname);
  await page.route(filter, handler);
  return {
    answered,
    async dispose() {
      await page.unroute(filter, handler).catch(() => undefined);
    },
  };
}

/** Error copy that would MISLEAD the user about a server-side refusal (access lost / view-only / paywall). */
const MISLEADING = /no longer|permission|view-only|access|upgrade|subscription|sign in again|session/i;

/** One visible error message (toast `role=alert` or an inline alert), and not a misleading one. */
async function expectGracefulError(page: Page, what: string): Promise<string> {
  const alert = page.getByRole('alert').filter({ hasText: /\S/ }).first();
  await expect(alert, `${what}: an error message is shown`).toBeVisible({ timeout: 20_000 });
  const text = (await alert.innerText()).trim();
  expect(text, `${what}: the error copy does not blame access/session/paywall`).not.toMatch(MISLEADING);
  return text;
}

const c = (id: string) => `${sqlStr(id)}::uuid`;

/** Minutes since midnight in `tz`. */
function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

function skipNearMidnight(tz: string): void {
  const m = minutesIntoDay(tz);
  test.skip(m < 5 || m > 24 * 60 - 5, 'within 5 minutes of midnight in the recipient zone (the 00:01 dose straddles)');
}

const eventRow = (id: string) =>
  dbQuery<{ title: string | null; completed_at: string | null; quantity_remaining: number | null }>(
    `select title, completed_at::text as completed_at, quantity_remaining from calendar_events where id = ${c(id)}`
  )[0];

/** Daily refill-tracked med from YESTERDAY at 00:01 (today's dose is due) + today's dose confirmed through the API. */
async function seedConfirmedRefillDose(o: Owner): Promise<{ medId: string; name: string; confirmationId: string }> {
  const name = `ZZ_E2E_WG_MED_${uniqueSuffix()}`;
  const medId = await createDailyMedication(o.api, o.circleId, name, dateInTz(o.tz, -1), {
    time: '00:01',
    trackRefills: true,
    quantityRemaining: 30,
  });
  const today = dateInTz(o.tz, 0);
  const res = await o.api.post(`/api/circles/${o.circleId}/medications/confirm`, {
    event_id: `${medId}_${today}`,
    status: 'taken',
    scheduled_time: '00:01:00',
  });
  expect(res.status(), `API confirm (backend -> apply_refill_decrement): ${await res.text()}`).toBe(201);
  const confirmationId = ((await res.json()) as { data: { confirmation: { id: string } } }).data.confirmation.id;
  return { medId, name, confirmationId };
}

// ---------------------------------------------------------------------------
// 0. the run is really armed
// ---------------------------------------------------------------------------

test('0. the database is armed and every gated table carries the trigger', () => {
  expect(armRows().length, 'an api_write_gate_sha256* row exists (else every refusal below is vacuous)').toBeGreaterThan(0);
  // Column alias NOT `t`: dbQuery wraps the query as `(...) t`, and json_agg(t) would then aggregate the column.
  const gated = dbQuery<{ tbl: string }>(
    `select c.relname as tbl from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and tg.tgname = 'cc_api_write_gate' and tg.tgenabled = 'O' order by 1`
  ).map((r) => r.tbl);
  expect(gated).toEqual([...GATED_TABLES].sort());
});

// ---------------------------------------------------------------------------
// 1. direct PostgREST writes with the page's own token are refused
// ---------------------------------------------------------------------------

test('1. direct /rest/v1 writes with the signed-in user\'s own token are refused and change nothing', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const o = await scopedOwner(request, context, baseURL, 'wg-direct');
  skipNearMidnight(o.tz);
  const taskTitle = `ZZ_E2E_WG_TASK_${uniqueSuffix()}`;
  const task = await apiCreateEvent(o.api, o.circleId, {
    event_type: 'task',
    title: taskTitle,
    scheduled_date: dateInTz(o.tz, 1),
  });
  const noteBody = `ZZ_E2E_WG_NOTE_${uniqueSuffix()}`;
  const noteId = await apiCreateCareNote(o.api, o.circleId, noteBody);
  const med = await seedConfirmedRefillDose(o);
  expect(eventRow(med.medId).quantity_remaining, 'the API confirm decremented the bottle (user-scoped RPC, armed)').toBe(29);
  // An UNCLAIMED confirmation (as if the decrement had not run yet): a direct
  // rpc call would claim it and take a pill — if the gate let it through.
  sqlExec(
    `update medication_confirmations set refill_applied_at = null, refill_applied_pills = null,
       refill_applied_bottle_id = null where id = ${c(med.confirmationId)};`
  );
  const [{ first_name: firstName }] = dbQuery<{ first_name: string | null }>(
    `select first_name from users where id = ${c(o.owner.userId)}`
  );
  const forged = `ZZ_E2E_WG_FORGED_${uniqueSuffix()}`;

  const token = await pageAccessToken(page, o.circleId);
  try {
    expectGateRefused(
      await directRest(page, token, 'PATCH', `calendar_events?id=eq.${task.id}`, { title: `${taskTitle}_hacked` }),
      'PATCH calendar_events',
      true
    );
    expectGateRefused(
      await directRest(page, token, 'POST', 'activity_feed', {
        circle_id: o.circleId,
        actor_id: o.owner.userId,
        action_type: 'event_created',
        description: forged,
      }),
      'INSERT activity_feed',
      true
    );
    expectGateRefused(
      await directRest(page, token, 'PATCH', `users?id=eq.${o.owner.userId}`, { first_name: 'Hacked' }),
      'PATCH users',
      true
    );
    expectGateRefused(await directRest(page, token, 'DELETE', `care_notes?id=eq.${noteId}`), 'DELETE care_notes', true);
    expectGateRefused(
      await directRest(page, token, 'POST', 'rpc/apply_refill_decrement', {
        p_confirmation_id: med.confirmationId,
        p_event_id: med.medId,
      }),
      'rpc apply_refill_decrement',
      true
    );

    // Nothing changed — read back through the API (the app's own view) …
    const ev = await o.api.get(`/api/circles/${o.circleId}/events/${task.id}`);
    expect(ev.status()).toBe(200);
    expect(((await ev.json()) as { data: { event: { title: string } } }).data.event.title).toBe(taskTitle);

    const feed = await o.api.get(`/api/circles/${o.circleId}/activity?limit=50`);
    expect(feed.status()).toBe(200);
    const activities = ((await feed.json()) as { data: { activities: Array<{ description: string }> } }).data.activities;
    expect(activities.map((a) => a.description)).not.toContain(forged);

    const me = await o.api.get('/api/users/me');
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { data: { user: { first_name: string | null } } }).data.user.first_name).toBe(firstName);

    const notes = await o.api.get(`/api/circles/${o.circleId}/care-notes`);
    expect(notes.status()).toBe(200);
    expect(((await notes.json()) as { data: { notes: Array<{ id: string }> } }).data.notes.map((n) => n.id)).toContain(
      noteId
    );

    const medEv = await o.api.get(`/api/circles/${o.circleId}/events/${med.medId}`);
    expect(medEv.status()).toBe(200);
    expect(
      ((await medEv.json()) as { data: { event: { quantity_remaining: number | null } } }).data.event.quantity_remaining
    ).toBe(29);

    // … and in the database itself.
    expect(eventRow(task.id).title).toBe(taskTitle);
    expect(dbCount(`select 1 from activity_feed where description = ${sqlStr(forged)}`)).toBe(0);
    expect(dbCount(`select 1 from care_notes where id = ${c(noteId)}`)).toBe(1);
    expect(eventRow(med.medId).quantity_remaining).toBe(29);
    expect(
      dbQuery<{ claimed: boolean }>(
        `select refill_applied_at is not null as claimed from medication_confirmations where id = ${c(med.confirmationId)}`
      )[0].claimed
    ).toBe(false);
  } finally {
    // Undo whatever a NON-refused write did (only reachable in the falsifier run).
    sqlExec(`
      update users set first_name = ${sqlStr(firstName)} where id = ${c(o.owner.userId)};
      delete from activity_feed where description = ${sqlStr(forged)};
    `);
  }
});

// ---------------------------------------------------------------------------
// 2. the same actions through the app succeed
// ---------------------------------------------------------------------------

test('2. the same writes through the app UI succeed and persist (event edit, task complete + feed, profile, note delete, dose + refill)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const o = await scopedOwner(request, context, baseURL, 'wg-ui');
  skipNearMidnight(o.tz);
  const crash = watchCrashes(page);
  const taskTitle = `ZZ_E2E_WG_UITASK_${uniqueSuffix()}`;
  const taskDate = dateInTz(o.tz, 1);
  const task = await apiCreateEvent(o.api, o.circleId, { event_type: 'task', title: taskTitle, scheduled_date: taskDate });
  const noteBody = `ZZ_E2E_WG_UINOTE_${uniqueSuffix()}`;
  const noteId = await apiCreateCareNote(o.api, o.circleId, noteBody);
  const medName = `ZZ_E2E_WG_UIMED_${uniqueSuffix()}`;
  const medId = await createDailyMedication(o.api, o.circleId, medName, dateInTz(o.tz, -1), {
    time: '00:01',
    trackRefills: true,
    quantityRemaining: 30,
  });

  // (a) calendar_events UPDATE — edit the task's title in the calendar.
  const edited = `${taskTitle}_EDITED`;
  const detail = await openCalendarEvent(page, o.circleId, taskDate, taskTitle);
  await detail.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit event', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit event' });
  await expect(edit).toBeVisible();
  await expect(edit.locator('#title')).toHaveValue(taskTitle, { timeout: 20_000 });
  await edit.locator('#title').fill(edited);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => eventRow(task.id).title, { timeout: 15_000 }).toBe(edited);

  // (b) calendar_events UPDATE + activity_feed INSERT — complete it on Tasks.
  const completed = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/circles/${o.circleId}/events/${task.id}/complete`,
    { timeout: 40_000 }
  );
  await page.goto(`/circles/${o.circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `Mark "${edited}" complete` }).click();
  expect((await completed).status(), 'complete through the armed gate').toBeLessThan(300);
  expect(eventRow(task.id).completed_at, 'completed_at persisted').not.toBeNull();
  await expect
    .poll(
      () => dbCount(`select 1 from activity_feed where circle_id = ${c(o.circleId)} and description ilike ${sqlStr(`%${edited}%`)}`),
      { timeout: 15_000, message: 'the completion wrote its activity-feed row (user-scoped insert)' }
    )
    .toBeGreaterThan(0);
  await page.goto(`/circles/${o.circleId}/activity`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(escapeRe(edited))).first()).toBeVisible({ timeout: 20_000 });

  // (c) users UPDATE — the profile first name, then a reload.
  const newFirst = `WG${uniqueSuffix()}`.slice(0, 20);
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Edit name', exact: true }).click();
  await page.locator('#profile-first-name').fill(newFirst);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#profile-first-name')).toBeHidden({ timeout: 20_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(escapeRe(newFirst))).first()).toBeVisible({ timeout: 20_000 });
  const me = await o.api.get('/api/users/me');
  expect(((await me.json()) as { data: { user: { first_name: string } } }).data.user.first_name).toBe(newFirst);

  // (d) care_notes DELETE — through the Notes page row menu.
  await page.goto(`/circles/${o.circleId}/notes`, { waitUntil: 'domcontentloaded' });
  const rowActions = /^Actions for note by /;
  const row = page
    .locator('li')
    .filter({ hasText: new RegExp(escapeRe(noteBody)) })
    .filter({ has: page.getByRole('button', { name: rowActions }) })
    .last();
  await row.getByRole('button', { name: rowActions }).click({ timeout: 20_000 });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').or(page.getByRole('alertdialog')).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => dbCount(`select 1 from care_notes where id = ${c(noteId)}`), { timeout: 15_000 }).toBe(0);
  const notes = await o.api.get(`/api/circles/${o.circleId}/care-notes`);
  expect(((await notes.json()) as { data: { notes: Array<{ id: string }> } }).data.notes.map((n) => n.id)).not.toContain(noteId);

  // (e) medication_confirmations INSERT + rpc apply_refill_decrement — "Taken" on Home.
  const confirmed = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/circles\/[^/]+\/medications\/confirm$/.test(new URL(r.url()).pathname),
    { timeout: 40_000 }
  );
  await page.goto(`/circles/${o.circleId}`, { waitUntil: 'domcontentloaded' });
  const today = page.locator('section[aria-labelledby="todays-meds-heading"] > ul');
  await today.getByRole('button', { name: `Confirm ${medName}` }).first().click({ timeout: 30_000 });
  expect((await confirmed).status(), 'dose confirm through the armed gate').toBe(201);
  await expect.poll(() => eventRow(medId).quantity_remaining, { timeout: 15_000 }).toBe(29);
  const medEv = await o.api.get(`/api/circles/${o.circleId}/events/${medId}`);
  expect(((await medEv.json()) as { data: { event: { quantity_remaining: number } } }).data.event.quantity_remaining).toBe(29);

  await crash.check();
});

// ---------------------------------------------------------------------------
// 3. a backend with the WRONG key: every save fails gracefully
// ---------------------------------------------------------------------------

interface Ctx {
  page: Page;
  o: Owner;
  label: string;
  state: Record<string, string>;
}

interface Surface {
  name: string;
  method: HttpMethod;
  path: string;
  /** Open + fill the form (or reach the control); return the save control. */
  prepare(ctx: Ctx): Promise<Locator>;
  /** The user's input / the row is still in place after the failure. */
  kept(ctx: Ctx): Promise<void>;
  /** SELECT whose count must be `before` after the failure and `after` after the retry. */
  rows(ctx: Ctx): string;
  before: number;
  after: number;
  /** The UI's success signal after the retry. */
  succeeded(ctx: Ctx): Promise<void>;
}

const futureDate = (o: Owner) => dateInTz(o.tz, 3);

/** Every confirmation of the series rooted at ctx.state.id. */
const doseRows = (ctx: Ctx) =>
  `select 1 from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
    where ce.circle_id = ${c(ctx.o.circleId)} and (ce.id = ${c(ctx.state.id)} or ce.parent_event_id = ${c(ctx.state.id)})`;

const SURFACES: Surface[] = [
  {
    name: 'create appointment',
    method: 'POST',
    path: '/api/circles/:id/events',
    async prepare({ page, o, label }) {
      await page.goto(`/circles/${o.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Add event' }).first().click({ timeout: 20_000 });
      const dialog = page.getByRole('dialog', { name: 'New event' });
      await expect(dialog).toBeVisible();
      await dialog.locator('#event_type').selectOption('appointment');
      await dialog.locator('#title').fill(label);
      await dialog.locator('#scheduled_date').fill(futureDate(o));
      return dialog.getByRole('button', { name: 'Create', exact: true });
    },
    async kept({ page, label }) {
      const dialog = page.getByRole('dialog', { name: 'New event' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#title')).toHaveValue(label);
    },
    rows: ({ o, label }) => `select 1 from calendar_events where circle_id = ${c(o.circleId)} and title = ${sqlStr(label)}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'New event' })).toBeHidden({ timeout: 20_000 });
    },
  },
  {
    name: 'create medication',
    method: 'POST',
    path: '/api/circles/:id/events',
    async prepare({ page, o, label }) {
      await page.goto(`/circles/${o.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Add event' }).first().click({ timeout: 20_000 });
      const dialog = page.getByRole('dialog', { name: 'New event' });
      await expect(dialog).toBeVisible();
      await dialog.locator('#event_type').selectOption('medication');
      await dialog.locator('#medication_name').fill(label);
      await dialog.locator('#medication_dosage').fill('5 mg');
      await dialog.locator('#scheduled_date').fill(futureDate(o));
      await dialog.locator('#scheduled_time').fill('09:00');
      return dialog.getByRole('button', { name: 'Create', exact: true });
    },
    async kept({ page, label }) {
      const dialog = page.getByRole('dialog', { name: 'New event' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#medication_name')).toHaveValue(label);
    },
    rows: ({ o, label }) =>
      `select 1 from calendar_events where circle_id = ${c(o.circleId)} and parent_event_id is null and medication_name = ${sqlStr(label)}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'New event' })).toBeHidden({ timeout: 20_000 });
    },
  },
  {
    name: 'edit event title',
    method: 'PATCH',
    path: '/api/circles/:id/events/:eventId',
    async prepare(ctx) {
      const date = dateInTz(ctx.o.tz, 1);
      ctx.state.original = `${ctx.label} orig`;
      ctx.state.id = (await apiCreateEvent(ctx.o.api, ctx.o.circleId, { event_type: 'task', title: ctx.state.original, scheduled_date: date })).id;
      const detail = await openCalendarEvent(ctx.page, ctx.o.circleId, date, ctx.state.original);
      await detail.getByRole('button', { name: 'More', exact: true }).click();
      await ctx.page.getByRole('menuitem', { name: 'Edit event', exact: true }).click();
      const edit = ctx.page.getByRole('dialog', { name: 'Edit event' });
      await expect(edit.locator('#title')).toHaveValue(ctx.state.original, { timeout: 20_000 });
      await edit.locator('#title').fill(ctx.label);
      return edit.getByRole('button', { name: 'Save changes' });
    },
    async kept({ page, label }) {
      await expect(page.getByRole('dialog', { name: 'Edit event' }).locator('#title')).toHaveValue(label);
    },
    rows: ({ o, label }) => `select 1 from calendar_events where circle_id = ${c(o.circleId)} and title = ${sqlStr(label)}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'Edit event' })).toBeHidden({ timeout: 20_000 });
    },
  },
  {
    name: 'delete appointment (a failed delete must not lose the row)',
    method: 'DELETE',
    path: '/api/circles/:id/events/:eventId',
    async prepare(ctx) {
      const date = dateInTz(ctx.o.tz, 1);
      ctx.state.id = (
        await apiCreateEvent(ctx.o.api, ctx.o.circleId, {
          event_type: 'appointment',
          title: ctx.label,
          scheduled_date: date,
          scheduled_time: '10:00',
        })
      ).id;
      const detail = await openCalendarEvent(ctx.page, ctx.o.circleId, date, ctx.label);
      await detail.getByRole('button', { name: 'More', exact: true }).click();
      await ctx.page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      const del = ctx.page.getByRole('dialog', { name: /^Delete/ }).last();
      await expect(del).toBeVisible();
      return del.getByRole('button', { name: 'Delete', exact: true });
    },
    async kept(ctx) {
      expect(dbCount(`select 1 from calendar_events where id = ${c(ctx.state.id)}`), 'the event survived').toBe(1);
    },
    rows: (ctx) => `select 1 from calendar_events where id = ${c(ctx.state.id)}`,
    before: 1,
    after: 0,
    async succeeded(ctx) {
      await expect.poll(() => dbCount(`select 1 from calendar_events where id = ${c(ctx.state.id)}`), { timeout: 20_000 }).toBe(0);
    },
  },
  {
    name: 'care note post',
    method: 'POST',
    path: '/api/circles/:id/care-notes',
    async prepare({ page, o, label }) {
      await page.goto(`/circles/${o.circleId}/notes`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel(/^Add a note/).fill(label, { timeout: 20_000 });
      return page.getByRole('button', { name: 'Post', exact: true });
    },
    async kept({ page, label }) {
      await expect(page.getByLabel(/^Add a note/)).toHaveValue(label);
    },
    rows: ({ o, label }) => `select 1 from care_notes where circle_id = ${c(o.circleId)} and body = ${sqlStr(label)}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.getByLabel(/^Add a note/)).toHaveValue('', { timeout: 20_000 });
    },
  },
  {
    name: 'event note create',
    method: 'POST',
    path: '/api/circles/:id/events/:eventId/notes',
    async prepare(ctx) {
      const date = dateInTz(ctx.o.tz, 0);
      ctx.state.host = `${ctx.label} host`;
      await apiCreateEvent(ctx.o.api, ctx.o.circleId, { event_type: 'task', title: ctx.state.host, scheduled_date: date });
      const detail = await openCalendarEvent(ctx.page, ctx.o.circleId, date, ctx.state.host);
      const composer = detail.locator('#event-note-composer');
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await composer.fill(ctx.label);
      return detail.getByRole('button', { name: 'Add note', exact: true });
    },
    async kept({ page, label }) {
      await expect(page.locator('#event-note-composer')).toHaveValue(label);
    },
    rows: ({ o, label }) => `select 1 from event_notes where circle_id = ${c(o.circleId)} and body = ${sqlStr(label)}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.locator('#event-note-composer')).toHaveValue('', { timeout: 20_000 });
    },
  },
  {
    name: 'vital add',
    method: 'POST',
    path: '/api/circles/:id/vitals',
    async prepare({ page, o, label }) {
      await page.goto(`/circles/${o.circleId}/vitals`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Add reading' }).first().click({ timeout: 20_000 });
      const dialog = page.getByRole('dialog', { name: 'Add reading' });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await dialog.locator('#vital_type').selectOption('heart_rate');
      await dialog.locator('#value1').fill('72');
      await dialog.locator('#notes').fill(label);
      return dialog.getByRole('button', { name: 'Save reading', exact: true });
    },
    async kept({ page, label }) {
      await expect(page.getByRole('dialog', { name: 'Add reading' }).locator('#notes')).toHaveValue(label);
    },
    rows: ({ o, label }) => `select 1 from health_vitals where circle_id = ${c(o.circleId)} and notes = ${sqlStr(label)}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'Add reading' })).toBeHidden({ timeout: 20_000 });
    },
  },
  {
    name: 'emergency medical info',
    method: 'PUT',
    path: '/api/circles/:id/emergency-info',
    async prepare({ page, o, label }) {
      await page.goto(`/circles/${o.circleId}/emergency`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Edit medical information' }).first().click({ timeout: 20_000 });
      const dialog = page.getByRole('dialog', { name: 'Medical information' });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      const input = dialog.locator('#allergies-input');
      await input.fill(label);
      await input.press('Enter');
      await expect(dialog.getByRole('button', { name: `Remove ${label}` })).toBeVisible();
      return dialog.getByRole('button', { name: 'Save', exact: true });
    },
    async kept({ page, label }) {
      await expect(page.getByRole('dialog', { name: 'Medical information' }).getByRole('button', { name: `Remove ${label}` })).toBeVisible();
    },
    rows: ({ o, label }) => `select 1 from emergency_info where circle_id = ${c(o.circleId)} and ${sqlStr(label)} = any(allergies)`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'Medical information' })).toBeHidden({ timeout: 20_000 });
    },
  },
  {
    name: 'circle settings (rename)',
    method: 'PATCH',
    path: '/api/circles/:id',
    async prepare({ page, o, label }) {
      await page.goto(`/circles/${o.circleId}/settings`, { waitUntil: 'domcontentloaded' });
      const field = page.locator('#recipient_name');
      await expect(field).not.toHaveValue('', { timeout: 20_000 });
      await field.fill(label);
      return page.getByRole('button', { name: 'Save changes', exact: true });
    },
    async kept({ page, label }) {
      await expect(page.locator('#recipient_name')).toHaveValue(label);
    },
    rows: ({ o, label }) => `select 1 from care_circles where id = ${c(o.circleId)} and recipient_name = ${sqlStr(label)}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.getByRole('status').filter({ hasText: /Circle updated/ })).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: 'invite member',
    method: 'POST',
    path: '/api/circles/:id/invites',
    async prepare(ctx) {
      ctx.state.email = `e2e-wg-invite-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
      await ctx.page.goto(`/circles/${ctx.o.circleId}/members`, { waitUntil: 'domcontentloaded' });
      await ctx.page.getByRole('button', { name: 'Invite member' }).first().click({ timeout: 20_000 });
      const dialog = ctx.page.getByRole('dialog', { name: 'Invite a member' });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await dialog.locator('#invite-email').fill(ctx.state.email);
      return dialog.getByRole('button', { name: 'Send invite', exact: true });
    },
    async kept(ctx) {
      await expect(ctx.page.locator('#invite-email')).toHaveValue(ctx.state.email);
    },
    rows: (ctx) => `select 1 from invites where circle_id = ${c(ctx.o.circleId)} and invited_email = ${sqlStr(ctx.state.email ?? '')}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'Invite a member' }).getByText('Invitation sent')).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: 'profile first name',
    method: 'PATCH',
    path: '/api/users/me',
    async prepare(ctx) {
      ctx.state.first = `WG${uniqueSuffix()}`.slice(0, 20);
      await ctx.page.goto('/profile', { waitUntil: 'domcontentloaded' });
      await ctx.page.getByRole('button', { name: 'Edit name', exact: true }).click({ timeout: 20_000 });
      await ctx.page.locator('#profile-first-name').fill(ctx.state.first);
      return ctx.page.getByRole('button', { name: 'Save', exact: true });
    },
    async kept(ctx) {
      await expect(ctx.page.locator('#profile-first-name')).toHaveValue(ctx.state.first);
    },
    rows: (ctx) => `select 1 from users where id = ${c(ctx.o.owner.userId)} and first_name = ${sqlStr(ctx.state.first ?? '')}`,
    before: 0,
    after: 1,
    async succeeded({ page }) {
      await expect(page.locator('#profile-first-name')).toBeHidden({ timeout: 20_000 });
    },
  },
  {
    name: 'task complete (Tasks page)',
    method: 'POST',
    path: '/api/circles/:id/events/:eventId/complete',
    async prepare(ctx) {
      ctx.state.id = (
        await apiCreateEvent(ctx.o.api, ctx.o.circleId, { event_type: 'task', title: ctx.label, scheduled_date: dateInTz(ctx.o.tz, 1) })
      ).id;
      await ctx.page.goto(`/circles/${ctx.o.circleId}/tasks`, { waitUntil: 'domcontentloaded' });
      const done = ctx.page.getByRole('button', { name: `Mark "${ctx.label}" complete` });
      await expect(done).toBeVisible({ timeout: 20_000 });
      return done;
    },
    async kept(ctx) {
      // The row is back to open (no stuck "Completing…") and can be completed again.
      await expect(ctx.page.getByRole('button', { name: `Mark "${ctx.label}" complete` })).toBeVisible({ timeout: 20_000 });
    },
    rows: (ctx) => `select 1 from calendar_events where id = ${c(ctx.state.id)} and completed_at is not null`,
    before: 0,
    after: 1,
    async succeeded(ctx) {
      await expect
        .poll(() => dbCount(`select 1 from calendar_events where id = ${c(ctx.state.id)} and completed_at is not null`), { timeout: 30_000 })
        .toBe(1);
    },
  },
  {
    name: 'dose Taken (Home, after the undo window)',
    method: 'POST',
    path: '/api/circles/:id/medications/confirm',
    async prepare(ctx) {
      skipNearMidnight(ctx.o.tz);
      ctx.state.name = `ZZ_E2E_WG_DOSE_${uniqueSuffix()}`;
      ctx.state.id = await createDailyMedication(ctx.o.api, ctx.o.circleId, ctx.state.name, dateInTz(ctx.o.tz, -1), { time: '00:01' });
      await ctx.page.goto(`/circles/${ctx.o.circleId}`, { waitUntil: 'domcontentloaded' });
      const btn = ctx.page
        .locator('section[aria-labelledby="todays-meds-heading"] > ul')
        .getByRole('button', { name: `Confirm ${ctx.state.name}` })
        .first();
      await expect(btn).toBeVisible({ timeout: 30_000 });
      return btn;
    },
    async kept(ctx) {
      await expect(
        ctx.page
          .locator('section[aria-labelledby="todays-meds-heading"] > ul')
          .getByRole('button', { name: `Confirm ${ctx.state.name}` })
          .first()
      ).toBeVisible({ timeout: 30_000 });
    },
    rows: doseRows,
    before: 0,
    after: 1,
    async succeeded(ctx) {
      await expect.poll(() => dbCount(doseRows(ctx)), { timeout: 30_000 }).toBe(1);
    },
  },
];

for (const surface of SURFACES) {
  test(`3. wrong-key backend: ${surface.name} fails gracefully, keeps the input, writes nothing; the retry lands once`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    requireAlt();
    const altHash = altKeyHash();
    expect(
      dbCount(`select 1 from app_settings where starts_with(key, ${sqlStr(ARM_PREFIX)}) and value = ${sqlStr(altHash)}`),
      'the alt backend key must NOT be armed for this test'
    ).toBe(0);
    const o = await scopedOwner(request, context, baseURL, 'wg-wrongkey');
    const crash = watchCrashes(page);
    const ctx: Ctx = { page, o, label: `ZZ_E2E_WG_${uniqueSuffix()}`, state: {} };
    const save = await surface.prepare(ctx);
    expect(dbCount(surface.rows(ctx)), 'precondition').toBe(surface.before);

    const via = await routeVia(page, surface.method, surface.path, ALT_API, 1);
    try {
      await save.click();
      await expect.poll(() => via.answered.length, { timeout: 30_000, message: 'the write reached the wrong-key backend' }).toBe(1);
      expect(via.answered[0], 'the wrong-key backend refused the write').toBeGreaterThanOrEqual(400);
      const copy = await expectGracefulError(page, surface.name);
      test.info().annotations.push({ type: 'wrong-key', description: `${surface.name}: HTTP ${via.answered[0]} -> "${copy}"` });
      await surface.kept(ctx);
      expect(dbCount(surface.rows(ctx)), 'the refused save changed nothing').toBe(surface.before);
      await crash.check();
    } finally {
      await via.dispose();
    }

    // Retry through the right backend: the same control, the same input.
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();
    await surface.succeeded(ctx);
    await expect.poll(() => dbCount(surface.rows(ctx)), { timeout: 20_000 }).toBe(surface.after);
    await crash.check();
  });
}

// ---------------------------------------------------------------------------
// 4. rotation
// ---------------------------------------------------------------------------

/** A care note POSTed straight to `base` with the user's bearer token. */
async function postNoteVia(request: APIRequestContext, base: string, o: Owner, body: string): Promise<number> {
  const res = await request.post(`${base}/api/circles/${o.circleId}/care-notes`, {
    headers: { Authorization: `Bearer ${o.api.token}` },
    data: { body },
  });
  return res.status();
}

const noteCount = (o: Owner, body: string) =>
  dbCount(`select 1 from care_notes where circle_id = ${c(o.circleId)} and body = ${sqlStr(body)}`);

test('4. rotation: with sha256 and sha256_next both present, a backend with EITHER key writes; dropping _next refuses the new key again', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  requireAlt();
  const altHash = altKeyHash();
  expect(dbCount(`select 1 from app_settings where key = ${sqlStr(NEXT_ROW)}`), 'no _next row before the test').toBe(0);
  const o = await scopedOwner(request, context, baseURL, 'wg-rotate');
  const mainBase = new URL(baseURL ?? 'http://localhost:5173').origin; // the page's backend, through the Vite proxy

  const n0 = `ZZ_E2E_WG_ROT0_${uniqueSuffix()}`;
  expect(await postNoteVia(request, ALT_API, o, n0), 'new key, not yet added: refused').toBeGreaterThanOrEqual(400);
  expect(noteCount(o, n0)).toBe(0);

  sqlExec(`insert into app_settings (key, value) values (${sqlStr(NEXT_ROW)}, ${sqlStr(altHash)})
           on conflict (key) do update set value = excluded.value;`);
  try {
    expect(armRows().map((r) => r.key)).toEqual(expect.arrayContaining([ARM_PREFIX, NEXT_ROW]));
    const n1 = `ZZ_E2E_WG_ROT1_${uniqueSuffix()}`;
    const n2 = `ZZ_E2E_WG_ROT2_${uniqueSuffix()}`;
    expect(await postNoteVia(request, ALT_API, o, n1), 'NEW key backend writes during rotation').toBe(201);
    expect(await postNoteVia(request, mainBase, o, n2), 'OLD key backend still writes during rotation').toBe(201);
    expect(noteCount(o, n1)).toBe(1);
    expect(noteCount(o, n2)).toBe(1);

    // And through the UI on the new-key backend.
    const label = `ZZ_E2E_WG_ROTUI_${uniqueSuffix()}`;
    await page.goto(`/circles/${o.circleId}/notes`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/^Add a note/).fill(label, { timeout: 20_000 });
    const via = await routeVia(page, 'POST', '/api/circles/:id/care-notes', ALT_API, 1);
    try {
      await page.getByRole('button', { name: 'Post', exact: true }).click();
      await expect.poll(() => via.answered[0], { timeout: 20_000 }).toBe(201);
      await expect(page.getByLabel(/^Add a note/)).toHaveValue('', { timeout: 20_000 });
      expect(noteCount(o, label)).toBe(1);
    } finally {
      await via.dispose();
    }
  } finally {
    sqlExec(`delete from app_settings where key = ${sqlStr(NEXT_ROW)};`);
  }
  const n3 = `ZZ_E2E_WG_ROT3_${uniqueSuffix()}`;
  expect(await postNoteVia(request, ALT_API, o, n3), '_next dropped: the new key is refused again').toBeGreaterThanOrEqual(400);
  expect(noteCount(o, n3)).toBe(0);
});

// ---------------------------------------------------------------------------
// 5. disarm / re-arm, live
// ---------------------------------------------------------------------------

test('5. disarm takes effect on the next statement and re-arming refuses again, with no backend restart', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  requireAlt();
  const snapshot = armRows();
  expect(snapshot.length, 'armed before the test').toBeGreaterThan(0);
  const o = await scopedOwner(request, context, baseURL, 'wg-disarm');
  const title = `ZZ_E2E_WG_DIS_${uniqueSuffix()}`;
  const task = await apiCreateEvent(o.api, o.circleId, { event_type: 'task', title, scheduled_date: dateInTz(o.tz, 1) });
  const token = await pageAccessToken(page, o.circleId);

  // Armed.
  expectGateRefused(await directRest(page, token, 'PATCH', `calendar_events?id=eq.${task.id}`, { title: `${title}_a` }), 'armed: direct PATCH');
  const a = `ZZ_E2E_WG_DISA_${uniqueSuffix()}`;
  expect(await postNoteVia(request, ALT_API, o, a), 'armed: wrong-key backend refused').toBeGreaterThanOrEqual(400);
  expect(noteCount(o, a)).toBe(0);

  let restored = false;
  const restore = () => {
    if (restored) return;
    sqlExec(
      snapshot
        .map(
          (r) =>
            `insert into app_settings (key, value) values (${sqlStr(r.key)}, ${sqlStr(r.value)}) on conflict (key) do update set value = excluded.value;`
        )
        .join('\n')
    );
    restored = true;
  };
  sqlExec(`delete from app_settings where starts_with(key, ${sqlStr(ARM_PREFIX)});`);
  try {
    expect(armRows()).toEqual([]);
    // Dormant on the very next statement.
    const r = await directRest(page, token, 'PATCH', `calendar_events?id=eq.${task.id}`, { title: `${title}_dormant` });
    expect(r.status, `dormant: the direct PATCH goes through (${JSON.stringify(r)})`).toBe(204);
    expect(eventRow(task.id).title).toBe(`${title}_dormant`);
    const b = `ZZ_E2E_WG_DISB_${uniqueSuffix()}`;
    expect(await postNoteVia(request, ALT_API, o, b), 'dormant: the wrong-key backend writes').toBe(201);
    expect(noteCount(o, b)).toBe(1);
  } finally {
    restore();
  }

  // Re-armed, same processes.
  expect(armRows()).toEqual(snapshot);
  expectGateRefused(await directRest(page, token, 'PATCH', `calendar_events?id=eq.${task.id}`, { title: `${title}_b` }), 're-armed: direct PATCH');
  expect(eventRow(task.id).title).toBe(`${title}_dormant`);
  const d = `ZZ_E2E_WG_DISD_${uniqueSuffix()}`;
  expect(await postNoteVia(request, ALT_API, o, d), 're-armed: wrong-key backend refused again').toBeGreaterThanOrEqual(400);
  expect(noteCount(o, d)).toBe(0);
  const e = `ZZ_E2E_WG_DISE_${uniqueSuffix()}`;
  expect(await postNoteVia(request, new URL(baseURL ?? 'http://localhost:5173').origin, o, e), 're-armed: right-key backend writes').toBe(201);
  expect(noteCount(o, e)).toBe(1);
});
