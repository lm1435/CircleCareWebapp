import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { IsolatedAccount } from '../isolation';
import { checkA11y, expandAllDayOverflow, pinRecipientZoneToBrowser } from '../helpers';
import { apiSession, countRequests, errorCodeOf } from '../unhappy';
import { sqlExec, sqlStr } from '../db';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';

// "DAYS OF THE WEEK" REPEAT — one series on several weekdays (Mon/Wed/Fri).
// Spec: docs/plans/weekly-days-of-week.md (Task 26).
//
// Drives the real AddEventModal against the real backend and reads the result
// back out of the surfaces that render it:
//   1. EN: a Mon/Wed/Fri medication and a Tue/Thu task, created through the UI.
//      The calendar shows them ONLY on those weekdays, in two consecutive
//      weeks; the event detail — the first occurrence AND a later (virtual)
//      one — and the Medications roster say "Weekly on Mon, Wed, Fri".
//      The task starts on a Monday that is NOT selected, so the form's
//      "First time" move is exercised too (saved on the Tuesday).
//   2. ES: chip order is locale week order (lun … dom) and the roster says
//      "Semanal los lun, mié, vie".
//   3. A STARTED series (seeded via the API with an anchor two weeks ago)
//      locks its anchor weekday chip (checked + aria-disabled + the lock
//      note), axe passes on the open picker including that chip, the backend
//      refuses a days set that drops the anchor weekday
//      (RECURRENCE_DAYS_EXCLUDE_START), and switching the editor back to plain
//      Weekly saves `recurrence_days: null` (read back from the API) and the
//      roster says "Weekly".
//   4. 0 days selected → inline field error, no POST.
//   5. GEOMETRY in the real browser (jsdom cannot measure): every chip is a
//      >=44x44 target, and at 375px the row WRAPS inside the dialog with no
//      horizontal scroll anywhere.
//
// Dates: never literals, always >= 7 days out (the medication start roll only
// fires for TODAY; see project_medication_start_roll), and weekdays are
// computed from the date STRING (UTC noon), never a local Date's getDay().
// The isolated account's recipient timezone is America/Denver, the same zone
// the runner's browser uses, so the form's date is the stored date.
//
// Data hygiene: every title is ZZ_E2E_DOW_<tag>_<unique>; an afterEach API
// sweep deletes every series this worker created (deleteScope=series per root).

const PREFIX = 'ZZ_E2E_DOW_';
const createdNames = new Set<string>();

function uniqueName(tag: string): string {
  const name = `${PREFIX}${tag}_${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  createdNames.add(name);
  return name;
}

// ---------------------------------------------------------------------------
// Date helpers — string math, 0=Sun like `recurrence_days`.
// ---------------------------------------------------------------------------

/** Runner-local today as YYYY-MM-DD (runner TZ == recipient TZ here). */
function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** The first date >= today + minOffset whose weekday is `dow`. */
function nextWeekdayAtLeast(minOffset: number, dow: number): string {
  let d = addDays(todayISO(), minOffset);
  while (weekdayOf(d) !== dow) d = addDays(d, 1);
  return d;
}

function longWeekday(dow: number, locale = 'en-US'): string {
  // 2026-09-27 is only a reference Sunday for Intl, never a scheduled date.
  const ref = new Date(Date.UTC(2026, 8, 27 + dow, 12));
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(ref);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** Continue through the non-blocking past-time notice if it shows (it should not: dates are future). */
async function submitAndClose(page: Page, dialog: Locator, buttonName: string | RegExp): Promise<void> {
  await dialog.getByRole('button', { name: buttonName }).click();
  const notice = page.getByRole('dialog', {
    name: /^(Time already passed|Starts with the next dose|La hora ya pasó|Empieza con la próxima dosis)$/,
  });
  const shown = await notice
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) await notice.getByRole('button', { name: /^(Continue|Continuar)$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

/** The chip group ("Repeat on" / "Repetir los") inside a dialog. */
function chipGroup(dialog: Locator, name: string | RegExp = 'Repeat on'): Locator {
  return dialog.getByRole('group', { name });
}

const WEEK_RANGE_HEADING = /^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}, \d{4}$/;

/**
 * The EN week-range heading of the (Sunday-first) week containing `date`
 * ("Oct 4 – Oct 10, 2026", CalendarPage `rangeLabel`).
 */
function weekRangeLabel(date: string): string {
  const sunday = addDays(date, -weekdayOf(date));
  const saturday = addDays(sunday, 6);
  const md = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${iso}T12:00:00Z`)
    );
  return `${md(sunday)} – ${md(saturday)}, ${saturday.slice(0, 4)}`;
}

