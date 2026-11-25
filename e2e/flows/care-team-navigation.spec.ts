import { test, expect } from '../fixtures';

// 1.4.4 navigation fixes (docs/plans/navigation-fixes-1-4-4.md), web side:
//   P1 the owner's gear opens Circle settings (Edit circle, owner 2026-11-25); P2 the person icon opens Settings and Back returns to Today;
//   P3 the Today row opens Care team; P4/N7 Back from Care team returns to Today;
//   P5 six Quick access cells in order; naming ("Emergency info", assistant "Ask").
// The gear (owner of an editable circle only) and the person icon exist below xl only: at xl the sidebar lists Members and the
// header's account menu offers Settings. Read-only: it navigates, never writes.

const NAV_TIMEOUT = 20_000;
const NARROW = { width: 390, height: 844 };

test.describe('Today header controls (narrow)', () => {
  test.use({ viewport: NARROW });

  test("P1: the owner's gear opens Circle settings (Edit circle); Back returns to Today", async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('today-circle-settings').click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/settings$`), { timeout: NAV_TIMEOUT });
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/?$`), { timeout: NAV_TIMEOUT });
  });

  test('P2: the person icon opens account Settings; Back returns to Today', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('today-account-settings').click();
    await expect(page).toHaveURL(/\/profile$/, { timeout: NAV_TIMEOUT });
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/?$`), { timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('today-circle-settings')).toBeVisible();
  });

  test('both header controls are at least 44x44 and keyboard reachable', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    for (const id of ['today-account-settings', 'today-circle-settings']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.getByTestId('today-account-settings').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('today-circle-settings')).toBeFocused();
  });

  test('the bottom bar names the assistant "Ask"', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('floating-nav').getByRole('button', { name: 'Ask', exact: true })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
  });
});

test.describe('Today header controls (wide)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('N: at xl the sidebar is the door, so the header icons are not drawn', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('today-care-team-row')).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('today-circle-settings')).toBeHidden();
    await expect(page.getByTestId('today-account-settings')).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Care team' })).toBeVisible();
  });
});

test('P3/N7: the Care team row on Today opens the Care team page; Back returns to Today', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const row = page.getByTestId('today-care-team-link');
  await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByTestId('today-care-team-names')).toContainText('You');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/members$`), { timeout: NAV_TIMEOUT });
  await expect(page.getByRole('heading', { level: 1, name: 'Care team' })).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/?$`), { timeout: NAV_TIMEOUT });
});

test('P5: Quick access is six cells in order; Vitals and Emergency info open their pages', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const grid = page.getByTestId('quick-access-grid');
  await expect(grid).toBeVisible({ timeout: NAV_TIMEOUT });
  const cells = grid.getByRole('link');
  await expect(cells).toHaveCount(6);
  const base = `/circles/${circleId}`;
  const expected: Array<[string, string]> = [
    ['Notes', 'notes'],
    ['Tasks', 'tasks'],
    ['Calendar', 'calendar'],
    ['Meds', 'meds'],
    ['Vitals', 'vitals'],
    ['Emergency info', 'emergency'],
  ];
  for (const [i, [label, segment]] of expected.entries()) {
    await expect(cells.nth(i)).toContainText(label);
    await expect(cells.nth(i)).toHaveAttribute('href', `${base}/${segment}`);
  }
  // N: no "Health info" anywhere in Quick access.
  await expect(page.getByRole('region', { name: 'Quick access' }).getByText('Health info')).toHaveCount(0);
  await cells.nth(5).click();
  await expect(page).toHaveURL(new RegExp(`${base}/emergency`), { timeout: NAV_TIMEOUT });
});
