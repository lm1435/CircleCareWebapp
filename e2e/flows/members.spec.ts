import { test, expect } from '../fixtures';

// Members flows.
//
// Test 1 — read + client-side validation (no mutation).
// Test 2 — REAL invite lifecycle (intentional mutation, self-cleaning): actually
// creates a pending invite in the DB and then cancels it. The invite goes to an
// @example.com address, which is in the backend's BLOCKED_DOMAINS — so the invite
// RECORD is created but NO real email is sent. Inviting → cancelling is net-zero,
// so the test stays repeatable.

test('members list renders, invite validation shows inline error, then cancel', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });

  // --- List renders: at least one member row visible ---
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
  const memberRows = page.locator('ul li');
  await expect(memberRows.first()).toBeVisible({ timeout: 20_000 });

  // --- Open the invite modal (owner-only CTA) ---
  await page.getByRole('button', { name: 'Invite member' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('heading', { name: 'Invite a member' })).toBeVisible();

  // --- Form renders ---
  const emailField = dialog.locator('#invite-email');
  await expect(emailField).toBeVisible();

  // --- Validation only: submit an invalid email, expect an inline error ---
  // (Never submit a valid invite — no real emails.)
  await emailField.fill('not-an-email');
  await dialog.getByRole('button', { name: 'Send invite' }).click();

  await expect(dialog.getByText('Please enter a valid email address.')).toBeVisible({
    timeout: 20_000,
  });
  // The modal must stay open (the invalid submit was blocked client-side).
  await expect(dialog).toBeVisible();

  // --- Cancel without sending anything ---
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
});

test('invite a member (real) then cancel the pending invite', async ({ page, circleId }) => {
  // @example.com is a BLOCKED_DOMAIN on the backend → the invite record is
  // created but no real email is sent. Unique address so repeat runs don't clash.
  const email = `e2e-invite-${Date.now()}@example.com`;

  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });

  // --- Send a real invite (member_type defaults to caregiver) ---
  await page.getByRole('button', { name: 'Invite member' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#invite-email').fill(email);
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- The pending invite now appears in the roster ---
  // Assert via the per-invite cancel button (unique) rather than getByText(email),
  // which would also match the "Invitation sent to <email>" toast.
  const cancelBtn = page.getByRole('button', { name: `Cancel invite for ${email}` });
  await expect(cancelBtn).toBeVisible({ timeout: 20_000 });

  // --- Cancel it (cleanup → net-zero) ---
  await cancelBtn.click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.getByRole('button', { name: 'Cancel invite' }).click();

  // The pending invite is gone.
  await expect(cancelBtn).toHaveCount(0, { timeout: 20_000 });
});
