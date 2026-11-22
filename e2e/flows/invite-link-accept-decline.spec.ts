import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import { dbCount, dbQuery, generateSignupOtp, sqlStr } from '../unhappy';
import {
  PARKED,
  archiveCircle,
  authUser,
  cookieLogin,
  createCircle,
  createScopedAccount,
  expireInvite,
  inviteStatus,
  membershipCount,
  ownerApi,
  sessionItems,
  settle,
  typeOtp,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';

// ===========================================================================
// INVITE LINKS, ACCEPTED and DECLINED, with screenshots for human validation
// (owner request 2026-11-21, release 1.4.3). Real local backend + DB, no stubs.
// Mobile twins: mobile/.maestro/parity/invites/{invite-link-new-account,
// invite-decline,invite-declined-owner}.yaml.
//
// Accepted:  P1 brand-new person from a LINK (signup + code -> lands IN the
//            circle, owns ZERO circles); P2 existing signed-in user.
// Declined:  P3 signed-in non-member declines a LINK; P4 addressee declines an
//            EMAIL invite.
// Negatives: N1 second person on a used link; N2 owner opens own link; N3 a
//            member opens it; N4 expired; N5 archived circle; N6 free owner's
//            second link (held seat, 402); N7 wrong account declines an EMAIL
//            invite; N8 ?lang= landings render localized, not 404.
//
// RUN AGAINST a backend started with EMAIL_BLOCKED_DOMAINS=circlecare.test
// (see invite-signup.spec.ts): P1's signup is the by-design fake 200 and the
// code comes from GoTrue's admin generate_link.
//
// SCREENSHOTS: every `shot()` writes a full-page PNG to the test output folder
// AND to SHOT_DIR/web/ (override with INVITE_SHOT_DIR) under a descriptive name.
//
// FALSIFY (PW_FALSIFY=n1-count): N1 expects TWO memberships on a used link, so
// it must go red (the real answer is one).
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
const SHOT_DIR = path.join(
  process.env.INVITE_SHOT_DIR ??
    '/private/tmp/claude-501/-Users-meza-Desktop-projects-CircleCare/a3a38227-93f7-4e66-92b8-61ef246dbce9/scratchpad/invite-shots',
  'web'
);

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

async function shot(page: Page, name: string): Promise<void> {
  // Let fonts/layout settle; the shot is for a human.
  await page.waitForTimeout(400);
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.copyFileSync(file, path.join(SHOT_DIR, `${name}.png`));
}

const LINK_RE = /\/invite\/([A-Z0-9]{6}|[A-Z0-9]{8})(\?lang=[a-z-]+)?$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const circleNameFor = (label: string) => `E2E ${label}`.slice(0, 100);
const welcomeHeading = (circleName: string) =>
  new RegExp(`^(.+ invited you to help with|You're helping with) ${escapeRe(circleName)}\\.$`);

interface LinkInvite {
  id: string;
  code: string;
}

/** Create a LINK invite (no email) through the API as the owner. */
async function apiLink(api: Awaited<ReturnType<typeof ownerApi>>, circleId: string): Promise<LinkInvite> {
  const res = await api.post(`/api/circles/${circleId}/invites`, { member_type: 'caregiver' });
  expect(res.status(), `create link invite: ${await res.text()}`).toBe(201);
  const invite = ((await res.json()) as { data: { invite: { id: string; invite_code: string; invited_email: string | null } } })
    .data.invite;
  expect(invite.invited_email, 'a link invite has no address').toBeNull();
  return { id: invite.id, code: invite.invite_code };
}

/** Owner presses "Share invite link" in the Members modal (the real UI). */
async function uiLink(page: Page, circleId: string, shotPrefix: string): Promise<LinkInvite> {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await shot(page, `${shotPrefix}-owner-invite-modal`);
  const createRes = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/circles\/[^/]+\/invites$/.test(r.url())
  );
  await dialog.getByRole('button', { name: 'Share invite link' }).click();
  const res = await createRes;
  expect(res.status()).toBe(201);
  const created = ((await res.json()) as { data: { invite: { id: string; invite_code: string } } }).data.invite;
  await expect(dialog.getByRole('heading', { name: 'Invite link ready' })).toBeVisible({ timeout: 20_000 });
  const shown = (await dialog.getByText(LINK_RE).textContent())?.trim() ?? '';
  expect(shown).toContain(created.invite_code);
  await shot(page, `${shotPrefix}-owner-link-ready`);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText('Shared link', { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, `${shotPrefix}-owner-shared-link-row`);
  return { id: created.id, code: created.invite_code };
}

async function freshContext(browser: Browser, baseURL: string | undefined, locale?: string): Promise<BrowserContext> {
  return browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL, ...(locale ? { locale } : {}) });
}

