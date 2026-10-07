import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

// Twin of i18n-spanish.spec.ts written by the pt lane; EXECUTED BY THE FLIP STAGE (needs
// 'pt' in the registry so the picker / Zod enum accept it).
// Runs the whole app in Portuguese (Brazil) and asserts the UI is actually translated as we
// walk the flows — a runtime complement to the static i18n parity checks.
//
// Forcing the locale, isolated to this file's contexts (the shared demo account is
// never mutated):
//   1. `locale: 'pt'` → i18n's navigator LanguageDetector picks `pt` on load.
//   2. We rewrite this context's GET /users/me to report `language: 'pt'`, so
//      <LanguageSync> keeps the UI in the locale instead of flipping to whatever
//      the demo account has saved.
//
// Non-destructive: navigates + opens modals only, never submits.

test.use({ locale: 'pt', viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    // Guarded: a fast navigation can dispose the request mid-flight, so on any
    // error we just let it through (locale:'pt' still drives the UI language).
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
      if (body?.data?.user) body.data.user.language = 'pt';
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
const PT_NAV = [
  'Início',
  'Calendário',
  'Tarefas',
  'Atividade',
  'Documentos',
  'Membros',
  'Sinais vitais',
  'Configurações do círculo',
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

async function expectPortugueseNav(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(nav).toBeVisible({ timeout: NAV_TIMEOUT });
  for (const label of PT_NAV) {
    // .first(): the "Home" group's Eyebrow label and its single NavLink render
    // the SAME text ("Início") inside the nav (Sidebar.tsx groups a single-item
    // section under an eyebrow named after that item) — either match proves
    // the label is translated.
    await expect(nav.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // No English chrome leaked. exact:true so "Calendar" doesn't match "Calendário".
  for (const en of EN_NAV) {
    await expect(
      nav.getByText(en, { exact: true }),
      `English nav label "${en}" leaked while in Portuguese`
    ).toHaveCount(0);
  }
}

// Each circle-scoped page: nav in Portuguese + the page's own heading in Portuguese.
// `heading: null` ⇒ heading is dynamic (month / recipient name), so we lean on
// the nav assertion for that page.
const CIRCLE_PAGES: { path: string; heading: string | null }[] = [
  { path: '', heading: 'Equipe de cuidado' }, // overview (h1 is the recipient name)
  { path: '/calendar', heading: null }, // heading is the current month
  { path: '/tasks', heading: 'Tarefas' },
  { path: '/activity', heading: 'Atividade' },
  { path: '/emergency', heading: 'Informações de emergência' },
  { path: '/documents', heading: 'Documentos' },
  { path: '/vitals', heading: 'Sinais vitais' },
  { path: '/members', heading: 'Membros' },
  { path: '/settings', heading: 'Configurações do círculo' },
];

for (const { path, heading } of CIRCLE_PAGES) {
  test(`circle page "${path || '/'}" renders in Portuguese`, async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}${path}`, { waitUntil: 'domcontentloaded' });
    await expectPortugueseNav(page);
    if (heading) {
      // Assert the page's own heading (not a nav link) is the Portuguese string.
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
  { route: '/circles', text: 'Participar de um círculo' },
  { route: '/profile', text: 'Perfil e configurações' },
  { route: '/help', text: 'Ajuda e perguntas frequentes' },
  { route: '/invites', text: 'Seus convites' },
];

for (const { route, text } of TOP_PAGES) {
  test(`top-level page "${route}" renders in Portuguese`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
}

test('join-circle modal is fully translated', async ({ page }) => {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Participar de um círculo' }).click();

  // Modal chrome + the two-step entry copy, all Portuguese (source of truth:
  // src/i18n/pt/circles.json -> "joinModal").
  await expect(
    page.getByText('Digite o código de 6 caracteres do seu convite.')
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByText('Código do convite', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar círculo' })).toBeVisible();
  // No English fallbacks bled into the modal.
  await expect(page.getByText('Invite code', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find circle' })).toHaveCount(0);
});

test('profile language selector is in Portuguese', async ({ page }) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Idioma', { exact: true }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  // The option labels (`language.names.*`) are added to every bundle by the flip stage,
  // whose picker test owns them. Here: the heading is Portuguese, no English one leaked.
  await expect(page.getByText('Language', { exact: true })).toHaveCount(0);
});
