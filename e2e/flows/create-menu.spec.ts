import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, uniqueLabel } from '../fixtures';
import type { Page } from '@playwright/test';

// Global "Create" menu flows. The authenticated shell (AppLayout + Sidebar) shows
// a terracotta "Create" button that opens a role="menu" of role="menuitem"
// options (Appointment, Medication, Task, Note, Document, Invite member —
// gated by edit access / ownership; the demo account is the circle owner, so all
// six show). Each option opens the matching modal (AddEventModal with the right
// initialType, DocumentUploadModal, InviteMemberModal) — except Note, which
// navigates to the Notes page where the composer lives.
//
// This suite exercises EVERY add path END-TO-END *through the menu*: open the
// Create menu → click the option → fill + submit the modal → verify the item
// persisted on its page → delete/cancel it (self-clean → net-zero). Each type is
// its own test() so a single failure is isolated and names the type.
//
// Conventions copied from calendar.spec.ts / vitals.spec.ts / documents.spec.ts /
// members.spec.ts: run-unique titles + emails, getByRole queries, dialog-scoped
// lookups, generous backend-wait timeouts, and a self-cleaning delete. The
// desktop sidebar only renders at the xl breakpoint, so we widen the viewport to
// be safely above it.

test.use({ viewport: { width: 1440, height: 900 } });

function todayISO(): string {
  // Local date as YYYY-MM-DD; the created item lands in the current views.
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rx(value: string): RegExp {
  return new RegExp(escapeRegExp(value));
}

// Smallest valid one-page PDF — PHI-free placeholder bytes (from documents.spec).
const MINIMAL_PDF =
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF\n';

/** Open the global Create menu and click one of its options. */
async function openCreateOption(page: Page, name: string, exact = false): Promise<void> {
  const createBtn = page.getByRole('button', { name: 'Create', exact: true });
  await expect(createBtn).toBeVisible({ timeout: 15_000 });
  await createBtn.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name, exact }).click();
}

/**
 * Open a calendar chip's EventDetailModal via KEYBOARD activation (focus +
 * Enter), not a pointer click. Chips in the same time slot render stacked
 * (absolutely positioned, fully overlapping), and a chip scrolled to the top
 * edge of the grid sits under the sticky day-header row — either way a pointer
 * click on the right chip gets intercepted by the element painted above it and
 * Playwright retries until the test times out. Keyboard activation dispatches
 * to the target button directly (no hit-testing) and is the same accessible
 * path a keyboard user takes.
 */
async function openChipByTitle(page: Page, titleRe: RegExp): Promise<void> {
  const chip = page.getByRole('button', { name: titleRe }).first();
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
}

/**
 * Delete a calendar event by opening its chip → EventDetailModal → Delete →
 * confirm. Mirrors calendar.spec's cleanup path. Non-recurring → simple confirm.
 */
async function deleteCalendarEventByTitle(
  page: Page,
  circleId: string,
  titleRe: RegExp
): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  const chip = page.getByRole('button', { name: titleRe });
  await openChipByTitle(page, titleRe);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(chip).toHaveCount(0, { timeout: 20_000 });
}

test('Create menu shows every option for the circle owner', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  const createBtn = page.getByRole('button', { name: 'Create', exact: true });
  await expect(createBtn).toBeVisible({ timeout: 15_000 });
  await createBtn.click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  // All six options are present (owner sees create + invite).
  await expect(page.getByRole('menuitem', { name: 'Appointment' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Medication' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Task', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Note', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Document' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Invite member' })).toBeVisible();
});

test('create a task end-to-end via the global Create menu', async ({ page, circleId }) => {
  const title = uniqueLabel('Task');
  const titleRe = rx(title);

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- Create via the menu ('Task' needs exact to avoid collisions) ---
  await openCreateOption(page, 'Task', true);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The menu pre-selects 'task' as the event type.
  await expect(dialog.locator('#event_type')).toHaveValue('task');

  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(todayISO());
  // The modal's own Create button (scoped to the dialog, not the sidebar one).
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- Verify it was really created (Tasks page) ---
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `Edit "${title}"` })).toBeVisible({
    timeout: 20_000,
  });

  // --- Delete (cleanup) via the calendar's EventDetailModal ---
  await deleteCalendarEventByTitle(page, circleId, titleRe);
});

test('create an appointment end-to-end via the global Create menu', async ({ page, circleId }) => {
  const title = uniqueLabel('Appt');
  const titleRe = rx(title);

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- Create via the menu ---
  await openCreateOption(page, 'Appointment');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#event_type')).toHaveValue('appointment');

  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(todayISO());
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- Verify on the calendar ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  const chip = page.getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup) ---
  await openChipByTitle(page, titleRe);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(chip).toHaveCount(0, { timeout: 20_000 });
});

