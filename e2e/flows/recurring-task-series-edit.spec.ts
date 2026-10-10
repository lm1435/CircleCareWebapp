import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addDaysISO,
  assertChipAbsent,
  assertChipPresent,
  circleTimezone,
  closeDialog,
  dateInTz,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';
import { sqlStr } from '../db';
import { dbQuery } from '../unhappy';
import { apiCreateEvent } from '../unhappy/writes/_helpers';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// A RECURRING TASK IS EDITABLE FROM EVERY OCCURRENCE — COMPLETED ONES INCLUDED —
// AND THE EDIT NEVER REWRITES A COMPLETED OR PAST DAY (owner decision 2026-10-10).
//
// THE BUG. A recurring task's ROOT row is also its own start-date occurrence, so
// completing day one stamped the root's `completed_at` — and the clients' "a
// completed task is locked" gate then refused every edit of the whole series.
//
// THE CONTRACT this spec proves end to end (the vitest suites can only assert
// the request the client builds):
//   - Edit is offered on every occurrence of a recurring task; it edits the
//     SERIES (PATCH to the root), and the editor is hydrated from the ROOT, not
//     from the tapped occurrence's snapshot.
//   - The backend freezes a completed/past occurrence into its own row that
//     KEEPS its title and completion, so a series rename shows on upcoming days
//     only. Asserted from the DB, not just the UI.
//   - A completed ONE-OFF task stays locked: no Edit.
//
// Scoped owner + own circle (never the worker's account); dates in the care
// recipient's zone, not the runner's clock; run-unique titles; PHI-safe.
//
// REQUIRES the backend change that freezes the completed start-date occurrence
// (a series rename from the completed root otherwise renames day one too, and
// Scenario B's DB assertions fail — which is the point).

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A chip name match for exactly this title (the suffixes A/B/C never prefix each other). */
function titleMatch(title: string): RegExp {
  return new RegExp(`${escapeRegExp(title)}(?![\\w-])`);
}

interface SeriesRow {
  id: string;
  parent_event_id: string | null;
  scheduled_date: string;
  title: string;
  completed_at: string | null;
}

/** Every live row of the series (root + physical children), oldest first. */
function seriesRows(rootId: string): SeriesRow[] {
  return dbQuery<SeriesRow>(
    `select id::text as id, parent_event_id::text as parent_event_id,
            scheduled_date::text as scheduled_date, title, completed_at::text as completed_at
       from calendar_events
      where (id = ${sqlStr(rootId)}::uuid or parent_event_id = ${sqlStr(rootId)}::uuid)
        and removed_at is null
      order by scheduled_date, id`
  );
}

function rootRow(rootId: string): SeriesRow {
  const [row] = seriesRows(rootId).filter((r) => r.id === rootId);
  expect(row, 'the series root still exists').toBeTruthy();
  return row;
}

/**
 * Open the occurrence on `date`, pick Edit from its More menu, and return the
 * editor. Asserts the series note is shown and the title field holds
 * `expectedTitle` — the ROOT's current title, never the occurrence's snapshot.
 */
async function openSeriesEditor(
  page: Page,
  date: string,
  chipTitle: string,
  expectedTitle: string
) {
  const detail = await openChip(page, date, titleMatch(chipTitle));
  await detail.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit event', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await expect(editor).toBeVisible({ timeout: 10_000 });
  // Hydration gate: the form appears only once the root is resolved.
  await expect(editor.locator('#title')).toHaveValue(expectedTitle, { timeout: 15_000 });
  await expect(editor.getByTestId('series-edit-note')).toHaveText(
    'Changes apply to upcoming tasks. Completed and past ones stay as they were.'
  );
  return editor;
}

/** Rename the series from the open editor; returns the PATCH's target id and body. */
async function renameSeries(
  page: Page,
  editor: ReturnType<Page['getByRole']>,
  newTitle: string
): Promise<{ targetId: string; body: Record<string, unknown> }> {
  await editor.locator('#title').fill(newTitle);
  const patch = page.waitForRequest(
    (req) => req.method() === 'PATCH' && /\/api\/circles\/[^/]+\/events\/[^/?]+$/.test(new URL(req.url()).pathname)
  );
  const response = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && /\/api\/circles\/[^/]+\/events\//.test(res.url())
  );
  await editor.getByRole('button', { name: 'Save changes' }).click();
  const req = await patch;
  expect((await response).status(), 'the series edit is accepted').toBe(200);
  await expect(page.getByText('Series updated')).toBeVisible({ timeout: 20_000 });
  await expect(editor).toBeHidden({ timeout: 10_000 });
  const targetId = new URL(req.url()).pathname.split('/').pop() as string;
  return { targetId, body: (req.postDataJSON() ?? {}) as Record<string, unknown> };
}

