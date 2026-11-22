import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page, Route, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { runScopedEmail } from '../isolation';
import { dbCount, dbQuery, generateSignupOtp, sqlStr } from '../unhappy';
import { sqlExec } from '../db';
import { uniq } from '../unhappy/auth-invites/_helpers';

// FIRST RUN v2 in ALL 8 shipped languages (web, real browser, real local backend + DB), and the
// "does onboarding ever duplicate a medication?" hunt. Every case asserts on DATABASE ROWS, not only
// the UI. The English-only twin is first-run-v2.spec.ts; this file runs the SAME path for
// en, es, de, fr, fr-CA, it, pt, pt-PT, reading every string from the real locale JSON files
// (src/i18n/<lang>/<ns>.json, variants fall back to their base then English, like i18next does), so
// it follows the shipped copy and never hard-codes English.
//
//   POSITIVE  (per locale)
//     P0  the first-run medication form opens with NO time chip lit (owner 2026-11-21: no preselected
//         time on a new medication); Save with no time writes 0 rows and shows the validation (see N10)
//     P1  the whole flow: question -> account -> code -> circle forms -> first medication (Morning
//         chip picked by the person) -> All set -> Go to Today
//     P2  DB: exactly 1 circle, exactly 1 medication SERIES ROOT (parent_event_id null, not deleted);
//         every medication row of the circle is printed (id, parent, date, time, rule, created_at)
//     P3  UI: on Today and on the Medications page the medication is ONE medication (screenshots kept)
//     P4  no raw i18n key and no console error on any step
//     P5  two dose times (morning + evening chips): exactly 2 roots, one per time, never 3+
//     P6  the OWNER'S SCENARIO: a custom 07:00 through "Other..." then Save = exactly 1 root at 07:00
//     P7  Evening only = exactly 1 root at 18:00
//   NEGATIVE
//     N10 Save with no time: 0 rows, 0 POSTs, the inline validation, focus on the first chip
//     N11 EDITS untouched: an existing medication opens on its stored time and a chip still moves it;
//         the normal add-medication form (not first run) still opens with no time
//     N12 the type switch never seeds a time (owner 2026-11-22: NO new item opens with a time selected):
//         medication -> appointment / task opens with NO time, a time picked on one tab is not carried to
//         the next, -> medication opens with NO time; an appointment with no time picked writes 0 rows and
//         shows the validation; the appointment then saves ONCE at the time the person picked (09:00)
//     N6  double Save in the same tick (two click events in ONE page.evaluate): still 1 root
//     N7  lost response (POST /events reaches the backend, the answer is dropped): the automatic
//         retry must not write a second root; ALL attempts lost + a second Save press (N7b: same
//         Idempotency-Key, still 1 root); and the
//         multi-dose sibling "Retry" toast (does it reuse its Idempotency-Key?)
//     N8  Back / Escape / reload / reopen after the save: no further medication
//     N9  reload during "the circle forms by itself" and a lost POST /circles answer: exactly 1 circle
//
// FALSIFICATION: E2E_FALSIFY=strip-key makes N7a strip the Idempotency-Key from the retry, which
// MUST turn it red (a second root appears). Needs the backend started with
// EMAIL_BLOCKED_DOMAINS=circlecare.test (e2e/README.md).

test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = 'Str0ng!Passw0rd';
const LOCALES = ['en', 'es', 'de', 'fr', 'fr-CA', 'it', 'pt', 'pt-PT'] as const;
type Lang = (typeof LOCALES)[number];
const SHOTS = process.env.E2E_SHOTS_DIR ?? '/private/tmp/claude-501/-Users-meza-Desktop-projects-CircleCare/a3a38227-93f7-4e66-92b8-61ef246dbce9/scratchpad/shots';
mkdirSync(SHOTS, { recursive: true });
const FALSIFY = process.env.E2E_FALSIFY ?? '';

// ── Copy, straight from the locale files ─────────────────────────────────────────────────────────

const I18N = path.resolve(process.cwd(), 'src/i18n');
const cache = new Map<string, unknown>();
function loadNs(lang: string, ns: string): unknown {
  const k = `${lang}/${ns}`;
  if (!cache.has(k)) {
    try {
      cache.set(k, JSON.parse(readFileSync(path.join(I18N, lang, `${ns}.json`), 'utf8')));
    } catch {
      cache.set(k, {});
    }
  }
  return cache.get(k);
}
function dig(obj: unknown, keyPath: string): string | undefined {
  let cur: unknown = obj;
  for (const part of keyPath.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}
/** tr('en','circles:create.whoCaringFor') with i18next's fallback chain (variant -> base -> en). */
function tr(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const [ns, keyPath] = key.split(':');
  const chain = lang.includes('-') ? [lang, lang.split('-')[0], 'en'] : [lang, 'en'];
  for (const l of chain) {
    const raw = dig(loadNs(l, ns), keyPath);
    if (raw !== undefined) {
      return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => String(vars[name] ?? `{{${name}}}`));
    }
  }
  throw new Error(`no copy for ${lang} ${key}`);
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A copy line with `{{time}}` (or similar) as a wildcard, for a regex match. */
function copyRegex(lang: Lang, key: string, vars: Record<string, string>): RegExp {
  const text = tr(lang, key, { ...vars, time: '\u0000' });
  return new RegExp(`^${text.split('\u0000').map(esc).join('.{3,14}')}$`);
}

// ── Page plumbing ────────────────────────────────────────────────────────────────────────────────

const RAW_KEY =
  /\b(?:firstRun|addEvent|timeChips|payoff|allSet|writeRetry)\.[A-Za-z]+|\b(?:common|circles|auth|calendar|meds|overview|upgrade|invite|shifts|tasks|notes|members):[A-Za-z]+(?:\.[A-Za-z]+)+|\{\{|\[object Object\]/;

interface Watch {
  errors: string[];
  eventPosts: Request[];
}
function watch(page: Page): Watch {
  const w: Watch = { errors: [], eventPosts: [] };
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // The unauthenticated bootstrap probes (/auth/me 401 before login) are expected noise.
    if (/Failed to load resource.*(401|Unauthorized)/i.test(text)) return;
    w.errors.push(`console.error: ${text.slice(0, 300)}`);
  });
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/circles\/[0-9a-f-]{36}\/events$/.test(new URL(r.url()).pathname)) {
      w.eventPosts.push(r);
    }
  });
  return w;
}

