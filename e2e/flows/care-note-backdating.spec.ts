import { test, expect } from '../fixtures';
import { openNoteComposer } from '../helpers';
import { apiSession, type ApiSession } from '../unhappy';
import { addDaysISO, circleTimezone, dateInTz, escapeRegExp, uniqueSuffix } from '../notesFirstClassShared';

// docs/plans/care-note-backdating.md — end-to-end proof, against the real
// backend, that
//   1. the Notes composer's Date row backdates a note: pick a past day, Post, and
//      the note lands under THAT day's heading (and survives a reload); the
//      picker is capped at the care recipient's "today"; "Reset to today" returns
//      to today;
//   2. "Show older notes" reaches history past the old 92-day ceiling, repeatably,
//      and ends with "No older notes".
// "Today" is the circle's recipient timezone (read from the API), never the
// browser's. Synthetic content only; every note is deleted in `finally`.

const PREFIX = 'ZZ_E2E_BACKDATE_';

async function createNoteVia(session: ApiSession, circleId: string, body: string, noteDate: string): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/care-notes`, { body, note_date: noteDate });
  expect(res.status(), `POST care-notes ${noteDate}`).toBe(201);
  return ((await res.json()) as { data: { note: { id: string } } }).data.note.id;
}

test.describe('care note backdating', () => {
  test('Date row: backdate a note and see it under its own day; picker is capped at today; reset works', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const past = addDaysISO(today, -5);
    const body = `${PREFIX}${uniqueSuffix()}`;
    const bodyRe = new RegExp(escapeRegExp(body));
    let createdId: string | null = null;

    try {
      await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
      await openNoteComposer(page);
      const dateInput = page.getByLabel(/^Date/);
      await expect(dateInput).toBeVisible({ timeout: 20_000 });

      // Default Today; the picker cannot go past the recipient-timezone today.
      await expect(dateInput).toHaveValue(today);
      await expect(dateInput).toHaveAttribute('max', today);
      await expect(page.getByRole('button', { name: 'Reset to today' })).toHaveCount(0);

      // Past day shows Reset; Reset returns to today.
      await dateInput.fill(past);
      await expect(dateInput).toHaveValue(past);
      await page.getByRole('button', { name: 'Reset to today' }).click();
      await expect(dateInput).toHaveValue(today);

      // Backdate and post.
      await dateInput.fill(past);
      await page.getByRole('textbox', { name: /^Add a note/ }).fill(body); // the composer is open: opened above
      const posted = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/circles/${circleId}/care-notes`
      );
      await page.getByRole('button', { name: 'Post', exact: true }).click();
      const res = await posted;
      expect(res.status()).toBe(201);
      expect(res.request().postDataJSON()).toMatchObject({ body, note_date: past });
      createdId = ((await res.json()) as { data: { note: { id: string } } }).data.note.id;

      // Under the heading for THAT day, not today's; and persisted.
      const group = page.locator(`#notes-day-${past}`);
      await expect(group.getByText(bodyRe)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(`#notes-day-${today}`).getByText(bodyRe)).toHaveCount(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`#notes-day-${past}`).getByText(bodyRe)).toBeVisible({ timeout: 20_000 });
    } finally {
      if (createdId) await session.delete(`/api/circles/${circleId}/care-notes/${createdId}`);
    }
  });

  test('Show older notes reaches history past 92 days, repeatably, then says "No older notes"', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const old = addDaysISO(today, -150); // second 92-day page: 92..183 days back
    const body = `${PREFIX}OLD_${uniqueSuffix()}`;
    const bodyRe = new RegExp(escapeRegExp(body));
    const id = await createNoteVia(session, circleId, body, old);

    try {
      await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('note-composer-expand')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(bodyRe)).toHaveCount(0);

      const showOlder = page.getByTestId('notes-show-older');
      const noOlder = page.getByTestId('notes-no-older');
      // ONE press is always a visible result (owner, 1.4.1 (5)): the base window widens straight
      // to 92 days and, when that holds nothing older, the first older page (92..183 days back,
      // where this note lives) loads in the same press. Either way more day groups show.
      const dayGroups = page.locator('section[id^="notes-day-"]');
      const groupsBefore = await dayGroups.count();
      await showOlder.click();
      await expect.poll(() => dayGroups.count(), { timeout: 20_000 }).toBeGreaterThan(groupsBefore);
      // Then whole 92-day pages until the end: never a dead end.
      for (let i = 0; i < 20 && !(await noOlder.isVisible()); i++) {
        await showOlder.click();
        await expect(showOlder.or(noOlder)).toBeVisible({ timeout: 20_000 });
        await expect(showOlder).toBeEnabled({ timeout: 20_000 }).catch(() => undefined);
      }
      await expect(noOlder).toHaveText('No older notes', { timeout: 20_000 });
      await expect(showOlder).toHaveCount(0);
      await expect(page.locator(`#notes-day-${old}`).getByText(bodyRe)).toBeVisible();
    } finally {
      await session.delete(`/api/circles/${circleId}/care-notes/${id}`);
    }
  });
  // Owner decision 2026-11-09: the backend's additive `oldest_note_date`. One press reaches the NEXT
  // older note even across a gap longer than one 92-day page, and once the oldest note is on the page
  // the control is gone ("No older notes" is said, because the person asked).
  test('Show older notes crosses a gap of 300 days in one press, then hides (oldest_note_date)', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const probe = await session.get(`/api/circles/${circleId}/care-notes`);
    expect(probe.status()).toBe(200);
    const probeData = ((await probe.json()) as { data: { today: string; oldest_note_date?: string | null } }).data;
    test.skip(!('oldest_note_date' in probeData), 'backend predates oldest_note_date (fallback pinned above)');
    const today = probeData.today;
    const prevOldest = probeData.oldest_note_date ?? null;
    const ours = addDaysISO(prevOldest ?? today, -300);
    const body = `${PREFIX}GAP_${uniqueSuffix()}`;
    const bodyRe = new RegExp(escapeRegExp(body));
    const id = await createNoteVia(session, circleId, body, ours);

    try {
      await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('note-composer-expand')).toBeVisible({ timeout: 20_000 });
      const showOlder = page.getByTestId('notes-show-older');
      const noOlder = page.getByTestId('notes-no-older');
      const oursText = page.locator(`#notes-day-${ours}`).getByText(bodyRe);
      const prevGroup = prevOldest ? page.locator(`#notes-day-${prevOldest}`) : null;
      await expect(showOlder).toBeVisible({ timeout: 20_000 });

      let prevVisibleBeforeFinalPress = prevGroup === null;
      for (let i = 0; i < 40 && (await oursText.count()) === 0; i++) {
        await expect(showOlder).toBeEnabled({ timeout: 20_000 });
        prevVisibleBeforeFinalPress = prevGroup === null ? true : (await prevGroup.count()) > 0;
        await showOlder.click();
        // Settled: either the control is idle again or it is gone (the end).
        await expect
          .poll(async () => (await noOlder.count()) > 0 || (await showOlder.isEnabled().catch(() => false)), {
            timeout: 30_000,
          })
          .toBe(true);
      }
      await expect(oursText).toBeVisible({ timeout: 20_000 });
      // The press that showed our note started from the previous oldest note: the 300-day gap
      // (over three empty 92-day pages) was crossed in ONE press.
      expect(prevVisibleBeforeFinalPress).toBe(true);
      await expect(showOlder).toHaveCount(0);
      await expect(noOlder).toHaveText('No older notes');
    } finally {
      await session.delete(`/api/circles/${circleId}/care-notes/${id}`);
    }
  });
});
