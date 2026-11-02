import { test, expect } from '../fixtures';
import { dbQuery, failRequest, sqlStr } from '../unhappy';
import { setProfileLanguage } from '../notesFirstClassShared';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { successToast } from '../unhappy/writes/_helpers';

// K4 — Profile settings persist and take effect (timezone, quiet hours, units,
// language, and the failure path). Run-scoped premium account (tz America/Denver,
// language en) so the worker account's settings are never touched.
//
// Run twice: once in the project's browser zone, once with the BROWSER in a far
// zone (Pacific/Kiritimati, UTC+14) so the viewer's clock never coincides with
// the profile zone being written. Every assertion is on the server's stored
// value or the API's reading of it, never on the runner's wall clock.
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const USER_ME = '/api/users/me';
const QUIET = '/api/users/me/quiet-hours';
const UNITS = '/api/users/me/unit-preferences';

const userRow = (userId: string) =>
  dbQuery<{
    timezone: string;
    language: string;
    weight_unit: string | null;
    glucose_unit: string | null;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
  }>(
    `select timezone, language, weight_unit, glucose_unit, quiet_hours_start::text, quiet_hours_end::text
       from users where id = ${sqlStr(userId)}::uuid`
  )[0];

for (const browserZone of [null, 'Pacific/Kiritimati'] as const) {
  test.describe(`profile settings persist (browser zone ${browserZone ?? 'project default'})`, () => {
    if (browserZone) test.use({ timezoneId: browserZone });

    test('timezone: follows the browser even with dependent circles, read-only on Profile, persisted across reload, and it is the circle recipient frame (PARKED P4)', async ({
      page,
      request,
      context,
      baseURL,
    }) => {
      const acct = await createScopedAccount('prof-tz');
      const api = await ownerApi(request, acct);
      // A circle with no recipient account: its dose times follow the owner's zone.
      const circleId = await createCircle(api, uniq('prof-tz'));
      await cookieLogin(context, acct, baseURL);
      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      const device = browserZone ?? 'America/Denver';
      const city = device.split('/').pop()!.replace(/_/g, ' ');

      // "Their phone dictates": the session start writes the browser zone with no
      // prompt and no exception for the dependent circle.
      const row = page.getByTestId('profile-timezone');
      await expect(row).toContainText(city, { timeout: 20_000 });
      await expect(row).toContainText('Set by your device.');
      await expect(row.getByRole('button')).toHaveCount(0);
      await expect(row.getByRole('combobox')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => userRow(acct.userId).timezone, { timeout: 20_000 }).toBe(device);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('profile-timezone')).toContainText(city, { timeout: 20_000 });

      // PARKED P4: with no recipient account, the owner's profile zone IS the
      // circle's frame, so following the browser moves every dose time in it.
      const res = await api.get(`/api/circles/${circleId}`);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { data: { circle: { care_recipient_timezone: string } } };
      expect(body.data.circle.care_recipient_timezone).toBe(device);
    });

    test('quiet hours: on, HH:MM normalized after reload, end-only edit keeps start as HH:MM, off clears both', async ({
      page,
      request,
      context,
      baseURL,
    }) => {
      const acct = await createScopedAccount('prof-qh');
      // New accounts start with quiet hours OFF (migration 20261005130000 dropped the
      // 22:00-07:00 column default; NULL = off), so the first assertion is the switch
      // turning them on. No SQL reset needed any more.
      expect(userRow(acct.userId).quiet_hours_start, 'new account: quiet hours off').toBeNull();
      expect(userRow(acct.userId).quiet_hours_end, 'new account: quiet hours off').toBeNull();
      await cookieLogin(context, acct, baseURL);
      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      const toggle = page.getByRole('switch', { name: 'Enable quiet hours' });
      await expect(toggle).toBeVisible({ timeout: 20_000 });
      await expect(toggle).not.toBeChecked();

      const onReq = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith(QUIET));
      await toggle.click();
      expect((await onReq).postDataJSON()).toEqual({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' });
      await expect(successToast(page, 'Quiet hours updated.')).toBeVisible({ timeout: 15_000 });
      expect(userRow(acct.userId).quiet_hours_start).toBe('22:00:00');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#profile-quiet-start')).toHaveValue('22:00', { timeout: 20_000 });
      await expect(page.locator('#profile-quiet-end')).toHaveValue('07:00');

      // Regression (memory project_quiet_hours_time_format): the start that comes
      // back from the API is HH:MM:SS; sending it back unchanged is a 400.
      const endReq = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith(QUIET));
      const endRes = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(QUIET));
      await page.locator('#profile-quiet-end').fill('06:30');
      await page.locator('#profile-quiet-end').blur();
      expect((await endReq).postDataJSON()).toEqual({ quiet_hours_start: '22:00', quiet_hours_end: '06:30' });
      expect((await endRes).status()).toBe(200);
      await expect.poll(() => userRow(acct.userId).quiet_hours_end).toBe('06:30:00');
      expect(userRow(acct.userId).quiet_hours_start).toBe('22:00:00');

      await toggle.click();
      await expect.poll(() => userRow(acct.userId).quiet_hours_start).toBeNull();
      expect(userRow(acct.userId).quiet_hours_end).toBeNull();
      await expect(page.locator('#profile-quiet-start')).toHaveCount(0);
      void request;
    });

    test('units: weight and glucose persist and survive a reload', async ({ page, context, baseURL }) => {
      const acct = await createScopedAccount('prof-un');
      await cookieLogin(context, acct, baseURL);
      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      const kg = page.getByRole('radio', { name: 'Kilograms (kg)' });
      await expect(kg).toBeVisible({ timeout: 20_000 });

      const put1 = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith(UNITS));
      await kg.click();
      expect((await put1).postDataJSON()).toMatchObject({ weight_unit: 'kg' });
      await expect(successToast(page, 'Units updated.')).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => userRow(acct.userId).weight_unit).toBe('kg');

      const mmol = page.getByRole('radio', { name: 'mmol/L' });
      await mmol.click();
      await expect.poll(() => userRow(acct.userId).glucose_unit).toBe('mmol/L');
      expect(userRow(acct.userId).weight_unit).toBe('kg');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('radio', { name: 'Kilograms (kg)' })).toBeChecked({ timeout: 20_000 });
      await expect(page.getByRole('radio', { name: 'mmol/L' })).toBeChecked();
    });

    test('language: Spanish persists and renders ES copy, then back to English', async ({ page, context, baseURL }) => {
      const acct = await createScopedAccount('prof-lang');
      await cookieLogin(context, acct, baseURL);
      await setProfileLanguage(page, 'es');
      await expect.poll(() => userRow(acct.userId).language).toBe('es');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Zona horaria', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Time zone', { exact: true })).toHaveCount(0);
      await page.getByRole('radio', { name: 'English', exact: true }).click();
      await expect.poll(() => userRow(acct.userId).language).toBe('en');
      await expect(page.getByText('Time zone', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    });

    test('failure: a 500 on the sync PATCH leaves the stored zone unchanged and the page still renders it', async ({
      page,
      context,
      baseURL,
    }) => {
      test.skip(!browserZone, 'needs a browser zone that differs from the seeded zone');
      const acct = await createScopedAccount('prof-fail');
      await cookieLogin(context, acct, baseURL);
      const fault = await failRequest(page, 'PATCH', USER_ME, { status: 500, times: 1 });
      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      await fault.expectHits(1);
      await expect(page.getByTestId('profile-timezone')).toContainText('Denver', { timeout: 20_000 });
      expect(userRow(acct.userId).timezone).toBe('America/Denver');
      // The next session start retries and succeeds.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect.poll(() => userRow(acct.userId).timezone, { timeout: 20_000 }).toBe(browserZone);
    });
  });
}