/**
 * Open the calendar and step forward (week view) until the week containing
 * `date` is the one on screen AND loaded. Steered by the range HEADING, not by
 * the presence of the day's cell: the heading changes before the new week's
 * data arrives, so "is the cell there yet?" read mid-load says no and steps
 * one week too far.
 */
async function gotoWeekContaining(page: Page, circleId: string, date: string): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  const range = page.getByRole('heading', { level: 2, name: WEEK_RANGE_HEADING });
  const target = weekRangeLabel(date);
  for (let i = 0; i < 8; i++) {
    await expect(range).toBeVisible({ timeout: 15_000 });
    const from = ((await range.textContent()) ?? '').trim();
    if (from === target) break;
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(range).not.toHaveText(from, { timeout: 15_000 });
  }
  await expect(range).toHaveText(target);
  await expect(page.locator(`[data-date="${date}"]`).first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
}

function chipOn(page: Page, date: string, name: string): Locator {
  return page
    .locator(`[data-date="${date}"]`)
    .getByRole('button', { name: new RegExp(escapeRegExp(name)) });
}

/** Present on each `on` day, absent on each `off` day (presence first, so absence is never vacuous). */
async function expectOnlyOn(page: Page, name: string, on: string[], off: string[]): Promise<void> {
  await expandAllDayOverflow(page);
  for (const d of on) {
    await expect(chipOn(page, d, name).first(), `${name} shows on ${d}`).toBeVisible({ timeout: 20_000 });
  }
  for (const d of off) {
    await expect(chipOn(page, d, name), `${name} absent on ${d}`).toHaveCount(0);
  }
}

// ---------------------------------------------------------------------------
// API helpers + cleanup
// ---------------------------------------------------------------------------

interface ApiEvent {
  id: string;
  title: string;
  parent_event_id: string | null;
  medication_name: string | null;
  recurrence_rule: string | null;
  recurrence_days: number[] | null;
  scheduled_date: string;
}

async function listEvents(
  request: APIRequestContext,
  account: IsolatedAccount,
  circleId: string
): Promise<ApiEvent[]> {
  const api = await apiSession(request, account);
  const res = await api.get(`/api/circles/${circleId}/events?includeDiscontinued=true`);
  expect(res.ok(), `GET events: ${res.status()}`).toBeTruthy();
  return ((await res.json())?.data?.events ?? []) as ApiEvent[];
}

/** The stored series ROOT(s) whose title is `name`. */
async function rootsNamed(
  request: APIRequestContext,
  account: IsolatedAccount,
  circleId: string,
  name: string
): Promise<ApiEvent[]> {
  const events = await listEvents(request, account, circleId);
  return events.filter((e) => e.title === name && !e.parent_event_id && !e.id.includes('_'));
}

async function sweep(request: APIRequestContext, account: IsolatedAccount, circleId: string): Promise<void> {
  if (createdNames.size === 0) return;
  try {
    const api = await apiSession(request, account);
    const res = await api.get(`/api/circles/${circleId}/events?includeDiscontinued=true`);
    if (!res.ok()) return;
    const events = ((await res.json())?.data?.events ?? []) as ApiEvent[];
    const roots = new Set<string>();
    for (const e of events) {
      const label = e.medication_name ?? e.title;
      if (!createdNames.has(label) && !createdNames.has(e.title)) continue;
      const root = e.parent_event_id ?? e.id;
      if (!root.includes('_')) roots.add(root);
    }
    for (const id of roots) {
      await api.delete(`/api/circles/${circleId}/events/${id}?deleteScope=series`).catch(() => {});
    }
  } catch {
    // Cleanup must never turn a test red; teardown purges the account anyway.
  }
}

