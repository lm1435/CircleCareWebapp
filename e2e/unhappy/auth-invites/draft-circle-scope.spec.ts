import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { failRequest } from '../../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from './_helpers';

// Web security audit 2026-10-01: a PK9 draft (sessionStorage, saved at a FORCED
// sign-out) is one care recipient's emergency info. It may only be restored into
// the SAME circle's form. The emergency modals keyed their drafts without the
// circle id, so a contact typed in circle A re-filled "Add contact" in circle B
// (whose other members need not be in A) and one Save wrote it there.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const DRAFT_ENTRIES = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('cc:draft:')));

async function gotoEmergency(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info', level: 1 })).toBeVisible({ timeout: 20_000 });
}

async function openAddContact(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('#contact-name')).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function loginViaForm(page: Page, acct: ScopedAccount): Promise<void> {
  await page.locator('#login-email').fill(acct.email);
  await page.locator('#login-password').fill(acct.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/circles\//, { timeout: 30_000 });
}

test('PK9: an emergency-contact draft from circle A is never restored into circle B', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const acct = await createScopedAccount('draftscope');
  const api = await ownerApi(request, acct);
  const circleA = await createCircle(api, uniq('scopeA'));
  const circleB = await createCircle(api, uniq('scopeB'));
  await cookieLogin(context, acct, baseURL);
  const draft = `DRAFT-${uniq('contact')}`;

  // Circle A: type a new contact, then the session dies on Save (the PUT 401s
  // and the refresh fails) — a FORCED sign-out, which saves the open form.
  await gotoEmergency(page, circleA);
  const dialog = await openAddContact(page);
  await dialog.locator('#contact-name').fill(draft);
  await dialog.locator('#contact-relationship').fill('Son');
  await dialog.locator('#contact-phone').fill('3035550142');
  const refresh = await failRequest(page, 'POST', '/api/auth/refresh', {
    status: 401,
    code: 'UNAUTHORIZED',
    times: 5,
  });
  const write = await failRequest(page, 'PUT', '/api/circles/:id/emergency-info', {
    status: 401,
    code: 'UNAUTHORIZED',
    times: 1,
  });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await refresh.dispose();
  await write.dispose();
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);

  await loginViaForm(page, acct);

  // Circle B: the same form opens EMPTY, with no restore notice, and the
  // circle-A draft is left untouched for circle A.
  await gotoEmergency(page, circleB);
  const dialogB = await openAddContact(page);
  await expect(dialogB.locator('#contact-name')).toHaveValue('');
  await expect(page.getByText('We restored your unsaved draft.')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialogB).toBeHidden({ timeout: 10_000 });
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);

  // Circle A: restored where it was typed, then deleted.
  await gotoEmergency(page, circleA);
  const dialogA = await openAddContact(page);
  await expect(dialogA.locator('#contact-name')).toHaveValue(draft, { timeout: 5_000 });
  await expect(page.getByText('We restored your unsaved draft.')).toBeVisible();
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
});