async function signedInPage(
  browser: Browser,
  baseURL: string | undefined,
  account: ScopedAccount
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await freshContext(browser, baseURL);
  await cookieLogin(ctx, account, baseURL);
  return { ctx, page: await ctx.newPage() };
}

function ownedCircles(userId: string): number {
  return dbCount(`select 1 from care_circles where owner_id = ${sqlStr(userId)}::uuid`);
}
function membershipRoles(userId: string): Array<{ circle_id: string; role: string }> {
  return dbQuery<{ circle_id: string; role: string }>(
    `select circle_id::text, role from circle_memberships where user_id = ${sqlStr(userId)}::uuid`
  );
}
function declineFeedRows(circleId: string): number {
  return dbCount(
    `select 1 from activity_feed where circle_id = ${sqlStr(circleId)}::uuid and action_type = 'invite_declined'`
  );
}
function memberCount(circleId: string): number {
  return dbCount(`select 1 from circle_memberships where circle_id = ${sqlStr(circleId)}::uuid`);
}

async function ownerSetup(request: Parameters<typeof ownerApi>[0], label: string) {
  const owner = await createScopedAccount(`${label}-owner`);
  const api = await ownerApi(request, owner);
  const lbl = uniq(label);
  const circleId = await createCircle(api, lbl);
  return { owner, api, circleId, label: lbl, circleName: circleNameFor(lbl) };
}

// ---------------------------------------------------------------------------
// ACCEPTED
// ---------------------------------------------------------------------------

test('P1 accepted: brand-new person from a LINK signs up, verifies, lands IN the circle, owns zero circles', async ({
  page,
  context,
  request,
  browser,
  baseURL,
}) => {
  test.slow();
  const { owner, circleId, label, circleName } = await ownerSetup(request, 'lnk-p1');
  let newEmail = '';
  await cookieLogin(context, owner, baseURL);
  const link = await uiLink(page, circleId, 'P1-01');
  expect(inviteStatus(link.id)).toBe('pending');

  // A signed-out visitor opens the link.
  const ctx = await freshContext(browser, baseURL);
  try {
    const guest = await ctx.newPage();
    await guest.goto(`/invite/${link.code}`, { waitUntil: 'domcontentloaded' });
    await expect(guest.getByRole('button', { name: 'Create an account to join' })).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText(circleName, { exact: true })).toBeVisible();
    await shot(guest, 'P1-02-landing-card-signed-out');
    await guest.getByRole('button', { name: 'Create an account to join' }).click();
    await expect(guest).toHaveURL(/\/signup$/, { timeout: 20_000 });
    expect((await sessionItems(guest, [PARKED.invite]))[PARKED.invite], 'the code is parked across signup').toBe(link.code);

    const email = runScopedEmail(uniq('lnk-p1-new'));
    newEmail = email;
    await expect(guest.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 20_000 });
    await guest.locator('#first_name').fill('Ada');
    await guest.locator('#last_name').fill('Invitee');
    await guest.locator('#email').fill(email);
    await guest.locator('#password').fill(ACCOUNT_PASSWORD);
    await guest.locator('#termsAccepted').check({ force: true });
    await shot(guest, 'P1-03-signup-form');
    await guest.getByRole('button', { name: 'Create account' }).click();
    await expect(guest.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 20_000 });
    await shot(guest, 'P1-04-verify-code-screen');
    const otp = await generateSignupOtp(email, ACCOUNT_PASSWORD);
    await typeOtp(guest, otp);

    await expect(guest.getByRole('heading', { level: 1, name: welcomeHeading(circleName) })).toBeVisible({
      timeout: 25_000,
    });
    await expect(guest).toHaveURL(new RegExp(`/circles/${circleId}/welcome$`), { timeout: 20_000 });
    await shot(guest, 'P1-05-post-verify-invitee-welcome-in-circle');
    await guest.getByRole('button', { name: 'Go to Today', exact: true }).click();
    await expect(guest).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
    await expect(guest.getByRole('heading', { name: /Who are you caring for/i })).toHaveCount(0);
    await shot(guest, 'P1-06-circle-today');

    const userId = authUser(email).id;
    const roles = membershipRoles(userId);
    expect(roles, 'exactly one membership: the invited circle, role member (not owner)').toEqual([
      { circle_id: circleId, role: 'member' },
    ]);
    expect(ownedCircles(userId), 'NO throwaway circle').toBe(0);
    expect(inviteStatus(link.id)).toBe('accepted');
    expect(memberCount(circleId), 'owner + the new person').toBe(2);
    expect((await sessionItems(guest, [PARKED.invite]))[PARKED.invite], 'parked code consumed').toBeNull();
  } finally {
    await ctx.close();
  }

  // The owner's Members page: the member is there, the pending link row is gone.
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 30_000 });
  // (The name is not Ada Invitee: the blocked-domain signup is a fake 200 and GoTrue's admin
  // generate_link makes the user without the form's metadata, so the row shows the e-mail.)
  await expect(page.getByText(newEmail).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Shared link', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Actions for invite to a shared link' })).toHaveCount(0);
  await shot(page, 'P1-07-owner-members-new-member-no-pending-link');
  void label;
});

