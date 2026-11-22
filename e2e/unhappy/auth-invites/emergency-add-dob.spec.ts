import { test, expect } from '../../fixtures';
import { dbQuery, sqlStr } from '../../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from './_helpers';

// "Add date of birth" from Emergency info (owner 2026-11-22, 1.4.3). Onboarding no longer asks for a DOB,
// so the owner adds it here. The stored `recipient_dob` must be EXACTLY the picked YYYY-MM-DD, in a
// browser zone far from the server's (Pacific/Auckland, UTC+12/13): a date built from a `Date` in the
// browser zone would land a day off. A run-scoped owner with a fresh circle (no DOB).

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'Pacific/Auckland' });

const dobOf = (circleId: string): string | null =>
  dbQuery<{ d: string | null }>(
    `select recipient_dob::text as d from care_circles where id = ${sqlStr(circleId)}::uuid`
  )[0].d;

test('POSITIVE: the owner adds 1950-06-15 from Emergency info; the DB row holds exactly that date', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('dob-owner');
  const circleId = await createCircle(await ownerApi(request, owner), uniq('dob'));
  expect(dobOf(circleId)).toBeNull();
  await cookieLogin(context, owner, baseURL);

  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add date of birth' }).click({ timeout: 20_000 });
  const dialog = page.getByRole('dialog', { name: 'Add date of birth' });
  await dialog.getByLabel('Date of birth', { exact: true }).fill('1950-06-15');
  await dialog.getByTestId('recipient-dob-save').click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  await expect.poll(() => dobOf(circleId), { timeout: 15_000 }).toBe('1950-06-15');
  // The row is gone and the date shows (formatted, never shifted).
  await expect(page.getByText('June 15, 1950')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add date of birth' })).toHaveCount(0);
});

test('NEGATIVE: Cancel writes nothing (the row stays NULL and the prompt stays)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('dob-cancel');
  const circleId = await createCircle(await ownerApi(request, owner), uniq('dob-cancel'));
  await cookieLogin(context, owner, baseURL);

  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add date of birth' }).click({ timeout: 20_000 });
  const dialog = page.getByRole('dialog', { name: 'Add date of birth' });
  await dialog.getByLabel('Date of birth', { exact: true }).fill('1950-06-15');
  await dialog.locator('[data-modal-footer]').getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(1_000);
  expect(dobOf(circleId)).toBeNull();
  await expect(page.getByRole('button', { name: 'Add date of birth' })).toBeVisible();
});
