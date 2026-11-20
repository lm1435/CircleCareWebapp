import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { fillSimpleTime } from '../helpers';
import { cookieLogin, createCircle, createScopedAccount, uniq } from '../unhappy/auth-invites/_helpers';
import { apiSession, type ApiSession } from '../unhappy';
import { circleTimezone, dateInTz } from '../notesFirstClassShared';

// "Add to this shift" (1.4.3): the detail's one button opens the Task / Medication / Appointment chooser; an
// appointment is added with the FULL form in window mode (locked day, start inside the window) and lands on the
// shift's "Also happening" group and on the calendar. Run-scoped account and circle.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180_000);

interface Scene {
  session: ApiSession;
  circleId: string;
  today: string;
  owner: Awaited<ReturnType<typeof createScopedAccount>>;
}

async function scene(request: APIRequestContext): Promise<Scene> {
  const owner = await createScopedAccount('shiftadd');
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, uniq('shiftadd'));
  const tz = await circleTimezone(session, circleId);
  return { session, circleId, today: dateInTz(tz, 0), owner };
}

/** Today 06:00 to midnight: not "ended" before midnight, and 03:00 is OUTSIDE it (before the start = tomorrow). */
async function seedShift(s: Scene): Promise<void> {
  const res = await s.session.post(`/api/circles/${s.circleId}/events`, {
    event_type: 'shift',
    title: 'Afternoons',
    scheduled_date: s.today,
    scheduled_time: '06:00',
    duration_minutes: 1080,
    reminder_lead_minutes: null,
    assigned_to: s.owner.userId,
  });
  expect(res.ok(), `seed shift: ${await res.text()}`).toBeTruthy();
}

async function openDetail(page: Page, circleId: string) {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const modes = page.getByRole('tablist', { name: 'Calendar mode' });
  await expect(modes).toBeVisible({ timeout: 20_000 });
  await modes.getByRole('tab', { name: /^Shifts/ }).click();
  await page.getByRole('tablist', { name: 'Calendar view' }).getByRole('tab', { name: 'Day' }).click();
  await page.getByTestId('shifts-day-list').getByRole('button', { name: /^Afternoons, / }).click();
  const detail = page.getByRole('dialog', { name: 'Afternoons' });
  await expect(detail).toBeVisible({ timeout: 20_000 });
  return detail;
}

test.describe('add to this shift', () => {
  let s: Scene;
  test.beforeEach(async ({ request, context, baseURL }) => {
    s = await scene(request);
    await cookieLogin(context, s.owner, baseURL);
    await seedShift(s);
  });

  test('the chooser has Task, Medication, Appointment and Cancel; Cancel returns to the detail', async ({ page }) => {
    const detail = await openDetail(page, s.circleId);
    // ONE ghost button, outside the list card.
    await expect(detail.getByTestId('shift-detail-add-task')).toHaveCount(1);
    await expect(detail.getByTestId('shift-task-list-empty-card').getByTestId('shift-detail-add-task')).toHaveCount(0);
    await expect(detail.getByTestId('shift-task-list-empty-hint')).toBeVisible();
    await detail.getByRole('button', { name: 'Add to this shift', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Add to this shift' });
    await expect(chooser).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Afternoons' })).toHaveCount(0);
    await expect(chooser.getByTestId('shift-add-subtitle')).toContainText('6:00 AM');
    const ids = await chooser.locator('[data-testid^="shift-add-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')).filter((id) => id !== 'shift-add-subtitle' && id !== 'shift-add-chooser')
    );
    expect(ids).toEqual(['shift-add-task', 'shift-add-medication', 'shift-add-appointment', 'shift-add-cancel']);
    await chooser.getByTestId('shift-add-cancel').click();
    await expect(page.getByRole('dialog', { name: 'Afternoons' })).toBeVisible();
  });

  test('appointment: locked day, out-of-window start refused, in-window save rings on "Also happening" and shows on the calendar', async ({ page }) => {
    const detail = await openDetail(page, s.circleId);
    await detail.getByRole('button', { name: 'Add to this shift', exact: true }).click();
    await page.getByTestId('shift-add-appointment').click();
    const form = page.getByRole('dialog', { name: 'New appointment' });
    await expect(form).toBeVisible();
    // The day is locked: the tile with its hint, and no date input to reach.
    await expect(form.getByTestId('shift-window-locked-day')).toContainText('during Afternoons');
    await expect(form.getByTestId('shift-window-locked-hint')).toHaveText('Locked to shift');
    await expect(form.locator('#scheduled_date')).toHaveCount(0);
    await expect(form.getByTestId('shift-window-time-hint')).toContainText('Between 6:00 AM');

    await form.getByRole('textbox', { name: /^Title/ }).fill('Dr Rivera visit');
    // Outside the window: refused inline, nothing sent.
    let created = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/events$/.test(new URL(r.url()).pathname)) created++;
    });
    await fillSimpleTime(form, '03:00');
    await form.getByTestId('add-event-save').click();
    await expect(form.getByText('Pick a time inside this shift.')).toBeVisible();
    expect(created).toBe(0);
    await expect(form).toBeVisible();

    // Inside it: saves, returns to the detail with "Also happening" open and the new row there.
    await fillSimpleTime(form, '23:45');
    await form.getByTestId('add-event-save').click();
    const back = page.getByRole('dialog', { name: 'Afternoons' });
    await expect(back).toBeVisible({ timeout: 20_000 });
    expect(created).toBe(1);
    await expect(back.getByTestId('shift-also-toggle')).toHaveAttribute('aria-expanded', 'true', { timeout: 20_000 });
    await expect(back.getByTestId('shift-also-list')).toContainText('Dr Rivera visit');

    // And on the calendar: an ordinary appointment on the shift's day.
    const res = await s.session.get(`/api/circles/${s.circleId}/events?start_date=${s.today}&end_date=${s.today}`);
    const rows = ((await res.json()) as { data: { events: Array<Record<string, any>> } }).data.events;
    const visit = rows.filter((e) => e.event_type === 'appointment' && e.title === 'Dr Rivera visit');
    expect(visit).toHaveLength(1);
    expect(visit[0].scheduled_date).toBe(s.today);
    expect((visit[0].scheduled_time as string).slice(0, 5)).toBe('23:45');
    expect(visit[0].shift ?? null).toBeNull();
  });
});
