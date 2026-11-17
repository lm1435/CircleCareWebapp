import { test, expect } from '../fixtures';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  inviteStatus,
  membershipCount,
  ownerApi,
  settle,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// ===========================================================================
// INVITE DECLINE (1.4.3, docs/plans/invite-decline-1-4-3.md). Real local
// backend + DB, no stubs. Maestro twins:
// mobile/.maestro/parity/invites/invite-decline.yaml (invitee) and
// invite-declined-owner.yaml (owner).
//
// Invitee (/invites):
//   P1 Decline -> in-page dialog (never window.confirm) -> 200 -> "Invite
//      declined", the card is gone; DB status 'declined', no membership.
//   N1 "Keep invite" sends nothing.
//   N2 Accept-by-id after the decline is refused (400 INVITE_ALREADY_USED).
//   N3 The inviter cancelled it meanwhile -> "This invite is no longer active.",
//      status stays 'cancelled' (the decline did not overwrite it).
// Owner (/circles/:id/members):
//   P2 the declined row is marked Declined with Invite again + Remove, no
//      actions menu (no Resend / Copy link) and it is not in Pending invites.
//   P3 Invite again -> dialog -> a NEW pending invite (actions menu appears),
//      the declined row goes.
//   P4 Remove -> the row goes; the declined invite becomes 'cancelled'.
//
// Accounts are run-scoped (teardown purges them); the backend mails nothing to
// them in a local run (same as unhappy/auth-invites).
//
// FALSIFY (PW_FALSIFY=invite-decline): the invite is created for ANOTHER
// address, so the invitee has no card to decline and P1 goes red.
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));

test.use({ storageState: { cookies: [], origins: [] } });

async function inviteTo(
  api: Awaited<ReturnType<typeof ownerApi>>,
  circleId: string,
  email: string
): Promise<string> {
  const res = await api.post(`/api/circles/${circleId}/invites`, { email, member_type: 'caregiver' });
  expect(res.status(), `create invite: ${await res.text()}`).toBeLessThan(300);
  return ((await res.json()) as { data: { invite: { id: string } } }).data.invite.id;
}

test.describe('invitee declines', () => {
  test('P1/N1/N2: keep sends nothing; decline records it, the card goes, accept is refused', async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const owner = await ownerApi(request, await createScopedAccount('decline-owner'));
    const label = uniq('decline');
    const circleId = await createCircle(owner, label);
    const invitee = await createScopedAccount('decline-invitee');
    const inviteId = await inviteTo(
      owner,
      circleId,
      FALSIFY.has('invite-decline') ? `${uniq('someone-else')}@example.com` : invitee.email
    );
    await cookieLogin(context, invitee, baseURL);

    let declineCalls = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === `/api/invites/${inviteId}/decline`) declineCalls++;
    });
    let nativeDialog = false;
    page.on('dialog', (d) => {
      nativeDialog = true;
      void d.dismiss();
    });

    await page.goto('/invites', { waitUntil: 'domcontentloaded' });
    const declineBtn = page.getByRole('button', { name: `Decline invite to E2E ${label}` });
    await expect(declineBtn).toBeVisible({ timeout: 20_000 });

    // N1: Keep invite.
    await declineBtn.click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Decline this invite?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep invite' }).last().click();
    await expect(dialog).toBeHidden();
    await settle();
    expect(declineCalls).toBe(0);
    expect(inviteStatus(inviteId)).toBe('pending');

    // P1: Decline + confirm.
    await declineBtn.click();
    dialog = page.getByRole('dialog');
    const declined = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/invites/${inviteId}/decline`,
      { timeout: 20_000 }
    );
    await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
    const res = await declined;
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { data: { already_declined: boolean } }).data.already_declined).toBe(false);
    await expect(page.getByText('Invite declined')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: `Decline invite to E2E ${label}` })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByText('No pending invitations')).toBeVisible();
    expect(declineCalls).toBe(1);
    expect(nativeDialog).toBe(false);
    expect(inviteStatus(inviteId)).toBe('declined');
    expect(membershipCount(circleId, invitee.userId)).toBe(0);

    // N2: the declined invite cannot be accepted.
    const inviteeApi = await ownerApi(request, invitee);
    const accept = await inviteeApi.post(`/api/invites/${inviteId}/accept`, {});
    expect(accept.status()).toBe(400);
    expect(((await accept.json()) as { error: { code: string } }).error.code).toBe('INVITE_ALREADY_USED');
    expect(membershipCount(circleId, invitee.userId)).toBe(0);
  });

  test('N3: an invite the inviter cancelled meanwhile -> "no longer active", nothing overwritten', async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const owner = await ownerApi(request, await createScopedAccount('decline-owner'));
    const label = uniq('decline-cancelled');
    const circleId = await createCircle(owner, label);
    const invitee = await createScopedAccount('decline-invitee');
    const inviteId = await inviteTo(owner, circleId, invitee.email);
    await cookieLogin(context, invitee, baseURL);

    await page.goto('/invites', { waitUntil: 'domcontentloaded' });
    const declineBtn = page.getByRole('button', { name: `Decline invite to E2E ${label}` });
    await expect(declineBtn).toBeVisible({ timeout: 20_000 });

    // The inviter cancels while the card is on screen.
    expect((await owner.delete(`/api/invites/${inviteId}`)).ok()).toBe(true);

    await declineBtn.click();
    const declined = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/invites/${inviteId}/decline`,
      { timeout: 20_000 }
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Decline', exact: true }).click();
    expect((await declined).status()).toBe(400);
    await expect(page.getByText('This invite is no longer active.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Invite declined')).toHaveCount(0);
    // The stale row is dropped by the refetch.
    await expect(page.getByRole('button', { name: `Decline invite to E2E ${label}` })).toHaveCount(0, {
      timeout: 20_000,
    });
    expect(inviteStatus(inviteId)).toBe('cancelled');
  });
});

