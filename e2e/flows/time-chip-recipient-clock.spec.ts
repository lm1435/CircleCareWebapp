import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { dateInTz, uniqueSuffix } from '../notesFirstClassShared';

// 1.4.0 TIME FIXES, against the real backend and database (mobile/docs/plans/repeated-hour-1-4-1/).
//
//   1. The time chips name the CARE RECIPIENT's clock, as on mobile: a Denver caregiver tapping Evening for a
//      New York recipient stores 18:00 (it stored 20:00).
//   2. The viewer's repeated (fall-back) hour: a stored time on the SECOND reading of an hour the browser's
//      clock repeats saves back unchanged from an untouched edit, and a chip that lands there saves its own
//      HH:MM. The Date constructor names the FIRST reading, so both used to save an hour early.
//
// The browser is pinned to America/Denver. Case 2 needs a day on which Denver falls back, so it is computed from
// the clock, never hard-coded: the recipient is Europe/London, on GMT for every US fall-back, where 08:00 London
// is the second 01:00 on the Denver clock.
//
// WHICH fall-back (date bomb, 2026-11-01): the untouched-edit case opens the med from the Meds roster, which reads
// the server's default window (today-15 .. today+30). A series starting on the NEXT fall-back is only listed in
// the ~30 days before it; on every other day (from the fall-back itself until early October) it is not, so that
// case seeds a daily med that started on the most RECENT fall-back, which always has doses in the window. The
// create case types its date into the form, so it keeps the next one (any date within the year is accepted).

const VIEWER_TZ = 'America/Denver';
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: VIEWER_TZ });
test.setTimeout(120_000);

/** UTC offset of `zone` at `t`, in minutes. */
function offsetMin(zone: string, t: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return Math.round((asUtc - Math.floor(t / 60000) * 60000) / 60000);
}

/** The first minute of the SECOND reading of the fall-back nearest `from` going `dir` (+1 next, -1 most recent). */
function fallBack(zone: string, dir: 1 | -1, from = Date.now()): number {
  const step = 15 * 60000;
  for (let i = 0; i < (400 * 86_400_000) / step; i++) {
    // The 15-minute slice [a, a + step) that holds the offset drop.
    const a = dir === 1 ? from + i * step : from - (i + 1) * step;
    if (offsetMin(zone, a + step) < offsetMin(zone, a)) {
      let at = a + step;
      while (offsetMin(zone, at - 60000) === offsetMin(zone, at)) at -= 60000;
      if (dir === 1 ? at > from : at <= from) return at;
    }
  }
  throw new Error(`no fall-back in ${zone} within 400 days`);
}

/** The next instant after now at which `zone` falls back: the first minute of the SECOND reading. */
function nextFallBack(zone: string): number {
  return fallBack(zone, 1);
}

/** The most recent instant at or before now at which `zone` fell back (the first minute of the SECOND reading). */
function lastFallBack(zone: string): number {
  return fallBack(zone, -1);
}

