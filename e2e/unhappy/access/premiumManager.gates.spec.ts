import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { checkA11y } from '../../helpers';
import { apiSession, dbQuery, errorCodeOf, sqlStr } from '../../unhappy';
import { ensureManagerSwitchOn, waitForViewer } from '../../managerRole';

// ===========================================================================
// MANAGER — what a manager may and may NOT do (docs/plans/manager-role.md).
//
// Persona `premiumManager`: a caregiver whose membership is role 'manager' in a
// premium host's circle (Hana Host). The same circle has a second manager (Pia
// Peer), a plain caregiver (Cal Plain), the template's caregivers and the care
// recipient. The feature switch is turned on for the run (e2e/managerRole.ts).
//
// UI (Members page and the Home care team):
//   - Invite + the pending-invite list are offered;
//   - Remove is offered on plain caregivers ONLY — never the owner, never the
//     other manager, never the recipient, never yourself;
//   - nothing owner-only is offered: no medication reminders, no Make manager;
//   - at the seat cap (402) the manager is told to ask the owner and is never
//     shown an Upgrade action (owner-aware premium gates);
//   - a manager the server no longer recognises (empty viewer_permissions —
//     demoted, or the owner fell to free) gets the plain member UI.
// SERVER: each forbidden write is refused with the documented code and writes
// nothing.
// ===========================================================================

test.use({ persona: 'premiumManager', viewport: { width: 1440, height: 900 } });

const OWNER = 'Hana Host';
const PEER = 'Pia Peer';
const PLAIN = 'Cal Plain';
const SELF = 'Mara Manager';

const members = (page: Page) => page.getByRole('listitem');

test.beforeAll(async ({ request, personaHandle: h }) => {
  test.setTimeout(120_000);
  ensureManagerSwitchOn();
  await waitForViewer(request, h, h.circleId, (v) => v.viewer_role === 'manager');
  // One pending invite from the OWNER, so the list has a row the manager did
  // not create (managers may cancel/resend any invite, the owner's included).
  const owner = await apiSession(request, { email: h.ownerEmail, password: h.password });
  const pending = dbQuery<{ n: number }>(
    `select count(*)::int as n from invites where circle_id = ${sqlStr(h.circleId)}::uuid
       and invited_email = 'e2e-mgr-gate@example.com' and status = 'pending'`
  )[0].n;
  if (pending === 0) {
    const res = await owner.post(`/api/circles/${h.circleId}/invites`, { email: 'e2e-mgr-gate@example.com' });
    expect(res.status(), `owner invite: ${await res.text()}`).toBe(201);
  }
});

async function openMembers(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  // Anchored on rows rendered FROM the detail payload, so every absence check
  // below runs against the loaded roster and permissions.
  await expect(members(page).filter({ hasText: PLAIN })).toBeVisible({ timeout: 20_000 });
  await expect(members(page).filter({ hasText: OWNER })).toBeVisible();
}