test('a recurring task series is editable from an upcoming AND a completed occurrence; completed/past days keep their values', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const owner = await createScopedAccount('seriesedit');
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq('seriesedit'));
  const tz = await circleTimezone(api, circleId);
  const today = dateInTz(tz, 0);
  const at = (n: number) => addDaysISO(today, n);
  const base = `ZZ_E2E_SERIESEDIT_${uniqueSuffix()}`;
  const titleA = `${base}_A`; // the original
  const titleB = `${base}_B`; // renamed from tomorrow (Scenario A)
  const titleC = `${base}_C`; // renamed from today's COMPLETED occurrence (Scenario B)

  // A daily task series that STARTS TODAY: today's occurrence IS the root — the
  // exact shape of the bug.
  const root = await apiCreateEvent(api, circleId, {
    event_type: 'task',
    title: titleA,
    scheduled_date: today,
    recurrence_rule: 'daily',
  });

  await cookieLogin(context, owner, baseURL);

  // --- Complete TODAY's occurrence from the Calendar ---
  await gotoWeekContaining(page, circleId, today, today);
  const todayDetail = await openChip(page, today, titleMatch(titleA));
  await todayDetail.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('Marked complete')).toBeVisible({ timeout: 20_000 });
  await expect(todayDetail.getByRole('button', { name: 'Mark complete' })).toHaveCount(0, {
    timeout: 20_000,
  });
  // Completed — and a RECURRING task, so Edit is still on offer: Edit + Delete
  // keep the More menu (a locked one-off renders Delete inline, no menu).
  // Scenario B below opens Edit from this very occurrence.
  await expect(todayDetail.getByRole('button', { name: 'More', exact: true })).toBeVisible();
  await closeDialog(page);

  const completedToday = seriesRows(root.id).filter(
    (r) => r.scheduled_date === today && r.completed_at
  );
  expect(completedToday, 'exactly one row completed for today').toHaveLength(1);
  const completedAtBefore = completedToday[0].completed_at;

  // ========================= SCENARIO A =====================================
  // Edit the series from an UPCOMING, not-completed occurrence (tomorrow).
  await gotoWeekContaining(page, circleId, today, at(1));
  const editorA = await openSeriesEditor(page, at(1), titleA, titleA);
  const patchA = await renameSeries(page, editorA, titleB);
  expect(patchA.targetId, 'Scenario A PATCHes the series root').toBe(root.id);
  expect(patchA.body).not.toHaveProperty('completed_at');
  expect(patchA.body.title).toBe(titleB);

  // UI: tomorrow shows the new title.
  await gotoWeekContaining(page, circleId, today, at(1));
  await assertChipPresent(page, at(1), titleMatch(titleB));
  await assertChipAbsent(page, at(1), titleMatch(titleA));

  // DB: the series is renamed; today's COMPLETED row keeps A and its stamp.
  expect(rootRow(root.id).title, 'Scenario A: the series root is renamed').toBe(titleB);
  {
    // The day's RECORD is the frozen child (backend utils/seriesStartFreeze.ts).
    // The root is the series template: it keeps its own terminal stamp (so no
    // reminder re-arms) but every reader lets the child own this date.
    const todayRows = seriesRows(root.id).filter((r) => r.scheduled_date === today);
    const done = todayRows.filter((r) => r.completed_at && r.parent_event_id === root.id);
    expect(done, 'exactly one completed OCCURRENCE row for today').toHaveLength(1);
    expect(done[0].title, 'Scenario A: the completed day keeps its original title').toBe(titleA);
    expect(done[0].completed_at, 'Scenario A: the completion stamp is untouched').toBe(completedAtBefore);
  }

  // ========================= SCENARIO B =====================================
  // Edit the series from TODAY's COMPLETED occurrence.
  await gotoWeekContaining(page, circleId, today, today);
  // The completed day still READS as A; the editor hydrates from the ROOT (B).
  const editorB = await openSeriesEditor(page, today, titleA, titleB);
  const patchB = await renameSeries(page, editorB, titleC);
  expect(patchB.targetId, 'Scenario B PATCHes the series root, never the completed row').toBe(root.id);
  expect(patchB.body).not.toHaveProperty('completed_at');
  expect(patchB.body.title).toBe(titleC);

  // UI: today's completed occurrence still shows its ORIGINAL title...
  await gotoWeekContaining(page, circleId, today, today);
  await assertChipPresent(page, today, titleMatch(titleA));
  await assertChipAbsent(page, today, titleMatch(titleC));
  // ...and tomorrow shows the newest one.
  await gotoWeekContaining(page, circleId, today, at(1));
  await assertChipPresent(page, at(1), titleMatch(titleC));
  await assertChipAbsent(page, at(1), titleMatch(titleB));

  // DB: today's completed row keeps title A and the SAME completed_at; the
  // series (root) now carries C; no upcoming open row still carries A or B.
  {
    const rows = seriesRows(root.id);
    const done = rows.filter(
      (r) => r.scheduled_date === today && r.completed_at && r.parent_event_id === root.id
    );
    expect(done, 'Scenario B: still exactly one completed OCCURRENCE row for today').toHaveLength(1);
    expect(done[0].title, 'Scenario B: the completed day keeps its original title').toBe(titleA);
    expect(done[0].completed_at, 'Scenario B: the completion stamp is untouched').toBe(completedAtBefore);
    expect(rootRow(root.id).title, 'the series root carries the newest title').toBe(titleC);
    const staleUpcoming = rows.filter(
      (r) => r.scheduled_date > today && !r.completed_at && r.title !== titleC
    );
    expect(staleUpcoming, 'no upcoming open occurrence keeps an old title').toEqual([]);
  }
});

