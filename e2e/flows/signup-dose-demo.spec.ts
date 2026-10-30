import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// /signup used to carry a live "dose demo" card (Taken / Undo / Skip on a sample Metformin dose, 1.3.1
// section 6). The pre-auth story is now the "See how it works" walkthrough (/how-it-works, covered by
// how-it-works.spec.ts), which replaced the card with a link. This pins the replacement: the card is gone,
// the link is there, and neither width gains a horizontal scroll. No backend and no account.
//   cd webapp && npx playwright test e2e/flows/signup-dose-demo.spec.ts --project=chromium

test.use({ storageState: { cookies: [], origins: [] } });

test('/signup has no embedded dose demo; "See how it works" links to the walkthrough', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId('dose-demo-card')).toHaveCount(0);
  await expect(page.getByText('Metformin')).toHaveCount(0);
  const link = page.getByRole('link', { name: 'See how it works' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/how-it-works');
  await checkA11y(page, '/signup', testInfo);
});

test('at phone width the walkthrough link is on screen with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });

  const link = page.getByRole('link', { name: 'See how it works' });
  await expect(link).toBeVisible({ timeout: 20_000 });
  const box = await link.boundingBox();
  expect(box && box.height >= 44).toBe(true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
