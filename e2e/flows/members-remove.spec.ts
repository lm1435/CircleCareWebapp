import { test, expect } from '../fixtures';

// Member REMOVAL (destructive-then-restored, local testing-ground DB).
//
// Unlike invite+cancel (net-zero, in members.spec.ts), removing an accepted
// member can't be undone through the UI — re-adding needs an invite + accept,
// which requires a second authenticated account. So this test does that
// itself, via the API, in the SAME run: remove through the UI (the real path
// under test), then restore by re-inviting the removed email as the owner and
// accepting as that member — both real backend calls, no UI. Net-zero overall,
// so the spec stays repeatable without a reseed. Still SKIPS (rather than
// failing) if there's no removable member at all, and the restore step warns
// loudly instead of failing if the member's account can't sign back in — a
// failed restore must not make an otherwise-correct removal test red.
//
// Member actions live behind a per-row MoreMenu now (MembersPage.tsx), named
// "Actions for <name>" (manage.memberActionsLabel) — NOT a direct
// "Remove <name>" button. Pending-invite rows use the SAME MoreMenu pattern
// but are named "Actions for invite to <email>" (members.spec.ts /
// members-expired-invite.spec.ts drive those), so every lookup here excludes
// that prefix to stay scoped to MEMBER rows only.

const MEMBER_ACTIONS_NAME = /^Actions for (?!invite to )/;

// Local seeded accounts share this password (see e2e/fixtures.ts, e2e/README.md).
const SEED_PASSWORD = process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!';
const OWNER_EMAIL = process.env.PW_DEMO_EMAIL ?? 'demo@circlecare.app';

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

test('remove a non-owner circle member', async ({ page, circleId, baseURL }) => {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 15_000 });
  // Wait for the roster to actually render before counting — otherwise we'd
  // false-skip on an empty pre-load DOM.
  await expect(page.locator('ul li').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

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

  test.skip(removableName === null, 'no removable (non-owner) members left — reseed to replenish');
  const name = removableName as string;
  expect(name.length, 'parsed member name from actions-trigger label').toBeGreaterThan(0);

  // --- Read the removed member's email BEFORE removing them (API, owner
  // token) — the roster won't have their row to read it from afterward. ---
  const origin = baseURL ?? 'http://localhost:5173';
  const ownerToken = await loginForToken(page, origin, OWNER_EMAIL, SEED_PASSWORD);
  expect(ownerToken, 'owner API login (needed to read the email + later restore)').toBeTruthy();

  const circleRes = await page.request.get(`/api/circles/${circleId}`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  expect(circleRes.ok(), 'GET /api/circles/:id to read member emails').toBeTruthy();
  const circleBody = await circleRes.json();
  const apiMembers: ApiMember[] = circleBody?.data?.circle?.members ?? [];
  const matched = apiMembers.find(
    (m) => [m.first_name, m.last_name].filter(Boolean).join(' ').trim() === name
  );
  expect(matched, `API roster has a member named "${name}"`).toBeTruthy();
  const removedEmail = matched!.email;

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

  // --- Restore (net-zero): re-invite the removed email, accept as them. ---
  // A failed restore is a cleanup problem, not a test-under-test problem — it
  // must warn loudly, never fail this test, which has already proven removal
  // works.
  try {
    const inviteRes = await page.request.post(`/api/circles/${circleId}/invites`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { email: removedEmail, member_type: 'caregiver' },
    });
    if (!inviteRes.ok()) {
      console.warn(
        `[members-remove] restore SKIPPED: POST /invites for ${removedEmail} failed (${inviteRes.status()}). Reseed if this account is now permanently missing.`
      );
      return;
    }
    const inviteBody = await inviteRes.json();
    const inviteCode: string | undefined = inviteBody?.data?.invite?.invite_code;
    if (!inviteCode) {
      console.warn(
        `[members-remove] restore SKIPPED: invite response for ${removedEmail} carried no invite_code.`
      );
      return;
    }

    const memberToken = await loginForToken(page, origin, removedEmail, SEED_PASSWORD);
    if (!memberToken) {
      console.warn(
        `[members-remove] restore SKIPPED: could not sign in as ${removedEmail} (password rotated / account gone?). The circle keeps a live pending invite for them instead.`
      );
      return;
    }

    const acceptRes = await page.request.post(
      `/api/invites/code/${encodeURIComponent(inviteCode)}/accept`,
      { headers: { Authorization: `Bearer ${memberToken}` } }
    );
    if (!acceptRes.ok()) {
      console.warn(
        `[members-remove] restore SKIPPED: POST /invites/code/${inviteCode}/accept for ${removedEmail} failed (${acceptRes.status()}).`
      );
      return;
    }

    // --- Confirm the restore actually landed in the roster. ---
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  } catch (err) {
    console.warn(`[members-remove] restore SKIPPED after an unexpected error:`, err);
  }
});