async function noRawKeys(page: Page, where: string): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const hit = RAW_KEY.exec(text);
  expect.soft(hit, `raw i18n key / template leak visible at "${where}": ${hit?.[0]}`).toBeNull();
}

function userIdOf(email: string): string {
  const rows = dbQuery<{ id: string }>(`select id from public.users where email = ${sqlStr(email.toLowerCase())}`);
  expect(rows, `public.users row for ${email}`).toHaveLength(1);
  return rows[0].id;
}
const circlesOf = (userId: string) =>
  dbQuery<{ id: string; recipient_name: string }>(
    `select id, recipient_name from care_circles where owner_id = ${sqlStr(userId)}::uuid`
  );
interface MedRow {
  id: string;
  parent_event_id: string | null;
  scheduled_date: string;
  scheduled_time: string;
  recurrence_rule: string | null;
  created_at: string;
  deleted_at: string | null;
  refill_group_id: string | null;
}
const medRows = (circleId: string) =>
  dbQuery<MedRow>(
    `select id, parent_event_id, scheduled_date::text, scheduled_time::text, recurrence_rule, created_at::text, deleted_at::text, refill_group_id::text
       from calendar_events
      where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'medication'
      order by created_at, scheduled_time`
  );
const roots = (circleId: string) => medRows(circleId).filter((r) => r.parent_event_id === null && r.deleted_at === null);
/** Every series ROOT row incl. deleted (the pre-minted next-occurrence CHILD rows are expected, 1-2 per root). */
const allRoots = (circleId: string) => medRows(circleId).filter((r) => r.parent_event_id === null);
function printRows(label: string, circleId: string): void {
  const rows = medRows(circleId);
  const lines = rows.map(
    (r) =>
      `    ${r.id.slice(0, 8)} ${r.parent_event_id ? `child-of ${r.parent_event_id.slice(0, 8)}` : 'ROOT'.padEnd(17)} ` +
      `${r.scheduled_date} ${r.scheduled_time} rule=${r.recurrence_rule ?? '-'} refill_group=${r.refill_group_id ? r.refill_group_id.slice(0, 8) : '-'} created=${r.created_at}${r.deleted_at ? ' DELETED' : ''}`
  );
  console.log(`[MEDROWS] ${label}: ${rows.length} medication row(s) (${roots(circleId).length} root(s))\n${lines.join('\n')}`);
}

/**
 * Every saved field, against the DB (owner 2026-11-21: "validate all fields against the db so no more dupes").
 * `times` = the dose times the person picked ('08:00:00', ...), one ROOT each. The first root is the primary; a second dose is its
 * sibling (refill_group_id = the primary's id). The 1.4.3 bug wrote that sibling from a ONE-dose Save.
 */
function expectFullDbState(c: { userId: string; circleId: string; recipient: string; email: string }, name: string, times: string[]): void {
  const rows = dbQuery<{
    id: string; event_type: string; title: string | null; medication_name: string | null; medication_dosage: string | null;
    scheduled_date: string; scheduled_time: string; recurrence_rule: string | null; recurrence_days: string | null; recurrence_end_date: string | null;
    parent_event_id: string | null; refill_group_id: string | null; as_needed: boolean | null; entry_source: string | null;
    gone: boolean; shift_event_id: string | null; split_from_event_id: string | null; track_refills: boolean | null;
    notifications_enabled: boolean | null; created_by: string;
  }>(
    `select id::text, event_type, title, medication_name, medication_dosage, scheduled_date::text, scheduled_time::text, recurrence_rule,
            recurrence_days::text, recurrence_end_date::text, parent_event_id::text, refill_group_id::text, as_needed, entry_source,
            (deleted_at is not null or removed_at is not null or discontinued_at is not null or completed_at is not null) as gone,
            shift_event_id::text, split_from_event_id::text, track_refills, notifications_enabled, created_by::text
       from calendar_events where circle_id = ${sqlStr(c.circleId)}::uuid order by created_at, scheduled_time`
  );
  const rootRows = rows.filter((r) => r.parent_event_id === null);
  const kids = rows.filter((r) => r.parent_event_id !== null);
  expect(rootRows.map((r) => r.scheduled_time).sort(), 'one ROOT per picked dose time, nothing else in the circle').toEqual([...times].sort());
  expect(rows.every((r) => r.event_type === 'medication'), 'every row in the circle is a medication').toBe(true);
  expect(rows.every((r) => !r.gone), 'no row is deleted / removed / discontinued / completed').toBe(true);
  expect(rows.every((r) => r.created_by === c.userId), 'every row was created by the new account').toBe(true);
  expect(rows.every((r) => !r.shift_event_id && !r.split_from_event_id && r.as_needed !== true), 'no shift / split / as-needed row').toBe(true);
  const slots = rows.map((r) => `${r.scheduled_date} ${r.scheduled_time}`);
  expect(new Set(slots).size, `no two rows share a date + time: ${slots.join(', ')}`).toBe(slots.length);
  const lower = name.toLowerCase();
  for (const r of rootRows) {
    expect((r.title ?? '').trim().toLowerCase(), 'title = the typed name').toBe(lower);
    expect((r.medication_name ?? '').trim().toLowerCase(), 'medication_name = the typed name').toBe(lower);
    expect(r.medication_dosage ?? '', 'no dose typed, none saved').toBe('');
    expect(r.recurrence_rule, 'repeats every day').toBe('daily');
    expect(r.recurrence_days ?? null, 'no day-of-week list').toBeNull();
    expect(r.recurrence_end_date ?? null, 'no end date').toBeNull();
    expect(r.entry_source, 'entry_source').toBe('form');
    expect(r.track_refills, 'refill tracking off').toBe(false);
    expect(r.notifications_enabled, 'reminders on').toBe(true);
  }
  const groups = rootRows.map((r) => r.refill_group_id).filter(Boolean);
  if (times.length === 1) expect(groups, 'a ONE-dose medication has no sibling group').toEqual([]);
  else {
    const primaryIds = rootRows.map((r) => r.id);
    expect(groups.every((g) => primaryIds.includes(g as string)), 'sibling doses point at a root of this same medication').toBe(true);
  }
  for (const k of kids) {
    const parent = rootRows.find((r) => r.id === k.parent_event_id);
    expect(parent, `pre-minted day row ${k.scheduled_date} belongs to one of the roots`).toBeTruthy();
    expect(k.scheduled_time, 'same time as its root').toBe(parent!.scheduled_time);
    expect(k.title, 'same name as its root').toBe(parent!.title);
    expect(k.scheduled_date > parent!.scheduled_date, 'on a later date than its root').toBe(true);
  }
  expect(kids.length, 'at most 3 pre-minted day rows per root').toBeLessThanOrEqual(3 * times.length);
  const one = (sql: string) => Number(dbQuery<{ n: string }>(sql)[0].n);
  expect(one(`select count(*)::text n from medication_confirmations where circle_id = ${sqlStr(c.circleId)}::uuid`), 'no dose confirmed by the flow').toBe(0);
  const mem = dbQuery<{ user_id: string; role: string; view_only: boolean | null }>(`select user_id::text, role, view_only from circle_memberships where circle_id = ${sqlStr(c.circleId)}::uuid`);
  expect(mem, 'ONE membership').toHaveLength(1);
  expect([mem[0].user_id, mem[0].role, mem[0].view_only === true], 'the new account, owner, not view-only').toEqual([c.userId, 'owner', false]);
  expect(one(`select count(*)::text n from circle_memberships where user_id = ${sqlStr(c.userId)}::uuid`), 'the account is in exactly ONE circle').toBe(1);
  const circles = dbQuery<{ name: string | null; recipient_name: string | null; is_self_care: boolean | null; archived: boolean }>(
    `select name, recipient_name, is_self_care, (archived_at is not null) as archived from care_circles where owner_id = ${sqlStr(c.userId)}::uuid`
  );
  expect(circles, 'ONE circle owned').toHaveLength(1);
  expect([circles[0].recipient_name, circles[0].is_self_care === true, circles[0].archived], 'the circle: typed recipient, not self-care, not archived').toEqual([c.recipient, false, false]);
  expect(one(`select count(*)::text n from invites where circle_id = ${sqlStr(c.circleId)}::uuid`), 'no invite').toBe(0);
  expect(one(`select count(*)::text n from public.users where email = ${sqlStr(c.email.toLowerCase())}`), 'ONE account row for the address').toBe(1);
}

