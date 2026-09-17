import { test, expect } from '../fixtures';

// Asserts the global create menu (sidebar "New" button + its AddMenu options)
// is fully localized in Spanish.
//
// Spanish is forced exactly like i18n-spanish.spec.ts:
//   1. `locale: 'es'` → i18n's navigator LanguageDetector picks `es` on load.
//   2. We rewrite this context's GET /users/me to report `language: 'es'`, so
//      <LanguageSync> keeps the UI in Spanish instead of the demo account's saved
//      language.
//
// The pill carries TWO strings per option and BOTH must be translated:
//   - `addMenu.<type>Short` is the visible 10px label under the disc, and it is
//     also the option's ACCESSIBLE NAME. A full-word `aria-label` over a short
//     visible label fails WCAG 2.5.3 ("Appt" is not contained in
//     "Appointment"), so the short form owns the name outright.
//   - `addMenu.<type>` (the full word) rides along as the `title`, which is
//     what a hovering mouse user reads.
// A half-translated pill would pass on either one alone, so both are asserted.
//
// Non-destructive: only opens the menu, never creates anything.

test.use({ locale: 'es', viewport: { width: 1440, height: 900 } });

const NAV_TIMEOUT = 20_000;

// Source of truth: src/i18n/es/common.json → "nav.new" + the "addMenu" block.
// SHORT is the accessible name; FULL is the title.
const ES_SHORT = {
  // "Med." — the SHORT label, and the button's accessible name. It is deliberately
  // not the full "Medicamento": four options share one row, and ES_SHORT must stay
  // no longer than ES_FULL (pinned by translationKeys.test.ts). EN is "Med".
  medication: 'Med.',
  appointment: 'Cita',
  task: 'Tarea',
  note: 'Nota',
} as const;

const ES_FULL = {
  medication: 'Medicamento',
  appointment: 'Cita',
  task: 'Tarea',
  note: 'Nota',
} as const;

const ES = { button: 'Nuevo' } as const;

// English equivalents that must NOT leak into the menu (en/common.json).
const EN = { button: 'New' } as const;

const EN_SHORT = {
  medication: 'Med',
  appointment: 'Appt',
  task: 'Task',
  note: 'Note',
} as const;

const OPTIONS = ['medication', 'appointment', 'task', 'note'] as const;

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

test('the global create menu is fully localized in Spanish', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // Confirm Spanish actually loaded (nav chrome is data-free, so it's a clean
  // signal) before asserting on the create control. The sidebar's nav and the
  // FloatingNavBar share this label; only the sidebar's is visible at 1440.
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(nav.first()).toBeVisible({ timeout: NAV_TIMEOUT });

  // The New button lives in the desktop sidebar <aside> (a sibling of <nav>).
  // Scoped there because the FloatingNavBar has one too (CSS-hidden at 1440),
  // and exact so "Nuevo" can't match a longer empty-state CTA. The icon is
  // aria-hidden, so the button's name is just "Nuevo".
  const newButton = page.locator('aside').getByRole('button', { name: ES.button, exact: true });
  await expect(newButton).toBeVisible({ timeout: NAV_TIMEOUT });

  // No English "New" button leaked while in Spanish.
  await expect(
    page.getByRole('button', { name: EN.button, exact: true }),
    'English "New" button leaked while in Spanish'
  ).toHaveCount(0);

  await newButton.click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: NAV_TIMEOUT });

  // Each option's ACCESSIBLE NAME (and visible label) is the Spanish SHORT form...
  for (const key of OPTIONS) {
    await expect(
      menu.getByRole('menuitem', { name: ES_SHORT[key], exact: true }),
      `Spanish addMenu.${key}Short menu item "${ES_SHORT[key]}" not found`
    ).toBeVisible({ timeout: NAV_TIMEOUT });
  }

  // ...and its `title` is the full Spanish word, so the hover tooltip is
  // translated too. Several short forms equal their full form ("Cita",
  // "Tarea", "Nota"); the attribute check is exact either way.
  for (const key of OPTIONS) {
    await expect(
      menu.getByRole('menuitem', { name: ES_SHORT[key], exact: true }),
      `Spanish addMenu.${key} title "${ES_FULL[key]}" not found`
    ).toHaveAttribute('title', ES_FULL[key]);
  }

  // No English option labels leaked into the menu — neither form.
  for (const key of OPTIONS) {
    await expect(
      menu.getByRole('menuitem', { name: EN_SHORT[key], exact: true }),
      `English addMenu.${key}Short menu item "${EN_SHORT[key]}" leaked while in Spanish`
    ).toHaveCount(0);
  }
});