test.afterEach(async ({ request, account, circleId }) => {
  await sweep(request, account, circleId);
});

// ---------------------------------------------------------------------------
// 1. EN — create via UI, calendar placement, detail + roster labels
// ---------------------------------------------------------------------------

test('EN: Mon/Wed/Fri medication and Tue/Thu task land only on those days and read "Weekly on …"', async ({
  page,
  circleId,
  request,
  account,
}) => {
  test.slow();
  // The Monday chip is pre-selected from the start date's weekday IN THE RECIPIENT FRAME: pin it to the
  // browser zone, else Monday 12:00 typed in Kiritimati is Sunday in the Denver-frame recipient.
  await pinRecipientZoneToBrowser(page, account, circleId);
  const med = uniqueName('med');
  const task = uniqueName('task');
  const monday = nextWeekdayAtLeast(7, 1);
  const d = (n: number) => addDays(monday, n); // d(0)=Mon … d(6)=Sun, d(7)=next Mon

  // --- Medication: start on a Monday, Days of the week → Mon (pre-selected) + Wed + Fri ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add event' }).first().click();
  const medDialog = page.getByRole('dialog', { name: 'New event' });
  await expect(medDialog).toBeVisible();
  await medDialog.locator('#event_type').selectOption('medication');
  await medDialog.locator('#medication_name').fill(med);
  await medDialog.locator('#medication_dosage').fill('5 mg');
  await medDialog.locator('#scheduled_date').fill(monday);
  await medDialog.locator('#scheduled_time').fill('12:00');
  // The option sits after Cycle and just before "As needed" (the PRN option, medication-only, is LAST).
  const options = await medDialog.locator('#recurrence_rule option').allTextContents();
  expect(options[options.length - 1]).toBe('As needed');
  expect(options[options.length - 2]).toBe('Days of the week');
  expect(options[options.length - 3]).toMatch(/^Cycle/);
  await medDialog.locator('#recurrence_rule').selectOption('days_of_week');

  const medGroup = chipGroup(medDialog);
  await expect(medGroup).toBeVisible();
  // EN week order: Sunday first.
  await expect(medGroup.getByRole('checkbox')).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  // Pre-selection = the start date's weekday (Monday), nothing else.
  await expect(medGroup.getByRole('checkbox', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true');
  await expect(medGroup.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await medGroup.getByRole('checkbox', { name: 'Wednesday' }).click();
  // Space toggles too (keyboard path): focus Friday, press Space.
  await medGroup.getByRole('checkbox', { name: 'Friday' }).focus();
  await page.keyboard.press('Space');
  await expect(medGroup.getByRole('checkbox', { name: 'Friday' })).toHaveAttribute('aria-checked', 'true');
  await expect(medDialog.getByText('Mon, Wed, Fri', { exact: true })).toBeVisible();
  // Start weekday is selected → no "First time" move, no lock (create).
  await expect(medDialog.getByText(/^First time:/)).toHaveCount(0);
  await expect(medDialog.getByText(/^Started on/)).toHaveCount(0);
  await submitAndClose(page, medDialog, 'Create');

  // --- Task: start on the Monday, pick Tue + Thu and drop Monday → "First time" = Tuesday ---
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const taskDialog = page.getByRole('dialog');
  await expect(taskDialog).toBeVisible();
  await taskDialog.locator('#title').fill(task);
  await taskDialog.locator('#scheduled_date').fill(monday);
  await taskDialog.locator('#recurrence_rule').selectOption('days_of_week');
  const taskGroup = chipGroup(taskDialog);
  await taskGroup.getByRole('checkbox', { name: 'Tuesday' }).click();
  await taskGroup.getByRole('checkbox', { name: 'Thursday' }).click();
  await taskGroup.getByRole('checkbox', { name: 'Monday' }).click();
  await expect(taskGroup.getByRole('checkbox', { name: 'Monday' })).toHaveAttribute('aria-checked', 'false');
  await expect(taskDialog.getByText('Tue, Thu', { exact: true })).toBeVisible();
  const firstTime = new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d(1)}T12:00:00Z`));
  await expect(taskDialog.getByText(`First time: ${firstTime}`, { exact: true })).toBeVisible();
  await submitAndClose(page, taskDialog, 'Create');

  // --- Stored rows: rule weekly + the day sets; the task's anchor moved to Tuesday ---
  await expect
    .poll(async () => (await rootsNamed(request, account, circleId, med)).length, { timeout: 20_000 })
    .toBe(1);
  const [medRoot] = await rootsNamed(request, account, circleId, med);
  expect(medRoot.recurrence_rule).toBe('weekly');
  expect(medRoot.recurrence_days).toEqual([1, 3, 5]);
  expect(medRoot.scheduled_date).toBe(monday);
  const [taskRoot] = await rootsNamed(request, account, circleId, task);
  expect(taskRoot.recurrence_rule).toBe('weekly');
  expect(taskRoot.recurrence_days).toEqual([2, 4]);
  expect(taskRoot.scheduled_date).toBe(d(1));

  // --- Calendar: week of the start, and the week after (Sunday-first weeks) ---
  await gotoWeekContaining(page, circleId, monday);
  await expectOnlyOn(page, med, [d(0), d(2), d(4)], [d(1), d(3), d(5)]);
  await expectOnlyOn(page, task, [d(1), d(3)], [d(0), d(2), d(4), d(5)]);

  // First occurrence's detail (the stored root).
  await chipOn(page, d(0), med).first().click();
  let detail = page.getByRole('dialog').filter({ hasText: med });
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await expect(detail).toContainText('Weekly on Mon, Wed, Fri');
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden({ timeout: 20_000 });

  await gotoWeekContaining(page, circleId, d(9));
  await expectOnlyOn(page, med, [d(7), d(9), d(11)], [d(6), d(8), d(10), d(12)]);
  await expectOnlyOn(page, task, [d(8), d(10)], [d(6), d(7), d(9), d(11), d(12)]);

  // A NON-first occurrence (a virtual instance, >1 week after the start).
  await chipOn(page, d(9), med).first().click();
  detail = page.getByRole('dialog').filter({ hasText: med });
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await expect(detail).toContainText('Weekly on Mon, Wed, Fri');
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden({ timeout: 20_000 });

  await chipOn(page, d(10), task).first().click();
  detail = page.getByRole('dialog').filter({ hasText: task });
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await expect(detail).toContainText('Weekly on Tue, Thu');
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden({ timeout: 20_000 });

  // --- Medications roster ---
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Active', exact: true }).locator('li').filter({ hasText: med });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('Weekly on Mon, Wed, Fri');
});

// ---------------------------------------------------------------------------
// 2. ES — locale week order and the Spanish label
// ---------------------------------------------------------------------------

test.describe('Spanish', () => {
  test.use({ locale: 'es' });

  test.beforeEach(async ({ page }) => {
    // Keep <LanguageSync> on Spanish (same technique as i18n-spanish.spec.ts).
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      try {
        const res = await route.fetch();
        const text = await res.text();
        let body: { data?: { user?: { language?: string } } };
        try {
          body = JSON.parse(text);
        } catch {
          return route.fulfill({ response: res });
        }
        if (body?.data?.user) body.data.user.language = 'es';
        await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) });
      } catch {
        await route.continue().catch(() => {});
      }
    });
  });

  // An ES browser session on a FRESH account settles `users.language = 'es'`
  // server-side (/auth/session-established decides the language once), and
  // that outlives this test: the next EN test on this worker's account then
  // renders Spanish. Put the stored preference back.
  test.afterEach(async ({ request, account }) => {
    const api = await apiSession(request, account);
    await api.patch('/api/users/me', { language: 'en' }).catch(() => {});
  });

  test('ES: chips run lun…dom and the roster reads "Semanal los lun, mié, vie"', async ({
    page,
    circleId,
    request,
    account,
  }) => {
    test.slow();
    // Same as the EN test: recipient frame = browser zone, so the typed Monday is a Monday for the app.
    await pinRecipientZoneToBrowser(page, account, circleId);
    const med = uniqueName('es');
    const monday = nextWeekdayAtLeast(7, 1);

    await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Agregar evento' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo evento' });
    await expect(dialog).toBeVisible();
    await dialog.locator('#event_type').selectOption('medication');
    await dialog.locator('#medication_name').fill(med);
    await dialog.locator('#medication_dosage').fill('5 mg');
    await dialog.locator('#scheduled_date').fill(monday);
    await dialog.locator('#scheduled_time').fill('12:00');
    const options = await dialog.locator('#recurrence_rule option').allTextContents();
    // "As needed" (the PRN option) is last; "Días de la semana" sits just before it.
    expect(options[options.length - 2]).toBe('Días de la semana');
    await dialog.locator('#recurrence_rule').selectOption('days_of_week');

    const group = chipGroup(dialog, 'Repetir los');
    await expect(group).toBeVisible();
    // ES week order: Monday first; short names visible, full names as the accessible name.
    await expect(group.getByRole('checkbox')).toHaveText(['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']);
    await expect(group.getByRole('checkbox', { name: 'lunes' })).toHaveAttribute('aria-checked', 'true');
    await group.getByRole('checkbox', { name: 'miércoles' }).click();
    await group.getByRole('checkbox', { name: 'viernes' }).click();
    await expect(dialog.getByText('lun, mié, vie', { exact: true })).toBeVisible();
    await submitAndClose(page, dialog, 'Crear');

    await expect
      .poll(async () => (await rootsNamed(request, account, circleId, med))[0]?.recurrence_days ?? null, {
        timeout: 20_000,
      })
      .toEqual([1, 3, 5]);

    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('region', { name: 'Activos', exact: true }).locator('li').filter({ hasText: med });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Semanal los lun, mié, vie');
  });
});

// ---------------------------------------------------------------------------
// 3. Started series — locked anchor chip, axe, backend guard, back to Weekly
// ---------------------------------------------------------------------------

test('started series: anchor chip locked (+axe); switching back to Weekly stores null days', async ({
  page,
  circleId,
  request,
  account,
}, testInfo) => {
  test.slow();
  const med = uniqueName('started');
  const anchor = addDays(todayISO(), -14);
  const a = weekdayOf(anchor);
  const other = (a + 3) % 7;
  const days = [a, other].sort((x, y) => x - y);

  const api = await apiSession(request, account);
  const created = await api.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: med,
    medication_name: med,
    medication_dosage: '1 mg',
    scheduled_date: anchor,
    scheduled_time: '12:00',
    recurrence_rule: 'weekly',
    recurrence_days: days,
  });
  expect(created.status(), await created.text()).toBe(201);
  const rootId = ((await created.json())?.data?.event?.id ?? '') as string;
  expect(rootId).not.toBe('');

  // The running backend is the current working tree: a days set that drops the
  // started anchor's weekday is refused, and nothing is written.
  const refused = await api.patch(`/api/circles/${circleId}/events/${rootId}`, { recurrence_days: [other] });
  expect(refused.status()).toBe(400);
  expect(await errorCodeOf(refused)).toBe('RECURRENCE_DAYS_EXCLUDE_START');

  // --- Open the editor from the Medications roster ---
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  const active = page.getByRole('region', { name: 'Active', exact: true });
  const card = active.locator('li').filter({ hasText: med });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: `More actions for ${med}` }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit event' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#recurrence_rule')).toHaveValue('days_of_week', { timeout: 20_000 });

  const group = chipGroup(dialog);
  const anchorName = longWeekday(a);
  const locked = group.getByRole('checkbox', { name: anchorName });
  await expect(locked).toHaveAttribute('aria-checked', 'true');
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  const lockNote = `Started on ${anchorName}. To remove ${anchorName}, end this series and add a new one.`;
  await expect(dialog.getByText(lockNote, { exact: true })).toBeVisible();
  await expect(locked).toHaveAccessibleDescription(lockNote);
  await expect(group.getByRole('checkbox', { name: longWeekday(other) })).toHaveAttribute('aria-checked', 'true');
  // Pressing the locked chip changes nothing. `force`: Playwright's
  // actionability treats aria-disabled as "not enabled" and would wait forever;
  // the chip is deliberately still clickable/focusable so its note is reachable.
  await locked.click({ force: true });
  await expect(locked).toHaveAttribute('aria-checked', 'true');
  // No "First time" move for a started series.
  await expect(dialog.getByText(/^First time:/)).toHaveCount(0);

  // axe on the open picker, locked chip included.
  await checkA11y(page, '/circles/:id/meds (edit: days picker, locked chip)', testInfo);

  // --- Back to plain Weekly ---
  await dialog.locator('#recurrence_rule').selectOption('weekly');
  await expect(group).toHaveCount(0);
  await submitAndClose(page, dialog, 'Save changes');

  await expect
    .poll(
      async () => {
        const res = await api.get(`/api/circles/${circleId}/events/${rootId}`);
        const ev = (await res.json())?.data?.event as ApiEvent | undefined;
        return ev ? { rule: ev.recurrence_rule, days: ev.recurrence_days, date: ev.scheduled_date } : null;
      },
      { timeout: 20_000 }
    )
    .toEqual({ rule: 'weekly', days: null, date: anchor });

  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('Weekly');
  await expect(card).not.toContainText('Weekly on');
});

// ---------------------------------------------------------------------------
// 4. 0 days → inline error, nothing sent
// ---------------------------------------------------------------------------

test('0 days selected: inline error, no request', async ({ page, circleId }) => {
  const name = uniqueName('zero');
  const monday = nextWeekdayAtLeast(7, 1);

  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#title').fill(name);
  await dialog.locator('#scheduled_date').fill(monday);
  await dialog.locator('#recurrence_rule').selectOption('days_of_week');
  const group = chipGroup(dialog);
  await group.getByRole('checkbox', { name: 'Monday' }).click();
  await expect(group.getByRole('checkbox', { checked: true })).toHaveCount(0);

  const posts = countRequests(page, 'POST', '/api/circles/:id/events');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('Choose at least one day', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  // Focus moves to the errored group; the group is described by the error.
  await expect(group).toBeFocused();
  await expect(group).toHaveAccessibleDescription('Choose at least one day');
  await posts.expectCount(0);
  posts.dispose();

  // Picking a day clears the error.
  await group.getByRole('checkbox', { name: 'Tuesday' }).click();
  await expect(dialog.getByText('Choose at least one day', { exact: true })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// PK23. The chips are in the RECIPIENT's frame; the zone note shows only when
// the viewer's zone differs from the recipient's (same condition as the
// dual-time hint). Both cases pin the recipient explicitly, so they hold under
// any PW_E2E_TZ (including Pacific/Kiritimati).
// ---------------------------------------------------------------------------

async function openDaysPicker(page: Page, circleId: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  // exact: a fresh circle's empty state adds a second heading containing "tasks".
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#recurrence_rule').selectOption('days_of_week');
  await expect(chipGroup(dialog).getByRole('checkbox')).toHaveCount(7);
  return dialog;
}

test('PK23: viewer and recipient in the SAME zone: no zone note under the chips', async ({
  page,
  account,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await pinRecipientZoneToBrowser(page, account, circleId);
  const dialog = await openDaysPicker(page, circleId);
  await expect(dialog.getByText(/^Days are in /)).toHaveCount(0);
  await expect(chipGroup(dialog)).not.toHaveAccessibleDescription(/time zone/);
});

test('PK23: viewer in a DIFFERENT zone than the recipient: the note names the recipient zone and describes the chips', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // A RUN-SCOPED owner with a circle of its own. The worker's circle is a clone
  // whose members other than the owner are the demo template's OWN accounts
  // (Margaret, Tom, Lisa; isolation.ts remaps only the owner), shared by every
  // worker clone and every later run. Moving THEIR zone here leaked into whatever
  // ran next: calendar-chip-meta read "Times shown in Kiritimati" and create-menu's
  // note left the window (coverage run 2026-10-02). Only the scoped owner moves
  // now; with no recipient account the owner's zone IS the recipient frame.
  const owner = await createScopedAccount('dowpk23');
  const circleId = await createCircle(await ownerApi(request, owner), uniq('dowpk23'));
  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  const viewerTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const recipientTz = viewerTz === 'America/Denver' ? 'Pacific/Kiritimati' : 'America/Denver';
  sqlExec(`update users set timezone = ${sqlStr(recipientTz)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const dialog = await openDaysPicker(page, circleId);
  const note = dialog.getByText(/^Days are in .*time zone \(/);
  await expect(note).toBeVisible();
  await expect(chipGroup(dialog)).toHaveAccessibleDescription(/time zone/);
});

// ---------------------------------------------------------------------------
// 5. Geometry — real pixels
// ---------------------------------------------------------------------------

test('chips are >=44px targets and wrap without horizontal scroll at 375px', async ({ page, circleId }) => {
  const monday = nextWeekdayAtLeast(7, 1);

  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#scheduled_date').fill(monday);
  await dialog.locator('#recurrence_rule').selectOption('days_of_week');
  const group = chipGroup(dialog);
  await expect(group.getByRole('checkbox')).toHaveCount(7);

  async function measure() {
    // getBoundingClientRect includes transforms: measured mid entrance
    // animation (the dialog scales in) a 44px chip reads ~43.5px. Let every
    // finite animation finish first.
    await page.evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {}))
        ),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ])
    );
    return group.evaluate((el) => {
      const chips = [...el.querySelectorAll<HTMLElement>('[role="checkbox"]')].map((c) => {
        const r = c.getBoundingClientRect();
        return { w: r.width, h: r.height, top: Math.round(r.top), left: r.left, right: r.right };
      });
      const g = el.getBoundingClientRect();
      // Every scrollable ancestor up to the document must not scroll sideways.
      const sideways: string[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 1) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === 'auto' || ox === 'scroll' || n === document.documentElement) {
            sideways.push(`${n.tagName}.${n.className.toString().slice(0, 40)} ${n.scrollWidth}>${n.clientWidth}`);
          }
        }
      }
      return {
        chips,
        group: { left: g.left, right: g.right },
        docScroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        sideways,
      };
    });
  }

  // Desktop width: 44x44 minimum.
  let m = await measure();
  for (const c of m.chips) {
    expect(c.h, 'chip height').toBeGreaterThanOrEqual(44);
    expect(c.w, 'chip width').toBeGreaterThanOrEqual(44);
  }

  // 375px phone width.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(group).toBeVisible();
  await expect
    .poll(async () => (await measure()).viewport)
    .toBe(375);
  m = await measure();
  for (const c of m.chips) {
    expect(c.h, 'chip height at 375').toBeGreaterThanOrEqual(44);
    expect(c.w, 'chip width at 375').toBeGreaterThanOrEqual(44);
    expect(c.left, 'chip inside the group (left)').toBeGreaterThanOrEqual(m.group.left - 0.5);
    expect(c.right, 'chip inside the group (right)').toBeLessThanOrEqual(m.group.right + 0.5);
    expect(c.right, 'chip inside the viewport').toBeLessThanOrEqual(375);
  }
  const rows = new Set(m.chips.map((c) => c.top));
  expect(rows.size, 'seven chips do not fit one row at 375px — they must wrap').toBeGreaterThanOrEqual(2);
  expect(m.docScroll, 'no page-level horizontal scroll').toBeLessThanOrEqual(375);
  expect(m.sideways, 'no ancestor scrolls horizontally').toEqual([]);
});
