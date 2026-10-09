import { test, expect } from '../fixtures';
import { CARD, openEmptyHome } from '../gettingStartedIntroShared';

// Role-aware Get-started intro — see e2e/gettingStartedIntroShared.ts for the why.

test.use({ persona: 'premiumOwner' });

test('the owner is told they created the circle, and keeps the invite step', async ({
  page,
  circleId,
}) => {
  const name = await openEmptyHome(page, circleId);
  const card = page.locator(CARD);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(
    card.getByText(`You've created a care circle for ${name}. Here's what you can do:`, { exact: true })
  ).toBeVisible();
  await expect(card.getByText(/joined/)).toHaveCount(0);
  // The owner keeps the owner-only invite step (already done here: the cloned
  // circle has members, so it shows as done rather than with its button).
  await expect(card.getByText(/^Invite family & caregivers/)).toBeVisible();
  await expect(card.getByText(/^\d of 3 done$/)).toBeVisible();
});
