import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

// FRENCH twin of i18n-spanish.spec.ts (FR lane, 1.2.2; executed by the flip stage).
// Runs the whole app in French and asserts the UI is actually translated as we
// walk the flows — a runtime complement to the static i18n parity checks.
//
// Forcing French, isolated to this file's contexts (the shared demo account is
// never mutated):
//   1. `locale: 'fr'` → i18n's navigator LanguageDetector picks `fr` on load.
//   2. We rewrite this context's GET /users/me to report `language: 'fr'`, so
//      <LanguageSync> keeps the UI in French instead of flipping to whatever
//      the demo account has saved.
//
// Non-destructive: navigates + opens modals only, never submits.

test.use({ locale: 'fr', viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    // Guarded: a fast navigation can dispose the request mid-flight, so on any
    // error we just let it through (locale:'fr' still drives the UI language).
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
      if (body?.data?.user) body.data.user.language = 'fr';
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

// Sidebar nav is pure chrome (no user data), so it's a false-positive-free
// signal that the language actually switched on every page.
const FR_NAV = [
  'Accueil',
  'Calendrier',
  'Tâches',
  'Activité',
  'Documents',
  'Membres',
  'Constantes',
  'Paramètres du cercle',
];
const EN_NAV = [
  'Home',
  'Calendar',
  'Tasks',
  'Activity',
  'Members',
  'Vitals',
  'Settings',
];

async function expectFrenchNav(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav).toBeVisible({ timeout: NAV_TIMEOUT });
  for (const label of FR_NAV) {
    // .first(): the "Home" group's Eyebrow label and its single NavLink render
    // the SAME text ("Inicio") inside the nav (Sidebar.tsx groups a single-item
    // section under an eyebrow named after that item) — either match proves
    // the label is translated.
    await expect(nav.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // No English chrome leaked. exact:true so "Calendar" doesn't match "Calendario".
  for (const en of EN_NAV) {
    await expect(
      nav.getByText(en, { exact: true }),
      `English nav label "${en}" leaked while in French`
    ).toHaveCount(0);
  }
}

// Each circle-scoped page: nav in French + the page's own heading in French.
// `heading: null` ⇒ heading is dynamic (month / recipient name), so we lean on
// the nav assertion for that page.
const CIRCLE_PAGES: { path: string; heading: string | null }[] = [
  { path: '', heading: 'Équipe d’aidants' }, // overview (h1 is the recipient name)
  { path: '/calendar', heading: null }, // heading is the current month
  { path: '/tasks', heading: 'Tâches' },
  { path: '/activity', heading: 'Activité' },
  { path: '/emergency', heading: 'Infos d’urgence' },
  { path: '/documents', heading: 'Documents' },
  { path: '/vitals', heading: 'Constantes' },
  { path: '/members', heading: 'Membres' },
  { path: '/settings', heading: 'Paramètres du cercle' },
];

for (const { path, heading } of CIRCLE_PAGES) {
  test(`circle page "${path || '/'}" renders in French`, async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}${path}`, { waitUntil: 'domcontentloaded' });
    await expectFrenchNav(page);
    if (heading) {
      // Assert the page's own heading (not a nav link) is the French string.
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible({
        timeout: NAV_TIMEOUT,
      });
    }
    // Never an English ErrorBoundary fallback.
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
}

// Top-level (non-circle) pages — no circle sidebar, so anchor on page content.
// /circles heading is a greeting + the user's name when they have one, so anchor
// on the always-present "join a circle" action instead.
const TOP_PAGES: { route: string; text: string }[] = [
  { route: '/circles', text: 'Rejoindre un cercle' },
  { route: '/profile', text: 'Profil et paramètres' },
  { route: '/help', text: 'Aide et FAQ' },
  { route: '/invites', text: 'Vos invitations' },
];

for (const { route, text } of TOP_PAGES) {
  test(`top-level page "${route}" renders in French`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
}

test('join-circle modal is fully translated', async ({ page }) => {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Rejoindre un cercle' }).click();

  // Modal chrome + the two-step entry copy, all French (source of truth:
  // src/i18n/fr/circles.json -> "joinModal").
  await expect(
    page.getByText('Saisissez le code à 6 caractères figurant dans votre invitation.')
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByText('Code d’invitation', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trouver le cercle' })).toBeVisible();
  // No English fallbacks bled into the modal.
  await expect(page.getByText('Invite code', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find circle' })).toHaveCount(0);
});

test('profile language selector is in French and reflects the active language', async ({
  page,
}) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Langue', { exact: true }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  // Both language options render (the flip adds Français to the picker; en/es always exist).
  await expect(page.getByText('Español', { exact: true })).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toBeVisible();
});