/** Appointment / task first item: every saved field against the DB (owner 2026-11-21 "test the task/appt too"). */
function expectItemDbState(c: { userId: string; circleId: string; recipient: string; email: string }, kind: 'appointment' | 'task', title: string): void {
  const rows = dbQuery<{
    event_type: string; title: string | null; scheduled_time: string; recurrence_rule: string | null; parent_event_id: string | null;
    medication_name: string | null; entry_source: string | null; gone: boolean; created_by: string; refill_group_id: string | null;
  }>(
    `select event_type, title, scheduled_time::text, recurrence_rule, parent_event_id::text, medication_name, entry_source,
            (deleted_at is not null or removed_at is not null or completed_at is not null) as gone, created_by::text, refill_group_id::text
       from calendar_events where circle_id = ${sqlStr(c.circleId)}::uuid`
  );
  expect(rows, `exactly ONE row in the circle: ${JSON.stringify(rows)}`).toHaveLength(1);
  const r = rows[0];
  expect([r.event_type, r.title, r.scheduled_time], 'the typed item at the time the person picked (09:00)').toEqual([kind, title, '09:00:00']);
  expect([r.recurrence_rule, r.parent_event_id, r.refill_group_id, r.medication_name], 'one-time, no child / sibling / medication fields').toEqual([null, null, null, null]);
  expect([r.entry_source, r.gone, r.created_by], 'from the form, live, by the new account').toEqual(['form', false, c.userId]);
  const one = (sql: string) => Number(dbQuery<{ n: string }>(sql)[0].n);
  expect(one(`select count(*)::text n from care_circles where owner_id = ${sqlStr(c.userId)}::uuid`), 'ONE circle').toBe(1);
  expect(one(`select count(*)::text n from circle_memberships where user_id = ${sqlStr(c.userId)}::uuid`), 'in ONE circle').toBe(1);
  expect(one(`select count(*)::text n from invites where circle_id = ${sqlStr(c.circleId)}::uuid`), 'no invite').toBe(0);
  expect(one(`select count(*)::text n from public.users where email = ${sqlStr(c.email.toLowerCase())}`), 'ONE account').toBe(1);
}

// ── The flow, step by step (each returns, so a case can intervene between steps) ────────────────

interface Ctx {
  lang: Lang;
  page: Page;
  w: Watch;
  recipient: string;
  email: string;
  userId: string;
  circleId: string;
}