test('Members: invite + pending list, Remove on plain caregivers only, nothing owner-only', async ({
  page,
  personaHandle: h,
}, testInfo) => {
  await openMembers(page, h.circleId);

  await expect(
    page.getByRole('button', { name: 'Invite member', exact: true }).filter({ visible: true })
  ).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Pending invites' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for invite to e2e-mgr-gate@example.com' })).toBeVisible();

  for (const name of [OWNER, PEER, SELF]) {
    await expect(page.getByRole('button', { name: `Actions for ${name}` }), name).toHaveCount(0);
  }
  // The care recipient's row: no trigger either.
  const [recipient] = dbQuery<{ name: string }>(`
    select concat_ws(' ', u.first_name, u.last_name) as name
      from circle_memberships m join users u on u.id = m.user_id
     where m.circle_id = ${sqlStr(h.circleId)}::uuid and m.is_care_recipient`);
  if (recipient) await expect(page.getByRole('button', { name: `Actions for ${recipient.name}` })).toHaveCount(0);

  // Managers are labelled.
  await expect(members(page).filter({ hasText: PEER }).getByText('Manager', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: `Actions for ${PLAIN}` }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Remove']);
  await checkA11y(page, `/circles/${h.circleId}/members (manager menu open)`, testInfo, { include: '[role="menu"]' });
  await page.keyboard.press('Escape');

  await expect(page.getByRole('menuitem', { name: /medication manager/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leave circle' })).toBeVisible();
  await checkA11y(page, `/circles/${h.circleId}/members (manager)`, testInfo);
});

test('Home care team: Invite + Remove on plain caregivers only', async ({ page, personaHandle: h }) => {
  await page.goto(`/circles/${h.circleId}`, { waitUntil: 'domcontentloaded' });
  const team = page.locator('section[aria-labelledby="care-team-heading"]');
  await expect(team.getByText(PLAIN)).toBeVisible({ timeout: 20_000 });
  await expect(team.getByRole('link', { name: 'Invite member' })).toBeVisible();
  await expect(team.getByRole('button', { name: `Remove ${PLAIN}` })).toBeVisible();
  for (const name of ['Hana', 'Pia', 'Mara']) {
    await expect(team.getByRole('button', { name: `Remove ${name}` }), name).toHaveCount(0);
  }
});

test('server refuses every out-of-bounds write, and writes nothing', async ({ request, personaHandle: h }) => {
  const api = await apiSession(request, h);
  const [peer] = dbQuery<{ id: string }>(`
    select m.user_id::text as id from circle_memberships m join users u on u.id = m.user_id
     where m.circle_id = ${sqlStr(h.circleId)}::uuid and u.first_name = 'Pia'`);
  const [plain] = dbQuery<{ id: string }>(`
    select m.user_id::text as id from circle_memberships m join users u on u.id = m.user_id
     where m.circle_id = ${sqlStr(h.circleId)}::uuid and u.first_name = 'Cal'`);
  const roster = () =>
    dbQuery<{ n: number }>(`select count(*)::int as n from circle_memberships where circle_id = ${sqlStr(h.circleId)}::uuid`)[0].n;
  const before = roster();

  const removeOwner = await api.delete(`/api/circles/${h.circleId}/members/${h.ownerUserId}`);
  expect(removeOwner.status()).toBe(403);
  expect(await errorCodeOf(removeOwner)).toBe('FORBIDDEN');

  const removePeer = await api.delete(`/api/circles/${h.circleId}/members/${peer.id}`);
  expect(removePeer.status()).toBe(403);
  expect(await errorCodeOf(removePeer)).toBe('FORBIDDEN');

  const removeSelf = await api.delete(`/api/circles/${h.circleId}/members/${h.userId}`);
  expect(removeSelf.status()).toBe(400);
  expect(await errorCodeOf(removeSelf)).toBe('INVALID_REQUEST');

  const promote = await api.patch(`/api/circles/${h.circleId}/members/${plain.id}/role`, { role: 'manager' });
  expect(promote.status()).toBe(403);
  expect(await errorCodeOf(promote)).toBe('FORBIDDEN');

  const meds = await api.put(`/api/circles/${h.circleId}/medication-responsible`, { userId: plain.id });
  expect(meds.status()).toBe(403);

  expect(roster()).toBe(before);
  expect(
    dbQuery<{ role: string }>(`select role from circle_memberships
      where circle_id = ${sqlStr(h.circleId)}::uuid and user_id = ${sqlStr(plain.id)}::uuid`)[0].role
  ).toBe('member');
});

test('at the seat cap a manager is told to ask the owner — never an Upgrade action', async ({
  page,
  personaHandle: h,
}) => {
  // The 402 is stubbed: a manager only reaches it through the seat race (a free
  // owner's manager is not a manager), which cannot be staged reliably.
  await page.route(`**/api/circles/${h.circleId}/invites`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'SUBSCRIPTION_REQUIRED', message: 'cap', details: { reason: 'members_full' } },
      }),
    });
  });
  await openMembers(page, h.circleId);
  await page.getByRole('button', { name: 'Invite member', exact: true }).filter({ visible: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Email address').fill('e2e-mgr-cap@example.com');
  await modal.getByRole('button', { name: 'Send invite' }).click();
  await expect(modal.getByRole('alert')).toHaveText(
    'Free circles include up to two caregivers. Only Hana, the circle owner, can upgrade to add more.'
  );
  // Toast: the owner-only notice, also with no action.
  await expect(page.getByText('This is a Premium feature for this circle. Only Hana, the circle owner, can upgrade.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upgrade' })).toHaveCount(0);
  expect(
    dbQuery<{ n: number }>(`select count(*)::int as n from invites where invited_email = 'e2e-mgr-cap@example.com'`)[0].n
  ).toBe(0);
});

test('a manager the server no longer recognises gets the plain member UI', async ({ page, personaHandle: h }) => {
  // Demotion (owner downgrade / removed as manager) reaches the client as an
  // EMPTY viewer_permissions; simulate exactly that payload.
  await page.route(`**/api/circles/${h.circleId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { data: { circle: Record<string, unknown> } };
    body.data.circle.viewer_permissions = [];
    body.data.circle.pending_invites = [];
    await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) });
  });
  await openMembers(page, h.circleId);
  await expect(page.getByRole('button', { name: 'Invite member', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pending invites' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
  await expect(page.getByText('Everyone helping coordinate care in this circle.')).toBeVisible();
});
