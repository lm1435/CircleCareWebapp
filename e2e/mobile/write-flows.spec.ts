import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addDaysISO,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  uniqueSuffix,
} from '../notesFirstClassShared';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// K16 (docs/plans/web-test-gaps-2026-09-29-reviewed.md): WRITES on a phone
// (mobile-chrome = Pixel 5, 390x664, coarse pointer). Task create at this size
// is already covered by create-menu-mobile.spec.ts; this file adds a medication
// (dates and times PICKED through sheets, never `.fill`), a Home dose confirm
// and a vital, and asserts on every page that nothing scrolls sideways.

const pill = (page: Page) => page.getByTestId('floating-nav');

async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
  const ok = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  );
  expect(ok, `${where}: the page scrolls sideways at 390px`).toBe(true);
}

/** Pick a wall time in the bottom-sheet time picker (hour, minute, and AM/PM when the viewer uses 12h). */
async function pickTime(page: Page, hour24: number, minute: number): Promise<void> {
  const sheet = page.getByRole('dialog', { name: 'Time picker' });
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  const period = sheet.getByRole('listbox', { name: 'AM/PM' });
  const twelveHour = (await period.count()) > 0;
  const hourLabel = twelveHour ? String(hour24 % 12 === 0 ? 12 : hour24 % 12) : String(hour24).padStart(2, '0');
  const hourRe = new RegExp(`^0?${hourLabel.replace(/^0/, '')}$`);
  await sheet.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: hourRe }).click();
  await sheet.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: String(minute).padStart(2, '0'), exact: true }).click();
  if (twelveHour) {
    await period.getByRole('option', { name: hour24 < 12 ? /^a\.? ?m\.?$/i : /^p\.? ?m\.?$/i }).click();
  }
  // Escape closes the picker only (it stops propagation before the modal sees it).
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden({ timeout: 10_000 });
}

