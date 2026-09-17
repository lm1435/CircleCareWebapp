import type { Locator } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { expandAllDayOverflow } from '../helpers';

// COMPLETING ONE OCCURRENCE OF A RECURRING TASK STAMPS THAT DAY, NOT DAY ONE.
//
// `completed_at` lives on a ROW, and one row is one occurrence. A recurring
// series' later occurrences are VIRTUAL — the backend synthesises them with a
// composite id (`${parentId}_${date}`) that matches no `id` column — so the
// only addressable form they have is the series ROOT plus the occurrence's
// date. Post the root with no date and the server stamps the series' FIRST
// day: in production that mis-stamped 14 series across 7 households, leaving
// the tapped day open and an earlier one silently "done".
//
// This is the only test in the suite that can prove the right ROW was written:
// the vitest tests assert the request the client builds, and a mock will agree
// with whatever the server would have done with it. Here the completion goes
// to the real backend, and the proof is read back out of a server-backed query
// (the Tasks page's Completed filter) as the DUE DATE of the row that got
// stamped.
//
// Run-unique title; self-cleaning (the series is deleted from its own first
// occurrence with "this and future"); PHI-safe.

/** Local date + `offset` days, as YYYY-MM-DD. */
function isoDate(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * The due label TaskRow prints for a date that is neither today nor yesterday —
 * `Intl` on the naive date anchored at noon UTC, exactly as TaskRow builds it.
 */
function dueDateLabel(date: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reveal every all-day chip in ONE day column.
 *
 * `expandAllDayOverflow` matches only the PLURAL label ("N more all-day
 * events"), and a day hiding exactly one chip is labelled "1 more all-day
 * event on 8 Tue" — the common case for a fresh daily series, and the reason
 * the chip lookup below was intermittently empty.
 */
async function expandDay(cell: Locator): Promise<void> {
  const overflow = cell.getByRole('button', { name: /more all-day event/i });
  if ((await overflow.count()) > 0) await overflow.first().click();
}

test('completing a later occurrence of a recurring task stamps THAT day, not the series start', async ({
  page,
  circleId,
}) => {
  const title = uniqueLabel('Recurring');
  const startDate = isoDate(0);
  // TWO days out, not one: `getRelativeDateLabel` collapses today/yesterday
  // into words, and the care recipient's timezone can be a day off the
  // runner's. At +2 the row can only ever print the formatted date, so the
  // assertion below cannot be satisfied by the wrong row wearing a relative
  // label.
  const occurrenceDate = isoDate(2);

  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });

  // --- Create a DAILY series starting today ---
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(startDate);
  await dialog.locator('#recurrence_rule').selectOption('daily');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // --- Complete the occurrence two days out, from the calendar ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  // The week view is anchored on today, so +2 can fall into next week. Page
  // forward when the day is not on screen rather than assuming it is.
  let dayCell = page.locator(`[data-date="${occurrenceDate}"]`).first();
  if ((await page.locator(`[data-date="${occurrenceDate}"]`).count()) === 0) {
    await page.getByRole('button', { name: 'Next week' }).click();
    dayCell = page.locator(`[data-date="${occurrenceDate}"]`).first();
  }
  await expect(dayCell).toBeAttached({ timeout: 15_000 });

  // Task chips are all-day; heavy re-run traffic can push ours past the week
  // view's per-day overflow cap.
  await expandAllDayOverflow(page);
  await expandDay(dayCell);

  const titleRe = new RegExp(escapeRegExp(title));
  const occurrenceChip = dayCell.getByRole('button', { name: titleRe }).first();
  await expect(occurrenceChip).toBeVisible({ timeout: 20_000 });
  await occurrenceChip.click();

  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Mark complete' }).click();
  // The completion is a plain POST with no undo window on this surface, so the
  // toast is the commit signal.
  await expect(page.getByText('Marked complete')).toBeVisible({ timeout: 20_000 });

  // --- THE OPEN MODAL MUST SHOW IT, WITHOUT A CLOSE/REOPEN ---
  // The detail modal renders from a SNAPSHOT the page set when the chip was
  // clicked. The write always landed (the section below proves the right row
  // got stamped), but until the snapshot was restamped the dialog still said
  // nothing about completion and still offered Mark complete — a working fix
  // that reads as broken, and an invitation to click it a second time.
  //
  // Deliberately asserted on the SAME `detail` locator, with no reload and no
  // close in between. This is also the only place the VIRTUAL path is checked
  // against a real server: the occurrence completed above may have had no
  // physical row at all, in which case the response carries a row the client
  // has never seen — the only thing that can refresh this dialog.
  await expect(detail.getByText(/^Completed (on|by)$/)).toBeVisible({ timeout: 20_000 });
  await expect(detail.getByRole('button', { name: 'Mark complete' })).toHaveCount(0);

  // --- WHICH ROW GOT STAMPED? ---
  // The Completed filter is a server-backed read of PHYSICAL rows. The stamped
  // row's own due date is printed in its accessible name, so this says which
  // occurrence the server wrote — not merely that something completed.
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Status:/ }).click();
  const statusMenu = page.getByRole('menu');
  await expect(statusMenu).toBeVisible({ timeout: 10_000 });
  await statusMenu.getByRole('menuitem', { name: 'Completed', exact: true }).click();

  const completedRow = page.getByRole('button', {
    name: new RegExp(`View details for "${escapeRegExp(title)}"`),
  });
  await expect(completedRow.first()).toBeVisible({ timeout: 25_000 });
  // THE ASSERTION. The stamped row is dated the day that was clicked. Stamping
  // the series root instead prints the START date here, which is the bug.
  await expect(completedRow.first()).toHaveAccessibleName(
    new RegExp(escapeRegExp(dueDateLabel(occurrenceDate)))
  );
  await expect(completedRow.first()).not.toHaveAccessibleName(/Today/);
  // Exactly one occurrence was completed — the click did not stamp two rows.
  await expect(completedRow).toHaveCount(1);

  // --- Delete the whole series (cleanup) ---
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await expandAllDayOverflow(page);
  const startCell = page.locator(`[data-date="${startDate}"]`).first();
  await expandDay(startCell);
  await startCell.getByRole('button', { name: titleRe }).first().click();
  const detailForDelete = page.getByRole('dialog');
  await expect(detailForDelete).toBeVisible();
  // An OPEN task keeps Edit, so Edit + Delete overflow into the More menu (a
  // completed task's solo Delete renders inline instead — which is why
  // tasks.spec.ts can click Delete directly and this cannot). Scoped to the
  // dialog and `exact`: the week view's all-day overflow toggle behind it is
  // also named "…more all-day event…".
  await detailForDelete.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  // Recurring → a scope picker. "This and future events" from the FIRST
  // occurrence removes the root and every child, including the one completed
  // above, so the run leaves nothing behind.
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('radio', { name: /future/i }).check();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.locator(`[data-date="${startDate}"]`).getByRole('button', { name: titleRe })).toHaveCount(
    0,
    { timeout: 20_000 }
  );
});
