import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// approved-recs-2026-09-30 B6 / section 3: a member picks their colour on
// Profile. It persists (DB + reload), the Profile preview repaints at once,
// and a SECOND member of the same circle sees it on the Members list. The
// picker is a radio group (axe clean, keyboard + check mark, not colour alone).
// Mobile twin: mobile/.maestro/parity/profile/member-color.yaml.
//
// Run-scoped accounts only: the worker account is never touched.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const colorOf = (userId: string): string | null =>
  dbQuery<{ avatar_color: string | null }>(
    `select avatar_color from users where id = ${sqlStr(userId)}::uuid`
  )[0]?.avatar_color ?? null;

test('pick a colour: preview, persistence, reload, and a second member sees it', async ({
  page,
  browser,
  context,
  request,
  baseURL,
}, testInfo) => {
  const owner = await createScopedAccount('color-owner');
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq('color'));
  const member = await createScopedAccount('color-member');
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(colorOf(owner.userId)).toBeNull();

  await cookieLogin(context, owner, baseURL);
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const group = page.getByRole('radiogroup', { name: 'Choose your color' });
  await expect(group).toBeVisible({ timeout: 20_000 });

  // Nothing chosen yet: six radios, none checked, each a >= 44px target.
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(6);
  await expect(group.locator('[aria-checked="true"]')).toHaveCount(0);
  for (const radio of await radios.all()) {
    const box = await radio.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await checkA11y(page, '/profile', testInfo);

  // Pick Coral: checked + ring + check glyph (not colour alone), live message.
  const coral = group.getByRole('radio', { name: 'Coral' });
  await coral.click();
  await expect(coral).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  await expect(coral.locator('svg')).toBeVisible();
  await expect(page.getByTestId('avatar-color-saved')).toHaveText('Color updated.', {
    timeout: 20_000,
  });
  await expect.poll(() => colorOf(owner.userId), { timeout: 20_000 }).toBe('coral');

  // Keyboard: arrows move focus only (no save per arrow), Space chooses.
  await coral.focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Slate blue' })).toBeFocused();
  expect(colorOf(owner.userId)).toBe('coral');
  await page.keyboard.press('Space');
  await expect(group.getByRole('radio', { name: 'Slate blue' })).toHaveAttribute(
    'aria-checked',
    'true',
    { timeout: 20_000 }
  );
  await expect.poll(() => colorOf(owner.userId), { timeout: 20_000 }).toBe('dusk');
  await group.getByRole('radio', { name: 'Coral' }).click();
  await expect.poll(() => colorOf(owner.userId), { timeout: 20_000 }).toBe('coral');

  // Reload: still Coral (persisted server-side, not local state).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radio', { name: 'Coral' })).toHaveAttribute('aria-checked', 'true', {
    timeout: 20_000,
  });

  // A second member of the circle sees the owner's colour on the Members list.
  const other = await browser.newContext({ baseURL });
  try {
    await cookieLogin(other, member, baseURL);
    const p2 = await other.newPage();
    await p2.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    const row = p2.locator('li').filter({ hasText: owner.email });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('span[aria-hidden="true"][style*="linear-gradient"]').first()).toHaveAttribute(
      'style',
      /var\(--color-coral-deep\)/
    );
  } finally {
    await other.close();
  }
});

test('the picker survives a save failure: rolls back and says so', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('color-fail');
  await ownerApi(request, owner);
  await cookieLogin(context, owner, baseURL);
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'x' } }),
      });
    } else {
      await route.continue();
    }
  });
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const coral = page.getByRole('radio', { name: 'Coral' });
  await expect(coral).toBeVisible({ timeout: 20_000 });
  await coral.click();
  await expect(page.getByText("We couldn't update your color. Please try again.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(coral).toHaveAttribute('aria-checked', 'false');
  expect(colorOf(owner.userId)).toBeNull();
});
