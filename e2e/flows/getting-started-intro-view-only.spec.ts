import { test, expect } from '../fixtures';
import { CARD, openEmptyHome } from '../gettingStartedIntroShared';

// Role-aware Get-started intro — see e2e/gettingStartedIntroShared.ts for the why.

test.use({ persona: 'viewOnlyMember' });

test('a view-only seat is shown no setup card and no action it cannot take', async ({
  page,
  circleId,
}) => {
  await openEmptyHome(page, circleId);
  // Home is settled (Today's medications rendered from the same empty presence
  // read the card waits on); hold a window so a late render would be caught.
  await page.waitForTimeout(1_500);
  await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.getByText(/You've (created|joined)/)).toHaveCount(0);
});
