import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addDaysISO,
  circleTimezone,
  dateInTz,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';
import { sqlExec } from '../db';
import { dbQuery, sqlStr, type ApiSession } from '../unhappy';
import { apiCreateEvent } from '../unhappy/writes/_helpers';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';

// CAN'T CLEAR ON EDIT (sweep 2026-11-08), against the REAL backend and database.
//
// An edit is a partial PATCH: an absent key keeps the stored value, only `null`
// clears it. The form used to OMIT an emptied field (`trim() || undefined`), so
// clearing notes / place, choosing "Any time" or "Once", or clearing a date of
// birth saved "successfully" while the database kept the old value. Each test
// clears through the real form and reads the row back from Postgres.
//
// Mobile: .maestro/parity/calendar/edit-clear-notes.yaml.

if (process.env.PW_E2E_TZ) test.use({ timezoneId: process.env.PW_E2E_TZ });

interface Seed {
  api: ApiSession;
  circleId: string;
  today: string;
}

async function seed(page: Page, context: BrowserContext, request: APIRequestContext, baseURL: string | undefined): Promise<Seed> {
  const owner = await createScopedAccount('editclear');
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq('editclear'));
  const tz = await circleTimezone(api, circleId);
  void page;
  await cookieLogin(context, owner, baseURL);
  return { api, circleId, today: dateInTz(tz, 0) };
}

function row(id: string): Record<string, unknown> {
  return dbQuery<Record<string, unknown>>(
    `select description, location, scheduled_time::text as scheduled_time, duration_minutes, recurrence_rule
       from calendar_events where id = ${sqlStr(id)}::uuid`
  )[0];
}

async function openEdit(page: Page, k: Seed, date: string, title: string, dialogName: string): Promise<Locator> {
  await gotoWeekContaining(page, k.circleId, k.today, date);
  const detail = await openChip(page, date, new RegExp(escapeRegExp(title)));
  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: dialogName });
  await expect(edit).toBeVisible();
  // The schedule hydrates from the series root, which may still be loading.
  await expect(edit.locator('#scheduled_date')).not.toHaveValue('', { timeout: 20_000 });
  return edit;
}

async function openMore(edit: Locator): Promise<void> {
  const toggle = edit.getByRole('button', { name: /^More details/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

test.describe('edit: an emptied field is cleared in the database', () => {
  test.setTimeout(120_000);

  test('appointment: clearing notes and place stores NULL (and the form reopens empty)', async ({ page, context, request, baseURL }) => {
    const k = await seed(page, context, request, baseURL);
    const title = `ZZ_E2E_CLRNOTES_${uniqueSuffix()}`;
    const day = addDaysISO(k.today, 1);
    const ev = await apiCreateEvent(k.api, k.circleId, {
      event_type: 'appointment',
      title,
      scheduled_date: day,
      scheduled_time: '10:00',
      duration_minutes: 60,
      description: 'Bring the card',
      location: 'Clinic, 2nd floor',
    });
    const edit = await openEdit(page, k, day, title, 'Edit appointment');
    await openMore(edit);
    await edit.getByLabel(/^Details/).fill('');
    await edit.getByLabel(/^Location/).fill('');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => row(ev.id).description, { timeout: 15_000 }).toBeNull();
    expect(row(ev.id).location).toBeNull();
    // Nothing else moved.
    expect(row(ev.id)).toMatchObject({ scheduled_time: '10:00:00', duration_minutes: 60 });

    const again = await openEdit(page, k, day, title, 'Edit appointment');
    await openMore(again);
    await expect(again.getByLabel(/^Details/)).toHaveValue('');
    await expect(again.getByLabel(/^Location/)).toHaveValue('');
  });

  test('appointment: "Any time" stores no time and no end', async ({ page, context, request, baseURL }) => {
    const k = await seed(page, context, request, baseURL);
    const title = `ZZ_E2E_CLRTIME_${uniqueSuffix()}`;
    const day = addDaysISO(k.today, 2);
    const ev = await apiCreateEvent(k.api, k.circleId, {
      event_type: 'appointment',
      title,
      scheduled_date: day,
      scheduled_time: '10:00',
      duration_minutes: 60,
    });
    const edit = await openEdit(page, k, day, title, 'Edit appointment');
    await edit.getByRole('radio', { name: 'Any time' }).click();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => row(ev.id).scheduled_time, { timeout: 15_000 }).toBeNull();
    expect(row(ev.id).duration_minutes).toBeNull();
  });

  test('task: "Once" on a repeating task ends the series', async ({ page, context, request, baseURL }) => {
    const k = await seed(page, context, request, baseURL);
    const title = `ZZ_E2E_CLRONCE_${uniqueSuffix()}`;
    const ev = await apiCreateEvent(k.api, k.circleId, {
      event_type: 'task',
      title,
      scheduled_date: k.today,
      recurrence_rule: 'daily',
    });
    const edit = await openEdit(page, k, k.today, title, 'Edit task');
    await edit.getByRole('radio', { name: 'Once' }).click();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => row(ev.id).recurrence_rule, { timeout: 15_000 }).toBeNull();
  });

  test('circle settings: clearing the date of birth stores NULL', async ({ page, context, request, baseURL }) => {
    const k = await seed(page, context, request, baseURL);
    sqlExec(`update care_circles set recipient_dob = '1941-03-07' where id = ${sqlStr(k.circleId)}::uuid`);
    await page.goto(`/circles/${k.circleId}/settings`, { waitUntil: 'domcontentloaded' });
    const dob = page.getByLabel('Date of birth');
    await expect(dob).toHaveValue('1941-03-07', { timeout: 20_000 });
    await dob.fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect
      .poll(
        () =>
          dbQuery<{ d: string | null }>(
            `select recipient_dob::text as d from care_circles where id = ${sqlStr(k.circleId)}::uuid`
          )[0].d,
        { timeout: 15_000 }
      )
      .toBeNull();
  });
});