test('P2 accepted: existing signed-in user opens the LINK and accepts', async ({ request, browser, baseURL, context, page }) => {
  const { owner, api, circleId, circleName } = await ownerSetup(request, 'lnk-p2');
  const link = await apiLink(api, circleId);
  const invitee = await createScopedAccount('lnk-p2-invitee');
  const ownCircle = await createCircle(await ownerApi(request, invitee), uniq('lnk-p2-own'));
  const { ctx, page: ip } = await signedInPage(browser, baseURL, invitee);
  try {
    await ip.goto(`/invite/${link.code}`, { waitUntil: 'domcontentloaded' });
    await expect(ip.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(ip.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
    await shot(ip, 'P2-01-landing-card-signed-in-accept-decline');
    await ip.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(ip.getByRole('heading', { level: 1, name: welcomeHeading(circleName) })).toBeVisible({
      timeout: 25_000,
    });
    await shot(ip, 'P2-02-joined-invitee-welcome');
  } finally {
    await ctx.close();
  }
  const roles = membershipRoles(invitee.userId);
  expect(roles.filter((r) => r.circle_id === circleId)).toEqual([{ circle_id: circleId, role: 'member' }]);
  expect(roles.find((r) => r.circle_id === ownCircle)?.role, 'own circle untouched').toBe('owner');
  expect(ownedCircles(invitee.userId), 'still exactly their own one circle').toBe(1);
  expect(inviteStatus(link.id)).toBe('accepted');
  expect(memberCount(circleId)).toBe(2);

  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Shared link', { exact: true })).toHaveCount(0);
  await shot(page, 'P2-03-owner-members-after-accept');
});

// ---------------------------------------------------------------------------
// DECLINED
// ---------------------------------------------------------------------------

test('P3 declined: signed-in non-member declines the LINK; reopened = already used; owner sees Declined, no Invite again', async ({
  request,
  browser,
  baseURL,
  context,
  page,
}) => {
  const { owner, api, circleId } = await ownerSetup(request, 'lnk-p3');
  const link = await apiLink(api, circleId);
  const stranger = await createScopedAccount('lnk-p3-stranger');
  const { ctx, page: sp } = await signedInPage(browser, baseURL, stranger);
  try {
    await sp.goto(`/invite/${link.code}`, { waitUntil: 'domcontentloaded' });
    await sp.getByRole('button', { name: 'Decline', exact: true }).click({ timeout: 30_000 });
    const dialog = sp.getByRole('dialog');
    await expect(dialog.getByText('Decline this invite?')).toBeVisible();
    await shot(sp, 'P3-01-decline-confirm-dialog');
    const res = sp.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/invites\/code\/[^/]+\/decline$/.test(r.url())
    );
    await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
    expect((await res).status()).toBe(200);
    await expect(sp.getByTestId('invite-declined-notice')).toHaveText('Invite declined', { timeout: 20_000 });
    await shot(sp, 'P3-02-declined-notice');

    // Reopen the same link.
    await sp.goto(`/invite/${link.code}`, { waitUntil: 'domcontentloaded' });
    await expect(sp.getByRole('heading', { level: 1, name: 'This invite has already been used' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(sp.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    await shot(sp, 'P3-03-reopened-link-already-used');
  } finally {
    await ctx.close();
  }
  expect(inviteStatus(link.id)).toBe('declined');
  expect(membershipCount(circleId, stranger.userId)).toBe(0);
  expect(declineFeedRows(circleId), 'exactly one invite_declined activity row').toBe(1);

  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  const section = page.getByTestId('declined-invites-section');
  await expect(section.getByText('Shared link', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(section.getByText(/^Declined/).first()).toBeVisible();
  await expect(section.getByRole('button', { name: 'Remove declined invite for a shared link' })).toBeVisible();
  await expect(section.getByText('Invite again')).toHaveCount(0);
  await shot(page, 'P3-04-owner-members-declined-link-row');

  await page.goto(`/circles/${circleId}/activity`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/declined the invite/).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, 'P3-05-owner-activity-declined-the-invite');
});

test('P4 declined: addressee declines an EMAIL invite; owner sees Invite again + Remove', async ({
  request,
  browser,
  baseURL,
  context,
  page,
}) => {
  const { owner, api, circleId, circleName } = await ownerSetup(request, 'lnk-p4');
  const invitee = await createScopedAccount('lnk-p4-invitee');
  const res0 = await api.post(`/api/circles/${circleId}/invites`, { email: invitee.email, member_type: 'caregiver' });
  expect(res0.status(), await res0.text()).toBeLessThan(300);
  const inviteId = ((await res0.json()) as { data: { invite: { id: string } } }).data.invite.id;

  const { ctx, page: ip } = await signedInPage(browser, baseURL, invitee);
  try {
    await ip.goto('/invites', { waitUntil: 'domcontentloaded' });
    const declineBtn = ip.getByRole('button', { name: `Decline invite to ${circleName}` });
    await expect(declineBtn).toBeVisible({ timeout: 30_000 });
    await shot(ip, 'P4-01-invitee-pending-invites-card');
    await declineBtn.click();
    await expect(ip.getByRole('dialog').getByText('Decline this invite?')).toBeVisible();
    await shot(ip, 'P4-02-decline-confirm-dialog');
    await ip.getByRole('dialog').getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(ip.getByText('Invite declined')).toBeVisible({ timeout: 10_000 });
    await shot(ip, 'P4-03-declined-banner');
  } finally {
    await ctx.close();
  }
  expect(inviteStatus(inviteId)).toBe('declined');
  expect(membershipCount(circleId, invitee.userId)).toBe(0);
  expect(declineFeedRows(circleId)).toBe(1);

  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  const section = page.getByTestId('declined-invites-section');
  await expect(section.getByText(invitee.email)).toBeVisible({ timeout: 30_000 });
  await expect(section.getByRole('button', { name: `Invite again: ${invitee.email}` })).toBeVisible();
  await expect(section.getByRole('button', { name: `Remove declined invite for ${invitee.email}` })).toBeVisible();
  await shot(page, 'P4-04-owner-declined-invites-invite-again-remove');
});

// ---------------------------------------------------------------------------
// NEGATIVES
// ---------------------------------------------------------------------------

test('N1 a second person on an already-accepted link: "already used", no membership', async ({
  request,
  browser,
  baseURL,
}) => {
  const { api, circleId } = await ownerSetup(request, 'lnk-n1');
  const link = await apiLink(api, circleId);
  const first = await createScopedAccount('lnk-n1-first');
  const firstApi = await ownerApi(request, first);
  const ok = await firstApi.post(`/api/invites/code/${link.code}/accept`, {});
  expect(ok.status(), await ok.text()).toBe(200);
  expect(inviteStatus(link.id)).toBe('accepted');

  const second = await createScopedAccount('lnk-n1-second');
  const { ctx, page: sp } = await signedInPage(browser, baseURL, second);
  try {
    await sp.goto(`/invite/${link.code}`, { waitUntil: 'domcontentloaded' });
    await expect(sp.getByRole('heading', { level: 1, name: 'This invite has already been used' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(sp.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    await shot(sp, 'N1-second-person-link-already-used');
  } finally {
    await ctx.close();
  }
  // The API refuses it too.
  const refused = await (await ownerApi(request, second)).post(`/api/invites/code/${link.code}/accept`, {});
  expect(refused.status()).toBe(400);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('INVITE_ALREADY_USED');
  expect(membershipCount(circleId, second.userId)).toBe(0);
  expect(membershipCount(circleId, first.userId)).toBe(1);
  // One link seats exactly one person: owner + first only.
  expect(memberCount(circleId)).toBe(FALSIFY.has('n1-count') ? 3 : 2);
});

test('N2 owner opens their own link: own-link note, no Accept, nothing burned', async ({
  request,
  browser,
  baseURL,
}) => {
  const { owner, api, circleId } = await ownerSetup(request, 'lnk-n2');
  const link = await apiLink(api, circleId);
  const { ctx, page } = await signedInPage(browser, baseURL, owner);
  try {
    await page.goto(`/invite/${link.code}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'This is your own invite link' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0);
    await shot(page, 'N2-owner-own-link-note');
  } finally {
    await ctx.close();
  }
  await settle();
  expect(inviteStatus(link.id)).toBe('pending');
  expect(memberCount(circleId)).toBe(1);
  expect(declineFeedRows(circleId)).toBe(0);
});

test('N3 an existing member opens the link: already in this circle, nothing burned', async ({
  request,
  browser,
  baseURL,
}) => {
  const { api, circleId } = await ownerSetup(request, 'lnk-n3');
  const first = await apiLink(api, circleId);
  const member = await createScopedAccount('lnk-n3-member');
  expect((await (await ownerApi(request, member)).post(`/api/invites/code/${first.code}/accept`, {})).status()).toBe(200);
  const spare = await apiLink(api, circleId); // owner may create another link only on premium
  const { ctx, page } = await signedInPage(browser, baseURL, member);
  try {
    await page.goto(`/invite/${spare.code}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: "You're already in this circle" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0);
    await shot(page, 'N3-member-opens-link-already-member');
  } finally {
    await ctx.close();
  }
  await settle();
  expect(inviteStatus(spare.id)).toBe('pending');
  expect(membershipCount(circleId, member.userId)).toBe(1);
  expect(declineFeedRows(circleId)).toBe(0);
});

test('N4 expired link: expired/invalid card, no Accept, nothing joined', async ({ request, browser, baseURL }) => {
  const { api, circleId } = await ownerSetup(request, 'lnk-n4');
  const link = await apiLink(api, circleId);
  expireInvite(link.id);
  const invitee = await createScopedAccount('lnk-n4-invitee');
  const { ctx, page } = await signedInPage(browser, baseURL, invitee);
  try {
    await page.goto(`/invite/${link.code}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'This invite has expired or is invalid' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    await shot(page, 'N4-expired-link');
  } finally {
    await ctx.close();
  }
  expect(membershipCount(circleId, invitee.userId)).toBe(0);
  expect(inviteStatus(link.id)).toBe('pending');
});

test('N5 link to an archived circle: "no longer active", nothing joined', async ({ request, browser, baseURL }) => {
  const { api, circleId } = await ownerSetup(request, 'lnk-n5');
  const link = await apiLink(api, circleId);
  await archiveCircle(api, circleId);
  const invitee = await createScopedAccount('lnk-n5-invitee');
  const { ctx, page } = await signedInPage(browser, baseURL, invitee);
  try {
    await page.goto(`/invite/${link.code}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'This care circle is no longer active' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    await shot(page, 'N5-archived-circle-link');
  } finally {
    await ctx.close();
  }
  expect(membershipCount(circleId, invitee.userId)).toBe(0);
});

test('N6 free owner: a pending LINK holds the free seat, a second link is refused (402) with the held-seat message', async ({
  request,
  context,
  page,
  baseURL,
}) => {
  const email = runScopedEmail(uniq('lnk-n6-free-owner'));
  await createAccount(email, 'free');
  const freeOwner: ScopedAccount = { email, password: ACCOUNT_PASSWORD, userId: authUser(email).id };
  const api = await ownerApi(request, freeOwner);
  const circleId = await createCircle(api, uniq('lnk-n6'));
  const first = await apiLink(api, circleId);

  const second = await api.post(`/api/circles/${circleId}/invites`, { member_type: 'caregiver' });
  expect(second.status(), await second.text()).toBe(402);
  const body = (await second.json()) as { error: { code: string; details?: { reason?: string } } };
  expect(body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  expect(body.error.details?.reason).toBe('pending_invite_seat');
  expect(dbCount(`select 1 from invites where circle_id = ${sqlStr(circleId)}::uuid and status = 'pending'`)).toBe(1);
  expect(inviteStatus(first.id)).toBe('pending');

  await cookieLogin(context, freeOwner, baseURL);
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  await expect(page.getByRole('dialog').getByText(/held by a shared invite link/).first()).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, 'N6-free-owner-seat-held-by-shared-link');
});

test('N7 wrong account declines an EMAIL invite addressed to someone else: refused 403, invite untouched', async ({
  request,
  browser,
  baseURL,
}) => {
  const { api, circleId, circleName } = await ownerSetup(request, 'lnk-n7');
  const addressee = await createScopedAccount('lnk-n7-addressee');
  const res0 = await api.post(`/api/circles/${circleId}/invites`, { email: addressee.email, member_type: 'caregiver' });
  expect(res0.status(), await res0.text()).toBeLessThan(300);
  const inviteId = ((await res0.json()) as { data: { invite: { id: string } } }).data.invite.id;

  const wrong = await createScopedAccount('lnk-n7-wrong');
  const refused = await (await ownerApi(request, wrong)).post(`/api/invites/${inviteId}/decline`, {});
  expect(refused.status(), await refused.text()).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('EMAIL_MISMATCH');
  expect(inviteStatus(inviteId)).toBe('pending');
  expect(declineFeedRows(circleId)).toBe(0);

  // What the wrong account sees: nothing to decline.
  const { ctx, page } = await signedInPage(browser, baseURL, wrong);
  try {
    await page.goto('/invites', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No pending invitations')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: `Decline invite to ${circleName}` })).toHaveCount(0);
    await shot(page, 'N7-wrong-account-sees-no-invite');
  } finally {
    await ctx.close();
  }
  // The real addressee can still decline it.
  const ok = await (await ownerApi(request, addressee)).post(`/api/invites/${inviteId}/decline`, {});
  expect(ok.status()).toBe(200);
  expect(inviteStatus(inviteId)).toBe('declined');
});

test.describe('N8 localized landing (?lang=), never a 404', () => {
  test('es-MX browser + ?lang=es renders the Spanish landing', async ({ request, browser, baseURL }) => {
    const { api, circleId } = await ownerSetup(request, 'lnk-n8es');
    const link = await apiLink(api, circleId);
    const ctx = await freshContext(browser, baseURL, 'es-MX');
    try {
      const page = await ctx.newPage();
      const res = await page.goto(`/invite/${link.code}?lang=es`, { waitUntil: 'domcontentloaded' });
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('button', { name: 'Crea una cuenta para unirte' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('heading', { level: 1, name: /te invitó a ayudar a cuidar a/ })).toBeVisible();
      await expect(page.getByText('Page not found')).toHaveCount(0);
      await shot(page, 'N8-landing-lang-es');
    } finally {
      await ctx.close();
    }
  });

  test('pt-PT browser + ?lang=pt-PT renders the Portuguese landing', async ({ request, browser, baseURL }) => {
    const { api, circleId } = await ownerSetup(request, 'lnk-n8pt');
    const link = await apiLink(api, circleId);
    const ctx = await freshContext(browser, baseURL, 'pt-PT');
    try {
      const page = await ctx.newPage();
      const res = await page.goto(`/invite/${link.code}?lang=pt-PT`, { waitUntil: 'domcontentloaded' });
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: /fez-lhe um convite para ajudar a cuidar de/ })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('button', { name: 'Create an account to join' })).toHaveCount(0);
      await shot(page, 'N8-landing-lang-pt-PT');
    } finally {
      await ctx.close();
    }
  });

  test('English browser + ?lang=es: the landing renders (not 404) and stays English (preview-only by design)', async ({
    request,
    browser,
    baseURL,
  }) => {
    const { api, circleId } = await ownerSetup(request, 'lnk-n8en');
    const link = await apiLink(api, circleId);
    const ctx = await freshContext(browser, baseURL, 'en-US');
    try {
      const page = await ctx.newPage();
      const res = await page.goto(`/invite/${link.code}?lang=es`, { waitUntil: 'domcontentloaded' });
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('button', { name: 'Create an account to join' })).toBeVisible({ timeout: 30_000 });
      await shot(page, 'N8-landing-lang-es-on-english-browser');
    } finally {
      await ctx.close();
    }
  });
});
