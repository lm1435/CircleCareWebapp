import { test, expect } from '../fixtures';
import { CARD, openEmptyHome } from '../gettingStartedIntroShared';

// Role-aware next-step card - see e2e/gettingStartedIntroShared.ts for the why.

test.use({ persona: 'premiumOwner' });

test('the owner is offered the first-medication step, with the owner-only invite step still counted', async ({
  page,
  circleId,
}) => {
  const name = await openEmptyHome(page, circleId);
  const card = page.locator(CARD);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute('data-step', 'first_med');
  await expect(card.getByRole('heading', { name: `Add ${name}'s first medication`, exact: true })).toBeVisible();
  // The owner can do all three steps (add a medication, invite, reminders).
  await expect(card.getByText('Next step · 1 of 3', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Add medication', exact: true })).toBeVisible();
  // Copy never assumes this is the user's own relative, and no longer says "created".
  await expect(card.getByText(/You've created|joined/)).toHaveCount(0);
});
