import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { apiSession, countRequests, dbCount, holdRequest, sqlStr } from '../../unhappy';
import {
  apiCreateEvent,
  dateInZone,
  doubleSubmitWhileHeld,
  localDate,
  openCalendarEvent,
  purgeEventsTitled,
  recipientTimezone,
} from './_helpers';

// DOUBLE SUBMIT WHILE PENDING — calendar event writes (AddEventModal create for
// appointment / medication / task, Enter-to-submit, DeleteEventDialog).
//
// Nothing dedupes `calendar_events` at the database, so a second POST is a
// second care record (two medication series = two reminder schedules and a
// doubled adherence denominator). Each test holds the write at the network
// layer, re-activates the control in the same tick AND while the request is
// pending, then proves ONE request left the browser and ONE row exists.

test.use({ persona: 'premiumOwner' });

const EVENTS = '/api/circles/:id/events';

async function openNewEvent(page: Page, circleId: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add event' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New event' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const eventRows = (circleId: string, title: string) =>
  `select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid
     and (title = ${sqlStr(title)} or medication_name = ${sqlStr(title)})`;

test('create appointment: double submit while the POST is pending writes one event', async ({ page, circleId }) => {
  const title = uniqueLabel('DS appt');
  try {
    const dialog = await openNewEvent(page, circleId);
    await dialog.locator('#event_type').selectOption('appointment');
    await dialog.locator('#title').fill(title);
    await dialog.locator('#scheduled_date').fill(localDate(3));
    await doubleSubmitWhileHeld(page, {
      method: 'POST',
      path: EVENTS,
      submit: dialog.getByRole('button', { name: 'Create', exact: true }),
      form: page.locator('#add-event-form'),
    });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(dbCount(eventRows(circleId, title))).toBe(1);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});

test('create medication: double submit while the POST is pending writes one series', async ({ page, circleId }) => {
  const name = uniqueLabel('DS med');
  try {
    const dialog = await openNewEvent(page, circleId);
    await dialog.locator('#event_type').selectOption('medication');
    await dialog.locator('#medication_name').fill(name);
    await dialog.locator('#medication_dosage').fill('5 mg');
    // Three days out: never "today" in any recipient zone, so the past-time
    // notice cannot interpose.
    await dialog.locator('#scheduled_date').fill(localDate(3));
    await dialog.locator('#scheduled_time').fill('09:00');
    await doubleSubmitWhileHeld(page, {
      method: 'POST',
      path: EVENTS,
      submit: dialog.getByRole('button', { name: 'Create', exact: true }),
      form: page.locator('#add-event-form'),
    });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(dbCount(`${eventRows(circleId, name)} and event_type = 'medication'`)).toBe(1);
  } finally {
    purgeEventsTitled(circleId, name);
  }
});

test('create task: double submit while the POST is pending writes one task', async ({ page, circleId }) => {
  const title = uniqueLabel('DS task');
  try {
    const dialog = await openNewEvent(page, circleId);
    await dialog.locator('#event_type').selectOption('task');
    await dialog.locator('#title').fill(title);
    await dialog.locator('#scheduled_date').fill(localDate(3));
    await doubleSubmitWhileHeld(page, {
      method: 'POST',
      path: EVENTS,
      submit: dialog.getByRole('button', { name: 'Create', exact: true }),
      form: page.locator('#add-event-form'),
    });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(dbCount(`${eventRows(circleId, title)} and event_type = 'task'`)).toBe(1);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});

test('create task: Enter pressed twice in the title field while the POST is pending writes one task', async ({
  page,
  circleId,
}) => {
  const title = uniqueLabel('DS enter');
  const hold = await holdRequest(page, 'POST', EVENTS);
  const sent = countRequests(page, 'POST', EVENTS);
  try {
    const dialog = await openNewEvent(page, circleId);
    await dialog.locator('#event_type').selectOption('task');
    await dialog.locator('#scheduled_date').fill(localDate(3));
    const titleField = dialog.locator('#title');
    await titleField.fill(title);
    // Implicit submission: Enter in a text field submits the form.
    await titleField.press('Enter');
    await hold.waitForHeld(1);
    // Past any short cooldown: the second Enter must meet a guard held for the
    // whole request, not one that let go after a few milliseconds.
    await page.waitForTimeout(1_000);
    await titleField.press('Enter');
    await page.waitForTimeout(500);
    expect(sent.count, 'POSTs sent while the first was held').toBe(1);
    await hold.release();
    await sent.expectCount(1);
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(dbCount(eventRows(circleId, title))).toBe(1);
  } finally {
    await hold.dispose();
    sent.dispose();
    purgeEventsTitled(circleId, title);
  }
});

test('delete event (DeleteEventDialog): double confirm while the DELETE is pending sends one DELETE', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const title = uniqueLabel('DS delete');
  const api = await apiSession(request, account);
  const tz = await recipientTimezone(api, circleId);
  const date = dateInZone(tz, 0);
  const created = await apiCreateEvent(api, circleId, { event_type: 'task', title, scheduled_date: date });
  try {
    const detail = await openCalendarEvent(page, circleId, date, title);
    await detail.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete event' });
    await expect(confirm).toBeVisible();
    await doubleSubmitWhileHeld(page, {
      method: 'DELETE',
      path: '/api/circles/:id/events/:eventId',
      submit: confirm.getByRole('button', { name: 'Delete', exact: true }),
    });
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(dbCount(`select 1 from calendar_events where id = ${sqlStr(created.id)}::uuid`)).toBe(0);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});
