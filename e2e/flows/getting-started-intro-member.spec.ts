import { test, expect } from '../fixtures';
import { CARD, openEmptyHome } from '../gettingStartedIntroShared';

// Role-aware next-step card - see e2e/gettingStartedIntroShared.ts for the why.

test.use({ persona: 'freeMember' });

test('a caregiver who joined is never shown the owner checklist: no first-medication step, no invite step (1.4.4)', async ({
  page,
  circleId,
}) => {
  // 1.4.4: the next-step checklist is the owner's. A plain helper was shown "Add <name>'s first
  // medication" (1 of 2) until 1.4.3; they now get no checklist at all (the calm helper card takes
  // its place in a circle without shifts: e2e/unhappy/access/memberToday.roleAware.spec.ts).
  const name = await openEmptyHome(page, circleId);
  // Wait for Today's settled signal first: a count of 0 before coaching is known proves nothing.
  const today = page.locator('[data-today-ready="true"]');
  await expect(today).toBeVisible({ timeout: 20_000 });
  expect(await today.getAttribute('data-coaching')).not.toBe('next_step');
  await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: `Add ${name}'s first medication`, exact: true })).toHaveCount(0);
  await expect(page.getByText('Invite someone to help')).toHaveCount(0);
});
