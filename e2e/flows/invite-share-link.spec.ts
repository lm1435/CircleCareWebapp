import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { dbQuery, countRequests } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  inviteStatus,
  ownerApi,
  settle,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// SHARE INVITE LINK (1.4.3): an invite with NO email, against the real backend + DB.
//
//   SL-E1 (positive) the owner presses "Share invite link": the create request carries
//         NO email key, the backend stores a pending invite with invited_email NULL, the
//         "Invite link ready" step shows the link (a 6- or 8-character code) and Copy
//         puts exactly that link on the clipboard; no "We also emailed" receipt.
//   SL-E2 (positive) the Members list shows the row as "Shared link", never "null".
//   SL-E3 (negative) the owner opening their own link is told it is their own link:
//         no Accept, no Decline, and the invite stays pending.
//   SL-E4 (positive) a signed-in stranger declines the link by code; the row is
//         declined in the DB and the owner sees it under Declined invites as
//         "Shared link" with Remove only (no "Invite again").
//
// Desktop Chromium has no navigator.share, so Copy is the path exercised here (the
// share-sheet branch is covered by the vitest suite).

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

const LINK_RE = /\/invite\/([A-Z0-9]{6}|[A-Z0-9]{8})(\?lang=[a-z-]+)?$/;

test('share invite link: no email, link + copy, "Shared link" row, own-link guard, decline by code', async ({
  page,
  context,
  request,
  baseURL,
  browser,
}) => {
  const owner = await createScopedAccount('share-link-owner');
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq('share-link'));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await cookieLogin(context, owner, baseURL);

  // --- SL-E1: create a link invite from the modal ---
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  const createReq = page.waitForRequest(
    (r) => r.method() === 'POST' && /\/api\/circles\/[^/]+\/invites$/.test(r.url())
  );
  const createRes = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/circles\/[^/]+\/invites$/.test(r.url())
  );
  await dialog.getByRole('button', { name: 'Share invite link' }).click();
  const body = (await createReq).postDataJSON() as Record<string, unknown>;
  expect(body).toEqual({ member_type: 'caregiver' });
  expect(Object.keys(body)).not.toContain('email');
  const res = await createRes;
  expect(res.status()).toBe(201);
  const created = ((await res.json()) as {
    data: { invite: { id: string; invited_email: string | null; invite_code: string } };
  }).data.invite;
  expect(created.invited_email).toBeNull();
  expect(created.invite_code).toMatch(/^([A-Z0-9]{6}|[A-Z0-9]{8})$/);

  const row = dbQuery<{ invited_email: string | null; status: string }>(
    `select invited_email, status from invites where id = '${created.id}'::uuid`
  )[0];
  expect(row).toEqual({ invited_email: null, status: 'pending' });

  await expect(dialog.getByRole('heading', { name: 'Invite link ready' })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText('Anyone with this link can join once. It expires in 7 days.')).toBeVisible();
  await expect(dialog.getByText(/We also emailed/)).toHaveCount(0);
  const shown = (await dialog.getByText(LINK_RE).textContent())?.trim() ?? '';
  expect(shown).toMatch(LINK_RE);
  expect(shown).toContain(created.invite_code);

  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(shown);

  await checkA11y(page, 'invite-share-link-ready', test.info());
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- SL-E2: the pending row reads "Shared link" ---
  await expect(page.getByText('Shared link', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Actions for invite to a shared link' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/\bnull\b/);

  // --- SL-E3: the owner opening their own link: no Accept, no Decline ---
  const declines = countRequests(page, 'POST', '/api/invites/code/:code/decline');
  await page.goto(`/invite/${created.invite_code}`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { level: 1, name: 'This is your own invite link' })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0);
  await settle();
  await declines.expectCount(0);
  expect(inviteStatus(created.id)).toBe('pending');

  // --- SL-E4: a stranger declines by code ---
  const stranger = await createScopedAccount('share-link-stranger');
  const strangerContext = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL });
  try {
    await cookieLogin(strangerContext, stranger, baseURL);
    const strangerPage = await strangerContext.newPage();
    await strangerPage.goto(`/invite/${created.invite_code}`, { waitUntil: 'domcontentloaded' });
    await strangerPage.getByRole('button', { name: 'Decline', exact: true }).click({ timeout: 30_000 });
    const confirm = strangerPage.getByRole('dialog');
    await expect(confirm.getByText('Decline this invite?')).toBeVisible();
    const declineRes = strangerPage.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/invites\/code\/[^/]+\/decline$/.test(r.url())
    );
    await confirm.getByRole('button', { name: 'Decline', exact: true }).click();
    expect((await declineRes).status()).toBe(200);
    await expect(strangerPage.getByTestId('invite-declined-notice')).toBeVisible({ timeout: 20_000 });
  } finally {
    await strangerContext.close();
  }
  expect(inviteStatus(created.id)).toBe('declined');

  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  const declinedSection = page.getByTestId('declined-invites-section');
  await expect(declinedSection.getByText('Shared link', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(declinedSection.getByRole('button', { name: 'Remove declined invite for a shared link' })).toBeVisible();
  await expect(declinedSection.getByText('Invite again')).toHaveCount(0);
});
