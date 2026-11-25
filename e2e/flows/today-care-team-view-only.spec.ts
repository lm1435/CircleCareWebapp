import { test, expect } from '../fixtures';

// 1.4.4: the Care team page, seen by a VIEW-ONLY member (mobile: no write actions).
// Owner twin: today-care-team.spec.ts. Non-destructive (Leave is cancelled).

test.use({ persona: 'viewOnlyMember' });

const NAV_TIMEOUT = 20_000;

test('NEGATIVE: no Invite member, no Manage, no pending count, no member menus; Leave circle only asks', async ({
  page,
  circleId,
}) => {
  // N3: the Today row shows names, never a pending count, to someone who cannot manage members.
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('today-care-team-row')).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByTestId('today-care-team-pending')).toHaveCount(0);

  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Care team' })).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /actions/i })).toHaveCount(0);
  await expect(page.getByTestId('care-team-manage')).toHaveCount(0);
  await expect(page.getByTestId('declined-invites-section')).toHaveCount(0);
  await page.getByRole('button', { name: 'Leave circle' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).last().click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/members/?$`));
});
