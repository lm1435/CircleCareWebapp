import { test, expect } from '@playwright/test';
import { checkA11y } from '../helpers';

// The pre-auth "See how it works" walkthrough (/how-it-works), the web twin of
// mobile Welcome's Preview: Sign up -> step 1 -> step 2 -> Get started -> Sign up,
// keyboard-driven, with an axe scan of each step. Signed out on purpose: no
// session and no API call at all. 1.4.3: the page opens on the fixed preview
// video (lib/previewVideo.ts); its file is answered 404 here (never fetched
// from production) so the load-error safety net shows this carousel (the
// video: how-it-works-video.spec.ts).

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

  await page.route('**/storage/v1/object/public/help-videos/**', (route) =>
    route.fulfill({ status: 404, body: 'gone' })
  );
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  // First run v2: /signup opens on "Who are you caring for?", with the walkthrough link kept.
  await expect(page.getByRole('heading', { level: 1, name: 'Who are you caring for?' })).toBeVisible();

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
  // First run v2: sign-up opens on the one question (Create account is its step 2).
  await expect(page.getByRole('heading', { level: 1, name: 'Who are you caring for?' })).toBeVisible();

  expect(apiCalls).toEqual([]);
});
