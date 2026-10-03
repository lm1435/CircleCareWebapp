import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { apiSession, dbQuery, sqlStr, type ApiSession } from '../unhappy';
import { sqlExec } from '../db';

// ===========================================================================
// EDITING A STARTED RECURRING MEDICATION keeps its history
// (docs/plans/test-gap-audit-2026-09-29.md #7; Maestro twins:
// mobile/.maestro/parity/medications/edit-time-dosage-old.yaml + edit-frequency.yaml).
//
// Product rule (memory project_medication_time_edit / _edit_history_integrity):
// an edit is forward-looking. Doses already TAKEN keep the time and dosage
// they were taken at, with their confirmations; the series root and every
// future occurrence carry the new values; a pattern change prunes only future
// UNCONFIRMED children.
//
//   1. time + dosage, from the Meds page, on a med started T-20 — older than
//      GET /events' -15-day window, so the roster card is not the root.
//   2. frequency daily -> weekly on a med started T-8 with materialized future.
//
// Seeded through the real API on this worker's circle (the confirm endpoint
// makes the Taken children, exactly as a tap does); the materializer is the
// backend's own hourly job, run once. Dates: runner-local "today" (runner TZ ==
// the isolated recipient's America/Denver). Cleanup: deleteScope=series.
//
// FALSIFY (PW_FALSIFY=<name>[,…], seeds WRONG so the test must go red):
//   med-edit-time-dosage  the series is seeded at 20mg (the taken doses then
//                         cannot "keep 10mg")
//   med-edit-frequency    the series is seeded WEEKLY (the editor is not on Daily)
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));

const PREFIX = 'ZZ_E2E_MEDEDIT_';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Today's date on the wall clock of `tz` (the recipient's = the browser's for this spec). */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dowOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const hhmm = (t: unknown) => String(t ?? '').slice(0, 5);

interface Row {
  id: string;
  parent_event_id: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  medication_dosage: string | null;
  recurrence_rule: string | null;
  removed_at: string | null;
}

function seriesRows(rootId: string): Row[] {
  return dbQuery<Row>(
    `select id, parent_event_id, scheduled_date::text as scheduled_date, scheduled_time::text as scheduled_time,
            medication_dosage, recurrence_rule, removed_at::text as removed_at
       from calendar_events where id = ${sqlStr(rootId)}::uuid or parent_event_id = ${sqlStr(rootId)}::uuid
      order by scheduled_date`
  );
}
function confirmations(ids: string[]): { id: string; event_id: string; status: string }[] {
  if (!ids.length) return [];
  return dbQuery(
    `select id, event_id, status from medication_confirmations where event_id in (${ids.map((i) => `${sqlStr(i)}::uuid`).join(',')})`
  );
}

async function createMed(api: ApiSession, circleId: string, name: string, start: string, dosage: string, rule = 'daily'): Promise<string> {
  const res = await api.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: dosage,
    scheduled_date: start,
    scheduled_time: '08:00',
    recurrence_rule: rule,
    notifications_enabled: true,
  });
  expect(res.status(), `create med: ${await res.text()}`).toBe(201);
  const id = ((await res.json()) as { data: { event: { id: string; scheduled_date: string } } }).data.event.id;
  expect(seriesRows(id)[0]?.scheduled_date, 'no start roll').toBe(start);
  return id;
}

async function confirmTaken(api: ApiSession, circleId: string, rootId: string, date: string): Promise<void> {
  const res = await api.post(`/api/circles/${circleId}/medications/confirm`, {
    event_id: `${rootId}_${date}`,
    status: 'taken',
    scheduled_time: '08:00:00',
  });
  expect(res.ok(), `confirm ${date}: ${await res.text()}`).toBe(true);
}

async function occurrences(api: ApiSession, circleId: string, rootId: string, from: string, to: string) {
  const res = await api.get(`/api/circles/${circleId}/events?start_date=${from}&end_date=${to}&includeDiscontinued=true`);
  expect(res.ok()).toBe(true);
  const evs = ((await res.json()) as { data: { events: Record<string, unknown>[] } }).data.events;
  return evs.filter((e) => e.id === rootId || e.parent_event_id === rootId || String(e.id).startsWith(`${rootId}_`));
}

