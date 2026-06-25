import { test, expect } from '../fixtures';

// Members flows — EMAIL invite UI.
//
// The invite modal is a simple email-required form: enter an email + role and
// "Send invite" emails the invitee a link to join.
//
// Test 1 — read + client-side validation (no mutation): opens the modal, types
//   an invalid email and asserts the inline validation error. Never submits a
//   valid invite (no real emails).
// Test 2 — REAL invite lifecycle (intentional mutation, self-cleaning): sends an
//   email invite to a unique throwaway address, asserts the pending row appears,
//   then CANCELS it. Create → cancel is net-zero, so the test repeats cleanly.

test('members list renders, invite-email validation shows inline error, then cancel', async ({
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

  // --- The email field + "Send invite" button ---
  const emailField = dialog.locator('#invite-email');
  await expect(emailField).toBeVisible();
  const sendBtn = dialog.getByRole('button', { name: 'Send invite' });
  // Disabled until an email is typed.
  await expect(sendBtn).toBeDisabled();

  // --- Validation only: type an invalid email, submit, expect an inline error.
  // (Never submit a valid invite — no real emails.) ---
  await emailField.fill('not-an-email');
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();

  await expect(dialog.getByText('Please enter a valid email address.')).toBeVisible({
    timeout: 20_000,
  });
  // The modal must stay open (the invalid submit was blocked client-side).
  await expect(dialog).toBeVisible();

  // --- Close without sending anything ---
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
});

test('send an email invite (real) then cancel the pending invite', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });

  // A unique throwaway address so the new pending row is uniquely targetable and
  // cannot collide with any pre-existing invite.
  const email = `e2e-invite-${Date.now()}@example.com`;

  // --- Send a real email invite (member_type defaults to caregiver). ---
  await page.getByRole('button', { name: 'Invite member' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#invite-email').fill(email);
  await dialog.getByRole('button', { name: 'Send invite' }).click();

  // Modal closes on success.
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- The pending invite now appears in the roster ---
  const cancelBtn = page.getByRole('button', { name: `Cancel invite for ${email}` });
  await expect(cancelBtn).toBeVisible({ timeout: 20_000 });

  // --- Cancel the newly-added invite (cleanup → net-zero). ---
  await cancelBtn.click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.getByRole('button', { name: 'Cancel invite' }).click();

  // --- Back to baseline: the row is gone. ---
  await expect(page.getByRole('button', { name: `Cancel invite for ${email}` })).toHaveCount(0, {
    timeout: 20_000,
  });
});
