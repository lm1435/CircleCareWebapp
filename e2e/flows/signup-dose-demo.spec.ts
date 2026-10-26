import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// The live dose demo on /signup (1.3.1 section 6). No backend and no account:
// the card is local state. Run:
//   cd webapp && npx playwright test e2e/flows/signup-dose-demo.spec.ts --project=chromium

test.use({ storageState: { cookies: [], origins: [] } });

test('the demo dose card can be taken, undone and skipped on /signup', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });

  const card = page.getByTestId('dose-demo-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText('Metformin')).toBeVisible();

  await card.getByRole('button', { name: 'Taken' }).click();
  await expect(card.getByText(/^Taken · You, /)).toBeVisible();
  await expect(card.getByText('Everyone in the circle sees it right away.')).toBeVisible();

  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByRole('button', { name: 'Skip' })).toBeVisible();

  await card.getByRole('button', { name: 'Skip' }).click();
  await expect(card.getByText('Skipped · You')).toBeVisible();
  await expect(card.getByText(/Taken at/)).toHaveCount(0);
  await checkA11y(page, '/signup', testInfo);
});

test('at phone width the demo card sits above the form with no horizontal scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });

  const card = page.getByTestId('dose-demo-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  const cardBox = await card.boundingBox();
  const formBox = await page.locator('form').boundingBox();
  expect(cardBox && formBox && cardBox.y < formBox.y).toBe(true);

  await card.getByRole('button', { name: 'Taken' }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
