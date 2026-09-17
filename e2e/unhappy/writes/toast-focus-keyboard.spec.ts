import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { failRequest } from '../../unhappy';
import { errorToast } from './_helpers';

// FOCUS AND KEYBOARD AROUND A TOAST RAISED INSIDE AN OPEN DIALOG.
//
//  - The toast region is ONE node for the page's whole life. Its placement is
//    pure CSS; remounting it would drop what a screen reader is tracking.
//  - A POINTER press on the toast's controls must not move focus at all
//    (Toast.tsx `keepFocus`): the user typing in a field clicks the toast's ×
//    and keeps typing.
//  - A KEYBOARD user reaches the toast's action (WCAG 2.1.1): the open dialog
//    appends the toast's controls to the end of its Tab cycle (Modal.tsx). The
//    live case is the premium gate's "Upgrade" raised by a 402 from a save
//    inside InviteMemberModal.

test.use({ persona: 'premiumOwner', viewport: { width: 1280, height: 720 } });
test.setTimeout(60_000);

const PENDING_EMAIL = 'pending.seat@example.com';
const PENDING_SEAT_COPY = `You've already used your invitation — the free spot is held by a pending invite to ${PENDING_EMAIL}.`;

async function openInvite(page: Page, circleId: string): Promise<{ dialog: Locator; save: Locator; email: Locator }> {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Invite a member' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const email = dialog.locator('#invite-email');
  await email.fill(`e2e-tfk-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`);
  return { dialog, save: dialog.getByRole('button', { name: 'Send invite', exact: true }), email };
}

async function raisePendingSeatGate(page: Page, save: Locator): Promise<Locator> {
  const injected = await failRequest(page, 'POST', '/api/circles/:id/invites', {
    status: 402,
    details: {
      reason: 'pending_invite_seat',
      blocking_invite: { id: '00000000-0000-4000-8000-00000000e2e1', invited_email: PENDING_EMAIL },
    },
    times: 1,
  });
  await save.click();
  await injected.expectHits(1);
  const toast = page.getByRole('status').filter({ hasText: PENDING_SEAT_COPY });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast.getByRole('button', { name: 'Upgrade', exact: true })).toBeVisible();
  return toast;
}

/** Where focus is: inside the dialog, inside the toast, or neither — plus a label. */
function focusState(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      inDialog: !!a?.closest('[role="dialog"]'),
      inToast: !!a?.closest('[data-toast-region]'),
      label: a ? a.getAttribute('aria-label') || (a.textContent ?? '').trim().slice(0, 30) || a.id || a.tagName : null,
      connected: !!a?.isConnected,
    };
  });
}

test('the toast region is the SAME node before, during and after a dialog — never remounted', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
  const handle = await page.locator('[data-toast-region]').elementHandle();
  expect(handle, 'the region is mounted before any toast').not.toBeNull();
  const token = `region-${Date.now()}`;
  await handle!.evaluate((node, t) => {
    (node as unknown as { __e2eMarker: string }).__e2eMarker = t;
  }, token);
  const sameNode = () =>
    handle!.evaluate(
      (node, t) =>
        node.isConnected &&
        (node as unknown as { __e2eMarker?: string }).__e2eMarker === t &&
        document.querySelectorAll('[data-toast-region]').length === 1 &&
        document.querySelector('[data-toast-region]') === node,
      token
    );

  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Invite a member' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#invite-email').fill(`e2e-tfk-${Date.now()}@example.com`);
  await failRequest(page, 'POST', '/api/circles/:id/invites', { status: 500, times: 1 });
  await dialog.getByRole('button', { name: 'Send invite', exact: true }).click();
  const toast = errorToast(page, 'Something went wrong. Please try again.');
  await expect(toast).toBeVisible({ timeout: 15_000 });
  expect(await sameNode(), 'same region while the dialog is open').toBe(true);
  expect(await handle!.evaluate((node) => node.querySelector('[role="alert"]') !== null), 'the toast is in THAT region').toBe(true);
  await toast.evaluate((el) => el.setAttribute('data-e2e-toast', 'kept'));

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await sameNode(), 'same region after the dialog closed').toBe(true);
  // The toast rode through the placement change on the same node too.
  await expect(page.locator('[data-toast-region] > [data-e2e-toast="kept"]')).toHaveCount(1);
});

