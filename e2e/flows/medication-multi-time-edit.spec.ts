import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { apiSession, dbQuery, sqlStr, type ApiSession } from '../unhappy';
import { sqlExec } from '../db';
import { dayCell, gotoWeekContaining } from '../notesFirstClassShared';

// ===========================================================================
// EDITING ONE TIME OF A TWO-TIME MEDICATION leaves the other time alone
// (scenarios E6, E8).
//
// A "twice daily" medication is two series roots: the first time owns the
// bottle, the second points at it through `refill_group_id` (what the add
// form's "Add another time" creates — AddEventModal `buildSiblingRequests`).
// The Meds page shows one row per time. Guarantees, per edited time:
//   - editing one time (8:00 AM from the Meds page; 8:00 PM from the Calendar
//     dose's "Edit event") moves only that series' root and future; the other
//     series (root, children, updated_at, confirmations) is byte-identical;
//   - the edited series' taken doses keep their old time and confirmations;
//   - neither time is lost: both rows stay on the Meds page and both series
//     keep producing future doses (E8).
// The third test pins bug N1 (was test.fail, now fixed): the Meds page's 8:00 PM row opened
// the 8:00 AM series in the editor.
//
// Seeded through the real API on this worker's circle (confirm endpoint for the
// taken doses, the backend's materializer run once). Recipient zone pinned to
// the browser zone (the editor types and reads recipient-frame clock values).
//
// FALSIFY (PW_FALSIFY=multi-edit-wrong-series): the editor's PATCH is
// re-pointed at the OTHER time's series root — the "edit one time, the other
// changes" bug — so the untouched-series assertions must go red.
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
const PREFIX = 'ZZ_E2E_MULTITIME_';

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const hhmm = (t: unknown) => String(t ?? '').slice(0, 5);

interface Row {
  id: string;
  parent_event_id: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  medication_dosage: string | null;
  removed_at: string | null;
  discontinued_at: string | null;
  refill_group_id: string | null;
  updated_at: string;
}

function seriesRows(rootId: string): Row[] {
  return dbQuery<Row>(
    `select id, parent_event_id, scheduled_date::text as scheduled_date, scheduled_time::text as scheduled_time,
            medication_dosage, removed_at::text as removed_at, discontinued_at::text as discontinued_at,
            refill_group_id, updated_at::text as updated_at
       from calendar_events where id = ${sqlStr(rootId)}::uuid or parent_event_id = ${sqlStr(rootId)}::uuid
      order by scheduled_date, id`
  );
}
function confirmationsOf(rootId: string): string[] {
  return dbQuery<{ k: string }>(
    `select mc.id || ':' || mc.event_id || ':' || mc.status || ':' || mc.scheduled_time::text as k
       from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
      where ce.id = ${sqlStr(rootId)}::uuid or ce.parent_event_id = ${sqlStr(rootId)}::uuid order by 1`
  ).map((r) => r.k);
}

async function createRoot(api: ApiSession, circleId: string, name: string, start: string, time: string, refillGroupId?: string): Promise<string> {
  const res = await api.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '10mg',
    scheduled_date: start,
    scheduled_time: time,
    recurrence_rule: 'daily',
    notifications_enabled: false,
    ...(refillGroupId ? { refill_group_id: refillGroupId, track_refills: false } : {}),
  });
  expect(res.status(), `create ${time}: ${await res.text()}`).toBe(201);
  return ((await res.json()) as { data: { event: { id: string } } }).data.event.id;
}

async function confirmTaken(api: ApiSession, circleId: string, rootId: string, date: string, time: string): Promise<void> {
  const res = await api.post(`/api/circles/${circleId}/medications/confirm`, {
    event_id: `${rootId}_${date}`,
    status: 'taken',
    scheduled_time: `${time}:00`,
  });
  expect(res.ok(), `confirm ${date} ${time}: ${await res.text()}`).toBe(true);
}

async function futureTimes(api: ApiSession, circleId: string, rootId: string, from: string, to: string): Promise<string[]> {
  const res = await api.get(`/api/circles/${circleId}/events?start_date=${from}&end_date=${to}`);
  expect(res.ok()).toBe(true);
  const evs = ((await res.json()) as { data: { events: Record<string, unknown>[] } }).data.events;
  return evs
    .filter((e) => e.id === rootId || e.parent_event_id === rootId || String(e.id).startsWith(`${rootId}_`))
    .map((e) => `${e.scheduled_date} ${hhmm(e.scheduled_time)}`)
    .sort();
}

