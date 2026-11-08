import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { cookieLogin, createCircle, createScopedAccount, uniq } from '../unhappy/auth-invites/_helpers';
import { apiSession, type ApiSession } from '../unhappy';
import { circleTimezone, dateInTz } from '../notesFirstClassShared';

// Shift rotations (docs/plans/shifts-meds-repeat-and-series-edit.md): "Days on / off" on the shift
// form, the month view of a 14 on / 7 off + 7 on / 14 off pair, the detail's "14 days on, 7 days off"
// and "Day n of N" line, and rescheduling "All upcoming shifts" from a date to 7 / 7 while the
// earlier shifts stay as they were. Run-scoped account and circle.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(240_000);

interface Scene {
  session: ApiSession;
  circleId: string;
  tz: string;
  owner: Awaited<ReturnType<typeof createScopedAccount>>;
}

async function premiumScene(request: APIRequestContext): Promise<Scene> {
  const owner = await createScopedAccount('rotation');
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, uniq('rotation'));
  const tz = await circleTimezone(session, circleId);
  return { session, circleId, tz, owner };
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** "Sun, Nov 29": how the detail names the date a rotation comes back. */
const shortDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${iso}T12:00:00Z`));

async function openMonth(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const modes = page.getByRole('tablist', { name: 'Calendar mode' });
  await expect(modes).toBeVisible({ timeout: 20_000 });
  await modes.getByRole('tab', { name: /^Shifts/ }).click();
  await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: 'Month' }).click();
  // An empty circle shows the empty state in place of the grid.
  await expect(
    page.getByTestId('shifts-month-view').or(page.getByTestId('shifts-empty-state'))
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * The month cell of a date. Opening a day switches the calendar to Day view, so this goes back to
 * Month first, then steps to the month on the grid (either way) until the date is on it.
 */
async function dayCell(page: Page, iso: string) {
  const monthTab = page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: 'Month' });
  if ((await monthTab.getAttribute('aria-selected')) !== 'true') await monthTab.click();
  const grid = page.getByRole('grid', { name: 'Shifts month calendar' });
  await expect(grid).toBeVisible({ timeout: 20_000 });
  const cell = grid.locator(`[data-date="${iso}"]`);
  for (let i = 0; i < 4 && (await cell.count()) === 0; i++) {
    const first = await grid.locator('[data-date]').first().getAttribute('data-date');
    const before = (first ?? '') > iso;
    await page.getByRole('button', { name: before ? 'Previous month' : 'Next month', exact: true }).click();
  }
  await expect(cell).toHaveCount(1);
  return cell;
}

/** none = no shift that day, covered / open = a shift (the dot state). */
async function dots(page: Page, iso: string): Promise<string | null> {
  return (await dayCell(page, iso)).getAttribute('data-shift-dots');
}

async function expectDots(page: Page, iso: string, expected: 'none' | 'covered' | 'open'): Promise<void> {
  await expect
    .poll(async () => dots(page, iso), { message: `month dot on ${iso}`, timeout: 20_000 })
    .toBe(expected);
}

async function createRotation(
  page: Page,
  o: { name: string; start: string; on: number; off: number; assignMe: boolean }
): Promise<void> {
  await page.getByRole('button', { name: /^Add (a )?shift$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'New shift' });
  await form.locator('#shift_name').fill(o.name);
  // 6 PM to 6 PM: one 24 hour shift, so the days run back to back.
  await form.getByTestId('shift-start-tile').click();
  await form.locator('#shift_start').fill('18:00');
  await form.getByTestId('shift-end-tile').click();
  await form.locator('#shift_end').fill('18:00');
  await form.locator('#shift_date').fill(o.start);
  // The four most people need; "Custom…" opens the rest in place (approved mock 2026-11-08).
  const tiles = form.getByRole('radiogroup', { name: 'How often?' });
  await expect(tiles.getByRole('radio')).toHaveText(['Once', 'Every day', 'Every week']);
  const customTile = form.getByTestId('shift-repeat-custom');
  await expect(customTile).toHaveText('Custom…');
  await expect(customTile).toHaveAttribute('aria-expanded', 'false');
  await customTile.click();
  const custom = form.getByRole('radiogroup', { name: 'Custom' });
  await expect(custom.getByRole('radio')).toHaveText([
    'Every other day',
    'Days on / off',
    'Some days',
    'Monthly',
    'Yearly',
  ]);
  await custom.getByRole('radio', { name: 'Days on / off' }).click();
  await form.locator('#cycle_days_on').fill(String(o.on));
  await form.locator('#cycle_days_off').fill(String(o.off));
  const panel = form.getByTestId('shift-cycle-panel');
  await expect(panel.getByTestId('shift-cycle-summary')).toHaveText(`${o.on} days on, ${o.off} days off`);
  await expect(panel.getByTestId('shift-cycle-hint')).toHaveText(
    'Each day is one 6:00 PM to 6:00 PM shift. They run back to back.'
  );
  await expect(panel.getByTestId('shift-cycle-cell')).toHaveCount(42);
  if (o.assignMe) {
    await form.getByRole('radiogroup', { name: /^Who's with/ }).getByRole('radio', { name: 'Me' }).click();
  }
  await form.getByRole('button', { name: 'Save shift' }).click();
  const saved = page.getByRole('dialog', { name: `"${o.name}" saved` });
  await expect(saved).toBeVisible({ timeout: 20_000 });
  await expect(saved.getByText(`${o.on} days on, ${o.off} days off`).first()).toBeVisible();
  await saved.getByRole('button', { name: 'Done' }).click();
}

/** Open a shift's detail from the month: its day, then its card. */
async function openDetail(page: Page, iso: string, name: string) {
  await (await dayCell(page, iso)).click();
  const list = page.getByTestId('shifts-day-list');
  await list.getByRole('button', { name: new RegExp(`^${name},`) }).click();
  const detail = page.getByRole('dialog', { name });
  await expect(detail).toBeVisible();
  return detail;
}

test.describe('shift rotations', () => {
  let s: Scene;
  test.beforeEach(async ({ request, context, baseURL }) => {
    s = await premiumScene(request);
    await cookieLogin(context, s.owner, baseURL);
  });

  test('14 on / 7 off then 7 on / 14 off: the month is covered, the detail names the rotation and the day', async ({
    page,
  }, testInfo) => {
    const start = dateInTz(s.tz, 1);
    await openMonth(page, s.circleId);
    await expect(page.getByTestId('shifts-empty-state')).toBeVisible({ timeout: 20_000 });

    // Week one and two: 14 days on, 7 off. Then the second person's week: 7 on, 14 off from day 15.
    await createRotation(page, { name: 'Weeks A', start, on: 14, off: 7, assignMe: true });
    await createRotation(page, { name: 'Weeks B', start: addDays(start, 14), on: 7, off: 14, assignMe: true });

    // Days 1-21 (start .. start+20) have exactly one covered shift each; the day before has none.
    await expectDots(page, addDays(start, -1), 'none');
    for (const n of [0, 6, 13, 14, 17, 20]) await expectDots(page, addDays(start, n), 'covered');
    // Day 22: A is back on (14 on again), B is off until day 36.
    await expectDots(page, addDays(start, 21), 'covered');
    await checkA11y(page, 'shifts-rotation-month-light', testInfo);

    // Detail of A on its 8th day: the rotation in words and the position line.
    const day8 = addDays(start, 7);
    const detail = await openDetail(page, day8, 'Weeks A');
    await expect(detail.getByTestId('shift-detail-repeat')).toHaveText('14 days on, 7 days off');
    await expect(detail.getByTestId('shift-detail-rotation')).toHaveText(
      `Day 8 of 14 · back on ${shortDate(addDays(start, 21))}`
    );
    await checkA11y(page, 'shifts-rotation-detail-light', testInfo);
    await detail.getByRole('button', { name: 'Close' }).last().click();

    // B on its first day, and A on an OFF day has no card at all (B is the one covering).
    const bDetail = await openDetail(page, addDays(start, 14), 'Weeks B');
    await expect(bDetail.getByTestId('shift-detail-repeat')).toHaveText('7 days on, 14 days off');
    await expect(bDetail.getByTestId('shift-detail-rotation')).toHaveText(
      `Day 1 of 7 · back on ${shortDate(addDays(start, 35))}`
    );
  });

  test('Edit > All upcoming shifts > 7 / 7 from a date: earlier shifts stay as they are', async ({ page }) => {
    const start = dateInTz(s.tz, 1);
    const from = addDays(start, 7);
    await openMonth(page, s.circleId);
    await expect(page.getByTestId('shifts-empty-state')).toBeVisible({ timeout: 20_000 });
    await createRotation(page, { name: 'Rota', start, on: 14, off: 7, assignMe: false });

    // Before: days 1-14 on, 15-21 off.
    for (const n of [0, 6, 7, 13]) await expectDots(page, addDays(start, n), 'open');
    for (const n of [14, 20]) await expectDots(page, addDays(start, n), 'none');
    await expectDots(page, addDays(start, 21), 'open');

    const detail = await openDetail(page, from, 'Rota');
    await detail.getByRole('button', { name: 'Edit' }).click();
    const form = page.getByRole('dialog', { name: 'Edit shift' });
    await form.getByRole('radio', { name: 'All upcoming shifts' }).click();
    // Starting defaults to the tapped shift; the stored rotation is preselected with its counts.
    await expect(form.locator('#shift_date')).toHaveValue(from);
    // A stored rotation opens with Custom expanded and Days on / off selected inside it.
    await expect(form.getByTestId('shift-repeat-custom')).toHaveAttribute('aria-expanded', 'true');
    await expect(form.getByRole('radiogroup', { name: 'Custom' }).getByRole('radio', { name: 'Days on / off' })).toBeChecked();
    await expect(form.locator('#cycle_days_on')).toHaveValue('14');
    await expect(form.locator('#cycle_days_off')).toHaveValue('7');
    await form.locator('#cycle_days_on').fill('7');
    await form.locator('#cycle_days_off').fill('7');
    await expect(form.getByTestId('shift-cycle-was')).toHaveText('was 14 days on, 7 days off');
    await expect(form.getByTestId('shift-form-from-note')).toContainText(
      'stay as they are, including who covered them.'
    );
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });

    // Earlier shifts (start .. from-1) are untouched; from now: 7 on, 7 off, 7 on.
    for (const n of [0, 3, 6]) await expectDots(page, addDays(start, n), 'open');
    for (const n of [7, 10, 13]) await expectDots(page, addDays(start, n), 'open');
    for (const n of [14, 17, 20]) await expectDots(page, addDays(start, n), 'none');
    for (const n of [21, 24, 27]) await expectDots(page, addDays(start, n), 'open');

    // The detail of a later shift speaks the new rotation.
    const after = await openDetail(page, addDays(start, 21), 'Rota');
    await expect(after.getByTestId('shift-detail-repeat')).toHaveText('7 days on, 7 days off');
    await expect(after.getByTestId('shift-detail-rotation')).toHaveText(
      `Day 1 of 7 · back on ${shortDate(addDays(start, 35))}`
    );
  });
  test('Edit > This shift > a new date moves only that shift; the rest of the series stays', async ({ page }) => {
    const start = dateInTz(s.tz, 1);
    const moved = addDays(start, 2);
    const target = addDays(start, 3);
    const seeded = await s.session.post(`/api/circles/${s.circleId}/events`, {
      event_type: 'shift',
      title: 'Alt',
      scheduled_date: start,
      scheduled_time: '09:00',
      duration_minutes: 240,
      recurrence_rule: 'every_other_day',
    });
    expect(seeded.ok(), `seed shift: ${await seeded.text()}`).toBeTruthy();

    await openMonth(page, s.circleId);
    // Before: start, +2, +4, +6 have a shift; +3 has none.
    for (const n of [0, 2, 4, 6]) await expectDots(page, addDays(start, n), 'open');
    await expectDots(page, target, 'none');

    const detail = await openDetail(page, moved, 'Alt');
    await detail.getByRole('button', { name: 'Edit' }).click();
    const form = page.getByRole('dialog', { name: 'Edit shift' });
    await expect(form.getByRole('radio', { name: 'This shift' })).toBeChecked();
    await expect(form.locator('#shift_date')).toHaveValue(moved);
    await form.locator('#shift_date').fill(target);
    const patch = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && /\/api\/circles\/[^/]+\/events\//.test(r.url())
    );
    await form.getByRole('button', { name: 'Save changes' }).click();
    const res = await patch;
    expect(res.ok(), `PATCH: ${res.status()}`).toBeTruthy();
    // The server detaches the moved occurrence: it is a standalone shift now.
    const body = (await res.json()) as { data: { event: { parent_event_id: string | null; scheduled_date: string } } };
    expect(body.data.event.parent_event_id).toBeNull();
    expect(body.data.event.scheduled_date).toBe(target);
    await expect(form).toBeHidden({ timeout: 20_000 });

    // The moved shift is on its new date, the old date is empty, the rest is unchanged.
    await expectDots(page, target, 'open');
    await expectDots(page, moved, 'none');
    for (const n of [0, 4, 6, 8]) await expectDots(page, addDays(start, n), 'open');
    for (const n of [1, 5, 7]) await expectDots(page, addDays(start, n), 'none');

    // Its detail opens on the new date and reads as a single shift; a series shift still repeats.
    const movedDetail = await openDetail(page, target, 'Alt');
    await expect(movedDetail.getByTestId('shift-detail-repeat')).toHaveText('Never');
    await movedDetail.getByRole('button', { name: 'Close' }).last().click();
    const seriesDetail = await openDetail(page, addDays(start, 4), 'Alt');
    await expect(seriesDetail.getByTestId('shift-detail-repeat')).not.toHaveText('Never');
  });
});
