import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { sqlExec } from '../db';
import { checkA11y } from '../helpers';
import { apiSession, circleTimezone, dateInTz, escapeRegExp } from '../notesFirstClassShared';

// docs/plans/notes-first-class.md, Slice 3: the Notes page's MoodWeekStrip —
// 7 Sunday-first day cells for the CURRENT week, a dot per mood-having note
// (up to 3, then "+N"), a week summary counting NOTES (not days) in
// great→good→okay→tough order, accessible per-day names, click-to-scroll, and
// the `?date=` deep link (widen + scroll + clear). `note_date` cannot be
// backdated through the API (server-stamped), so every note here is seeded
// directly in the DB — the same shape the product itself writes.

const NOTE_MARKER = 'ZZ_E2E_MOODSTRIP_';

function longDateLabel(dateStr: string): string {
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(`${dateStr}T12:00:00Z`)
  );
}

function insertCareNote(
  circleId: string,
  authorId: string,
  noteDate: string,
  mood: 'great' | 'good' | 'okay' | 'tough' | null,
  body: string
): string {
  sqlExec(
    `insert into care_notes (circle_id, author_id, note_date, body, mood)
     values (${sqlStr(circleId)}, ${sqlStr(authorId)}, ${sqlStr(noteDate)}, ${sqlStr(body)}, ${mood ? sqlStr(mood) : 'NULL'})`
  );
  return dbQuery<{ id: string }>(
    `select id from care_notes where circle_id = ${sqlStr(circleId)} and note_date = ${sqlStr(noteDate)} and body = ${sqlStr(body)}`
  )[0].id;
}

async function gotoNotesSettled(page: import('@playwright/test').Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading notes')).toHaveCount(0, { timeout: 20_000 }).catch(() => {});
}

test.describe('Notes page: mood week strip', () => {
  test('two moods on one day, a mood-less note on another, summary + a11y labels, click-to-scroll', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
    const weekStart = new Date(new Date(`${today}T12:00:00Z`).getTime() - dow * 86_400_000)
      .toISOString()
      .slice(0, 10);
    function dayAt(offset: number): string {
      return new Date(new Date(`${weekStart}T12:00:00Z`).getTime() + offset * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    // Two DISTINCT offsets within [0, dow] — every day in that span is both
    // <= today (so `useCareNotes`'s default `[today-13, today]` window, which
    // never reaches a future `to`, actually fetches it) and inside the
    // CURRENT week the strip renders. Only when today is itself Sunday
    // (dow=0) is there exactly one such day, and both notes collapse onto it
    // — handled below rather than silently asserting the wrong thing.
    const candidateOffsets = [3, 2, 1, 0].filter((o) => o <= dow);
    const offsetTwoMoods = candidateOffsets[0] ?? 0;
    const offsetNoMood = candidateOffsets.find((o) => o !== offsetTwoMoods) ?? offsetTwoMoods;
    const dayTwoMoods = dayAt(offsetTwoMoods);
    const dayNoMood = dayAt(offsetNoMood);
    const daysCollapsed = dayTwoMoods === dayNoMood;

    const suffix = Date.now();
    const noteIds: string[] = [];
    try {
      noteIds.push(insertCareNote(circleId, account.userId, dayTwoMoods, 'good', `${NOTE_MARKER}good_${suffix}`));
      noteIds.push(insertCareNote(circleId, account.userId, dayTwoMoods, 'tough', `${NOTE_MARKER}tough_${suffix}`));
      noteIds.push(insertCareNote(circleId, account.userId, dayNoMood, null, `${NOTE_MARKER}nomood_${suffix}`));

      await gotoNotesSettled(page, circleId);

      const twoMoodLabel = longDateLabel(dayTwoMoods);

      const twoMoodCell = page.getByRole('button', {
        name: new RegExp(`^${escapeRegExp(twoMoodLabel)}: `),
      });
      await expect(twoMoodCell).toBeVisible({ timeout: 20_000 });
      await expect(twoMoodCell).toHaveAccessibleName(`${twoMoodLabel}: 1 good, 1 tough`);

      if (!daysCollapsed) {
        // The mood-less day's cell has NO summary suffix in its accessible name.
        const noMoodLabel = longDateLabel(dayNoMood);
        const noMoodCell = page.getByRole('button', { name: noMoodLabel, exact: true });
        await expect(noMoodCell).toBeVisible();
      }

      // Week summary counts NOTES, great→good→okay→tough order, only moods present.
      await expect(page.getByText('This week: 1 good, 1 tough')).toBeVisible();

      // New UI state: the mood week strip with dots + summary populated.
      await checkA11y(page, `/circles/${circleId}/notes`, testInfo);

      // Click a day with notes -> its group scrolls into view.
      await twoMoodCell.click();
      const group = page.locator(`#notes-day-${dayTwoMoods}`);
      await expect(group).toBeInViewport({ timeout: 10_000 });
    } finally {
      for (const id of noteIds) {
        await session.delete(`/api/circles/${circleId}/care-notes/${id}`).catch(() => {});
      }
    }
  });

  test('empty week shows "No moods logged this week"', async ({ page, secondCircleId }, testInfo) => {
    test.slow();
    await gotoNotesSettled(page, secondCircleId);
    await expect(page.getByText('No moods logged this week')).toBeVisible({ timeout: 20_000 });
    // 7 cells still render (never hidden).
    const grid = page.locator('.grid.grid-cols-7');
    await expect(grid.locator('button')).toHaveCount(7);
    // New UI state: the empty-week mood strip message.
    await checkA11y(page, `/circles/${secondCircleId}/notes`, testInfo);
  });

  test('?date= an older date within 92 days widens the window, scrolls, and clears the param', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const olderDate = new Date(new Date(`${today}T12:00:00Z`).getTime() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const body = `${NOTE_MARKER}older_${Date.now()}`;
    const noteId = insertCareNote(circleId, account.userId, olderDate, 'okay', body);

    try {
      await page.goto(`/circles/${circleId}/notes?date=${olderDate}`, { waitUntil: 'domcontentloaded' });
      const group = page.locator(`#notes-day-${olderDate}`);
      await expect(group).toBeVisible({ timeout: 20_000 });
      await expect(group).toContainText(body);

      // FIXED (evidenced 2026-09-27): `src/pages/NotesPage.tsx`'s deep-link
      // effect now also gates on `notesQuery.isPlaceholderData` — the widened
      // fetch's data (`useCareNotes`'s `placeholderData: keepPreviousData`,
      // `src/hooks/useCareNotes.ts`) can report `isLoading`/`isFetching` as
      // false for one render on the STALE (narrow-window) data before the
      // wider query registers, and the effect no longer trusts that render.
      // It now scrolls only once real, settled data containing the target
      // day lands.
      await expect(group).toBeInViewport({ timeout: 15_000 });
      await expect(page).not.toHaveURL(/[?&]date=/, { timeout: 15_000 });
    } finally {
      await session.delete(`/api/circles/${circleId}/care-notes/${noteId}`).catch(() => {});
    }
  });
});
