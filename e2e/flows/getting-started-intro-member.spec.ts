import { test, expect } from '../fixtures';
import { CARD, openEmptyHome } from '../gettingStartedIntroShared';

// Role-aware Get-started intro — see e2e/gettingStartedIntroShared.ts for the why.

test.use({ persona: 'freeMember' });

test('a caregiver who joined is told they joined — never that they created it', async ({
  page,
  circleId,
}) => {
  const name = await openEmptyHome(page, circleId);
  const card = page.locator(CARD);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(
    card.getByText(`You've joined ${name}'s care circle. Here's what you can do:`, { exact: true })
  ).toBeVisible();
  await expect(card.getByText(/created/)).toHaveCount(0);
  // Inviting is owner-only: the step and its button are withheld.
  await expect(card.getByText(/Invite family & caregivers/)).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0);
  await expect(card.getByText('0 of 2 done')).toBeVisible();
});
