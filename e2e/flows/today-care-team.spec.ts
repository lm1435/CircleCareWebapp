import { test, expect } from '../fixtures';

// 1.4.4 (docs/plans/navigation-fixes-1-4-4.md): the care team lives on its OWN page,
// /circles/:id/members ("Care team"): members, invites, Invite member, Manage (owner), Leave circle
// (everyone else). Today keeps one row (care-team-navigation.spec.ts). Non-destructive: it
// navigates, opens and cancels dialogs only.
// Unit twins: src/pages/__tests__/MembersPage.careTeam.test.tsx, CareTeamRow.test.tsx.

const NAV_TIMEOUT = 20_000;

test.describe('owner', () => {
  test('POSITIVE: Care team page with Invite member, Manage with Edit + Delete; Today has none of it', async ({
    page,
    circleId,
  }) => {
    // N1: Today no longer renders the members list, Manage or Leave circle.
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('today-care-team-row')).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('today-manage')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Leave circle' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Upcoming appointments' })).toHaveCount(0);

    await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Care team' })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('care-team-count')).toContainText(/\d+ members?/);

    // Invite member opens the same dialog; Escape closes it.
    await page.getByRole('button', { name: 'Invite member' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const manage = page.getByTestId('care-team-manage');
    await expect(manage.getByRole('heading', { name: 'Manage' })).toBeVisible();
    await manage.getByRole('link', { name: 'Edit circle' }).click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/settings$`), { timeout: NAV_TIMEOUT });
    await page.goBack();
    await expect(page.getByTestId('care-team-delete-circle')).toHaveAttribute(
      'href',
      `/circles/${circleId}/settings#danger`
    );
    // N2: the owner cannot leave.
    await expect(page.getByRole('button', { name: 'Leave circle' })).toHaveCount(0);
  });
});
