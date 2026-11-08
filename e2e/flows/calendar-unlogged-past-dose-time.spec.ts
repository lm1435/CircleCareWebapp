import { test, expect } from '../fixtures';
import { weekChipLabels } from '../helpers';
import { apiSession, sqlStr, type ApiSession } from '../unhappy';
import { sqlExec } from '../db';
import { dayCell, escapeRegExp, gotoWeekContaining } from '../notesFirstClassShared';

// ===========================================================================
// A PAST DAY'S UNANSWERED DOSE SHOWS NO CLOCK TIME; A TAKEN DOSE KEEPS ITS TIME
// (scenario V1; shipped in webapp d1ec57f, unit twin
// src/components/calendar/__tests__/unloggedPastDoseTime.test.tsx).
//
// The case it exists for: a medication's time is edited 07:00 -> 07:15. A past
// day nobody answered is a VIRTUAL occurrence built from the edited root, so it
// would claim "7:15 AM" on a day the dose was due at 7:00. 1.4.0 drops the time
// for such a dose (Day rows, Week chips, the detail's Time row) while a dose
// that WAS answered keeps the time frozen on its own row.
//
// Seed (worker's circle, real API): two daily meds from T-5 with reminders off.
//   A 08:00, taken on T-2 through the confirm endpoint;
//   B 07:00, never answered, then its time edited to 07:15 through PATCH (root).
// The browser zone is pinned to the recipient's so clock labels are plain.
// Today's B dose is the control: today keeps its (new) time.
//
// FALSIFY: run against the pre-fix webapp (d1ec57f^) — B then reads "7:15 AM"
// on T-2 and the test goes red (see the report for the run).
// ===========================================================================

const PREFIX = 'ZZ_E2E_V1_';
const CLOCK = /\b\d{1,2}:\d{2}\b/;

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

async function createDaily(api: ApiSession, circleId: string, name: string, start: string, time: string): Promise<string> {
  const res = await api.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '5mg',
    scheduled_date: start,
    scheduled_time: time,
    recurrence_rule: 'daily',
    notifications_enabled: false,
  });
  expect(res.status(), `create ${name}: ${await res.text()}`).toBe(201);
  return ((await res.json()) as { data: { event: { id: string } } }).data.event.id;
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

test("a past day's unanswered dose shows no clock time while a dose taken that day keeps its time", async ({
  page,
  request,
  account,
  circleId,
}) => {
  test.slow();
  const viewerTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  sqlExec(
    `update users set timezone = ${sqlStr(viewerTz)} where id = ${sqlStr(account.userId)}::uuid
        or id in (select user_id from circle_memberships where circle_id = ${sqlStr(circleId)}::uuid);`
  );
  const api = await apiSession(request, account);
  const today = todayIn(viewerTz);
  const day = addDays(today, -2);
  const stamp = Date.now();
  const takenName = `${PREFIX}A_${stamp}`;
  const unansweredName = `${PREFIX}B_${stamp}`;
  const a = await createDaily(api, circleId, takenName, addDays(today, -5), '08:00');
  created.push(a);
  const b = await createDaily(api, circleId, unansweredName, addDays(today, -5), '07:00');
  created.push(b);
  const confirm = await api.post(`/api/circles/${circleId}/medications/confirm`, {
    event_id: `${a}_${day}`,
    status: 'taken',
    scheduled_time: '08:00:00',
  });
  expect(confirm.ok(), await confirm.text()).toBe(true);
  const edit = await api.patch(`/api/circles/${circleId}/events/${b}`, { scheduled_time: '07:15' });
  expect(edit.ok(), `edit B's time: ${await edit.text()}`).toBe(true);

  // Week view: the chips on the past day.
  await gotoWeekContaining(page, circleId, today, day);
  // Same-type doses at one minute fold into one "N meds" chip, so read the chips through weekChipLabels.
  const cell = dayCell(page, day);
  await expect
    .poll(() => weekChipLabels(page, cell, new RegExp(`^${escapeRegExp(takenName)}`)).then((l) => l.length), { timeout: 20_000 })
    .toBe(1);
  const openLabels = await weekChipLabels(page, cell, new RegExp(`^${escapeRegExp(unansweredName)}`));
  expect(openLabels).toHaveLength(1);
  expect(openLabels[0], 'unanswered past chip: no time in its name').not.toMatch(CLOCK);
  expect(openLabels[0]).toMatch(/Not marked/);

  // Day view of that day.
  await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(longDate(day))}$`) }).click();
  await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 20_000 });
  const takenRow = page.getByTestId('day-event').filter({ hasText: takenName });
  const openRow = page.getByTestId('day-event').filter({ hasText: unansweredName });
  await expect(takenRow).toHaveAttribute('data-med-status', 'taken', { timeout: 20_000 });
  await expect(takenRow, 'the taken dose keeps its time').toContainText('8:00 AM');
  await expect(takenRow).toHaveAccessibleName(/8:00 AM/);
  await expect(openRow).toHaveAttribute('data-med-status', 'missed');
  await expect(openRow, 'no clock time (it would wrongly read the edited 7:15)').not.toHaveText(CLOCK);
  await expect(openRow).not.toHaveAccessibleName(CLOCK);
  await expect(openRow).toHaveAccessibleName(`${unansweredName}, Medication, Not marked`);

  // The detail: WHEN shows no time for the unanswered dose, and its time for the taken one.
  await openRow.click();
  let detail = page.getByRole('dialog');
  await expect(detail).toBeVisible({ timeout: 10_000 });
  await expect(detail.getByText(unansweredName).first()).toBeVisible();
  await expect(detail.getByTestId('event-detail-date')).toBeVisible();
  await expect(detail.getByTestId('event-detail-time')).toHaveCount(0);
  await expect(detail.getByText(/7:15/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close event details' }).click();
  await takenRow.click();
  detail = page.getByRole('dialog');
  await expect(detail.getByTestId('event-detail-time')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Close event details' }).click();

  // Control: today's dose of the edited med keeps its (new) time.
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByTestId('day-event').filter({ hasText: unansweredName })).toContainText('7:15 AM', {
    timeout: 20_000,
  });
});
