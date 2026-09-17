import { test, expect } from '../../fixtures';
import { aiEntrySurface, gotoCirclePage } from './_helpers';

// ===========================================================================
// NEGATIVE CONTROL for `freeMember.ai-entry.smoke.spec.ts`: the premium owner
// gets the AI entry on the same navigation, at the same viewport, after the
// same loaded signal. Without it, "absent" could mean the sidebar group or the
// pill cell was renamed or dropped for everyone.
// ===========================================================================

test.use({ persona: 'premiumOwner' });

test('AI entry is present on the navigation this viewport renders (control)', async ({ page, circleId }) => {
  await gotoCirclePage(page, circleId, 'notes');
  await expect(page.getByLabel(/^Add a note/)).toBeVisible({ timeout: 20_000 });

  const surface = aiEntrySurface(page);
  await expect(surface.navSignal, `${surface.kind} navigation rendered`).toBeVisible();
  await expect(surface.navSignal).toBeEnabled();
  await expect(surface.aiEntry, `${surface.kind} AI entry`).toBeVisible();
});