async function openEditFromMedsPage(page: Page, circleId: string, name: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Active', exact: true }).locator('li').filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit event' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function saveChanges(page: Page, dialog: Locator, circleId: string, rootId: string): Promise<void> {
  const patch = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.startsWith(`/api/circles/${circleId}/events/`),
    { timeout: 25_000 }
  );
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  const notice = page.getByRole('dialog', { name: /^(Time already passed|Starts with the next dose)$/ });
  if (await notice.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false)) {
    await notice.getByRole('button', { name: 'Continue' }).click();
  }
  const res = await patch;
  expect(res.ok(), `PATCH ${res.url()} → ${res.status()}`).toBe(true);
  expect(new URL(res.url()).pathname, 'the edit targets the SERIES ROOT').toBe(`/api/circles/${circleId}/events/${rootId}`);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

const created: string[] = [];
test.afterEach(async ({ request, account, circleId }) => {
  try {
    const api = await apiSession(request, account);
    for (const id of created.splice(0)) await api.delete(`/api/circles/${circleId}/events/${id}?deleteScope=series`).catch(() => {});
  } catch {
    // teardown purges the account anyway
  }
});

test('time + dosage edit of a started series older than 15 days from the Meds page: taken doses keep 08:00 + 10mg, the future moves', async ({
  page,
  request,
  account,
  circleId,
}) => {
  test.slow();
  // The editor shows the VIEWER's wall clock (AddEventModal eventDatesFromApi), and this test types and
  // asserts recipient-frame values ('08:00', '09:00'). Pin recipient = browser zone so it holds from any
  // browser zone (a far-zone run otherwise reads 08:00 Denver back as 04:00 Kiritimati / 03:00 Midway).
  const viewerTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  // useCircle takes the care-recipient MEMBER's zone first, then the owner's: move every member of the circle.
  sqlExec(
    `update users set timezone = ${sqlStr(viewerTz)} where id = ${sqlStr(account.userId)}::uuid
        or id in (select user_id from circle_memberships where circle_id = ${sqlStr(circleId)}::uuid);`
  );
  const api = await apiSession(request, account);
  const today = todayIn(viewerTz);
  const name = `${PREFIX}Old_${Date.now()}`;
  const start = addDays(today, -20);
  const rootId = await createMed(api, circleId, name, start, FALSIFY.has('med-edit-time-dosage') ? '20mg' : '10mg');
  created.push(rootId);
  const taken = [-5, -4, -3, -2, -1].map((n) => addDays(today, n));
  for (const d of taken) await confirmTaken(api, circleId, rootId, d);
  dbQuery('select materialize_recurring_instances() as n');
  const takenRows = seriesRows(rootId).filter((r) => r.parent_event_id && taken.includes(r.scheduled_date));
  const confsBefore = confirmations(takenRows.map((r) => r.id));
  expect(takenRows).toHaveLength(5);
  expect(confsBefore).toHaveLength(5);

  const dialog = await openEditFromMedsPage(page, circleId, name);
  // The editor shows the SERIES' values.
  await expect(dialog.locator('#medication_dosage')).toHaveValue('10mg', { timeout: 20_000 });
  await expect(dialog.locator('#scheduled_time')).toHaveValue('08:00');
  await expect(dialog.locator('#scheduled_date')).toHaveValue(start);
  await dialog.locator('#medication_dosage').fill('20mg');
  await dialog.locator('#scheduled_time').fill('09:00');
  await saveChanges(page, dialog, circleId, rootId);

  const rows = seriesRows(rootId);
  const root = rows.find((r) => r.id === rootId)!;
  expect(root.medication_dosage, 'root dosage').toBe('20mg');
  expect(hhmm(root.scheduled_time), 'root time').toBe('09:00');
  expect(root.scheduled_date, 'the series anchor never moves').toBe(start);
  for (const b of takenRows) {
    const now = rows.find((r) => r.id === b.id);
    expect(now, `taken child ${b.scheduled_date} still exists`).toBeTruthy();
    expect(hhmm(now!.scheduled_time), `taken child ${b.scheduled_date} keeps 08:00`).toBe('08:00');
    expect(now!.medication_dosage, `taken child ${b.scheduled_date} keeps 10mg`).toBe('10mg');
  }
  const confsAfter = confirmations(takenRows.map((r) => r.id));
  expect(confsAfter.map((c) => `${c.id}:${c.event_id}:${c.status}`).sort()).toEqual(
    confsBefore.map((c) => `${c.id}:${c.event_id}:${c.status}`).sort()
  );
  const startChild = rows.find((r) => r.parent_event_id && r.scheduled_date === start);
  expect(startChild && hhmm(startChild.scheduled_time), 'the past start-date occurrence is frozen at 08:00').toBe('08:00');
  const futureKids = rows.filter((r) => r.parent_event_id && r.scheduled_date >= today && !r.removed_at);
  const futureConfirmed = new Set(confirmations(futureKids.map((r) => r.id)).map((c) => c.event_id));
  for (const r of futureKids.filter((k) => !futureConfirmed.has(k.id))) {
    expect(hhmm(r.scheduled_time), `future unconfirmed child ${r.scheduled_date} moved to 09:00`).toBe('09:00');
  }
  const future = await occurrences(api, circleId, rootId, addDays(today, 3), addDays(today, 6));
  expect(future.length).toBeGreaterThanOrEqual(4);
  for (const e of future) {
    expect(`${e.scheduled_date} ${hhmm(e.scheduled_time)} ${e.medication_dosage}`).toBe(`${e.scheduled_date} 09:00 20mg`);
  }
  const past = await occurrences(api, circleId, rootId, taken[0], taken[4]);
  expect(past.map((e) => `${e.scheduled_date} ${hhmm(e.scheduled_time)} ${e.medication_dosage}`)).toEqual(
    taken.map((d) => `${d} 08:00 10mg`)
  );
});

