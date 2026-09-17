import { test, expect } from '../../fixtures';
import { countRequests, dbCount, sqlStr } from '../../unhappy';
import {
  UPGRADE_GATE_MESSAGE,
  circleNameOf,
  gotoCirclePage,
  loadSurfaceData,
  openAllCircles,
} from './_helpers';

// ===========================================================================
// FREE OWNER — the paywall gates, against the REAL backend refusals.
//
//   AI        the entry is rendered in its 'upgrade' state: pressing it raises
//             the upgrade prompt, never the chat, and no request reaches any
//             /ai/ endpoint (counted from before the page loads).
//   circles   creating a second circle on the free tier is a real 402; the app
//             shows the upgrade prompt and the database still holds ONE circle.
//   invites   the free caregiver cap (owner + 1) is a real 402; the modal keeps
//             the cap notice, never "Invitation sent", and no invite row exists.
//
// The same three flows succeed for the premium owner in
// `premiumOwner.controls.spec.ts`.
// ===========================================================================

test.use({ persona: 'freeOwner' });

test('AI entry raises the upgrade prompt, never the chat, and sends no AI request', async ({
  page,
  personaHandle: h,
}) => {
  const ai = countRequests(page, '*', '/api/circles/:id/ai/**');
  const data = loadSurfaceData(h);
  await gotoCirclePage(page, h.circleId, 'notes');
  await expect(page.getByText(data.careNoteBody!).first()).toBeVisible({ timeout: 20_000 });

  const assistant = page.getByRole('button', { name: 'Assistant', exact: true });
  await expect(assistant).toBeVisible();
  await assistant.click();

  await expect(page.getByText(UPGRADE_GATE_MESSAGE)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Care Assistant')).toHaveCount(0);
  await ai.expectCount(0);

  await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page).toHaveURL(/\/upgrade$/, { timeout: 15_000 });
  await ai.expectCount(0, { settleMs: 500 });
});

test('create circle at the free cap: real 402, the upgrade prompt, and still exactly one circle row', async ({
  page,
  personaHandle: h,
}) => {
  const name = `E2E cap probe ${Date.now()}`;
  const ownedLive = `select 1 from care_circles where owner_id = ${sqlStr(h.userId)}::uuid and archived_at is null`;
  expect(dbCount(ownedLive), 'free owner starts with one circle').toBe(1);

  await gotoCirclePage(page, h.circleId, '');
  await openAllCircles(page);
  await expect(page.getByRole('link', { name: new RegExp(`^Open ${circleNameOf(h.circleId)}`) })).toBeVisible();

  await page.getByRole('button', { name: 'Create circle' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('New care circle')).toBeVisible();
  await dialog.locator('#recipient_name').fill(name);

  const posts = countRequests(page, 'POST', '/api/circles');
  const refused = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/circles',
    { timeout: 20_000 }
  );
  await dialog.getByRole('button', { name: 'Create circle' }).click();
  const res = await refused;
  expect(res.status(), 'POST /api/circles on the free tier').toBe(402);

  await expect(page.getByText(UPGRADE_GATE_MESSAGE)).toBeVisible();
  await posts.expectCount(1);
  await expect(page).toHaveURL(/\/circles$/);
  expect(dbCount(ownedLive), 'no second circle was created').toBe(1);
  expect(
    dbCount(`select 1 from care_circles where recipient_name = ${sqlStr(name)}`),
    'no row carries the submitted name'
  ).toBe(0);

  await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page).toHaveURL(/\/upgrade$/, { timeout: 15_000 });
});

test('invite at the free caregiver cap: real 402, cap notice in the modal, no invite row', async ({
  page,
  personaHandle: h,
}) => {
  const email = `e2e-cap-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
  await gotoCirclePage(page, h.circleId, 'members');
  await expect(page.getByText(h.email).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Invite a member' })).toBeVisible();
  await dialog.locator('#invite-email').fill(email);

  const posts = countRequests(page, 'POST', '/api/circles/:id/invites');
  const refused = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/circles/${h.circleId}/invites`,
    { timeout: 20_000 }
  );
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  expect((await refused).status(), 'POST invites at the cap').toBe(402);

  await expect(dialog.getByRole('alert')).toContainText(
    'Free circles include up to two caregivers. Upgrade to Premium to add more.'
  );
  await expect(page.getByText(UPGRADE_GATE_MESSAGE)).toBeVisible();
  await expect(dialog.getByText('Invitation sent')).toHaveCount(0);
  await posts.expectCount(1);
  expect(
    dbCount(`select 1 from invites where circle_id = ${sqlStr(h.circleId)}::uuid and invited_email = ${sqlStr(email)}`),
    'no invite row'
  ).toBe(0);
});