function timeRows(page: Page, name: string): Locator {
  return page.getByTestId('med-time-row').filter({ hasText: name });
}

async function openEditForTime(page: Page, circleId: string, name: string, timeLabel: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(timeRows(page, name)).toHaveCount(2, { timeout: 25_000 });
  const row = timeRows(page, name).filter({ hasText: timeLabel });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit medication' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function changeTimeAndSave(page: Page, dialog: Locator, circleId: string, rootId: string, from: string, to: string, otherRootId: string): Promise<void> {
  await dialog.getByRole('button', { name: 'Other time' }).click();
  await expect(dialog.locator('#scheduled_time')).toHaveValue(from, { timeout: 15_000 });
  await dialog.locator('#scheduled_time').fill(to);
  if (FALSIFY.has('multi-edit-wrong-series')) {
    await page.route(
      (url) => url.pathname.startsWith(`/api/circles/${circleId}/events/${rootId}`),
      (route: Route) =>
        route.request().method() === 'PATCH'
          ? route.continue({ url: route.request().url().replace(rootId, otherRootId) })
          : route.fallback()
    );
  }
  const patch = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.startsWith(`/api/circles/${circleId}/events/`),
    { timeout: 25_000 }
  );
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  const notice = page.getByRole('dialog', { name: 'Time already passed' });
  if (await notice.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false)) {
    await notice.getByRole('button', { name: 'Continue' }).click();
  }
  const res = await patch;
  expect(res.ok(), `PATCH ${res.url()} -> ${res.status()} ${await res.text().catch(() => '')}`).toBe(true);
  expect.soft(new URL(res.request().url()).pathname, 'the edit targets THIS time series').toMatch(
    new RegExp(`^/api/circles/${circleId}/events/${rootId}(_\\d{4}-\\d{2}-\\d{2})?$`)
  );
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
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

interface Scene {
  api: ApiSession;
  today: string;
  name: string;
  morning: string;
  evening: string;
  taken: string[];
}

/** 08:00 (owns the bottle) + 20:00 (refill_group_id -> 08:00) from T-10; both taken T-3..T-1. */
async function arrange(page: Page, request: Parameters<typeof apiSession>[0], account: { email: string; password: string; userId: string }, circleId: string): Promise<Scene> {
  const viewerTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  // useCircle takes the care-recipient MEMBER's zone first, then the owner's: move every member of the circle.
  sqlExec(
    `update users set timezone = ${sqlStr(viewerTz)} where id = ${sqlStr(account.userId)}::uuid
        or id in (select user_id from circle_memberships where circle_id = ${sqlStr(circleId)}::uuid);`
  );
  const api = await apiSession(request, account);
  const today = todayIn(viewerTz);
  const start = addDays(today, -10);
  const name = `${PREFIX}${Date.now()}`;
  const morning = await createRoot(api, circleId, name, start, '08:00');
  created.push(morning);
  const evening = await createRoot(api, circleId, name, start, '20:00', morning);
  created.push(evening);
  const taken = [-3, -2, -1].map((n) => addDays(today, n));
  for (const d of taken) {
    await confirmTaken(api, circleId, morning, d, '08:00');
    await confirmTaken(api, circleId, evening, d, '20:00');
  }
  dbQuery('select materialize_recurring_instances() as n');
  expect(confirmationsOf(morning)).toHaveLength(3);
  expect(confirmationsOf(evening)).toHaveLength(3);
  expect(seriesRows(evening).find((r) => r.id === evening)?.refill_group_id, 'the 2nd time points at the bottle').toBe(morning);
  return { api, today, name, morning, evening, taken };
}