test('frequency edit (daily -> weekly) keeps the taken history and prunes the off-pattern future', async ({
  page,
  request,
  account,
  circleId,
}) => {
  test.slow();
  const api = await apiSession(request, account);
  const today = todayISO();
  const name = `${PREFIX}Freq_${Date.now()}`;
  const start = addDays(today, -8);
  const anchor = dowOf(start);
  const rootId = await createMed(api, circleId, name, start, '5mg', FALSIFY.has('med-edit-frequency') ? 'weekly' : 'daily');
  created.push(rootId);
  const taken = [-3, -2, -1].map((n) => addDays(today, n));
  for (const d of taken) await confirmTaken(api, circleId, rootId, d);
  dbQuery('select materialize_recurring_instances() as n');
  const takenRows = seriesRows(rootId).filter((r) => r.parent_event_id && taken.includes(r.scheduled_date));
  expect(takenRows).toHaveLength(3);

  const dialog = await openEditFromMedsPage(page, circleId, name);
  await expect(dialog.locator('#recurrence_rule')).toHaveValue('daily', { timeout: 20_000 });
  await dialog.locator('#recurrence_rule').selectOption('weekly');
  await saveChanges(page, dialog, circleId, rootId);

  const rows = seriesRows(rootId);
  const root = rows.find((r) => r.id === rootId)!;
  expect(root.recurrence_rule).toBe('weekly');
  expect(root.scheduled_date).toBe(start);
  for (const b of takenRows) expect(rows.some((r) => r.id === b.id && !r.removed_at), `taken ${b.scheduled_date} kept`).toBe(true);
  expect(confirmations(takenRows.map((r) => r.id))).toHaveLength(3);
  const offPattern = rows.filter((r) => r.parent_event_id && r.scheduled_date >= today && !r.removed_at && dowOf(r.scheduled_date) !== anchor);
  expect(offPattern.map((r) => r.scheduled_date), 'no future child off the weekly pattern').toEqual([]);
  const occ = await occurrences(api, circleId, rootId, today, addDays(today, 13));
  expect(occ.length).toBeGreaterThan(0);
  expect([...new Set(occ.map((e) => dowOf(String(e.scheduled_date))))]).toEqual([anchor]);
});
