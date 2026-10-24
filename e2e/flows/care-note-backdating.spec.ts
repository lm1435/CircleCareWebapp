import { test, expect } from '../fixtures';
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
      await page.getByLabel(/^Add a note/).fill(body);
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
      await expect(page.getByLabel(/^Add a note/)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(bodyRe)).toHaveCount(0);

      const showOlder = page.getByTestId('notes-show-older');
      const noOlder = page.getByTestId('notes-no-older');
      // 14-day steps up to one full page, then whole 92-day pages: never a dead end.
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
});
