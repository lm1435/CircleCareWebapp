import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { dbQuery, sqlStr } from '../../unhappy';
import { localDate, purgeEventsTitled } from './_helpers';

// THE "15 MINUTES BEFORE" DEFAULT IS OFF — checked against the SAVED ROW.
//
// `defaultReminder15mFor` (lib/eventForm.ts) was flipped to false for every
// type, and nothing verified what a new entry actually stores. The column
// `calendar_events.reminder_15m` DEFAULTS TO TRUE in the database, so a client
// that omits the key, or a form that pre-checks the box, both store `true` and
// the cron sends a second push 15 minutes early on every occurrence. These
// tests read the row back.

test.use({ persona: 'premiumOwner' });

async function fillTimedEvent(page: Page, circleId: string, type: 'task' | 'appointment', title: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add event' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New event' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#event_type').selectOption(type);
  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(localDate(3));
  // Reminders only render once a time is set.
  await dialog.locator('#scheduled_time').fill('10:00');
  await dialog.locator('#endTime').fill('10:30');
  return dialog;
}

function storedReminder15m(circleId: string, title: string): string[] {
  return dbQuery<{ r: string }>(
    `select reminder_15m::text as r from calendar_events
      where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)}`
  ).map((row) => row.r);
}

async function saveAndCapture(page: Page, dialog: Locator, circleId: string): Promise<Record<string, unknown>> {
  const posted = page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname === `/api/circles/${circleId}/events`
  );
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const body = (await posted).postDataJSON() as Record<string, unknown>;
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  return body;
}

for (const type of ['task', 'appointment'] as const) {
  test(`${type} saved without touching reminders stores reminder_15m = false`, async ({ page, circleId }) => {
    const title = uniqueLabel(`Rem ${type}`);
    try {
      const dialog = await fillTimedEvent(page, circleId, type, title);
      // Positive signal that the reminder controls rendered, and are untouched.
      const m15 = dialog.getByRole('checkbox', { name: '15 minutes before' });
      await expect(m15).toBeVisible();
      await expect(m15).toHaveAttribute('aria-checked', 'false');

      const body = await saveAndCapture(page, dialog, circleId);
      expect(body.reminder_15m, 'the client sends an explicit false').toBe(false);
      expect(storedReminder15m(circleId, title)).toEqual(['false']);
    } finally {
      purgeEventsTitled(circleId, title);
    }
  });
}

test('task with "15 minutes before" explicitly checked stores reminder_15m = true', async ({ page, circleId }) => {
  const title = uniqueLabel('Rem checked');
  try {
    const dialog = await fillTimedEvent(page, circleId, 'task', title);
    const m15 = dialog.getByRole('checkbox', { name: '15 minutes before' });
    await expect(m15).toHaveAttribute('aria-checked', 'false');
    await m15.click();
    await expect(m15).toHaveAttribute('aria-checked', 'true');

    const body = await saveAndCapture(page, dialog, circleId);
    expect(body.reminder_15m).toBe(true);
    expect(storedReminder15m(circleId, title)).toEqual(['true']);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});
