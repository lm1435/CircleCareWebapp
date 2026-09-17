import { test, expect, uniqueLabel } from '../../fixtures';
import { apiSession, countRequests, dbCount, dbQuery, sqlStr } from '../../unhappy';
import {
  SURFACES,
  UPGRADE_GATE_MESSAGE,
  ensureControlRows,
  expectOffered,
  gotoCirclePage,
  openAllCircles,
} from './_helpers';

// ===========================================================================
// NEGATIVE CONTROLS — the premium owner, through the SAME flows the gated
// specs use, IS offered every control they assert away.
//
// Without this file an absence assertion in `viewOnlyMember.gates.spec.ts`,
// `frozenCircleOwner.gates.spec.ts` or `freeOwner.paywall.spec.ts` could pass
// because the page never renders that control for anybody (renamed label,
// moved menu, a surface that stopped loading). Each surface here runs the
// identical `open()` from `_helpers.ts` and requires every affordance to be
// visible and enabled.
//
// The premium clone carries no care note, vital or document, so
// `ensureControlRows` creates one of each through the API the first time a
// worker slot needs them.
// ===========================================================================

test.use({ persona: 'premiumOwner' });

for (const surface of SURFACES) {
  test(`${surface.name}: write affordances ARE offered to the premium owner (control)`, async ({
    page,
    request,
    personaHandle,
  }) => {
    const data = await ensureControlRows(request, personaHandle);
    const affordances = await surface.open(page, data);
    await expectOffered(affordances);
  });
}

test('AI entry opens the Care Assistant and talks to the AI API (control for freeOwner)', async ({
  page,
  circleId,
}) => {
  await gotoCirclePage(page, circleId, 'notes');
  const assistant = page.getByRole('button', { name: 'Assistant', exact: true });
  await expect(assistant).toBeVisible();

  const ai = countRequests(page, '*', '/api/circles/:id/ai/**');
  await assistant.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Care Assistant').first()).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByLabel('Your message', { exact: true })).toBeVisible();
  // The flow the free owner's "0 AI requests" is measured against really
  // does reach the AI API when the entry is available.
  await expect.poll(() => ai.count, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByText(UPGRADE_GATE_MESSAGE)).toHaveCount(0);
});

test('create circle is NOT paywalled for premium: the POST lands and a row is created (control)', async ({
  page,
  request,
  personaHandle: h,
}) => {
  const name = uniqueLabel('Ctl circle').slice(0, 90);
  const rowsNamed = `select id::text as id from care_circles where owner_id = ${sqlStr(h.userId)}::uuid
     and recipient_name = ${sqlStr(name)} and archived_at is null`;
  const api = await apiSession(request, h);
  try {
    await gotoCirclePage(page, h.circleId, '');
    await openAllCircles(page);
    await page.getByRole('button', { name: 'Create circle' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('New care circle')).toBeVisible();
    await dialog.locator('#recipient_name').fill(name);

    const posts = countRequests(page, 'POST', '/api/circles');
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/circles',
      { timeout: 20_000 }
    );
    await dialog.getByRole('button', { name: 'Create circle' }).click();
    expect((await created).status(), 'POST /api/circles for premium').toBe(201);
    await posts.expectCount(1);
    await expect(page).toHaveURL(/\/circles\/[0-9a-f-]{36}/, { timeout: 20_000 });
    expect(dbCount(rowsNamed), 'the circle row exists').toBe(1);
    await expect(page.getByText(UPGRADE_GATE_MESSAGE)).toHaveCount(0);
  } finally {
    for (const { id } of dbQuery<{ id: string }>(rowsNamed)) {
      await api.delete(`/api/circles/${id}`);
    }
  }
});

test('invite is sent for premium: no cap notice, and the invite row exists (control)', async ({
  page,
  request,
  personaHandle: h,
}) => {
  const email = `e2e-ctl-invite-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
  const rows = `select id::text as id from invites where circle_id = ${sqlStr(h.circleId)}::uuid
     and invited_email = ${sqlStr(email)}`;
  const api = await apiSession(request, h);
  try {
    await gotoCirclePage(page, h.circleId, 'members');
    await expect(page.getByText(h.email).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Invite member' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#invite-email').fill(email);

    const posts = countRequests(page, 'POST', '/api/circles/:id/invites');
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByText('Invitation sent')).toBeVisible({ timeout: 20_000 });
    await posts.expectCount(1);
    await expect(dialog.getByText(/Free circles include up to two caregivers/)).toHaveCount(0);
    expect(dbCount(rows), 'the invite row exists').toBe(1);
  } finally {
    for (const { id } of dbQuery<{ id: string }>(rows)) {
      await api.delete(`/api/invites/${id}`);
    }
  }
});
