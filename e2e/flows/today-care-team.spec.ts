import { test, expect } from '../fixtures';

// 1.4.3 web/mobile parity (owner: "web matches mobile"): Today carries the care team and the
// circle's Manage rows (owner) or Leave circle (everyone else), as mobile's CircleDetailScreen;
// the separate "Upcoming appointments" card is gone (today's appointments are Next up rows).
// Non-destructive: it navigates, opens and cancels dialogs only.
// Unit twin: src/components/overview/__tests__/TodayCareTeam.test.tsx.

const NAV_TIMEOUT = 20_000;

test.describe('owner', () => {
  test('POSITIVE: Care team with Invite member, Manage with Edit + Delete; no appointments card', async ({
    page,
    circleId,
  }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    const team = page.getByTestId('today-care-team');
    await expect(team.getByRole('heading', { name: 'Care team' })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(team.getByTestId('today-care-team-count')).toContainText(/\d+ members?/);
    await expect(page.getByRole('heading', { name: 'Upcoming appointments' })).toHaveCount(0);

    // Invite member opens the same dialog the Members page uses; Escape closes it.
    await team.getByRole('button', { name: 'Invite member' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const manage = page.getByTestId('today-manage');
    await expect(manage.getByRole('heading', { name: 'Manage' })).toBeVisible();
    await manage.getByRole('link', { name: 'Edit circle' }).click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/settings$`), { timeout: NAV_TIMEOUT });
    await page.goBack();
    await expect(page.getByTestId('today-manage').getByRole('link', { name: 'Delete circle' })).toHaveAttribute(
      'href',
      `/circles/${circleId}/settings#danger`
    );
    // The owner cannot leave.
    await expect(page.getByRole('button', { name: 'Leave circle' })).toHaveCount(0);
    // The Members page still has its own route.
    await page.goto(`/circles/${circleId}/members`);
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible({ timeout: NAV_TIMEOUT });
  });
});
