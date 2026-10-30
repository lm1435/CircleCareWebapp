import { test, expect } from '../fixtures';
import { CARD, openEmptyHome } from '../gettingStartedIntroShared';

// Role-aware next-step card - see e2e/gettingStartedIntroShared.ts for the why.

test.use({ persona: 'freeMember' });

test('a caregiver who joined is offered the first-medication step but never the owner-only invite step', async ({
  page,
  circleId,
}) => {
  const name = await openEmptyHome(page, circleId);
  const card = page.locator(CARD);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute('data-step', 'first_med');
  await expect(card.getByRole('heading', { name: `Add ${name}'s first medication`, exact: true })).toBeVisible();
  // Inviting is owner-only: the step is not counted and its button is withheld. 2 steps, not 3.
  await expect(card.getByText('Next step · 1 of 2', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0);
  // "Not now" on the only other step leaves no invite card behind it.
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Invite someone to help')).toHaveCount(0);
});
