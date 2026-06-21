import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

// Runs the whole app in Spanish and asserts the UI is actually translated as we
// walk the flows — a runtime complement to the static i18n parity checks.
//
// Forcing Spanish, isolated to this file's contexts (the shared demo account is
// never mutated):
//   1. `locale: 'es'` → i18n's navigator LanguageDetector picks `es` on load.
//   2. We rewrite this context's GET /users/me to report `language: 'es'`, so
//      <LanguageSync> keeps the UI in Spanish instead of flipping to whatever
//      the demo account has saved.
//
// Non-destructive: navigates + opens modals only, never submits.

test.use({ locale: 'es', viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    // Guarded: a fast navigation can dispose the request mid-flight, so on any
    // error we just let it through (locale:'es' still drives the UI language).
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
      if (body?.data?.user) body.data.user.language = 'es';
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
const ES_NAV = [
  'Inicio',
  'Calendario',
  'Tareas',
  'Actividad',
  'Documentos',
  'Miembros',
  'Signos vitales',
  'Configuración del círculo',
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

async function expectSpanishNav(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(nav).toBeVisible({ timeout: NAV_TIMEOUT });
  for (const label of ES_NAV) {
    await expect(nav.getByText(label, { exact: true })).toBeVisible();
  }
  // No English chrome leaked. exact:true so "Calendar" doesn't match "Calendario".
  for (const en of EN_NAV) {
    await expect(
      nav.getByText(en, { exact: true }),
      `English nav label "${en}" leaked while in Spanish`
    ).toHaveCount(0);
  }
}

// Each circle-scoped page: nav in Spanish + the page's own heading in Spanish.
// `heading: null` ⇒ heading is dynamic (month / recipient name), so we lean on
// the nav assertion for that page.
const CIRCLE_PAGES: { path: string; heading: string | null }[] = [
  { path: '', heading: 'Equipo de cuidado' }, // overview (h1 is the recipient name)
  { path: '/calendar', heading: null }, // heading is the current month
  { path: '/tasks', heading: 'Tareas' },
  { path: '/activity', heading: 'Historial de Actividad' },
  { path: '/emergency', heading: 'Info de Emergencia' },
  { path: '/documents', heading: 'Documentos' },
  { path: '/vitals', heading: 'Signos vitales' },
  { path: '/members', heading: 'Miembros' },
  { path: '/settings', heading: 'Configuración del círculo' },
];

for (const { path, heading } of CIRCLE_PAGES) {
  test(`circle page "${path || '/'}" renders in Spanish`, async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}${path}`, { waitUntil: 'domcontentloaded' });
    await expectSpanishNav(page);
    if (heading) {
      // Assert the page's own heading (not a nav link) is the Spanish string.
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
  { route: '/circles', text: 'Unirte a un círculo' },
  { route: '/profile', text: 'Perfil y ajustes' },
  { route: '/help', text: 'Ayuda y Preguntas Frecuentes' },
  { route: '/invites', text: 'Tus invitaciones' },
];

for (const { route, text } of TOP_PAGES) {
  test(`top-level page "${route}" renders in Spanish`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
}

test('join-circle modal is fully translated', async ({ page }) => {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Unirte a un círculo' }).click();

  // Modal chrome + the two-step entry copy, all Spanish.
  await expect(
    page.getByText('Ingresa el código de invitación que te envió un familiar.')
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByText('Código de invitación', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar código' })).toBeVisible();
  // No English fallbacks bled into the modal.
  await expect(page.getByText('Invite code', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Look up code' })).toHaveCount(0);
});

test('profile language selector is in Spanish and reflects the active language', async ({
  page,
}) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Idioma', { exact: true }).first()).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  // Both language options render; the page being Spanish proves "es" is active.
  await expect(page.getByText('Español', { exact: true })).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toBeVisible();
});
