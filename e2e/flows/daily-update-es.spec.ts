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

  const card = page.getByRole('region', { name: 'Un día estable para Rose.' });
  await expect(card).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(card.getByText('Esta noche')).toBeVisible();
  await expect(
    card.getByText('Casi todas las dosis tomadas · 2 tareas hechas · una cita · Ana dejó una nota')
  ).toBeVisible();
  await expect(card.getByRole('link', { name: /^2 tareas hechas/ })).toBeVisible();
  await expect(card.getByRole('link', { name: /^Una nota de Ana/ })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Ocultar hasta mañana' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Ver el resumen completo' })).toBeVisible();
  await checkA11y(page, `/circles/${circleId} (resumen del día)`, testInfo);

  await page.goto(`/circles/${circleId}/daily-update/${addDays(today, -1)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('daily-update-glance')).toHaveText(
    '2 de 3 dosis tomadas · 1 sin marcar',
    { timeout: NAV_TIMEOUT }
  );
  await expect(page.getByRole('heading', { level: 2, name: 'Medicamentos' })).toBeVisible();
  await expect(page.getByText('Tomada, marcó Ana')).toBeVisible();
  await expect(page.getByText('Hecha por Luis')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Otros días' }).getByRole('link', { name: /^Día siguiente/ })
  ).toBeVisible();
  await checkA11y(page, `/circles/${circleId}/daily-update/<ayer> (es)`, testInfo);
});

test('acceso rápido: "Resúmenes del día"', async ({ page, circleId }) => {
  const at = mostRecentWallTime('12:00', TZ);
  await mockDailyUpdate(page, TZ, localDateOf(at, TZ));
  await page.clock.install({ time: at });
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Resúmenes del día' })).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
});
