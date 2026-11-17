import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createScopedAccount, uniq, type ScopedAccount } from '../unhappy/auth-invites/_helpers';

// 1.4.2: "Who are you caring for?" on the web create-circle form, mobile parity
// (mobile/src/screens/circle/CreateCircleScreen.tsx + Maestro auth/first-run-wizard).
// Same five chips in the same order, none picked by default; "Myself" is self-care
// (it replaced the old "This circle is for myself" switch), the others personalise
// the subtitle and the name hint. The relationship is never sent.
//
// Against the real backend: a scoped account with no circles creates through the
// real modal and the DB is read for is_self_care.

test.describe('create circle: Who are you caring for? (1.4.2, mobile parity)', () => {
  test.setTimeout(90_000);
  let acct: ScopedAccount;

  test.beforeEach(async ({ page: _page, context, baseURL }) => {
    void _page;
    acct = await createScopedAccount('rel');
    await cookieLogin(context, acct, baseURL);
  });

  async function openCreate(page: import('@playwright/test').Page) {
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^(Start a care circle|Create circle)$/ }).first().click();
    return page.getByRole('dialog');
  }

  test('POSITIVE: the chips, their order, no default; "A parent" personalises; created as NOT self-care', async ({
    page,
  }) => {
    const modal = await openCreate(page);
    const group = modal.getByRole('radiogroup', { name: 'Who are you caring for?' });
    await expect(group.getByRole('radio')).toHaveText([
      'A parent',
      'My spouse / partner',
      'My child',
      'Myself',
      'Someone else',
    ]);
    for (const radio of await group.getByRole('radio').all()) {
      await expect(radio).toHaveAttribute('aria-checked', 'false');
    }
    await expect(modal.getByTestId('create-circle-subtitle')).toHaveText('Start coordinating care for your loved one');

    await group.getByRole('radio', { name: 'A parent' }).click();
    await expect(modal.getByTestId('create-circle-subtitle')).toHaveText("Let's set up care for your parent");
    await expect(modal.locator('#recipient_name')).toHaveAttribute('placeholder', 'e.g., Mom, Dad');

    const recipient = uniq('relparent');
    await modal.locator('#recipient_name').fill(recipient);
    await modal.getByRole('button', { name: 'Create circle' }).click();
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const circleId = /\/circles\/([0-9a-f-]{36})/.exec(page.url())![1];
    const rows = dbQuery<{ recipient_name: string; is_self_care: boolean }>(
      `select recipient_name, is_self_care from care_circles where id = ${sqlStr(circleId)}::uuid`
    );
    expect(rows).toEqual([{ recipient_name: recipient, is_self_care: false }]);
  });

  test('POSITIVE: "Myself" is self-care: no name field, created with is_self_care true', async ({ page }) => {
    const modal = await openCreate(page);
    await modal.getByRole('radio', { name: 'Myself' }).click();
    await expect(modal.locator('#recipient_name')).toHaveCount(0);
    await expect(modal.getByTestId('create-circle-subtitle')).toHaveText(
      'Set up medication tracking and reminders for yourself'
    );
    await modal.getByRole('button', { name: 'Create circle' }).click();
    await page.waitForURL(/\/circles\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const circleId = /\/circles\/([0-9a-f-]{36})/.exec(page.url())![1];
    const rows = dbQuery<{ is_self_care: boolean }>(
      `select is_self_care from care_circles where id = ${sqlStr(circleId)}::uuid`
    );
    expect(rows).toEqual([{ is_self_care: true }]);
  });

  test('NEGATIVE: the old self-care switch is gone', async ({ page }) => {
    const modal = await openCreate(page);
    await expect(modal.getByRole('switch')).toHaveCount(0);
    await expect(modal.getByText('This circle is for myself')).toHaveCount(0);
  });
});
