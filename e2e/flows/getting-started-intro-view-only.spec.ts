import { test, expect } from '../fixtures';
import { CARD, openEmptyHome } from '../gettingStartedIntroShared';

// Role-aware next-step card - see e2e/gettingStartedIntroShared.ts for the why.

test.use({ persona: 'viewOnlyMember' });

test('a view-only seat is shown no next-step card and no action it cannot take', async ({
  page,
  circleId,
}) => {
  await openEmptyHome(page, circleId);
  // Today is settled (Quick access rendered from the same empty presence read the
  // card waits on); hold a window so a late render would be caught.
  await page.waitForTimeout(1_500);
  await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add medication' })).toHaveCount(0);
  await expect(page.getByText(/Next step ·/)).toHaveCount(0);
});