function wallIn(t: number, zone: string): { date: string; hhmm: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

async function arrange(request: import('@playwright/test').APIRequestContext, label: string, recipientTz: string) {
  const owner = await createScopedAccount(label);
  // The circle's zone falls back to its owner's (no care-recipient account in these circles).
  sqlExec(`update users set timezone = ${sqlStr(recipientTz)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  return { owner, session, circleId };
}

interface Row {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
}
function medRoots(circleId: string, name: string): Row[] {
  return dbQuery<Row>(
    `select id::text, scheduled_date::text, scheduled_time::text from calendar_events
      where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'medication'
        and medication_name = ${sqlStr(name)} and parent_event_id is null`
  );
}

async function openMedForm(page: Page, circleId: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const trigger = page.locator('aside').getByRole('button', { name: 'New', exact: true });
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  await page.getByRole('menu', { name: 'New' }).getByRole('menuitem', { name: /^(Med|Medication)$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New medication' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("time chips are the recipient's clock", () => {
  test('Denver browser, New York recipient: Evening stores 18:00 on the recipient day', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'chipny', 'America/New_York');
    await cookieLogin(context, a.owner, baseURL);
    const name = `ZZ_E2E_CHIP_${uniqueSuffix()}`;
    const dialog = await openMedForm(page, a.circleId);
    await dialog.locator('#medication_name').fill(name);
    const evening = dialog.getByRole('radio', { name: /Evening/ });
    await evening.click();
    await expect(evening).toBeChecked();
    // The zones differ (Denver browser, New York recipient): the conversion line sits under the lit chip, and the
    // chip group is described by it so a screen reader reads it with the chip.
    const line = dialog.getByTestId('time-conversion');
    // Recipient first, the viewer second, in plain words (owner 1.4.0).
    await expect(line).toHaveText('6:00 PM in New York is 4:00 PM for you (Denver)');
    await expect(dialog.getByRole('radiogroup', { name: 'Common dose times' })).toHaveAccessibleDescription(
      '6:00 PM in New York is 4:00 PM for you (Denver)'
    );
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const rows = medRoots(a.circleId, name);
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_time?.slice(0, 5)).toBe('18:00');
    // The start date is the recipient's today, or the next day when 6 PM there has already passed
    // (the backend starts the series with its next dose).
    expect([dateInTz('America/New_York', 0), dateInTz('America/New_York', 1)]).toContain(rows[0].scheduled_date);
  });
});

test.describe('"Other time" is on the same clock as the chips (owner 1.4.0)', () => {
  test('Denver browser, New York recipient: the field is typed on the recipient clock ("Time in New York"); 07:30 reads "Other time, 7:30 AM", the line names both', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'otherny', 'America/New_York');
    await cookieLogin(context, a.owner, baseURL);
    const dialog = await openMedForm(page, a.circleId);
    await dialog.getByRole('button', { name: 'Other time' }).click();
    // ONE clock on the control: the field, the cell and every chip are the RECIPIENT's clock, and the field says so.
    await expect(dialog.getByLabel(/^Time in New York/)).toBeVisible();
    await dialog.locator('#scheduled_time').fill('07:30');
    const other = dialog.getByTestId('time-chip-other');
    await expect(other).toHaveAccessibleName('Other time, 7:30 AM');
    await expect(dialog.getByTestId('time-chip-other-time')).toHaveText('7:30 AM');
    await expect(dialog.locator('#scheduled_time')).toHaveValue('07:30');
    await expect(other).not.toContainText('·');
    // The viewer's own clock only in the conversion line (here the time field's hint).
    await expect(dialog.getByText('7:30 AM in New York is 5:30 AM for you (Denver)')).toBeVisible();
    const name = `ZZ_E2E_OTHER_${uniqueSuffix()}`;
    await dialog.locator('#medication_name').fill(name);
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const rows = medRoots(a.circleId, name);
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_time?.slice(0, 5)).toBe('07:30');
  });
});

test.describe("the browser's repeated (fall-back) hour", () => {
  const second = nextFallBack(VIEWER_TZ);
  const recipient = wallIn(second, 'Europe/London');
  // The untouched edit's series started on the most recent fall-back (see the header: the roster window).
  const pastSecond = lastFallBack(VIEWER_TZ);
  const pastRecipient = wallIn(pastSecond, 'Europe/London');
  const pastViewer = wallIn(pastSecond, VIEWER_TZ);

  test('the scenario: 08:00 London is the second 01:00 in Denver on the next and the last fall-back day', () => {
    for (const t of [second, pastSecond]) {
      expect(wallIn(t, 'Europe/London').hhmm).toBe('08:00');
      expect(wallIn(t, VIEWER_TZ).hhmm).toBe('01:00');
      expect(wallIn(t - 3_600_000, VIEWER_TZ).hhmm).toBe('01:00'); // the first 01:00, an hour earlier
    }
    expect(pastSecond).toBeLessThanOrEqual(Date.now());
    expect(second).toBeGreaterThan(Date.now());
    expect(second - pastSecond).toBeLessThan(400 * 86_400_000);
  });

  test('an untouched edit of a dose on the second reading saves it back unchanged', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'repedit', 'Europe/London');
    await cookieLogin(context, a.owner, baseURL);
    const name = `ZZ_E2E_REPEAT_${uniqueSuffix()}`;
    const res = await a.session.post(`/api/circles/${a.circleId}/events`, {
      event_type: 'medication',
      title: name,
      medication_name: name,
      medication_dosage: '5 mg',
      scheduled_date: pastRecipient.date,
      scheduled_time: pastRecipient.hhmm,
      recurrence_rule: 'daily',
      notifications_enabled: false,
    });
    expect(res.status(), `create med: ${await res.text()}`).toBe(201);
    expect(medRoots(a.circleId, name)[0]?.scheduled_time?.slice(0, 5)).toBe('08:00');

    await page.goto(`/circles/${a.circleId}/meds`, { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('med-time-row').filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Edit', exact: true }).click();
    // The edit is the add form's simple layout (owner 1.4.0): the stored 08:00 London lights Morning (the
    // chip is the recipient's clock); the start date (More details) is the viewer's day of that instant.
    const dialog = page.getByRole('dialog', { name: 'Edit medication' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.locator('#scheduled_date')).toHaveValue(pastViewer.date, { timeout: 20_000 });
    await expect(
      dialog.getByRole('radiogroup', { name: 'Common dose times' }).getByRole('radio', { name: /Morning/ })
    ).toBeChecked();

    const patch = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.startsWith(`/api/circles/${a.circleId}/events/`),
      { timeout: 25_000 }
    );
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    expect((await patch).ok()).toBe(true);
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const row = medRoots(a.circleId, name)[0];
    expect({ date: row.scheduled_date, time: row.scheduled_time?.slice(0, 5) }).toEqual({
      date: pastRecipient.date,
      time: '08:00',
    });
    // An untouched edit moves nothing, so the started series' first dose is not frozen into a child on its
    // start date either (a time edit of a started series would freeze one there).
    const children = dbQuery<{ n: string }>(
      `select count(*)::text as n from calendar_events
        where parent_event_id = ${sqlStr(row.id)}::uuid and scheduled_date = ${sqlStr(pastRecipient.date)}::date`
    );
    expect(children[0]?.n).toBe('0');
  });

  test('Morning on that day lights and stores 08:00 London', async ({ page, context, request, baseURL }) => {
    const a = await arrange(request, 'repchip', 'Europe/London');
    await cookieLogin(context, a.owner, baseURL);
    const name = `ZZ_E2E_REPEAT_${uniqueSuffix()}`;
    const dialog = await openMedForm(page, a.circleId);
    await dialog.locator('#medication_name').fill(name);
    // The start date is behind More details; with no time yet it is the recipient's day the chip lands on.
    await dialog.getByRole('button', { name: /More details/ }).click();
    await dialog.locator('#scheduled_date').fill(recipient.date);
    const morning = dialog.getByRole('radio', { name: /Morning/ });
    await morning.click();
    await expect(morning).toBeChecked();
    // The line names the instant that is saved: 08:00 London is the SECOND 01:00 in Denver (the first would read 7:00 AM).
    await expect(dialog.getByTestId('time-conversion')).toHaveText('8:00 AM in London is 1:00 AM for you (Denver)');
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const rows = medRoots(a.circleId, name);
    expect(rows).toHaveLength(1);
    expect({ date: rows[0].scheduled_date, time: rows[0].scheduled_time?.slice(0, 5) }).toEqual({
      date: recipient.date,
      time: '08:00',
    });
  });
});
