import { test, expect } from '../fixtures';
import { checkA11y, pinRecipientZoneToBrowser } from '../helpers';
import {
  addDays,
  localDateOf,
  mockDailyUpdate,
  mostRecentWallTime,
  setTipsPref,
} from '../dailyUpdateShared';

/**
 * DAILY UPDATE, Spanish (docs/plans/daily-update.md §2.1, §8.3). Same harness as
 * daily-update.spec.ts; the UI language is forced the way i18n-spanish.spec.ts
 * does it (locale 'es' + GET /users/me reporting language 'es').
 *
 * NOT RUN in the web lane that added it: it needs the local backend.
 */

const TZ = 'America/Mexico_City';
test.use({ locale: 'es', timezoneId: TZ });

const NAV_TIMEOUT = 20_000;

test.beforeEach(async ({ page, account, circleId }) => {
  await pinRecipientZoneToBrowser(page, account, circleId);
  setTipsPref(account.userId, true);
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    try {
      const res = await route.fetch();
      const body = (await res.json()) as { data?: { user?: { language?: string } } };
      if (body?.data?.user) body.data.user.language = 'es';
      await route.fulfill({ status: res.status(), json: body });
    } catch {
      await route.continue().catch(() => {});
    }
  });
});

test('la tarjeta y la vista por fecha en español', async ({ page, circleId }, testInfo) => {
  const at = mostRecentWallTime('20:00', TZ);
  const today = localDateOf(at, TZ);
  await mockDailyUpdate(page, TZ, today);
  await page.clock.install({ time: at });
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  const card = page.getByRole('region', { name: 'El día de Rose' });
  await expect(card).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(card.getByText('Resumen del día')).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Hoy hasta ahora' })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Falta por hacer' })).toBeVisible();
  await expect(card.getByText('1 dosis omitida')).toBeVisible();
  // The unmarked dose appears once, as a "Falta por hacer" item, never also as a count.
  await expect(card.getByText(/sin marcar/i)).toHaveCount(1);
  await expect(card.getByRole('button', { name: 'Ocultar hasta mañana' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Ver el resumen completo' })).toBeVisible();
  await checkA11y(page, `/circles/${circleId} (resumen del día)`, testInfo);

  await page.goto(`/circles/${circleId}/daily-update/${addDays(today, -1)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'Lo que pasó' })).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expect(page.getByRole('heading', { name: 'Quedó pendiente ese día' })).toBeVisible();
});