test('clicking the toast × inside an open dialog leaves focus exactly where it was, and Escape still closes the dialog', async ({
  page,
  circleId,
}) => {
  const { dialog, save, email } = await openInvite(page, circleId);
  await failRequest(page, 'POST', '/api/circles/:id/invites', { status: 500, times: 1 });
  await save.click();
  const toast = errorToast(page, 'Something went wrong. Please try again.');
  await expect(toast).toBeVisible({ timeout: 15_000 });

  await email.focus();
  const typed = await email.inputValue();
  await toast.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(toast).toHaveCount(0, { timeout: 5_000 });

  // Not merely "back in the dialog" — the press never took focus off the field.
  await expect(email).toBeFocused();
  await page.keyboard.type('z');
  await expect(email).toHaveValue(`${typed}z`);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Tab from the dialog reaches the premium-gate "Upgrade" in the toast, holds it there, and Enter activates it', async ({
  page,
  circleId,
}) => {
  const { dialog, save, email } = await openInvite(page, circleId);
  const toast = await raisePendingSeatGate(page, save);
  await expect(dialog).toBeVisible();
  // Let the page finish reacting to the 402 BEFORE tabbing: it re-renders the
  // dialog with a cap notice and refetches the circle's access flags, and a
  // re-render landing mid-walk can move focus (and so restart the toast's
  // timer) — page behaviour, not the toast's.
  await expect(dialog.getByRole('button', { name: 'Upgrade', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);

  // The dialog's own LAST tabbable control, as the page has it now (the 402
  // also puts an in-dialog cap notice — with its own Upgrade link — on screen).
  const dialogLast = await dialog.evaluate((el) => {
    const all = Array.from(
      el.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    const last = all[all.length - 1];
    return last.getAttribute('aria-label') || (last.textContent ?? '').trim().slice(0, 30) || last.id || last.tagName;
  });

  await email.focus();
  const path: Array<Awaited<ReturnType<typeof focusState>>> = [];
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab');
    const state = await focusState(page);
    path.push(state);
    if (state.inToast && state.label === 'Upgrade') break;
  }
  const trail = path.map((s) => `${s.inDialog ? 'dialog' : s.inToast ? 'toast' : 'OUTSIDE'}:${s.label}`).join(' → ');
  // Every stop is inside the dialog or the toast: the trap still holds.
  expect(path.every((s) => s.inDialog || s.inToast), trail).toBe(true);
  // The toast is entered only after the dialog's own last control.
  const firstToastStop = path.findIndex((s) => s.inToast);
  expect(firstToastStop, trail).toBeGreaterThan(0);
  expect(path[firstToastStop - 1], trail).toMatchObject({ inDialog: true, label: dialogLast });
  expect(path[path.length - 1], trail).toMatchObject({ inToast: true, label: 'Upgrade' });
  await expect(toast, 'focus arrived on a live toast, not one already leaving').not.toHaveAttribute('data-leaving');

  // Focus holds the toast past its 5s auto-dismiss — it does not vanish mid-Tab.
  await page.waitForTimeout(5_600);
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Upgrade', exact: true })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/upgrade$/, { timeout: 15_000 });
  // The activated toast plays its 160ms exit and is removed; the dialog went
  // with the page. Focus must then be on a live node, not inside the region.
  await expect(page.locator('[data-toast-region] > [data-toast]')).toHaveCount(0, { timeout: 5_000 });
  const after = await focusState(page);
  expect(after, 'focus after the upgrade navigation').toMatchObject({ inToast: false, connected: true });
});

test('Shift+Tab walks back out of the toast, and closing it from the keyboard returns focus to where Tab entered', async ({
  page,
  circleId,
}) => {
  const { dialog, save } = await openInvite(page, circleId);
  const toast = await raisePendingSeatGate(page, save);

  await save.focus();
  await page.keyboard.press('Tab');
  expect(await focusState(page)).toMatchObject({ inToast: true });
  await page.keyboard.press('Shift+Tab');
  await expect(save, 'Shift+Tab out of the toast lands back on the control Tab left').toBeFocused();

  // Into the toast and on to its close button.
  await page.keyboard.press('Tab');
  const close = toast.getByRole('button', { name: 'Close', exact: true });
  for (let i = 0; i < 4 && !(await close.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0, { timeout: 5_000 });
  await expect(save, 'focus returns to the dialog control it came from').toBeFocused();

  // And the dialog still owns the keyboard.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
