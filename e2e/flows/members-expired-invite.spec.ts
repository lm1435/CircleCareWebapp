import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Expired-invite flow — the "Expired" badge and the Resend action.
//
// WHY THIS IS PART-STUBBED
// ------------------------
// An invite lapses 7 days after it is created and there is no endpoint that can
// age one, so a freshly created invite can never be expired inside a test run.
// This spec therefore creates a REAL invite, then intercepts only the circle
// READ (GET /api/circles/:id) to flip that one invite's `is_expired` to true.
//
// Everything downstream of the read is real: the Resend click fires a genuine
// POST /api/invites/:id/resend against the backend and the response is asserted,
// and the cleanup CANCEL is a real DELETE. So the stub fakes the passage of time
// and nothing else.
//
// Net-zero: the invite created here is cancelled at the end, so the spec repeats
// cleanly. The address is @example.com, which the backend's BLOCKED_DOMAINS list
// short-circuits before Resend — no real email is sent.

// The stub stays registered for the whole test and is switched off with a flag
// rather than page.unroute(). unroute() races any handler already in flight and
// fails with "Route is already handled"; a flag has no such window. (It also
// sidesteps the trap that unroute() matches on the RegExp's source, so passing a
// separately-written literal silently removes nothing.)
const CIRCLE_DETAIL_ROUTE = /\/api\/circles\/[^/?]+(\?.*)?$/;

test('an expired invite shows the Expired badge and can be resent', async ({ page, circleId }) => {
  // Deliberately avoids the substring "expired" — an address containing it would
  // also match the badge's text locator below and trip strict mode.
  const email = `e2e-lapsed-${Date.now()}@example.com`;

  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });

  // --- Create a real invite ---
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#invite-email').fill(email);
  await dialog.getByRole('button', { name: 'Send invite' }).click();

  // The modal no longer auto-closes on success (InviteMemberModal.tsx): it
  // shows the "Invitation sent" share screen (copy/share the link) instead of
  // relying on email alone. Close it explicitly via the × once it appears.
  await expect(dialog.getByText('Invitation sent')).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // Resend/Cancel live behind one MoreMenu trigger per invite row now
  // (MembersPage.tsx), named "Actions for invite to <email>".
  const inviteActions = page.getByRole('button', { name: `Actions for invite to ${email}` });
  await expect(inviteActions).toBeVisible({ timeout: 20_000 });

  // While live, the row carries neither the badge nor a Resend menu item —
  // Resend is added to the menu only when the invite is expired.
  await inviteActions.click();
  const liveMenu = page.getByRole('menu');
  await expect(liveMenu).toBeVisible();
  await expect(liveMenu.getByRole('menuitem', { name: 'Resend', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(liveMenu).toBeHidden();

  // Flipped off in cleanup so the real (unexpired) row comes back.
  let ageingEnabled = true;

  try {
    // --- Age that one invite, and only that one ---
    // Anchored to /api/ so the SPA's own client-side routes are unaffected.
    let stubbed = 0;
    await page.route(CIRCLE_DETAIL_ROUTE, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const invites = body?.data?.circle?.pending_invites;
      if (ageingEnabled && Array.isArray(invites)) {
        for (const invite of invites) {
          if (invite.invited_email === email) {
            invite.is_expired = true;
            invite.expires_at = new Date(Date.now() - 3 * 864e5).toISOString();
            stubbed++;
          }
        }
      }
      // Fulfil explicitly rather than passing the original `response`: reusing
      // its headers alongside a rewritten body leaves content-length (and any
      // content-encoding) describing the ORIGINAL bytes, and the browser then
      // fails to parse what it receives.
      await route.fulfill({
        status: response.status(),
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

    // Wait on the circle-detail RESPONSE, not on the heading: the heading paints
    // before that query resolves, so asserting on `stubbed` right after it would
    // race the fetch and read 0 every time.
    const circleLoaded = page.waitForResponse(
      (res) => /\/api\/circles\/[^/?]+$/.test(res.url()) && res.request().method() === 'GET',
      { timeout: 20_000 }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await circleLoaded;
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
    // Fail loudly here rather than letting a silently-unmatched route surface as
    // a confusing "badge not visible" further down.
    expect(stubbed, 'the circle-detail stub never matched the created invite').toBeGreaterThan(0);

    // --- The badge and the Resend action appear ---
    const row = page.locator('li', { hasText: email });
    await expect(row.getByText('Expired', { exact: true })).toBeVisible({ timeout: 20_000 });

    await inviteActions.click();
    const expiredMenu = page.getByRole('menu');
    await expect(expiredMenu).toBeVisible();
    const resendItem = expiredMenu.getByRole('menuitem', { name: 'Resend', exact: true });
    await expect(resendItem).toBeVisible();

    // The page must still be clean for a screen reader with the new controls on it.
    await checkA11y(page, 'members-expired-invite', test.info());

    // --- Resend hits the real endpoint ---
    const resendResponse = page.waitForResponse(
      (res) => /\/api\/invites\/[^/]+\/resend$/.test(res.url()) && res.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await resendItem.click();
    const res = await resendResponse;
    expect(res.status()).toBe(200);

    const payload = await res.json();
    expect(payload.success).toBe(true);
    // The backend pushed the expiry back out into the future.
    expect(new Date(payload.data.invite.expires_at).getTime()).toBeGreaterThan(Date.now());
  } finally {
    // --- Cleanup: stop ageing so the real (unexpired) row returns, then cancel ---
    ageingEnabled = false;
    await page.reload({ waitUntil: 'domcontentloaded' });

    const cleanupBtn = page.getByRole('button', { name: `Actions for invite to ${email}` });
    await expect(cleanupBtn).toBeVisible({ timeout: 20_000 });
    await cleanupBtn.click();
    const cleanupMenu = page.getByRole('menu');
    await expect(cleanupMenu).toBeVisible();
    await cleanupMenu.getByRole('menuitem', { name: 'Cancel invite', exact: true }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await confirm.getByRole('button', { name: 'Cancel invite', exact: true }).click();
    await expect(
      page.getByRole('button', { name: `Actions for invite to ${email}` })
    ).toHaveCount(0, {
      timeout: 20_000,
    });
  }
});
