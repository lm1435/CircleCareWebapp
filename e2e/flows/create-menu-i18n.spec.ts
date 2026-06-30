import { test, expect } from '../fixtures';

// Asserts the global "Create" menu (sidebar Create button + its dropdown options)
// is fully localized in Spanish.
//
// Spanish is forced exactly like i18n-spanish.spec.ts:
//   1. `locale: 'es'` → i18n's navigator LanguageDetector picks `es` on load.
//   2. We rewrite this context's GET /users/me to report `language: 'es'`, so
//      <LanguageSync> keeps the UI in Spanish instead of the demo account's saved
//      language.
//
// Non-destructive: only opens the menu, never creates anything.

test.use({ locale: 'es', viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;

// Source of truth: src/i18n/es/common.json → "create" block.
const ES = {
  button: 'Crear',
  appointment: 'Cita',
  medication: 'Medicamento',
  task: 'Tarea',
  vitals: 'Signos vitales',
  document: 'Documento',
  invite: 'Invitar miembro',
} as const;

// English equivalents that must NOT leak into the menu (en/common.json create.*).
const EN = {
  button: 'Create',
  appointment: 'Appointment',
  medication: 'Medication',
  task: 'Task',
  vitals: 'Vitals',
  document: 'Document',
  invite: 'Invite member',
} as const;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
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

test('global Create menu is fully localized in Spanish', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // Confirm Spanish actually loaded (nav chrome is data-free, so it's a clean
  // signal) before asserting on the Create control.
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(nav).toBeVisible({ timeout: NAV_TIMEOUT });

  // The Create button lives in the desktop sidebar <aside> (a sibling of <nav>),
  // not inside the nav landmark. Exact name so "Crear" can't match a longer
  // empty-state CTA. The icon is aria-hidden, so the button's name is just "Crear".
  const createButton = page.getByRole('button', { name: ES.button, exact: true });
  await expect(createButton).toBeVisible({ timeout: NAV_TIMEOUT });

  // No English "Create" button leaked while in Spanish.
  await expect(
    page.getByRole('button', { name: EN.button, exact: true }),
    'English "Create" button leaked while in Spanish'
  ).toHaveCount(0);

  await createButton.click();

  // Each menu option renders with its Spanish label.
  for (const key of ['appointment', 'medication', 'task', 'vitals', 'document', 'invite'] as const) {
    await expect(
      page.getByRole('menuitem', { name: ES[key], exact: true }),
      `Spanish create.${key} menu item "${ES[key]}" not found`
    ).toBeVisible({ timeout: NAV_TIMEOUT });
  }

  // No English option labels leaked into the menu.
  for (const key of ['appointment', 'medication', 'task', 'vitals', 'document', 'invite'] as const) {
    await expect(
      page.getByRole('menuitem', { name: EN[key], exact: true }),
      `English create.${key} menu item "${EN[key]}" leaked while in Spanish`
    ).toHaveCount(0);
  }
});
