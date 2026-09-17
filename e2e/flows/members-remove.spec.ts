import { test, expect } from '../fixtures';

// Member REMOVAL (destructive, local testing-ground DB).
//
// Removal is driven through the UI (the real path under test) and then
// confirmed on the SERVER: the removed member is gone from GET /circles/:id,
// not just from the rendered roster.
//
// There is deliberately NO restore step any more. One used to re-invite the
// removed e-mail and accept as that member so the shared demo account stayed
// net-zero — but it wrapped its only assertion in try/catch with early returns,
// so it could never fail, and since per-worker isolation it has had no job:
// this runs against THIS WORKER's cloned circle, which globalTeardown deletes
// wholesale. An assertion that cannot fail, guarding cleanup nobody needs, was
// removed rather than kept as noise.
//
// Nor does it skip when no member is removable. The clone always carries the
// demo template's satellite members, so "nothing to remove" now means the
// clone or the roster is broken — a failure, not a reason to go quiet.
//
// Member actions live behind a per-row MoreMenu now (MembersPage.tsx), named
// "Actions for <name>" (manage.memberActionsLabel) — NOT a direct
// "Remove <name>" button. Pending-invite rows use the SAME MoreMenu pattern
// but are named "Actions for invite to <email>" (members.spec.ts /
// members-expired-invite.spec.ts drive those), so every lookup here excludes
// that prefix to stay scoped to MEMBER rows only.

const MEMBER_ACTIONS_NAME = /^Actions for (?!invite to )/;

interface ApiMember {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

/**
 * A FRESH login (not the shared storageState) for a plain bearer token.
 * fixtures.ts documents why: the web's single-use refresh-token rotation
 * invalidates a shared cookie session once any context refreshes, so reusing
 * stored auth here would be exactly the flakiness that file works around —
 * a fresh login is a fast, independent, unrotated session every time.
 */
async function loginForToken(
  page: import('@playwright/test').Page,
  baseURL: string,
  email: string,
  password: string
): Promise<string | null> {
  const res = await page.request.post('/api/auth/login', {
    headers: { Origin: baseURL },
    data: { email, password },
  });
  if (!res.ok()) return null;
  const body = await res.json();
  return body?.data?.session?.access_token ?? null;
}

async function apiMembers(
  page: import('@playwright/test').Page,
  circleId: string,
  token: string
): Promise<ApiMember[]> {
  const res = await page.request.get(`/api/circles/${circleId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `GET /api/circles/:id returned ${res.status()}`).toBeTruthy();
  return ((await res.json())?.data?.circle?.members ?? []) as ApiMember[];
}

test('remove a non-owner circle member', async ({ page, circleId, baseURL, account }) => {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 15_000 });
  // Wait for the roster to actually render before counting — otherwise the
  // count below would read an empty pre-load DOM.
  await expect(page.locator('ul li').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: MEMBER_ACTIONS_NAME }).first()).toBeVisible({
    timeout: 15_000,
  });

  // A member row only carries an actions trigger when the owner can manage
  // that member (MembersPage.tsx `canManage`: not the owner, not the care
  // recipient, not yourself) — and every managed row's menu unconditionally
  // includes Remove alongside the med-responsible toggle. Still confirm by
  // opening each menu and inspecting it (rather than trusting trigger
  // presence alone), so this spec keeps working if that invariant ever
  // changes — open, inspect, Escape, per row.
  const triggers = page.getByRole('button', { name: MEMBER_ACTIONS_NAME });
  const triggerCount = await triggers.count();

  let removableName: string | null = null;
  for (let i = 0; i < triggerCount; i++) {
    const trigger = triggers.nth(i);
    const triggerLabel = (await trigger.getAttribute('aria-label')) ?? '';
    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    const hasRemove =
      (await menu.getByRole('menuitem', { name: 'Remove', exact: true }).count()) > 0;
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden({ timeout: 10_000 });
    if (hasRemove) {
      removableName = triggerLabel.replace(/^Actions for /, '');
      break;
    }
  }

  expect(
    removableName,
    'the cloned circle has a removable (non-owner, non-recipient) member'
  ).not.toBeNull();
  const name = removableName as string;
  expect(name.length, 'parsed member name from actions-trigger label').toBeGreaterThan(0);

  // --- Identify the member on the SERVER before removing them (the roster
  // won't have their row to read afterwards). ---
  const origin = baseURL ?? 'http://localhost:5173';
  const ownerToken = await loginForToken(page, origin, account.email, account.password);
  expect(ownerToken, 'owner API login').toBeTruthy();

  const before = await apiMembers(page, circleId, ownerToken!);
  const matched = before.find(
    (m) => [m.first_name, m.last_name].filter(Boolean).join(' ').trim() === name
  );
  expect(matched, `API roster has a member named "${name}"`).toBeTruthy();

  // --- Remove → confirm ---
  const memberTrigger = page.getByRole('button', { name: `Actions for ${name}`, exact: true });
  await memberTrigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await menu.getByRole('menuitem', { name: 'Remove', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole('heading', { name: 'Remove member?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();

  // That member's row (and its actions trigger) is gone; the roster still
  // renders (the owner remains).
  await expect(
    page.getByRole('button', { name: `Actions for ${name}`, exact: true })
  ).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('ul li').first()).toBeVisible({ timeout: 10_000 });

  // --- And the server agrees: exactly that member left, nobody else did. ---
  const after = await apiMembers(page, circleId, ownerToken!);
  expect(after.map((m) => m.id), 'removed member is gone from GET /circles/:id').not.toContain(
    matched!.id
  );
  expect(after.length, 'exactly one member was removed').toBe(before.length - 1);
});
