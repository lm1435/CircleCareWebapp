import { test, expect, uniqueLabel } from '../fixtures';
import type { Page } from '@playwright/test';
import { expandAllDayOverflow } from '../helpers';

// Global create flows. The authenticated shell (AppLayout + Sidebar) shows a
// moss "New" button that opens the `AddMenu` — a role="menu" of four
// role="menuitem" options (Medication, Appointment, Task, Note), gated by edit
// access. Each opens `AddEventModal` with the matching initialType, except Note,
// which navigates to the Notes page where the composer lives (spec §4.5, §5.2).
//
// The options are addressed by their VISIBLE short label ("Med", "Appt",
// "Task", "Note"), which is also their accessible name — a full-word aria-label
// over a short visible label fails WCAG 2.5.3. The full word is the `title`.
//
// Document upload and Invite member are NO LONGER create-menu options. Those
// flows now live on the pages that own their context and are covered there:
//   - document upload  -> e2e/flows/documents.spec.ts (Documents page Upload)
//   - invite a member  -> e2e/flows/members.spec.ts (Members page Invite)
//
// This suite exercises every remaining add path END-TO-END *through the menu*:
// open New → click the option → fill + submit the modal → verify the item
// persisted on its page → delete/cancel it (self-clean → net-zero). Each type is
// its own test() so a single failure is isolated and names the type.
//
// Conventions copied from calendar.spec.ts / vitals.spec.ts / careNotes.spec.ts:
// run-unique titles, getByRole queries, dialog-scoped lookups, generous
// backend-wait timeouts, and a self-cleaning delete. The desktop sidebar only
// renders at the xl breakpoint, so we widen the viewport safely above it.

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

/**
 * A dose time still ahead of "now" in the circle's timezone (America/Denver —
 * every seeded circle uses it, per medications.spec.ts), rounded UP to the
 * next quarter hour, so creating a medication with today's date doesn't trip
 * the "time already passed" path. Returns null when even a 2-hour cushion
 * would land at/after 23:00 — the caller falls back to a fixed time and
 * handles the "Starts with the next dose" branch explicitly instead.
 */
function futureDoseTimeToday(): string | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  // +2 hours, then round up to the next quarter hour.
  const rounded = Math.ceil((hour * 60 + minute + 120) / 15) * 15;
  if (rounded >= 23 * 60) return null;

  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The sidebar's create trigger. Scoped to `<aside>` because the FloatingNavBar
 * carries a "New" button too — CSS-hidden at this width, but scoping keeps the
 * query unambiguous regardless.
 */
function newTrigger(page: Page) {
  return page.locator('aside').getByRole('button', { name: 'New', exact: true });
}

/** Open the global create menu and click one of its options. */
async function openCreateOption(page: Page, name: string, exact = false): Promise<void> {
  const trigger = newTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
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
  // Heavy re-run traffic pushes many synthetic all-day Task/Appointment
  // events onto "today", which can push this run's chip past the week
  // view's per-day overflow cap (WeekView.tsx MAX_ALL_DAY_VISIBLE) — expand
  // any collapsed day before searching so the chip is actually queryable.
  await expandAllDayOverflow(page);
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
  // Edit/Discontinue/Delete live behind one "More" MoreMenu trigger now
  // (EventDetailActions.tsx spec §M2) whenever 2+ secondary actions apply —
  // true for every fresh (non-completed) event this suite creates.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const actionsMenu = page.getByRole('menu');
  await expect(actionsMenu).toBeVisible();
  await actionsMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(chip).toHaveCount(0, { timeout: 20_000 });
}

