import { test, expect } from '../../fixtures';
import { countRequests } from '../../unhappy';
import { gotoCirclePage } from './_helpers';

// ===========================================================================
// FREE OWNER — the invite seat PRE-CHECK when the free seat is held by a live
// PENDING invite (lib/inviteSeatPrecheck; mobile twin
// mobile/.maestro/flows/invite-seat-precheck.yaml).
//
// Real users (1.4.1 logs): two of three refused owners had sent invite #1 a
// minute or two earlier and were refused only after filling the form for #2.
// The backend counts active caregivers + live pending caregiver invites; the
// modal now does too, and names the invite holding the seat.
//
// The roster is reshaped on GET /circles/:id (owner alone + invites), because
// the freeOwner persona's seat is held by a MEMBER and a real pending invite
// cannot be created on a capped free circle. Staged invites:
//   live caregiver invite      -> takes the seat (named on the card)
//   expired caregiver invite   -> does NOT count
//   live care-recipient invite -> does NOT count
// Cancelling the live invite frees the seat: the form comes back.
// ===========================================================================

test.use({ persona: 'freeOwner' });

const DAY = 24 * 60 * 60 * 1000;
const HELD = 'e2e-held-seat@example.com';

test('pending invite holds the free seat: card before the form, Upgrade opens /upgrade', async ({
  page,
  personaHandle: h,
}) => {
  await stageRoster(page, h.circleId, h.userId);
  const posts = countRequests(page, 'POST', '/api/circles/:id/invites');
  await gotoCirclePage(page, h.circleId, 'members');
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog');
  const card = dialog.getByTestId('invite-cap-card');
  await expect(card).toContainText('Your free invitation is in use');
  await expect(card).toContainText(HELD);
  await expect(card).not.toContainText('e2e-expired@example.com');
  await expect(dialog.locator('#invite-email')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);

  await card.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page).toHaveURL(/\/upgrade$/, { timeout: 15_000 });
  await posts.expectCount(0, { settleMs: 500 });
});

test('a care-recipient invite is still offered while the caregiver seat is held', async ({
  page,
  personaHandle: h,
}) => {
  await stageRoster(page, h.circleId, h.userId);
  await gotoCirclePage(page, h.circleId, 'members');
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('invite-cap-card')).toBeVisible();
  await dialog.getByTestId('invite-role-recipient').click();
  await expect(dialog.getByTestId('invite-cap-card')).toHaveCount(0);
  await expect(dialog.locator('#invite-email')).toBeVisible();
});

test('cancelling the pending invite frees the seat: the form comes back', async ({
  page,
  personaHandle: h,
}) => {
  const state = await stageRoster(page, h.circleId, h.userId);
  await page.route('**/api/invites/inv-live', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    state.cancelled = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });
  await gotoCirclePage(page, h.circleId, 'members');
  await page.getByRole('button', { name: `Actions for invite to ${HELD}` }).click();
  await page.getByRole('menuitem', { name: 'Cancel invite' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel invite' }).click();
  await expect(page.getByText('Invitation canceled.')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Invite a member' });
  await expect(dialog.getByTestId('invite-cap-card')).toHaveCount(0);
  await expect(dialog.locator('#invite-email')).toBeVisible();
});

/**
 * Serve the real circle detail with the owner as the only caregiver and three
 * staged invites. Returns a handle: `cancelled = true` drops the live one, as
 * the refetch after DELETE /invites/:id would.
 */
async function stageRoster(
  page: import('@playwright/test').Page,
  circleId: string,
  ownerId: string
): Promise<{ cancelled: boolean }> {
  const state = { cancelled: false };
  await page.route(`**/api/circles/${circleId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as {
      data: { circle: { members: Array<{ id: string; is_care_recipient: boolean }>; pending_invites?: unknown[] } };
    };
    const c = body.data.circle;
    c.members = c.members.filter((m) => m.id === ownerId || m.is_care_recipient);
    const now = Date.now();
    const invites = [
      {
        id: 'inv-expired',
        invited_email: 'e2e-expired@example.com',
        created_at: new Date(now - 20 * DAY).toISOString(),
        expires_at: new Date(now - 13 * DAY).toISOString(),
        member_type: 'caregiver',
        is_expired: true,
      },
      {
        id: 'inv-recipient',
        invited_email: 'e2e-recipient@example.com',
        created_at: new Date(now - DAY).toISOString(),
        expires_at: new Date(now + 6 * DAY).toISOString(),
        member_type: 'care_recipient',
        is_expired: false,
      },
    ];
    if (!state.cancelled) {
      invites.push({
        id: 'inv-live',
        invited_email: HELD,
        created_at: new Date(now - 2 * 60 * 1000).toISOString(),
        expires_at: new Date(now + 7 * DAY).toISOString(),
        member_type: 'caregiver',
        is_expired: false,
      });
    }
    c.pending_invites = invites;
    await route.fulfill({ response: res, json: body });
  });
  return state;
}
