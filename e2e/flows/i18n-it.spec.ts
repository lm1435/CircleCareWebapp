import { test, expect } from '../fixtures';
import { expectLanguagePicker } from '../languagePicker';
import type { Page } from '@playwright/test';

// ITALIAN twin of i18n-spanish.spec.ts (lane: it). Executed by the FLIP stage only:
// it needs `it` in the registry (picker + backend Zod enum).
//
// Runs the whole app in Italian and asserts the UI is actually translated as we
// walk the flows — a runtime complement to the static i18n parity checks.
//
// Forcing Italian, isolated to this file's contexts (the shared demo account is
// never mutated):
//   1. `locale: 'it'` → i18n's navigator LanguageDetector picks `it` on load.
//   2. We rewrite this context's GET /users/me to report `language: 'it'`, so
//      <LanguageSync> keeps the UI in Italian instead of flipping to whatever
//      the demo account has saved.
//
// Non-destructive: navigates + opens modals only, never submits.

test.use({ locale: 'it', viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    // Guarded: a fast navigation can dispose the request mid-flight, so on any
    // error we just let it through (locale:'it' still drives the UI language).
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
      if (body?.data?.user) body.data.user.language = 'it';
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
const IT_NAV = [
  'Home', // Italian UI keeps the loanword "Home" (common.nav.home)
  'Calendario',
  'Incarichi',
  'Attività',
  'Documenti',
  'Membri',
  'Parametri vitali',
  'Impostazioni della cerchia',
];
// "Home" is deliberately absent: it is also the Italian label.
const EN_NAV = [
  'Calendar',
  'Tasks',
  'Activity',
  'Documents',
  'Members',
  'Vitals',
  'Settings',
];

async function expectItalianNav(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Navigazione principale' });
  await expect(nav).toBeVisible({ timeout: NAV_TIMEOUT });
  for (const label of IT_NAV) {
    // .first(): the "Home" group's Eyebrow label and its single NavLink render
    // the SAME text ("Home") inside the nav (Sidebar.tsx groups a single-item
    // section under an eyebrow named after that item) — either match proves
    // the label is translated.
    await expect(nav.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // No English chrome leaked. exact:true so "Calendar" doesn't match "Calendario".
  for (const en of EN_NAV) {
    await expect(
      nav.getByText(en, { exact: true }),
      `English nav label "${en}" leaked while in Italian`
    ).toHaveCount(0);
  }
}

// Each circle-scoped page: nav in Italian + the page's own heading in Italian.
// `heading: null` ⇒ heading is dynamic (month / recipient name), so we lean on
// the nav assertion for that page.
const CIRCLE_PAGES: { path: string; heading: string | null }[] = [
  { path: '', heading: 'Team di cura' }, // overview (h1 is the recipient name)
  { path: '/calendar', heading: null }, // heading is the current month
  { path: '/tasks', heading: 'Incarichi' },
  { path: '/activity', heading: 'Attività' },
  { path: '/emergency', heading: 'Informazioni di emergenza' },
  { path: '/documents', heading: 'Documenti' },
  { path: '/vitals', heading: 'Parametri vitali' },
  { path: '/members', heading: 'Membri' },
  { path: '/settings', heading: 'Impostazioni della cerchia' },
];

for (const { path, heading } of CIRCLE_PAGES) {
  test(`circle page "${path || '/'}" renders in Italian`, async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}${path}`, { waitUntil: 'domcontentloaded' });
    await expectItalianNav(page);
    if (heading) {
      // Assert the page's own heading (not a nav link) is the Italian string.
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
  { route: '/circles', text: 'Unisciti a una cerchia' },
  { route: '/profile', text: 'Profilo e impostazioni' },
  { route: '/help', text: 'Aiuto e domande frequenti' },
  { route: '/invites', text: 'I tuoi inviti' },
];

for (const { route, text } of TOP_PAGES) {
  test(`top-level page "${route}" renders in Italian`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
}

test('join-circle modal is fully translated', async ({ page }) => {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Unisciti a una cerchia' }).click();

  // Modal chrome + the two-step entry copy, all Italian (source of truth:
  // src/i18n/it/circles.json -> "joinModal").
  await expect(
    page.getByText('Inserisci il codice di 6 caratteri del tuo invito.')
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByText('Codice di invito', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trova la cerchia' })).toBeVisible();
  // No English fallbacks bled into the modal.
  await expect(page.getByText('Invite code', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find circle' })).toHaveCount(0);
});

test('profile language selector is in Italian and reflects the active language', async ({
  page,
}) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Lingua', { exact: true }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  // Language options render in their native spelling; the page being Italian proves "it" is active.
  // (The flip adds 'Italiano' to every bundle's language.names; assert it here once wired.)
  await expect(page.getByText('Español', { exact: true })).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toBeVisible();  // 1.2.2 flip: all eight languages, picker order, endonyms, the active one checked.
  await expectLanguagePicker(page, 'Lingua', 'Italiano');
});
