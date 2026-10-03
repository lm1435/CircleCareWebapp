import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

// P-H2 follow-up (user rule 2026-09-29 "forms should reset and move to the new
// circle"): the layout-level "+ New" AddEventModal belongs to the circle it was
// opened in. AppLayout is not keyed by circle (only the page <Outlet> is, by
// pathname), so browser back/forward into ANOTHER circle while it was open
// kept the typed input and re-pointed its save at the new circle. It now
// closes on a circle change and does not come back on forward. Unit twin:
// src/components/layout/__tests__/AppLayout.circleSwitchCreate.test.tsx;
// mobile twin: mobile/src/navigation/useCloseOnCircleSwitch.ts.
//
// Nothing is saved, so the spec is net-zero.

test.use({ viewport: { width: 1440, height: 900 } });

async function openNewAppointment(page: Page, title: string): Promise<void> {
  const trigger = page.locator('aside').getByRole('button', { name: 'New', exact: true });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Appt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#title').fill(title);
}

/** Marks the loaded document; still set after back/forward ⇒ an in-app (SPA) history move, not a reload. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __e2eDoc?: number }).__e2eDoc = 1;
  });
}
async function expectSameDocument(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { __e2eDoc?: number }).__e2eDoc)).toBe(1);
}

test('history back into another circle closes the open "+ New" modal; forward does not reopen it', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const switcher = page.getByRole('button', { name: /^Switch circle: / });
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  await markDocument(page);

  // Move to ANOTHER circle in-app (the header switcher pushes a history entry).
  const currentName = ((await switcher.getAttribute('aria-label')) ?? '').replace(/^Switch circle: /, '');
  await switcher.click();
  await page
    .getByRole('menu', { name: 'Switch circle' })
    .getByRole('menuitem')
    .filter({ hasNotText: currentName })
    .first()
    .click();
  await expect(page).not.toHaveURL(new RegExp(`/circles/${circleId}/`));
  const otherCircleUrl = page.url();

  await openNewAppointment(page, 'Typed in the other circle');

  // Browser Back: into the first circle.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/calendar`));
  await expectSameDocument(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#title')).toHaveCount(0);

  // Browser Forward: back to the circle the modal was opened in — still closed.
  await page.goForward();
  await expect(page).toHaveURL(otherCircleUrl);
  await expectSameDocument(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a page change inside the SAME circle keeps the modal and its input', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside').getByRole('button', { name: 'New', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await markDocument(page);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Notes' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notes`));
  await openNewAppointment(page, 'Typed in circle A');

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/calendar`));
  await expectSameDocument(page);
  await expect(page.getByRole('dialog').locator('#title')).toHaveValue('Typed in circle A');
});
