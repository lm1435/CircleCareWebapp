import { test, expect } from '../fixtures';
import { expectLanguagePicker } from '../languagePicker';
import type { Page } from '@playwright/test';

// German (de) twin of i18n-spanish.spec.ts, written by the DE language lane.
// RUNS ONLY AFTER THE REGISTRY FLIP (the backend Zod enum and the webapp registry must
// accept 'de'); a lane does not claim it green. Same flow as the Spanish spec, German
// strings from src/i18n/de/*.json (formal "Sie", glossary docs/i18n/glossary-de.md).
//
// Forcing German, isolated to this file's contexts (the shared demo account is
// never mutated):
//   1. `locale: 'de'` → i18n's navigator LanguageDetector picks `de` on load.
//   2. We rewrite this context's GET /users/me to report `language: 'de'`, so
//      <LanguageSync> keeps the UI in German instead of flipping to whatever
//      the demo account has saved.
//
// Non-destructive: navigates + opens modals only, never submits.

test.use({ locale: 'de', viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    // Guarded: a fast navigation can dispose the request mid-flight, so on any
    // error we just let it through (locale:'de' still drives the UI language).
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
      if (body?.data?.user) body.data.user.language = 'de';
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
const DE_NAV = [
  'Start',
  'Kalender',
  'Aufgaben',
  'Aktivität',
  'Dokumente',
  'Mitglieder',
  'Vitalwerte',
  'Kreiseinstellungen',
];
const EN_NAV = [
  'Home',
  'Calendar',
  'Tasks',
  'Activity',
  'Documents',
  'Members',
  'Vitals',
  'Settings',
];

async function expectGermanNav(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(nav).toBeVisible({ timeout: NAV_TIMEOUT });
  for (const label of DE_NAV) {
    // .first(): the "Home" group's Eyebrow label and its single NavLink render
    // the SAME text ("Start") inside the nav (Sidebar.tsx groups a single-item
    // section under an eyebrow named after that item) — either match proves
    // the label is translated.
    await expect(nav.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // No English chrome leaked. exact:true so a substring never counts.
  for (const en of EN_NAV) {
    await expect(
      nav.getByText(en, { exact: true }),
      `English nav label "${en}" leaked while in German`
    ).toHaveCount(0);
  }
}

// Each circle-scoped page: nav in German + the page's own heading in German.
// `heading: null` ⇒ heading is dynamic (month / recipient name), so we lean on
// the nav assertion for that page.
const CIRCLE_PAGES: { path: string; heading: string | null }[] = [
  { path: '', heading: 'Pflegeteam' }, // overview (h1 is the recipient name)
  { path: '/calendar', heading: null }, // heading is the current month
  { path: '/tasks', heading: 'Aufgaben' },
  { path: '/activity', heading: 'Aktivität' },
  { path: '/emergency', heading: 'Notfallinfos' },
  { path: '/documents', heading: 'Dokumente' },
  { path: '/vitals', heading: 'Vitalwerte' },
  { path: '/members', heading: 'Mitglieder' },
  { path: '/settings', heading: 'Kreiseinstellungen' },
];

for (const { path, heading } of CIRCLE_PAGES) {
  test(`circle page "${path || '/'}" renders in German`, async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}${path}`, { waitUntil: 'domcontentloaded' });
    await expectGermanNav(page);
    if (heading) {
      // Assert the page's own heading (not a nav link) is the German string.
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
  { route: '/circles', text: 'Kreis beitreten' },
  { route: '/profile', text: 'Profil & Einstellungen' },
  { route: '/help', text: 'Hilfe & FAQ' },
  { route: '/invites', text: 'Ihre Einladungen' },
];

for (const { route, text } of TOP_PAGES) {
  test(`top-level page "${route}" renders in German`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
}

test('join-circle modal is fully translated', async ({ page }) => {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Kreis beitreten' }).click();

  // Modal chrome + the two-step entry copy, all German (source of truth:
  // src/i18n/de/circles.json -> "joinModal").
  await expect(
    page.getByText('Geben Sie den 6-stelligen Code aus Ihrer Einladung ein.')
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByText('Einladungscode', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kreis suchen' })).toBeVisible();
  // No English fallbacks bled into the modal.
  await expect(page.getByText('Invite code', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find circle' })).toHaveCount(0);
});

test('profile language selector is in German and reflects the active language', async ({
  page,
}) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Sprache', { exact: true }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  // The language options render (names per profile.language.names, completed by the
  // flip); the page being German proves "de" is active.
  await expect(page.getByText('Español', { exact: true })).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toBeVisible();  // 1.2.2 flip: all eight languages, picker order, endonyms, the active one checked.
  await expectLanguagePicker(page, 'Sprache', 'Deutsch');
});
