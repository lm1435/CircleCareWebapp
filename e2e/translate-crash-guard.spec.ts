import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { checkA11y } from './helpers';

// BROWSER AUTO-TRANSLATE GUARD + LANGUAGE BANNER
// (docs/plans/web-translate-guard-language-banner.md, Task C).
//
//  1. Crash guard: Chrome translate wraps text nodes in <font>; React then fails
//     removeChild/insertBefore. src/lib/domExtensionGuard.ts tolerates that. We
//     simulate Translate (html.translated-ltr, lang=es, <font>-wrapped text) and
//     walk three circle sub-pages with the app's own nav: the circle-page error
//     fallback must never appear.
//  2. Banner flow: the strip shows in the TARGET language (Spanish); accept
//     PATCHes the profile language and flips the UI live.
//  3. Dismiss: sets cc_translate_prompt_dismissed; it stays gone after a reload.
//
// Accept mutates the worker's isolated account (language en -> es), so the test
// that accepts restores 'en' in a finally block. Run:
//   cd webapp && npx playwright test translate-crash-guard --project=chromium

test.use({ viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;
const DISMISS_KEY = 'cc_translate_prompt_dismissed';

/** What Chrome Translate does to the document, minus the network. */
async function simulateTranslate(
  page: Page,
  wrapText: boolean,
  scope = 'main'
): Promise<void> {
  await page.evaluate(([wrap, scopeSel]) => {
    const root = document.documentElement;
    root.classList.add('translated-ltr');
    root.lang = 'es';
    if (!wrap) return;
    const walker = document.createTreeWalker(document.querySelector(scopeSel as string) ?? document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (nodes.length < 50 && walker.nextNode()) {
      const n = walker.currentNode as Text;
      if (n.parentNode && n.nodeValue && n.nodeValue.trim() !== '') nodes.push(n);
    }
    for (const n of nodes) {
      const font = document.createElement('font');
      n.parentNode!.insertBefore(font, n);
      font.appendChild(n);
    }
  }, [wrapText, scope] as const);
}

/**
 * The signed-in account is shared per worker: put its language back to English
 * through the Profile picker (data routes are Bearer-only, so a raw cookie PATCH 401s).
 */
async function restoreEnglish(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.classList.remove('translated-ltr');
  });
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const group = page.getByRole('radiogroup', { name: /^(Language|Idioma)$/ });
  await expect(group).toBeVisible({ timeout: NAV_TIMEOUT });
  const english = group.getByRole('radio', { name: 'English', exact: true });
  // Idempotent: when English is already active (a retried restore, or the accept
  // never persisted), clicking the checked radio fires no PATCH to wait for.
  if (await english.isChecked()) return;
  const saved = page.waitForResponse(
    (r) => r.url().includes('/users/me') && r.request().method() === 'PATCH' && r.ok()
  );
  await english.click();
  await saved;
  await expect(english).toBeChecked();
}

test.describe('browser translate guard', () => {
  test('circle pages survive <font>-wrapped text across navigation', async ({ page, circleId }) => {
    const boundary = page.getByRole('heading', { name: 'Something went wrong' });
    await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.locator('main')).toContainText(/\S/, { timeout: NAV_TIMEOUT });
    await simulateTranslate(page, true);
    expect(await page.locator('main font').count()).toBeGreaterThan(0);

    for (const [label, path] of [
      ['Tasks', 'tasks'],
      ['Documents', 'documents'],
      ['Calendar', 'calendar'],
    ] as const) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/${path}`), { timeout: NAV_TIMEOUT });
      await expect(page.locator('main')).toContainText(/\S/, { timeout: NAV_TIMEOUT });
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: NAV_TIMEOUT });
      await expect(boundary).toHaveCount(0);
      // Re-wrap the freshly rendered page, as Translate does for new content.
      await simulateTranslate(page, true);
    }
    await expect(boundary).toHaveCount(0);
  });

  // The falsifiable scenario. A route change removes the old page at its root, so
  // font-wrapped text deep inside is never removed on its own. The real crash is an
  // IN-PLACE re-render that REMOVES a text node from a surviving element after Translate
  // moved it into a <font>: the Save button's label ("Save changes") is replaced by the
  // loading markup (label re-parented into a hidden span) while the <button> stays.
  // Without domExtensionGuard that removeChild throws and the circle-page boundary shows.
  test('in-place re-render of a font-wrapped button label does not crash', async ({
    page,
    circleId,
  }) => {
    const boundary = page.getByRole('heading', { name: 'Something went wrong' });
    // Hold the save open (and fail it) so the loading state is observable and nothing persists.
    await page.route(`**/api/circles/${circleId}`, async (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      await new Promise((r) => setTimeout(r, 1500));
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'E2E_HELD', message: 'held' } }),
      });
    });
    await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });
    const nameField = page.locator('#recipient_name');
    await expect(nameField).toBeVisible({ timeout: NAV_TIMEOUT });
    await nameField.fill(`${await nameField.inputValue()} x`);

    await simulateTranslate(page, true, 'form');
    const save = page.getByRole('button', { name: 'Save changes' });
    expect(await save.locator('font').count()).toBeGreaterThan(0);
    await save.click();

    // Wait for whichever settles first (loading state or the crash fallback), then
    // assert the fallback is NOT what we got.
    const busy = page.locator('button[type="submit"][aria-busy="true"]');
    await expect(busy.or(boundary)).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(boundary).toHaveCount(0);
    await expect(busy).toBeVisible();
    await expect(nameField).toBeVisible();
  });

  test('banner offers Spanish; accepting switches the UI', async ({ page, circleId }) => {
    // Three navigations + an axe scan + a profile-language round trip do not fit
    // the default 30s budget on a cold dev-mode Vite; the restore in `finally`
    // was getting cut off by the TEST timeout after the flow itself passed.
    test.setTimeout(90_000);
    try {
      await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: NAV_TIMEOUT });
      await simulateTranslate(page, false);

      const banner = page.getByTestId('translate-banner');
      await expect(banner).toBeVisible({ timeout: NAV_TIMEOUT });
      await expect(banner).toContainText('CircleCare está disponible en Español');
      await expect(banner.getByRole('button', { name: 'Cambiar a Español' })).toBeVisible();
      await expect(banner.getByRole('button', { name: 'Ahora no' })).toBeVisible();
      await checkA11y(page, `/circles/${circleId}/tasks (translate banner)`, test.info());

      await banner.getByRole('button', { name: 'Cambiar a Español' }).click();
      await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible({
        timeout: NAV_TIMEOUT,
      });
      await expect(banner).toHaveCount(0);
    } finally {
      await restoreEnglish(page);
    }
  });

  test('dismissed banner stays dismissed after reload', async ({ page, circleId }) => {
    // Two full page loads plus a fixed detection wait; same budget reasoning as above.
    test.setTimeout(60_000);
    await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: NAV_TIMEOUT });
    await simulateTranslate(page, false);

    const banner = page.getByTestId('translate-banner');
    await expect(banner).toBeVisible({ timeout: NAV_TIMEOUT });
    await banner.getByRole('button', { name: 'Ahora no' }).click();
    await expect(banner).toHaveCount(0);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), DISMISS_KEY)).not.toBeNull();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: NAV_TIMEOUT });
    await simulateTranslate(page, false);
    // Give the detection hook (MutationObserver + language bundle load) time to act.
    await page.waitForTimeout(1500);
    await expect(banner).toHaveCount(0);
  });
});
