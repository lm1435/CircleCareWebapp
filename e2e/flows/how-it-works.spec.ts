import { test, expect } from '@playwright/test';
import { checkA11y } from '../helpers';

// The pre-auth "See how it works" walkthrough (/how-it-works), the web twin of
// mobile Welcome's Preview: Sign up -> step 1 -> step 2 -> Get started -> Sign up,
// keyboard-driven, with an axe scan of each step. Signed out on purpose: no
// session, and the page must make no API call of its own.

test.use({ storageState: { cookies: [], origins: [] } });

test('Sign up -> See how it works -> step 2 -> Get started -> Sign up', async ({
  page,
}, testInfo) => {
  const apiCalls: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
      apiCalls.push(url.pathname);
    }
  });

  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible();

  await page.getByRole('link', { name: 'See how it works' }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(page).toHaveTitle(/See how it works/);

  // Step 1: the sample day of doses.
  const step1 = page.getByRole('heading', { level: 1, name: 'Medication schedule' });
  await expect(step1).toBeVisible();
  await expect(page.getByText("Margaret's schedule for today")).toBeVisible();
  await expect(page.getByText('Metformin', { exact: true })).toBeVisible();
  await expect(page.getByText('Screen 1 of 2')).toBeVisible();
  await checkA11y(page, '/how-it-works#step-1', testInfo, { wcag22: true });

  // Keyboard: Next is a real button; Enter advances and focus lands on the
  // new step's heading.
  await page.getByRole('button', { name: 'Next' }).focus();
  await page.keyboard.press('Enter');
  const step2 = page.getByRole('heading', { level: 1, name: 'Activity' });
  await expect(step2).toBeVisible();
  await expect(step2).toBeFocused();
  await expect(page.getByText('Screen 2 of 2')).toBeVisible();
  await expect(page.getByText('Start free with one circle. Upgrade anytime.')).toBeVisible();
  await expect(page.getByText('You joined the circle as Caregiver')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await checkA11y(page, '/how-it-works#step-2', testInfo, { wcag22: true });

  // Back steps back to step 1 (not off the page), then forward again.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(step1).toBeFocused();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(step2).toBeFocused();

  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible();

  expect(apiCalls).toEqual([]);
});