test.describe('owner sees the decline', () => {
  test('P2/P3/P4: Declined row, Invite again creates a new invite, Remove dismisses', async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const ownerAccount = await createScopedAccount('declined-owner');
    const owner = await ownerApi(request, ownerAccount);
    const circleId = await createCircle(owner, uniq('declined-owner'));
    const again = await createScopedAccount('declined-again');
    const removed = await createScopedAccount('declined-remove');
    const againId = await inviteTo(owner, circleId, again.email);
    const removeId = await inviteTo(owner, circleId, removed.email);
    for (const [acct, id] of [
      [again, againId],
      [removed, removeId],
    ] as const) {
      const r = await (await ownerApi(request, acct)).post(`/api/invites/${id}/decline`, {});
      expect(r.status(), await r.text()).toBe(200);
    }
    await cookieLogin(context, ownerAccount, baseURL);

    await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    const section = page.getByTestId('declined-invites-section');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.getByText('Declined invites')).toBeVisible();
    for (const email of [again.email, removed.email]) {
      await expect(section.getByText(email)).toBeVisible();
      await expect(section.getByRole('button', { name: `Invite again: ${email}` })).toBeVisible();
      await expect(section.getByRole('button', { name: `Remove declined invite for ${email}` })).toBeVisible();
      // No Resend / Copy link: a declined row has no actions menu, and is not pending.
      await expect(page.getByRole('button', { name: `Actions for invite to ${email}` })).toHaveCount(0);
    }
    await expect(section.getByText(/^Declined/).first()).toBeVisible();

    // P3: Invite again.
    const created = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/circles/${circleId}/invites` && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await section.getByRole('button', { name: `Invite again: ${again.email}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Invite again?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Invite again', exact: true }).click();
    expect((await created).status()).toBeLessThan(300);
    await expect(page.getByRole('button', { name: `Actions for invite to ${again.email}` })).toBeVisible({
      timeout: 20_000,
    });
    await expect(section.getByRole('button', { name: `Invite again: ${again.email}` })).toHaveCount(0, {
      timeout: 20_000,
    });
    expect(inviteStatus(againId)).toBe('declined');

    // P4: Remove.
    const deleted = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/invites/${removeId}` && r.request().method() === 'DELETE',
      { timeout: 20_000 }
    );
    await page.getByRole('button', { name: `Remove declined invite for ${removed.email}` }).click();
    expect((await deleted).status()).toBe(200);
    await expect(page.getByText('Declined invite removed.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('declined-invites-section')).toHaveCount(0, { timeout: 20_000 });
    expect(inviteStatus(removeId)).toBe('cancelled');
  });
});