test.describe('phone writes', () => {
  test.setTimeout(120_000);

  test('(a) medication from the pill New menu: sheets for date and time, Create is hittable, one series row', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const owner = await createScopedAccount('phonemed');
    const api = await ownerApi(request, owner);
    const circleId = await createCircle(api, uniq('phonemed'));
    const tz = await circleTimezone(api, circleId);
    const date = addDaysISO(dateInTz(tz, 0), 3);
    const name = `ZZ_E2E_PHONEMED_${uniqueSuffix()}`;
    await cookieLogin(context, owner, baseURL);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    // The first-run wizard is not shown for a circle created over the API.
    await expectNoSidewaysScroll(page, 'circle overview');
    const newCell = pill(page).getByRole('button', { name: 'New' });
    await expect(newCell).toBeVisible({ timeout: 20_000 });
    await newCell.click();
    await page.getByRole('menuitem', { name: 'Med', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'New event' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.locator('#event_type')).toHaveValue('medication');
    await dialog.locator('#medication_name').fill(name);
    await dialog.locator('#medication_dosage').fill('5 mg');

    // DATE: tap -> sheet -> tap the day. The recipient's +3 (never "today", so
    // the past-time notice cannot interpose). The sheet opens on the current
    // month; +3 days may be next month, so page forward when the cell is absent.
    await dialog.locator('#scheduled_date').tap();
    const datePicker = page.getByRole('dialog', { name: 'Date picker' });
    await expect(datePicker).toBeVisible();
    const cell = datePicker.locator(`[data-day="${date}"]`);
    for (let i = 0; i < 2 && (await cell.count()) === 0; i += 1) {
      await datePicker.getByRole('button', { name: 'Next month' }).tap();
    }
    await cell.tap();
    await expect(datePicker).toBeHidden();
    await expect(dialog.locator('#scheduled_date')).toHaveValue(date);

    // TIME: tap -> sheet -> hour, minute, period.
    await dialog.locator('#scheduled_time').tap();
    await pickTime(page, 9, 0);
    await expect(dialog.locator('#scheduled_time')).toHaveValue(/^(09:00|0?9:00\s?(AM|a\.\s?m\.))$/i);

    // CREATE IS HITTABLE: what is at the button's centre IS the button (a sheet,
    // the keyboard or a stacked footer must not cover it).
    const create = dialog.getByRole('button', { name: 'Create', exact: true });
    await create.scrollIntoViewIfNeeded();
    const hit = await create.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!at && (at === el || el.contains(at));
    });
    expect(hit, 'elementFromPoint at the centre of Create is the button').toBe(true);
    await expectNoSidewaysScroll(page, 'Add medication modal');

    const posts = countRequests(page, 'POST', '/api/circles/:id/events');
    await create.click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await posts.expectCount(1);

    const rows = dbQuery<{ scheduled_date: string; scheduled_time: string }>(
      `select scheduled_date::text as scheduled_date, scheduled_time::text as scheduled_time
         from calendar_events
        where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'medication'
          and medication_name = ${sqlStr(name)} and parent_event_id is null`
    );
    expect(rows).toEqual([{ scheduled_date: date, scheduled_time: '09:00:00' }]);
  });

  test('(b) Home dose confirm on a phone writes a taken confirmation', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const owner = await createScopedAccount('phonedose');
    const api = await ownerApi(request, owner);
    const circleId = await createCircle(api, uniq('phonedose'));
    const tz = await circleTimezone(api, circleId);
    const name = `ZZ_E2E_PHONEDOSE_${uniqueSuffix()}`;
    // Yesterday start at 00:01: today's 00:01 dose is due (K2 setup).
    const root = await createDailyMedication(api, circleId, name, addDaysISO(dateInTz(tz, 0), -1), { time: '00:01' });
    await cookieLogin(context, owner, baseURL);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    const today = page.locator('section[aria-labelledby="todays-meds-heading"] > ul');
    const confirm = today.getByRole('button', { name: `Confirm ${name}` }).first();
    await expect(confirm).toBeVisible({ timeout: 25_000 });
    await expectNoSidewaysScroll(page, 'Home');
    const posts = countRequests(page, 'POST', '/api/circles/:id/medications/confirm');
    await confirm.tap();
    // The Undo window is 5 s; the write goes out when it lapses.
    await posts.expectCount(1, { timeoutMs: 20_000 });
    const rows = dbQuery<{ status: string; scheduled_date: string }>(
      `select mc.status, ce.scheduled_date::text as scheduled_date
         from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
        where ce.circle_id = ${sqlStr(circleId)}::uuid
          and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)
          and ce.scheduled_date = ${sqlStr(dateInTz(tz, 0))}::date`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toMatch(/^taken/);
  });

  test('(c) vital from Health > Vitals: heart rate 70 writes one health_vitals row', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const owner = await createScopedAccount('phonevital');
    const api = await ownerApi(request, owner);
    const circleId = await createCircle(api, uniq('phonevital'));
    const note = `ZZ_E2E_PHONEVITAL_${uniqueSuffix()}`;
    await cookieLogin(context, owner, baseURL);

    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(pill(page)).toBeVisible({ timeout: 20_000 });
    await pill(page).getByRole('link', { name: 'Health' }).or(pill(page).getByRole('button', { name: 'Health' })).first().click();
    // The Health tab is a client-side navigation to the Health page. Wait for that page to RENDER (its
    // Emergency/Documents switcher) before probing for a Vitals entry: probed earlier, the probe matches
    // Home's Quick Access "Vitals" row, which is about to unmount (the URL changes before the new route
    // renders); the click then waits for a detached element until the test times out (final regression
    // 10-02: red every time, on the pre-tonight web code too).
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/emergency`), { timeout: 20_000 });
    await expect(page.getByRole('tablist', { name: 'Health' })).toBeVisible({ timeout: 20_000 });
    const vitalsLink = page.getByRole('link', { name: 'Vitals' }).or(page.getByRole('menuitem', { name: 'Vitals' })).first();
    if (await vitalsLink.isVisible().catch(() => false)) await vitalsLink.click();
    else await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/vitals`), { timeout: 20_000 });
    await expectNoSidewaysScroll(page, 'Vitals');

    await page.getByRole('button', { name: 'Add reading' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add reading' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.locator('#vital_type').selectOption('heart_rate');
    await dialog.locator('#value1').fill('70');
    await dialog.locator('#notes').fill(note);
    await expectNoSidewaysScroll(page, 'Add reading modal');
    await dialog.getByRole('button', { name: 'Save reading', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const rows = dbQuery<{ vital_type: string; value1: number }>(
      `select vital_type, value1::float as value1 from health_vitals
        where circle_id = ${sqlStr(circleId)}::uuid and notes = ${sqlStr(note)}`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ vital_type: 'heart_rate', value1: 70 });
    await expectNoSidewaysScroll(page, 'Vitals after save');
  });
});