test('editing a recurring task series leaves PAST occurrences as they were', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const owner = await createScopedAccount('seriespast');
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq('seriespast'));
  const tz = await circleTimezone(api, circleId);
  const today = dateInTz(tz, 0);
  const at = (n: number) => addDaysISO(today, n);
  const base = `ZZ_E2E_SERIESPAST_${uniqueSuffix()}`;
  const oldTitle = `${base}_A`;
  const newTitle = `${base}_B`;

  // Started TWO DAYS AGO: the start-date occurrence is in the past.
  const root = await apiCreateEvent(api, circleId, {
    event_type: 'task',
    title: oldTitle,
    scheduled_date: at(-2),
    recurrence_rule: 'daily',
  });

  await cookieLogin(context, owner, baseURL);
  await gotoWeekContaining(page, circleId, today, at(1));
  const editor = await openSeriesEditor(page, at(1), oldTitle, oldTitle);
  const patch = await renameSeries(page, editor, newTitle);
  expect(patch.targetId).toBe(root.id);

  // DB: every row dated before today still carries the old title, and the
  // start-date day is still represented (frozen), not rewritten.
  // Occurrence rows only: the root is the series TEMPLATE (renamed); its own
  // start day was frozen into a child before the edit (seriesStartFreeze).
  const past = seriesRows(root.id).filter(
    (r) => r.scheduled_date < today && r.parent_event_id === root.id
  );
  expect(
    past.filter((r) => r.scheduled_date === at(-2)),
    'the past start-date occurrence is still on record'
  ).toHaveLength(1);
  expect(past.map((r) => r.title)).toEqual(past.map(() => oldTitle));

  // UI: the upcoming day shows the new title.
  await gotoWeekContaining(page, circleId, today, at(1));
  await assertChipPresent(page, at(1), titleMatch(newTitle));
});

test('a completed ONE-OFF task offers no Edit (the lock stays)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const owner = await createScopedAccount('singlelock');
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq('singlelock'));
  const tz = await circleTimezone(api, circleId);
  const today = dateInTz(tz, 0);
  const title = `ZZ_E2E_SINGLELOCK_${uniqueSuffix()}`;

  const single = await apiCreateEvent(api, circleId, {
    event_type: 'task',
    title,
    scheduled_date: today,
  });
  const done = await api.post(`/api/circles/${circleId}/events/${single.id}/complete`, {});
  expect(done.ok(), `complete one-off: ${await done.text()}`).toBe(true);

  await cookieLogin(context, owner, baseURL);
  await gotoWeekContaining(page, circleId, today, today);
  const detail = await openChip(page, today, titleMatch(title));
  // Edit is the only other secondary action a task has; with it hidden, Delete
  // renders inline and there is no More menu at all.
  await expect(detail.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
});
