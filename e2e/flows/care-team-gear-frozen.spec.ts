import { test, expect } from '../fixtures';

// 1.4.4 (owner 2026-11-25): Today's gear is the circle settings door for the owner of an editable circle
// (and the flagged care recipient). Personas must be file-level (`test.use({ persona })` forces a worker).
const NAV_TIMEOUT = 20_000;
const NARROW = { width: 390, height: 844 };

test.use({ viewport: NARROW, persona: 'frozenCircleOwner' });

test('N: the owner of a circle that cannot be edited gets no gear', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('today-account-settings')).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByTestId('today-circle-settings')).toHaveCount(0);
});