async function signupToCircle(page: Page, lang: Lang, w: Watch, opts: { reloadInMoment?: boolean } = {}): Promise<Ctx> {
  const recipient = uniq('Rosa').slice(0, 30);
  const email = runScopedEmail(uniq(`frl-${lang.toLowerCase()}`));
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${lang.split('-')[0]}`));
  await expect(page.getByRole('heading', { level: 1, name: tr(lang, 'circles:create.whoCaringFor') })).toBeVisible({
    timeout: 20_000,
  });
  await noRawKeys(page, 'question');
  await page.locator('#first-run-recipient-name').fill(recipient);
  await expect(page.getByTestId('first-run-who-preview')).toContainText(tr(lang, 'circles:firstRun.who.preview', { name: recipient }));
  await page.getByTestId('first-run-who-continue').click();

  await expect(page.getByRole('heading', { name: tr(lang, 'auth:signup.title') })).toBeVisible({ timeout: 20_000 });
  await noRawKeys(page, 'create account');
  await page.locator('#first_name').fill('Maria');
  await page.locator('#last_name').fill('Lopez');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#termsAccepted').check({ force: true });
  await page.getByRole('button', { name: tr(lang, 'auth:signup.createAccountButton'), exact: true }).click();
  await expect(page.getByRole('heading', { name: tr(lang, 'auth:verifyOtp.title') })).toBeVisible({ timeout: 20_000 });
  await noRawKeys(page, 'verify');

  // The blocked-domain signup answers a fake 200 and creates nothing, so (as the real signup would
  // have) the account is made with its code by GoTrue admin, and the profile language the real
  // signup payload carries ("language": the browser's locale) is written to the row.
  const otp = await generateSignupOtp(email, PASSWORD);
  sqlExec(`update public.users set language = ${sqlStr(lang)} where email = ${sqlStr(email.toLowerCase())}`);
  await page.getByLabel(tr(lang, 'common:otpDigit', { index: 1, length: 6 })).click();
  await page.keyboard.type(otp, { delay: 20 });

  await expect(page.getByTestId('first-run-circle-moment')).toBeVisible({ timeout: 30_000 });
  const userId = userIdOf(email);
  if (opts.reloadInMoment) return { lang, page, w, recipient, email, userId, circleId: '' };
  await expect(page.getByText(tr(lang, 'circles:firstRun.ready.title', { name: recipient }))).toBeVisible({ timeout: 30_000 });
  await noRawKeys(page, 'circle moment');
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('tablist')).toBeVisible({ timeout: 30_000 });
  const circles = circlesOf(userId);
  expect(circles, 'exactly ONE circle after the automatic create').toHaveLength(1);
  return { lang, page, w, recipient, email, userId, circleId: circles[0].id };
}

const medNameBox = (c: Ctx) =>
  c.page.getByRole('combobox', { name: new RegExp(`^${esc(tr(c.lang, 'calendar:addEvent.fields.medicationName'))}`) });
const chip = (c: Ctx, id: 'morning' | 'evening') =>
  c.page.getByRole('checkbox', { name: new RegExp(`${esc(tr(c.lang, `calendar:addEvent.timeChips.${id}`))}$`) });

/** Name + the time chips the person picks themselves (owner 2026-11-21: none is preselected). */
async function fillForm(c: Ctx, name: string, doses: 1 | 2): Promise<void> {
  await expect(chip(c, 'morning')).not.toBeChecked();
  await chip(c, 'morning').click();
  await expect(chip(c, 'morning')).toBeChecked();
  if (doses === 2) {
    await chip(c, 'evening').click();
    await expect(chip(c, 'evening')).toBeChecked();
  }
  await medNameBox(c).fill(name);
  await noRawKeys(c.page, 'first-item form');
}

async function waitAllSet(c: Ctx): Promise<void> {
  await expect(c.page.getByTestId('first-run-all-set')).toBeVisible({ timeout: 30_000 });
  await expect(c.page.getByTestId('first-run-all-set-title')).toContainText(c.recipient);
  await noRawKeys(c.page, 'all set');
}

async function goToToday(c: Ctx): Promise<void> {
  await c.page.getByTestId('first-run-go-to-today').click();
  await expect(c.page).toHaveURL(/\/(upgrade|circles\/[0-9a-f-]{36})$/, { timeout: 30_000 });
  if (/\/upgrade$/.test(c.page.url())) {
    await c.page.getByRole('button', { name: new RegExp(esc(tr(c.lang, 'upgrade:onboarding.continueFree'))) }).click();
    await c.page.waitForURL(new RegExp(`/circles/${c.circleId}$`), { timeout: 30_000 });
  }
  await expect(c.page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
}

const countOf = (page: Page, text: string) => page.getByText(text, { exact: false }).evaluateAll((els, t) => els.filter((e) => (e as HTMLElement).offsetParent !== null && (e.textContent ?? '').includes(t as string) && Array.from(e.children).every((ch) => !(ch.textContent ?? '').includes(t as string))).length, text);

async function checkTodayAndMeds(c: Ctx, name: string, doses: 1 | 2, tag: string): Promise<void> {
  const { page } = c;
  await page.waitForTimeout(1500);
  await noRawKeys(page, 'Today');
  const todayName = await countOf(page, name);
  const markIt = await page.getByTestId('first-med-mark-it').count();
  console.log(`[TODAY] ${tag}: name shown ${todayName}x (leaf elements), first-med-mark-it rows ${markIt}`);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-today.png`), fullPage: true });
  // ONE medication on Today: the note row and a dose row must not both name the same dose.
  expect.soft(todayName, `Today shows the medication "${name}" ${todayName}x for ${doses} dose time(s) (candidate duplicate; see ${tag}-today.png)`).toBeLessThanOrEqual(doses);

  await page.goto(`/circles/${c.circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000);
  await noRawKeys(page, 'Medications');
  const rowsN = await page.getByTestId('med-time-row').count();
  const medsName = await countOf(page, name);
  console.log(`[MEDS] ${tag}: med-time-row x${rowsN}, name shown ${medsName}x`);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-meds.png`), fullPage: true });
  expect.soft(rowsN, `Medications page has ${rowsN} dose rows for ${doses} dose time(s) (see ${tag}-meds.png)`).toBe(doses);
  expect.soft(medsName, `Medications page names the med ${medsName}x for ${doses} dose time(s)`).toBeLessThanOrEqual(doses);
}

// ── POSITIVE, per locale ─────────────────────────────────────────────────────────────────────────

