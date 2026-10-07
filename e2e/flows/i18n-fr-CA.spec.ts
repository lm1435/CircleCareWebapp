import { test, expect } from '../fixtures';
import { expectLanguagePicker } from '../languagePicker';

// Canadian French (fr-CA): a SPARSE override of fr. Written by the FLIP stage (the FR
// lane shipped i18n-fr.spec.ts only). Proves, in a real browser, that a fr-CA
// browser + account land on fr-CA (not fr, not en), that untouched strings resolve
// through fr, and that the Quebec deltas win ("Signes vitaux" vs fr "Constantes").
//
// Locale forcing mirrors i18n-pt-PT.spec.ts: `locale: 'fr-CA'` drives detection and
// this context's GET /users/me reports `language: 'fr-CA'`. Non-destructive.

test.use({ locale: 'fr-CA', viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    // Guarded: a fast navigation can dispose the request mid-flight, so on any
    // error we just let it through (locale:'fr-CA' still drives the UI language).
    try {
      const res = await route.fetch();
      const text = await res.text();
      let body: { data?: { user?: { language?: string } } };
      try {
        body = JSON.parse(text);
      } catch {
        await route.fulfill({ response: res });
        return;
      }
      if (body?.data?.user) body.data.user.language = 'fr-CA';
      await route.fulfill({
        status: res.status(),
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    } catch {
      try {
        await route.continue();
      } catch {
        /* request already gone — nothing to do */
      }
    }
  });
});

test('fr-CA chrome: Quebec delta over the fr base, no English, html lang fr-CA', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav).toBeVisible({ timeout: NAV_TIMEOUT });
  // fr-CA override (common.nav.vitals)...
  await expect(nav.getByText('Signes vitaux', { exact: true }).first()).toBeVisible();
  await expect(nav.getByText('Constantes', { exact: true })).toHaveCount(0);
  // ...and the fr base for everything the override does not touch.
  for (const label of ['Accueil', 'Calendrier', 'Tâches', 'Activité', 'Membres']) {
    await expect(nav.getByText(label, { exact: true }).first()).toBeVisible();
  }
  for (const en of ['Home', 'Calendar', 'Tasks', 'Activity', 'Members', 'Vitals']) {
    await expect(nav.getByText(en, { exact: true })).toHaveCount(0);
  }
  // The page's own heading takes the Quebec override too (pageTitles / nav vitals).
  await expect(page.getByRole('heading', { name: 'Signes vitaux', exact: true }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
});

test('profile language selector is in French and Français (Canada) is active', async ({
  page,
}) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Langue', { exact: true }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expectLanguagePicker(page, 'Langue', 'Français (Canada)');
});