test('the create menu shows exactly the four create options', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  const trigger = newTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  // Mobile's four, in mobile's order, named by their visible short label.
  await expect(menu.getByRole('menuitem', { name: 'Med', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Appt', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Task', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Note', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(4);

  // Removed in Task 11 (spec §5.2) — see the file header for where each moved.
  await expect(menu.getByRole('menuitem', { name: 'Document' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Invite member' })).toHaveCount(0);
});

test('create a task end-to-end via the global create menu', async ({ page, circleId }) => {
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

test('create an appointment end-to-end via the global create menu', async ({ page, circleId }) => {
  const title = uniqueLabel('Appt');
  const titleRe = rx(title);

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- Create via the menu ---
  await openCreateOption(page, 'Appt', true);

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
  await expandAllDayOverflow(page);
  const chip = page.getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup) ---
  await openChipByTitle(page, titleRe);
  // Edit/Discontinue/Delete live behind one "More" MoreMenu trigger now
  // (EventDetailActions.tsx spec §M2).
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const actionsMenu = page.getByRole('menu');
  await expect(actionsMenu).toBeVisible();
  await actionsMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(chip).toHaveCount(0, { timeout: 20_000 });
});

test('create a medication end-to-end via the global create menu', async ({ page, circleId }) => {
  const title = uniqueLabel('Med');
  const titleRe = rx(title);

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  // --- Create via the menu ---
  await openCreateOption(page, 'Med', true);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#event_type')).toHaveValue('medication');

  // Medication requires name + date + time (time is mandatory for meds, unlike
  // tasks). Dosage is optional but we fill it for realism. A fixed time can be
  // ALREADY PAST by the time this runs, and saving a past time makes the
  // medication start with its NEXT dose (tomorrow) instead of today — on a
  // Saturday, tomorrow falls in the NEXT calendar week, so the chip lookup
  // below would search the wrong week entirely. Pick a time still ahead today
  // when the wall clock allows it; only fall back to a fixed time in the rare
  // near-midnight window `futureDoseTimeToday` refuses to touch.
  const doseTime = futureDoseTimeToday();
  await dialog.locator('#medication_name').fill(title);
  await dialog.locator('#medication_dosage').fill('1 tablet');
  await dialog.locator('#scheduled_date').fill(todayISO());
  await dialog.locator('#scheduled_time').fill(doseTime ?? '09:00');
  await dialog.getByRole('button', { name: 'Create' }).click();

  // Saving a med whose time already passed TODAY (in the circle's timezone)
  // interposes a non-blocking "Starts with the next dose" (create) or "Time
  // already passed" (edit) notice — Continue proceeds with the save. With a
  // future `doseTime` this should never fire; it's only expected in the
  // `doseTime === null` fallback.
  const pastNotice = page.getByRole('dialog', { name: /^(Time already passed|Starts with the next dose)$/ });
  const noticeShown = await pastNotice
    .waitFor({ state: 'visible', timeout: 2_500 })
    .then(() => true)
    .catch(() => false);
  if (noticeShown) await pastNotice.getByRole('button', { name: 'Continue' }).click();

  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- Verify on the calendar ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await expandAllDayOverflow(page);
  const chip = page.getByRole('button', { name: titleRe });
  if (noticeShown) {
    // The dose now starts tomorrow, not today. Tomorrow is usually still in
    // THIS week's grid, but not when today is the week's last day — try the
    // current week first, then advance once rather than assuming either way.
    const visibleThisWeek = await chip.first().isVisible().catch(() => false);
    if (!visibleThisWeek) {
      await page.getByRole('button', { name: 'Next week' }).click();
      await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
      await expandAllDayOverflow(page);
    }
  }
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup) ---
  await openChipByTitle(page, titleRe);
  // Edit/Discontinue/Delete live behind one "More" MoreMenu trigger now
  // (EventDetailActions.tsx spec §M2).
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const actionsMenu = page.getByRole('menu');
  await expect(actionsMenu).toBeVisible();
  await actionsMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(chip).toHaveCount(0, { timeout: 20_000 });
});

test('create a note end-to-end via the global create menu', async ({ page, circleId }) => {
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

  // Reload before touching row actions: the post is optimistic-then-confirmed
  // (NoteComposer posts, then the list refetches and swaps the optimistic row
  // for the server-confirmed one), so clicking the row's MoreMenu right after
  // `postBtn.click()` can race that swap — the trigger you resolved detaches
  // mid-click as the confirmed row remounts. A reload guarantees we're
  // interacting with the settled, server-confirmed row (careNotes.spec.ts
  // uses the same reload-before-row-actions pattern for its edit/delete).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(rx(body)).first()).toBeVisible({ timeout: 20_000 });

  // --- Delete (cleanup, same row-scoping + MoreMenu as careNotes.spec.ts) ---
  // Scoped to `li` ONLY: NoteRow.tsx's root is always `<Card as="li">`, and
  // including ancestor divs let the outer feed container win a `.last()`
  // tie-break, resolving to every row's trigger instead of one.
  // NoteRow.tsx's MoreMenu trigger is named per-author ("Actions for note by
  // <author>", notes.json row.actionsFor) — not the plain "More" every other
  // MoreMenu instance defaults to — so match that instead of an exact "More".
  const rowActions = /^Actions for note by /;
  const row = page
    .locator('li')
    .filter({ hasText: rx(body) })
    .filter({ has: page.getByRole('button', { name: rowActions }) })
    .last();
  await row.getByRole('button', { name: rowActions }).click();
  const rowMenu = page.getByRole('menu');
  await expect(rowMenu).toBeVisible();
  await rowMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(rx(body))).toHaveCount(0, { timeout: 20_000 });
});