for (const lang of LOCALES) {
  test.describe(`first run v2 [${lang}]`, () => {
    test.use({ locale: lang });

    test(`P1-P4 [${lang}] POSITIVE one dose: whole flow, 1 circle, 1 medication root, ONE medication on Today and Medications, no raw keys, no console errors`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      const name = 'Metformin';
      await fillForm(c, name, 1);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      await expect(page.getByTestId('first-run-all-set-title')).toHaveText(copyRegex(lang, 'circles:firstRun.payoff.title', { name: c.recipient }));

      expect(circlesOf(c.userId), 'exactly 1 circle owned by the user').toHaveLength(1);
      printRows(`${lang} single dose`, c.circleId);
      const rs = roots(c.circleId);
      expect(rs, 'exactly 1 medication SERIES ROOT').toHaveLength(1);
      expect(rs[0].scheduled_time, 'the Morning chip the person picked').toBe('08:00:00');
      expectFullDbState(c, name, ['08:00:00']);
      expect(w.eventPosts, 'exactly 1 POST /events left the browser').toHaveLength(1);
      expect(await page.getByRole('tablist').count(), 'the form is closed on All set').toBe(0);

      await goToToday(c);
      await checkTodayAndMeds(c, name, 1, `${lang}-single`);
      expect(roots(c.circleId), 'still 1 root after Today and Medications').toHaveLength(1);
      expectFullDbState(c, name, ['08:00:00']);
      expect(w.errors, 'no console errors / page errors').toEqual([]);
    });

    test(`P5 [${lang}] POSITIVE two dose times (morning + evening): exactly 2 roots, one per time`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      const name = 'Lisinopril';
      await fillForm(c, name, 2);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      printRows(`${lang} two doses`, c.circleId);
      const rs = roots(c.circleId);
      expect(rs, 'exactly 2 roots (one per dose time), never 3+').toHaveLength(2);
      const times = rs.map((r) => r.scheduled_time).sort();
      expect(new Set(times).size, `two DISTINCT times, got ${times}`).toBe(2);
      expect(times[0]).toBe('08:00:00');
      expect(w.eventPosts, 'exactly 2 POST /events').toHaveLength(2);
      expect(circlesOf(c.userId)).toHaveLength(1);

      await goToToday(c);
      await checkTodayAndMeds(c, name, 2, `${lang}-double`);
      expect(roots(c.circleId), 'still 2 roots').toHaveLength(2);
      expectFullDbState(c, name, ['08:00:00', '18:00:00']);
      expect(w.errors, 'no console errors / page errors').toEqual([]);
    });

    test(`N6 [${lang}] NEGATIVE double Save in the same tick: still exactly 1 root`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      await fillForm(c, 'Metformin', 1);
      // Two click events inside ONE evaluate: no render can commit between them.
      await page.evaluate(() => {
        const b = document.querySelector('[data-testid="add-event-save"]') as HTMLButtonElement;
        b.click();
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await waitAllSet(c);
      await page.waitForTimeout(2500);
      printRows(`${lang} double click`, c.circleId);
      expect(roots(c.circleId), 'double Save: exactly 1 root').toHaveLength(1);
      expect(allRoots(c.circleId), 'double Save: exactly 1 root row at all (children are pre-minted occurrences)').toHaveLength(1);
      expectFullDbState(c, 'Metformin', ['08:00:00']);
      expect(w.eventPosts, 'double Save: 1 POST /events').toHaveLength(1);
    });

    // owner 2026-11-21: no preselected time on a new medication. These were the two "B1" repros of the old
    // Morning-8:00-preselected bug (a second pick ADDED a dose); now they are ordinary passing cases.
    test(`P6 [${lang}] POSITIVE the owner's scenario: a custom 07:00 through "Other..." then Save = exactly 1 root at 07:00`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      await expect(chip(c, 'morning')).not.toBeChecked(); // owner 2026-11-21: no preselected time on a new medication
      await medNameBox(c).fill('Metformin');
      await page.locator('#scheduled_time').fill('07:00');
      await page.waitForTimeout(500);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      await page.waitForTimeout(1500);
      printRows(`${lang} P6 other-7am`, c.circleId);
      const rs = roots(c.circleId);
      expect(rs, `expected 1 root at 07:00, got ${rs.length}: ${rs.map((r) => r.scheduled_time).join(', ')}`).toHaveLength(1);
      expect(rs[0].scheduled_time).toBe('07:00:00');
      expectFullDbState(c, 'Metformin', ['07:00:00']);
      expect(allRoots(c.circleId)).toHaveLength(1);
      expect(w.eventPosts, 'exactly 1 POST /events').toHaveLength(1);
    });

    test(`P7 [${lang}] POSITIVE Evening only = exactly 1 root at 18:00`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      await expect(chip(c, 'morning')).not.toBeChecked();
      await medNameBox(c).fill('Metformin');
      await chip(c, 'evening').click();
      await expect(chip(c, 'evening')).toBeChecked();
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      await page.waitForTimeout(1500);
      printRows(`${lang} P7 evening`, c.circleId);
      const rs = roots(c.circleId);
      expect(rs, `expected 1 root at 18:00, got ${rs.length}: ${rs.map((r) => r.scheduled_time).join(', ')}`).toHaveLength(1);
      expect(rs[0].scheduled_time).toBe('18:00:00');
      expectFullDbState(c, 'Metformin', ['18:00:00']);
      expect(w.eventPosts).toHaveLength(1);
    });

    test(`P0/N10 [${lang}] the form opens with NO time lit; NEGATIVE Save with no time writes 0 rows and shows the validation; picking Morning clears it and saves 1 root`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      // P0: owner 2026-11-21: no preselected time on a new medication.
      for (const id of ['morning', 'evening'] as const) await expect(chip(c, id)).not.toBeChecked();
      await expect(page.getByRole('checkbox', { checked: true }), 'no time chip is lit').toHaveCount(0);
      await expect(page.locator('#scheduled_time')).toHaveValue('');
      await medNameBox(c).fill('Metformin');
      // N10: the same inline validation as the normal add-medication form.
      const timeRequired = tr(lang, 'calendar:addEvent.validation.timeRequired');
      await expect(page.getByText(timeRequired)).toHaveCount(0);
      await page.getByTestId('add-event-save').click();
      await expect(page.getByText(timeRequired).first(), `validation text (${lang}): ${timeRequired}`).toBeVisible({ timeout: 10_000 });
      await expect(chip(c, 'morning'), 'focus goes to the first time chip').toBeFocused();
      await page.waitForTimeout(1500);
      expect(medRows(c.circleId), 'Save with no time writes 0 medication rows').toHaveLength(0);
      expect(w.eventPosts, 'Save with no time sends no POST /events').toHaveLength(0);
      expect(await page.getByTestId('first-run-all-set').count(), 'still on the form').toBe(0);
      await noRawKeys(page, 'validation');
      // Picking a time clears the error and the save then writes ONE root.
      await chip(c, 'morning').click();
      await expect(page.getByText(timeRequired)).toHaveCount(0);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      expect(roots(c.circleId)).toHaveLength(1);
      expect(w.errors, 'no console errors / page errors').toEqual([]);
    });

    test(`N11 [${lang}] NEGATIVE edits untouched: an existing medication opens on its stored time and a chip still moves it; the normal add form (not first run) opens with no time`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      const name = 'Metformin';
      await fillForm(c, name, 1);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      await goToToday(c);
      await page.goto(`/circles/${c.circleId}/meds`, { waitUntil: 'domcontentloaded' });
      const card = page.getByTestId('med-time-row').filter({ hasText: name });
      await expect(card).toBeVisible({ timeout: 20_000 });

      // The normal add-medication form: no chip lit.
      await page.getByRole('button', { name: tr(lang, 'meds:page.add') }).first().click();
      const addDialog = page.getByRole('dialog').last();
      await expect(addDialog.getByRole('checkbox', { name: new RegExp(`${esc(tr(lang, 'calendar:addEvent.timeChips.morning'))}$`) })).toBeVisible({ timeout: 15_000 });
      await expect(addDialog.getByRole('checkbox', { checked: true }), 'normal add form: no time lit').toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(addDialog).toBeHidden({ timeout: 10_000 });

      // Edit: opens on the stored 08:00 (Morning lit), and a chip still moves it.
      await card.getByRole('button', { name: tr(lang, 'meds:page.actions.more', { name }) }).click();
      await page.getByRole('menu').getByRole('menuitem', { name: tr(lang, 'meds:page.actions.edit'), exact: true }).click();
      const dialog = page.getByRole('dialog', { name: tr(lang, 'calendar:addEvent.simple.editMedication') });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      const group = dialog.getByRole('radiogroup', { name: tr(lang, 'calendar:addEvent.timeChips.label') });
      const radio = (id: 'morning' | 'evening') =>
        group.getByRole('radio', { name: new RegExp(`${esc(tr(lang, `calendar:addEvent.timeChips.${id}`))}$`) });
      await expect(radio('morning'), 'edit opens on its stored time').toBeChecked({ timeout: 15_000 });
      await radio('evening').click();
      await expect(radio('evening'), 'a chip still moves the time on an edit').toBeChecked();
      await expect(radio('morning')).not.toBeChecked();
      await page.keyboard.press('Escape');
      printRows(`${lang} N11 after edit/add forms (nothing saved)`, c.circleId);
      expect(roots(c.circleId), 'opening the add and edit forms writes nothing').toHaveLength(1);
      expect(roots(c.circleId)[0].scheduled_time).toBe('08:00:00');
    });

    test(`N12 [${lang}] NEGATIVE the type switch never seeds a time: appointment / task / medication all open with NO time; no time = 0 rows; the appointment saves at the picked 09:00`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      const tab = (kind: 'medication' | 'appointment' | 'task') =>
        page.getByRole('tab', { name: tr(lang, `calendar:eventTypes.${kind}`) });
      const nine = /\b0?9\s?[:.h]\s?00/;
      const noTime = tr(lang, 'shifts:form.chooseTime');
      await expect(chip(c, 'morning')).not.toBeChecked(); // untouched medication: nothing lit
      await tab('appointment').click();
      await expect(page.getByTestId('appt-from-tile')).toContainText(noTime, { timeout: 15_000 });
      await expect(page.getByTestId('appt-from-tile')).not.toContainText(nine);
      await expect(page.locator('#scheduled_time')).toHaveValue('');
      // A time picked on the appointment tab is not carried to the task tab (each tab is a fresh form).
      await page.locator('#scheduled_time').fill('10:30');
      await tab('task').click();
      await expect(page.getByTestId('task-from-tile')).toContainText(noTime, { timeout: 15_000 });
      await expect(page.locator('#scheduled_time')).toHaveValue('');
      await tab('medication').click();
      await expect(chip(c, 'morning')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('checkbox', { checked: true }), 'appointment/task -> medication: no time carried over').toHaveCount(0);
      await expect(page.locator('#scheduled_time')).toHaveValue('');
      await medNameBox(c).fill('Metformin');
      await page.getByTestId('add-event-save').click();
      await expect(page.getByText(tr(lang, 'calendar:addEvent.validation.timeRequired')).first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      expect(medRows(c.circleId), 'the medication without a time wrote nothing').toHaveLength(0);
      // The appointment opens with no time; Save without one writes nothing (the form's time validation).
      await tab('appointment').click();
      await expect(page.getByTestId('appt-from-tile')).toContainText(noTime, { timeout: 15_000 });
      await page.locator('#title').fill('Doctor visit');
      await page.getByTestId('add-event-save').click();
      await expect(page.getByText(tr(lang, 'calendar:addEvent.validation.pickTime'), { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(tr(lang, 'calendar:addEvent.validation.timeRequired'))).toHaveCount(0);
      await page.waitForTimeout(1000);
      expect(dbCount(`select 1 from calendar_events where circle_id = ${sqlStr(c.circleId)}::uuid`), 'no time picked: 0 rows').toBe(0);
      // The person picks 09:00: it saves ONCE at 09:00.
      await page.locator('#scheduled_time').fill('09:00');
      await expect(page.getByTestId('appt-from-tile')).toContainText(nine);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      const appts = dbQuery<{ scheduled_time: string }>(
        `select scheduled_time::text from calendar_events where circle_id = ${sqlStr(c.circleId)}::uuid and event_type = 'appointment' and parent_event_id is null`
      );
      expect(appts.map((r) => r.scheduled_time)).toEqual(['09:00:00']);
      expect(medRows(c.circleId), 'no medication row').toHaveLength(0);
      expectItemDbState(c, 'appointment', 'Doctor visit');
      expect(w.errors).toEqual([]);
    });

    test(`P9 [${lang}] POSITIVE task as the first item: the Task tab opens with NO time, the person picks 09:00, the task saves ONCE at 09:00, All set, Today`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      await page.getByRole('tab', { name: tr(lang, 'calendar:eventTypes.task') }).click();
      await expect(page.getByTestId('task-from-tile')).toContainText(tr(lang, 'shifts:form.chooseTime'), { timeout: 15_000 });
      await expect(page.locator('#scheduled_time')).toHaveValue('');
      await page.locator('#title').fill('Pick up prescription');
      await page.locator('#scheduled_time').fill('09:00');
      await expect(page.getByTestId('task-from-tile')).toContainText(/\b0?9\s?[:.h]\s?00/);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      await page.waitForTimeout(1500);
      expect(w.eventPosts, 'exactly 1 POST /events').toHaveLength(1);
      expectItemDbState(c, 'task', 'Pick up prescription');
      await page.screenshot({ path: test.info().outputPath(`first-run-task-all-set-${lang}.png`), fullPage: true });
      await goToToday(c);
      expectItemDbState(c, 'task', 'Pick up prescription');
      await noRawKeys(page, `Today after a task first item [${lang}]`);
      expect(w.errors, 'no console errors / page errors').toEqual([]);
    });

    test(`N8 [${lang}] NEGATIVE Back / Escape / reload / reopening after the save never adds a medication`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      await fillForm(c, 'Metformin', 1);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      expect(roots(c.circleId)).toHaveLength(1);

      // Escape on All set, then the browser Back, then Forward, then a reload mid-flow.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      await page.goBack().catch(() => undefined);
      await page.waitForTimeout(1200);
      await page.goForward().catch(() => undefined);
      await page.waitForTimeout(800);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2500);
      const reopened = await page.getByRole('tablist').count();
      console.log(`[N8] ${lang}: after Escape/Back/Forward/reload the first-item form is ${reopened ? 'OPEN again' : 'not shown'}; url=${new URL(page.url()).pathname}`);
      printRows(`${lang} after back/reload`, c.circleId);
      expect(roots(c.circleId), 'after Escape/Back/Forward/reload: still exactly 1 root').toHaveLength(1);
      expect(allRoots(c.circleId), 'no extra root of any kind').toHaveLength(1);
      expect(circlesOf(c.userId), 'still 1 circle').toHaveLength(1);
      // Open the circle again from scratch: no medication appears from nowhere.
      await page.goto(`/circles/${c.circleId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      expect(allRoots(c.circleId)).toHaveLength(1);
      expect(w.eventPosts, 'one POST /events in the whole session').toHaveLength(1);
    });
  });
}

// ── NEGATIVE: lost responses (en + es) ───────────────────────────────────────────────────────────

const EVENTS_URL = /\/api\/circles\/[0-9a-f-]{36}\/events$/;

for (const lang of ['en', 'es'] as const) {
  test.describe(`lost responses [${lang}]`, () => {
    test.use({ locale: lang });

    test(`N7a [${lang}] NEGATIVE the answer to the first POST /events is lost (the row IS written): the automatic retry must not make a second root`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      const seen: Array<{ key: string | undefined; dropped: boolean }> = [];
      let first = true;
      await page.route(EVENTS_URL, async (route: Route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const key = req.headers()['idempotency-key'];
        if (first) {
          first = false;
          const res = await route.fetch(); // the backend writes the row
          seen.push({ key, dropped: true });
          void res;
          return route.abort('connectionreset'); // ...and the browser never sees the answer
        }
        seen.push({ key, dropped: false });
        if (FALSIFY === 'strip-key') {
          const headers = { ...req.headers() };
          delete headers['idempotency-key'];
          return route.continue({ headers }); // FALSIFICATION: the retry no longer carries its key
        }
        return route.continue();
      });
      await fillForm(c, 'Metformin', 1);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      await page.waitForTimeout(1500);
      console.log(`[N7a] ${lang}: POST attempts ${JSON.stringify(seen)}`);
      printRows(`${lang} lost first response`, c.circleId);
      expect(seen.length, 'the client retried by itself after the lost answer').toBeGreaterThanOrEqual(2);
      expect(seen[0].key, 'the first attempt carries an Idempotency-Key').toBeTruthy();
      expect(roots(c.circleId), 'lost response + automatic retry: exactly 1 root').toHaveLength(1);
      expect(allRoots(c.circleId)).toHaveLength(1);
    });

    test(`N7b [${lang}] NEGATIVE the answer is lost on EVERY automatic attempt (the row is written), then the user presses Save again: no second root`, async ({ page }) => {
      test.slow();
      test.setTimeout(150_000);
      // The form remembers its save (Option A, 2026-11-21, lib/saveIntentKeys.ts): the second Save press with an
      // unchanged payload carries the SAME Idempotency-Key as the lost attempts, so the server replays the first
      // answer instead of writing a second root.
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      let dropAll = true;
      const seen: Array<{ key: string | undefined; dropped: boolean }> = [];
      await page.route(EVENTS_URL, async (route: Route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const key = req.headers()['idempotency-key'];
        if (dropAll) {
          await route.fetch();
          seen.push({ key, dropped: true });
          return route.abort('connectionreset');
        }
        seen.push({ key, dropped: false });
        return route.continue();
      });
      await fillForm(c, 'Metformin', 1);
      const save = page.getByTestId('add-event-save');
      await save.click();
      // 1 first try + 3 retries (1 s / 3 s / 7 s) all lose their answer: the form stays, the save "failed".
      await expect.poll(() => seen.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(4);
      await page.waitForTimeout(1500);
      expect(await page.getByTestId('first-run-all-set').count(), 'not on All set: the client believes the save failed').toBe(0);
      const afterAuto = roots(c.circleId).length;
      dropAll = false;
      await expect(save).toBeEnabled({ timeout: 20_000 });
      await save.click();
      await waitAllSet(c);
      await page.waitForTimeout(1500);
      console.log(`[N7b] ${lang}: attempts ${JSON.stringify(seen)}; roots after the failed auto sequence=${afterAuto}`);
      printRows(`${lang} all attempts lost then second Save`, c.circleId);
      expect(afterAuto, 'the lost-answer attempts wrote exactly one row').toBe(1);
      const keys = seen.map((x) => x.key);
      expect(keys.every((k) => !!k), 'every attempt carried an Idempotency-Key').toBe(true);
      expect(new Set(keys).size, 'the second Save press carried the SAME Idempotency-Key as the lost attempts').toBe(1);
      expect(roots(c.circleId), 'second Save press after a lost answer: still exactly 1 root').toHaveLength(1);
      expect(allRoots(c.circleId)).toHaveLength(1);
    });

    test(`N7c [${lang}] NEGATIVE multi-dose: the extra dose's answer is lost on every attempt, the user presses the toast's Retry: exactly 2 roots, and the Retry reuses the Idempotency-Key`, async ({ page }) => {
      test.slow();
      test.setTimeout(180_000);
      const w = watch(page);
      const c = await signupToCircle(page, lang, w);
      let dropSibling = true;
      let n = 0;
      const attempts: Array<{ n: number; key: string | undefined; time: string; dropped: boolean }> = [];
      await page.route(EVENTS_URL, async (route: Route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const body = req.postDataJSON() as { scheduled_time?: string };
        const key = req.headers()['idempotency-key'];
        n += 1;
        const isFirstDose = (body.scheduled_time ?? '').startsWith('08:00');
        if (!isFirstDose && dropSibling) {
          await route.fetch(); // written...
          attempts.push({ n, key, time: body.scheduled_time ?? '', dropped: true });
          return route.abort('connectionreset'); // ...answer lost
        }
        attempts.push({ n, key, time: body.scheduled_time ?? '', dropped: false });
        return route.continue();
      });
      await fillForm(c, 'Lisinopril', 2);
      await page.getByTestId('add-event-save').click();
      // The primary saves (All set), the evening dose loses every answer: the warning toast with Retry.
      await waitAllSet(c);
      const retryBtn = page.getByRole('button', { name: tr(lang, 'common:writeRetry.retry'), exact: true });
      await expect(retryBtn).toBeVisible({ timeout: 60_000 });
      const beforeRetry = attempts.length;
      const rowsBefore = roots(c.circleId).length;
      console.log(`[N7c] ${lang}: before Retry attempts=${JSON.stringify(attempts)} roots=${rowsBefore}`);
      dropSibling = false;
      await retryBtn.click();
      await expect.poll(() => attempts.length, { timeout: 30_000 }).toBeGreaterThan(beforeRetry);
      await page.waitForTimeout(2500);
      const siblingKeys = attempts.filter((a) => !a.time.startsWith('08:00')).map((a) => a.key);
      const retryKey = siblingKeys[siblingKeys.length - 1];
      const reused = !!retryKey && siblingKeys.slice(0, -1).every((k) => k === retryKey);
      console.log(`[N7c] ${lang}: sibling keys=${JSON.stringify(siblingKeys)} -> Retry reuses the Idempotency-Key: ${reused ? 'YES' : 'NO'}`);
      printRows(`${lang} sibling lost then Retry`, c.circleId);
      expect(rowsBefore, 'the lost-answer attempts wrote the evening dose once').toBe(2);
      expect(reused, `Retry reuses the Idempotency-Key of the lost attempts (${JSON.stringify(siblingKeys)})`).toBe(true);
      expect(roots(c.circleId), 'after Retry: exactly 2 roots (never 3)').toHaveLength(2);
    });
  });
}

// ── NEGATIVE: the automatic circle create (en + es) ──────────────────────────────────────────────

for (const lang of ['en', 'es'] as const) {
  test.describe(`circle create [${lang}]`, () => {
    test.use({ locale: lang });
    const CIRCLES_URL = /\/api\/circles$/;

    test(`N9a [${lang}] NEGATIVE reload while "the circle forms by itself" is in flight (the backend has it): exactly 1 circle`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      let landed = false;
      await page.route(CIRCLES_URL, async (route: Route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const res = await route.fetch(); // the backend creates the circle
        landed = true;
        await new Promise((r) => setTimeout(r, 6000)); // hold the answer while the test reloads
        return route.fulfill({ response: res }).catch(() => undefined);
      });
      const c = await signupToCircle(page, lang, w, { reloadInMoment: true });
      await expect.poll(() => landed, { timeout: 20_000 }).toBe(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.unroute(CIRCLES_URL);
      await page.waitForTimeout(4000);
      const rows = circlesOf(c.userId);
      console.log(`[N9a] ${lang}: after reload circles=${rows.length}, url=${new URL(page.url()).pathname}, form open=${await page.getByRole('tablist').count()}`);
      expect(rows, 'reload during the automatic circle create: exactly 1 circle').toHaveLength(1);
      // Whatever the person does next, the circle is not made again by the app itself.
      await page.waitForTimeout(3000);
      expect(circlesOf(c.userId)).toHaveLength(1);
      expect(medRows(rows[0].id), 'no medication appears from a reload').toHaveLength(0);
    });

    test(`N9b [${lang}] NEGATIVE the answer to POST /circles is lost (the circle IS made): the automatic retry / Retry still gives exactly 1 circle and reaches the first-item form`, async ({ page }) => {
      test.slow();
      const w = watch(page);
      let first = true;
      const keys: Array<string | undefined> = [];
      await page.route(CIRCLES_URL, async (route: Route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        keys.push(req.headers()['idempotency-key']);
        if (first) {
          first = false;
          await route.fetch();
          return route.abort('connectionreset');
        }
        return route.continue();
      });
      const c = await signupToCircle(page, lang, w);
      console.log(`[N9b] ${lang}: POST /circles keys=${JSON.stringify(keys)}`);
      expect(keys.length, 'the create was retried after the lost answer').toBeGreaterThanOrEqual(2);
      expect(circlesOf(c.userId), 'exactly 1 circle').toHaveLength(1);
      await fillForm(c, 'Metformin', 1);
      await page.getByTestId('add-event-save').click();
      await waitAllSet(c);
      expect(roots(c.circleId)).toHaveLength(1);
    });
  });
}

// keep dbCount imported for ad-hoc debugging of a failing run
void dbCount;
