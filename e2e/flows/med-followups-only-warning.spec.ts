import type { Locator, Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y, expandReminders, fillSimpleTime, openCalendarNew } from '../helpers';

// FOLLOW-UP ALERTS ONLY (owner 2026-11-09, copy LOCKED, mobile parity).
//
// A medication with "Enable notifications" ON, "At the scheduled time" OFF and
// all four earlier reminders OFF reads as "fully off", but the 15 / 30 / 60
// minute missed-dose alerts still fire (they hang off notifications_enabled
// alone). The medication form says so with a prominent note — exactly in that
// state, gone in every neighbour. Axe runs with the note on screen.
//
// Non-destructive: the worker's isolated circle, the form is backed out of and
// NOTHING is saved (asserted: no event write leaves the page).
//
// Unit coverage: src/components/calendar/__tests__/AddEventModal.test.tsx
// ("follow-up-only warning"). Mobile: the AddEventScreen twin.

interface Copy {
  addEvent: string;
  newMenu: string;
  medItem: RegExp;
  dialog: string;
  moreDetails: string;
  enable: string;
  atTime: string;
  earlier: [string, string, string, string];
  title: string;
  body: string;
  close: string;
}

const EN: Copy = {
  addEvent: 'Add event',
  newMenu: 'New',
  medItem: /^(Med|Medication)$/,
  dialog: 'New medication',
  moreDetails: 'More details',
  enable: 'Enable notifications',
  atTime: 'At the scheduled time',
  earlier: ['24 hours before', '1 hour before', '30 minutes before', '15 minutes before'],
  title: 'Reminders are off — follow-up alerts are not',
  body: "If a dose isn't marked as taken, CircleCare still alerts the circle: after 15 minutes, 30 minutes, and 1 hour. Turn off Notifications above to silence everything for this medication.",
  close: 'Close event form',
};

const ES: Copy = {
  addEvent: 'Agregar evento',
  newMenu: 'Nuevo',
  medItem: /^(Med\.|Medicamento)$/,
  dialog: 'Nuevo medicamento',
  moreDetails: 'Más detalles',
  enable: 'Activar notificaciones',
  atTime: 'A la hora programada',
  earlier: ['24 horas antes', '1 hora antes', '30 minutos antes', '15 minutos antes'],
  title: 'Los recordatorios están desactivados — las alertas de seguimiento no',
  body: 'Si una dosis no se marca como tomada, CircleCare igual avisa al círculo: a los 15 minutos, a los 30 minutos y a la hora. Desactiva Notificaciones arriba para silenciar todo para este medicamento.',
  close: 'Cerrar el formulario de evento',
};

/** Every event WRITE the page sends; the test backs out, so this must stay empty. */
function trackEventWrites(page: Page): Request[] {
  const writes: Request[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/api\/circles\/[^/]+\/events/.test(r.url())) writes.push(r);
  });
  return writes;
}

async function openMedicationForm(page: Page, circleId: string, copy: Copy): Promise<Locator> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
  if (copy === EN) return openCalendarNew(page, 'medication');
  // openCalendarNew speaks English; the same steps in Spanish.
  await page.getByRole('button', { name: copy.addEvent, exact: true }).first().click();
  const menu = page.getByRole('menu', { name: copy.newMenu });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: copy.medItem }).click();
  const dialog = page.getByRole('dialog', { name: copy.dialog });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Fill the minimum, expand the Reminders row, and return the dialog with the reminder controls on screen. */
async function openReminders(page: Page, circleId: string, copy: Copy): Promise<Locator> {
  const dialog = await openMedicationForm(page, circleId, copy);
  await dialog.locator('#medication_name').fill(`ZZ_E2E_FOLLOWUPS_${Date.now()}`);
  await fillSimpleTime(dialog, '08:00');
  // The Reminders card is the summary row's accordion (owner 2026-11-10), not inside More details.
  await expandReminders(dialog);
  await expect(dialog.getByRole('switch', { name: copy.enable })).toBeVisible();
  return dialog;
}

async function setChecked(control: Locator, checked: boolean): Promise<void> {
  const state = (await control.getAttribute('aria-checked')) === 'true';
  if (state !== checked) await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(checked));
}

async function runFlow(page: Page, circleId: string, copy: Copy, a11yLabel: string, testInfo: Parameters<typeof checkA11y>[2]): Promise<void> {
  const writes = trackEventWrites(page);
  const dialog = await openReminders(page, circleId, copy);
  const master = dialog.getByRole('switch', { name: copy.enable });
  const warning = dialog.getByTestId('reminders-follow-up-only-warning');

  // Master on, the anchor on (the default): no warning.
  await setChecked(master, true);
  await expect(warning).toHaveCount(0);

  // THE STATE: master on, anchor off, all four earlier off.
  for (const name of copy.earlier) await setChecked(dialog.getByRole('checkbox', { name }), false);
  await setChecked(dialog.getByRole('checkbox', { name: copy.atTime }), false);
  await expect(master).toHaveAttribute('aria-checked', 'true');

  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute('role', 'note');
  await expect(warning).toHaveAccessibleName(copy.title);
  await expect(warning.getByText(copy.title, { exact: true })).toBeVisible();
  await expect(warning.getByText(copy.body, { exact: true })).toBeVisible();
  // The body points at a control that really is above it.
  const masterBox = await master.boundingBox();
  const warningBox = await warning.boundingBox();
  expect(masterBox && warningBox && masterBox.y < warningBox.y).toBe(true);
  await checkA11y(page, a11yLabel, testInfo);

  // One earlier box on: gone. Off again: back.
  const oneHour = dialog.getByRole('checkbox', { name: copy.earlier[1] });
  await setChecked(oneHour, true);
  await expect(warning).toHaveCount(0);
  await setChecked(oneHour, false);
  await expect(warning).toBeVisible();

  // Master off: everything is silent, and the warning goes with it.
  await setChecked(master, false);
  await expect(warning).toHaveCount(0);

  // Back out without saving.
  await dialog.getByRole('button', { name: copy.close }).first().click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  expect(writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
}

test.describe('medication: follow-up alerts only warning', () => {
  test('shows exactly when only the 15 / 30 / 60 minute alerts are left', async ({ page, circleId }, testInfo) => {
    await runFlow(page, circleId, EN, 'med-followups-only-warning', testInfo);
  });
});

test.describe('medication: follow-up alerts only warning — Spanish', () => {
  // Same technique as i18n-spanish.spec.ts: navigator locale `es` plus this
  // context's GET /users/me rewritten to `language: 'es'` so <LanguageSync>
  // keeps the UI in Spanish.
  test.use({ locale: 'es' });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      try {
        const res = await route.fetch();
        const body = (await res.json()) as { data?: { user?: { language?: string } } };
        if (body?.data?.user) body.data.user.language = 'es';
        await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) });
      } catch {
        await route.continue().catch(() => undefined);
      }
    });
  });

  test('aviso en español', async ({ page, circleId }, testInfo) => {
    await runFlow(page, circleId, ES, 'med-followups-only-warning-es', testInfo);
  });
});