/** After editing `edited` from `oldTime` to `newTime`: `other` is byte-identical, history kept, both times still live. */
async function assertOnlyOneTimeMoved(
  page: Page,
  circleId: string,
  s: Scene,
  edited: string,
  oldTime: string,
  newTime: string,
  other: string,
  otherTime: string,
  otherBefore: Row[],
  confsBefore: { edited: string[]; other: string[] },
  rowLabels: [string, string]
): Promise<void> {
  expect(seriesRows(other), 'the other time series is untouched (rows, times, updated_at)').toEqual(otherBefore);
  expect(confirmationsOf(other), "the other time's taken history is intact").toEqual(confsBefore.other);
  const after = seriesRows(edited);
  expect(hhmm(after.find((r) => r.id === edited)?.scheduled_time), 'edited series root moved').toBe(newTime);
  for (const d of s.taken) {
    const child = after.find((r) => r.parent_event_id && r.scheduled_date === d);
    expect(child && hhmm(child.scheduled_time), `taken dose ${d} keeps ${oldTime}`).toBe(oldTime);
  }
  expect(confirmationsOf(edited), "the edited series' taken confirmations are unchanged").toEqual(confsBefore.edited);
  expect(after.filter((r) => r.removed_at || r.discontinued_at).map((r) => r.scheduled_date)).toEqual([]);

  // E8: both times still exist — on the Meds page and in the future schedule.
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(timeRows(page, s.name)).toHaveCount(2, { timeout: 25_000 });
  for (const label of rowLabels) await expect(timeRows(page, s.name).filter({ hasText: label })).toHaveCount(1);
  const from = addDays(s.today, 3);
  const to = addDays(s.today, 5);
  expect(await futureTimes(s.api, circleId, edited, from, to)).toEqual([0, 1, 2].map((n) => `${addDays(from, n)} ${newTime}`));
  expect(await futureTimes(s.api, circleId, other, from, to)).toEqual([0, 1, 2].map((n) => `${addDays(from, n)} ${otherTime}`));
}

test('editing the morning time of a twice-daily medication from the Meds page keeps the evening time, its series and its taken history', async ({
  page,
  request,
  account,
  circleId,
}) => {
  test.slow();
  const s = await arrange(page, request, account, circleId);
  const otherBefore = seriesRows(s.evening);
  const confs = { edited: confirmationsOf(s.morning), other: confirmationsOf(s.evening) };
  const dialog = await openEditForTime(page, circleId, s.name, '8:00 AM');
  await changeTimeAndSave(page, dialog, circleId, s.morning, '08:00', '09:00', s.evening);
  await assertOnlyOneTimeMoved(page, circleId, s, s.morning, '08:00', '09:00', s.evening, '20:00', otherBefore, confs, ['9:00 AM', '8:00 PM']);
});

test('editing the evening time of a twice-daily medication from the Calendar keeps the morning time, its series and its taken history', async ({
  page,
  request,
  account,
  circleId,
}) => {
  test.slow();
  const s = await arrange(page, request, account, circleId);
  const otherBefore = seriesRows(s.morning);
  const confs = { edited: confirmationsOf(s.evening), other: confirmationsOf(s.morning) };
  const tomorrow = addDays(s.today, 1);
  await gotoWeekContaining(page, circleId, s.today, tomorrow);
  const chip = dayCell(page, tomorrow).getByRole('button', { name: new RegExp(`^${s.name}.*8:00 PM`) });
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  await chip.click();
  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible({ timeout: 10_000 });
  await detail.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit medication' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await changeTimeAndSave(page, dialog, circleId, s.evening, '20:00', '21:00', s.morning);
  await assertOnlyOneTimeMoved(page, circleId, s, s.evening, '20:00', '21:00', s.morning, '08:00', otherBefore, confs, ['8:00 AM', '9:00 PM']);
});

// BUG N1 (found 2026-11-02, fixed): on the Meds page every time row of a multi-time medication
// carries the medication's GROUP, and Edit opens `group.event` — the first time's
// series (MedicationsPage.tsx `handleEdit` -> `setEditingEvent(group.event)`;
// the rows are built in `timedGroups` with `item: group` for each time). So "More
// actions -> Edit" on the 8:00 PM row opens the editor on 08:00, and a caregiver who
// changes that time to move the evening dose moves the MORNING dose instead.
// Mobile builds its rows the same way (MedicationHistoryScreen `dayPartGroups`).
// Pinned as test.fail in 482c031 (bug N1); fixed: each time row carries its own
// series (`MedGroup.timeEvents`) and Edit opens it.
test('the Meds page Edit on the 8:00 PM row of a twice-daily medication edits the 8:00 PM time', async ({
  page,
  request,
  account,
  circleId,
}) => {
  test.slow();
  const s = await arrange(page, request, account, circleId);
  const dialog = await openEditForTime(page, circleId, s.name, '8:00 PM');
  await dialog.getByRole('button', { name: 'Other time' }).click();
  await expect(dialog.locator('#scheduled_time'), 'the 8:00 PM row opens the 8:00 PM series').toHaveValue('20:00', {
    timeout: 15_000,
  });
});
