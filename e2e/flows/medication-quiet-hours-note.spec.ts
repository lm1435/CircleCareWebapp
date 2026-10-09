import type { Browser, BrowserContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { apiSession, dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { circleTimezone, dateInTz } from '../notesFirstClassShared';

// Quiet hours OFF by default (migration 20261005130000) + the dose-time note.
//
//   * a NEW account has NULL quiet hours in the real DB (no 22:00-07:00 default),
//     so a 10 PM dose gets NO note;
//   * once quiet hours are ON (22:00-07:00) a 10 PM dose in the medication form
//     shows the amber note, a 9 AM dose does not, and Save is never blocked.
//
// The viewer's profile timezone is set to the browser context's timezone so the
// instant is judged in the zone the form was typed in. Run-scoped accounts only.
//
// Clock-independent: the saved dose is dated TWO days ahead in the recipient's
// zone. A 10:30 PM dose dated "today" hit the "time has already passed" notice
// (and never reached "Medication added") whenever the suite ran after 10:30 PM
// recipient time — a date bomb, not a quiet-hours signal.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const TZ = process.env.PW_E2E_TZ || 'America/Denver';
const NOTE =
  'This time is during quiet hours, so no reminder will be sent then. You can change quiet hours in Account.';

async function openForm(browser: Browser, baseURL: string | undefined, acc: ScopedAccount, circleId: string) {
  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const ctx: BrowserContext = await browser.newContext({ baseURL: origin, timezoneId: TZ });
  await cookieLogin(ctx, acc, baseURL);
  const page = await ctx.newPage();
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Medications' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add medication' }).first().click();
  return { ctx, page, form: page.getByRole('dialog') };
}

test('a NEW account has quiet hours OFF, so a 10 PM dose shows no note', async ({ browser, request, baseURL }) => {
  const owner = await createScopedAccount('qh-new');
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, `qh ${uniq('c').slice(-6)}`);
  const row = dbQuery<{ s: string | null; e: string | null }>(
    `select quiet_hours_start::text as s, quiet_hours_end::text as e from users where id = ${sqlStr(owner.userId)}::uuid`
  );
  expect(row[0]).toEqual({ s: null, e: null });
  sqlExec(`update users set timezone = ${sqlStr(TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);

  const { ctx, form } = await openForm(browser, baseURL, owner, circleId);
  try {
    await form.getByLabel(/^Time/).fill('22:30');
    // Give the profile query time to settle: the note must STAY absent.
    await form.page().waitForTimeout(1500);
    await expect(form.getByTestId('dose-quiet-hours-note')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('with quiet hours ON the note shows for a 10 PM dose, not a 9 AM one, and never blocks Save', async ({
  browser,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('qh-on');
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, `qh ${uniq('c').slice(-6)}`);
  const futureDate = dateInTz(await circleTimezone(session, circleId), 2);
  sqlExec(
    `update users set timezone = ${sqlStr(TZ)}, quiet_hours_start = '22:00', quiet_hours_end = '07:00' where id = ${sqlStr(owner.userId)}::uuid;`
  );

  const { ctx, page, form } = await openForm(browser, baseURL, owner, circleId);
  try {
    const time = form.getByLabel(/^Time/);
    await time.fill('22:30');
    await expect(form.getByTestId('dose-quiet-hours-note')).toHaveText(NOTE, { timeout: 15_000 });

    await time.fill('09:00');
    await expect(form.getByTestId('dose-quiet-hours-note')).toHaveCount(0);

    // Back inside the window and SAVE: the note never blocks it.
    await time.fill('22:30');
    await expect(form.getByTestId('dose-quiet-hours-note')).toBeVisible();
    await form.getByLabel(/Medication name/i).fill(`Metformin ${uniq('x').slice(-6)}`);
    await form.getByLabel(/Dosage/i).fill('500 mg');
    await form.getByLabel(/^Date/).fill(futureDate);
    await expect(form.getByLabel(/^Date/)).toHaveValue(futureDate);
    await expect(form.getByTestId('dose-quiet-hours-note')).toBeVisible();
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Medication added')).toBeVisible({ timeout: 20_000 });
  } finally {
    await ctx.close();
  }
});
