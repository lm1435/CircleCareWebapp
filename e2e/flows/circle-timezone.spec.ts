import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { apiSession, dbQuery, sqlStr } from '../unhappy';

// Owner-configurable circle time zone (docs/plans/circle-timezone.md, web T12),
// against the REAL backend and database.
//
// Circle settings → "Time zone": the field shows the EFFECTIVE zone as
// "City (GMT-X)" and where it comes from. Picking a zone saves it to
// `care_circles.timezone` ("Set by you"); "Automatic" clears it to NULL. Axe
// runs on the page with the picker open.
//
// Zones are Mexican (Monterrey, Mexico City): Mexico abolished DST in 2022, so
// "(GMT-6)" is the label every day of the year.
//
// Run-scoped account + fresh circle: nothing shared is touched.
//
// Mobile: .maestro flow for the Edit Circle zone change (T10).

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

interface Scene {
  circleId: string;
}

async function scene(
  context: BrowserContext,
  request: Parameters<typeof apiSession>[0],
  baseURL: string | undefined
): Promise<Scene> {
  const owner = await createScopedAccount('circletz');
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, uniq('circletz'));
  await cookieLogin(context, owner, baseURL);
  return { circleId };
}

function storedZone(circleId: string): string | null {
  return dbQuery<{ timezone: string | null }>(
    `select timezone from care_circles where id = ${sqlStr(circleId)}::uuid`
  )[0].timezone;
}

async function openSettings(page: Page, circleId: string) {
  await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });
  const card = page.getByTestId('circle-timezone-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  return { card, field: card.getByRole('combobox', { name: 'Time zone' }) };
}

test.describe('circle time zone (owner, Circle settings)', () => {
  test('set a zone, see it persist, then go back to automatic', async ({ page, context, request, baseURL }, testInfo) => {
    const { circleId } = await scene(context, request, baseURL);
    expect(storedZone(circleId)).toBeNull();

    const { card, field } = await openSettings(page, circleId);
    // Fresh circle, no recipient account: the owner's device zone (or the default).
    await expect(card.getByTestId('circle-timezone-source')).toHaveText('From your device (default)');
    await expect(field).toHaveValue(/^.+ \(GMT([+-]\d{1,2}(:\d{2})?)?\)$/);
    await expect(card.getByText('Medication times follow this zone', { exact: true })).toBeVisible();
    await expect(
      card.getByText('Times keep their clock time — an 8:00 AM dose stays 8:00 AM in the new time zone.', {
        exact: true,
      })
    ).toBeVisible();

    // Open the picker: automatic first, regions grouped. Axe with it open.
    await field.click();
    const list = page.getByRole('listbox', { name: 'Time zones' });
    await expect(list).toBeVisible();
    await expect(field).toHaveAttribute('aria-expanded', 'true');
    // Automatic = label + sub-line. No recipient account here, so it follows the owner's device.
    const automatic = list.getByRole('option').first();
    await expect(automatic.getByText('Automatic', { exact: true })).toBeVisible();
    await expect(automatic.getByText(/^Follow your device · currently .+$/)).toBeVisible();
    await expect(field).toHaveAttribute('placeholder', 'Search city or region');
    await expect(list.getByRole('group', { name: 'Americas' })).toBeVisible();
    await checkA11y(page, 'circle-timezone-picker-open', testInfo);

    // Search narrows the list; pick Monterrey.
    await field.fill('monterrey');
    await expect(list.getByRole('option')).toHaveCount(1);
    await list.getByRole('option', { name: 'Monterrey (GMT-6)' }).click();

    await expect(page.getByText('Circle updated.')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => storedZone(circleId), { timeout: 15_000 }).toBe('America/Monterrey');
    await expect(field).toHaveValue('Monterrey (GMT-6)', { timeout: 20_000 });
    await expect(card.getByTestId('circle-timezone-source')).toHaveText('Set by you');

    // It sticks across a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const again = await openSettings(page, circleId);
    await expect(again.field).toHaveValue('Monterrey (GMT-6)', { timeout: 20_000 });
    await expect(again.card.getByTestId('circle-timezone-source')).toHaveText('Set by you');

    // Automatic clears the override back to NULL.
    await again.field.click();
    await page
      .getByRole('listbox', { name: 'Time zones' })
      .getByRole('option', { name: /^Automatic/ })
      .click();
    await expect.poll(() => storedZone(circleId), { timeout: 15_000 }).toBeNull();
    await expect(again.card.getByTestId('circle-timezone-source')).toHaveText('From your device (default)', {
      timeout: 20_000,
    });
  });

  test('keyboard: type, arrow, Enter picks; Escape closes without saving', async ({ page, context, request, baseURL }, testInfo) => {
    const { circleId } = await scene(context, request, baseURL);
    const { card, field } = await openSettings(page, circleId);

    await field.focus();
    await field.pressSequentially('Mexico City');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Time zones' })).toBeHidden();
    expect(storedZone(circleId)).toBeNull();

    await field.focus();
    await field.pressSequentially('Mexico City');
    await page.keyboard.press('ArrowDown');
    await expect(field).toHaveAttribute('aria-activedescendant', /.+/);
    await page.keyboard.press('Enter');
    await expect.poll(() => storedZone(circleId), { timeout: 15_000 }).toBe('America/Mexico_City');
    await expect(field).toHaveValue('Mexico City (GMT-6)', { timeout: 20_000 });
    await expect(card.getByTestId('circle-timezone-source')).toHaveText('Set by you');
    await checkA11y(page, 'circle-timezone-set', testInfo);
  });
});

test.describe('circle time zone — Spanish', () => {
  // Same technique as i18n-spanish.spec.ts: navigator locale `es` plus this
  // context's GET /users/me rewritten to `language: 'es'` so <LanguageSync>
  // keeps the UI in Spanish.
  test.use({ locale: 'es' });

  test('row copy in Spanish', async ({ page, context, request, baseURL }) => {
    const { circleId } = await scene(context, request, baseURL);
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      try {
        const res = await route.fetch();
        const body = (await res.json()) as { data?: { user?: { language?: string } } };
        if (body?.data?.user) body.data.user.language = 'es';
        await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) });
      } catch {
        await route.continue().catch(() => undefined);
      }
    });
    await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('circle-timezone-card');
    await expect(card.getByRole('combobox', { name: 'Zona horaria' })).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId('circle-timezone-source')).toHaveText('De tu dispositivo (predeterminada)');
    await expect(card.getByText('Los horarios de los medicamentos siguen esta zona', { exact: true })).toBeVisible();
  });
});
