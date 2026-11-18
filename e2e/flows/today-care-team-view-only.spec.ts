import { test, expect } from '../fixtures';

// 1.4.3 parity: the care team on Today, seen by a VIEW-ONLY member (mobile: no write actions).
// Owner twin: today-care-team.spec.ts. Non-destructive (Leave is cancelled).

test.use({ persona: 'viewOnlyMember' });

const NAV_TIMEOUT = 20_000;

test('NEGATIVE: no Invite member, no Manage, no member menus; Leave circle only asks', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const team = page.getByTestId('today-care-team');
  await expect(team).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(team.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
  await expect(team.getByRole('button', { name: /actions/i })).toHaveCount(0);
  await expect(page.getByTestId('today-manage')).toHaveCount(0);
  await page.getByRole('button', { name: 'Leave circle' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).last().click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/?$`));
});