test('create a medication end-to-end via the global Create menu', async ({ page, circleId }) => {
  const title = uniqueLabel('Med');
  const titleRe = rx(title);

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- Create via the menu ---
  await openCreateOption(page, 'Medication');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#event_type')).toHaveValue('medication');

  // Medication requires name + date + time (time is mandatory for meds, unlike
  // tasks). Dosage is optional but we fill it for realism.
  await dialog.locator('#medication_name').fill(title);
  await dialog.locator('#medication_dosage').fill('1 tablet');
  await dialog.locator('#scheduled_date').fill(todayISO());
  await dialog.locator('#scheduled_time').fill('09:00');
  await dialog.getByRole('button', { name: 'Create' }).click();

  // Medication lifecycle: saving a med whose time already passed TODAY (in the
  // circle's timezone) interposes a non-blocking "Time already passed" notice —
  // Continue proceeds with the save. Whether it appears depends on the wall
  // clock at run time (09:00 fixed above), so continue through it when shown.
  const pastNotice = page.getByRole('dialog', { name: 'Time already passed' });
  const noticeShown = await pastNotice
    .waitFor({ state: 'visible', timeout: 2_500 })
    .then(() => true)
    .catch(() => false);
  if (noticeShown) await pastNotice.getByRole('button', { name: 'Continue' }).click();

  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- Verify on the calendar ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  const chip = page.getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup) ---
  await openChipByTitle(page, titleRe);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(chip).toHaveCount(0, { timeout: 20_000 });
});

test('create a note end-to-end via the global Create menu', async ({ page, circleId }) => {
  // Unlike the other options, 'Note' doesn't open a modal — it navigates to the
  // Notes page, where the composer lives (mirrors mobile's New-menu note entry).
  // Full note CRUD is covered by careNotes.spec.ts; this verifies the menu path
  // lands on a ready-to-use composer and a posted note persists.
  const body = uniqueLabel('MenuNote');

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- Navigate via the menu ---
  await openCreateOption(page, 'Note', true);
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notes$`), { timeout: 15_000 });

  // --- The composer is live: post a note ---
  const composer = page.getByLabel(/^Add a note/);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill(body);
  const postBtn = page.getByRole('button', { name: 'Post', exact: true });
  await expect(postBtn).toBeEnabled();
  await postBtn.click();
  await expect(page.getByText(rx(body)).first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup, same row-scoping as careNotes.spec.ts) ---
  const row = page
    .locator('li, article, div')
    .filter({ hasText: rx(body) })
    .filter({ has: page.getByRole('button', { name: 'Delete', exact: true }) })
    .last();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(rx(body))).toHaveCount(0, { timeout: 20_000 });
});

test('send an invite end-to-end via the global Create menu then cancel', async ({
  page,
  circleId,
}) => {
  // A unique throwaway address so the new pending row is uniquely targetable.
  const email = `e2e-menu-invite-${Date.now()}@example.com`;

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- Send a real email invite via the menu (member_type defaults to caregiver) ---
  await openCreateOption(page, 'Invite member');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('heading', { name: 'Invite a member' })).toBeVisible();
  await dialog.locator('#invite-email').fill(email);
  await dialog.getByRole('button', { name: 'Send invite' }).click();

  // Modal closes on success.
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- The pending invite now appears in the roster (Members page) ---
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
  const cancelBtn = page.getByRole('button', { name: `Cancel invite for ${email}` });
  await expect(cancelBtn).toBeVisible({ timeout: 20_000 });

  // --- Cancel the newly-added invite (cleanup → net-zero) ---
  await cancelBtn.click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.getByRole('button', { name: 'Cancel invite' }).click();
  await expect(page.getByRole('button', { name: `Cancel invite for ${email}` })).toHaveCount(0, {
    timeout: 20_000,
  });
});

test('upload a document end-to-end via the global Create menu', async ({ page, circleId }) => {
  const name = uniqueLabel('Doc');

  // A tiny real file for the <input type=file>. Only jpg/jpeg/png/heic/pdf are
  // accepted, so write a minimal valid PDF. PHI-free filler only.
  const dir = mkdtempSync(join(tmpdir(), 'e2e-menu-doc-'));
  const filePath = join(dir, `e2e-menu-doc-${Date.now()}.pdf`);
  writeFileSync(filePath, MINIMAL_PDF);

  try {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    // --- Upload via the menu ---
    await openCreateOption(page, 'Document');

    const uploadDialog = page.getByRole('dialog');
    await expect(uploadDialog).toBeVisible({ timeout: 15_000 });

    await uploadDialog.locator('input[type="file"]').setInputFiles(filePath);
    // setInputFiles pre-fills the Name from the file name; overwrite with ours.
    await uploadDialog.locator('#document-upload-label').fill(name);
    await uploadDialog.locator('#document-upload-category').selectOption('medical_records');
    await uploadDialog.getByRole('button', { name: 'Upload', exact: true }).click();

    // Uploads route through a live dev tunnel — be generous.
    await expect(uploadDialog).toBeHidden({ timeout: 30_000 });

    // --- Verify on the Documents page ---
    await page.goto(`/circles/${circleId}/documents`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(rx(name), { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });

    // --- Delete (cleanup) ---
    await page.getByRole('button', { name: rx(`Delete ${name}`) }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(rx(name), { exact: false })).toHaveCount(0, { timeout: 20_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
