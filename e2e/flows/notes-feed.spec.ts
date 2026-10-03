import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { apiSession, dbQuery, sqlStr, type ApiSession } from '../unhappy';
import { assertLocalDbTargets, sqlExec } from '../db';

// docs/plans/notes-first-class.md, Slice 2 (feed previews + deep links) and
// the web parts of Slice 4's task 34: end-to-end proof, against the real
// backend, that
//   1. an event note on an appointment shows a live preview on the Activity
//      feed, as a LINK, and clicking it opens the calendar on that event's
//      date with its notes panel visible;
//   2. a daily care note does the same, landing on the Notes page at that
//      note's date;
//   3. deleting an event note removes its Activity row (plan decision 3 —
//      "deleting a note deletes its feed row").
//
// Modeled on the established pattern in flows/medication-notes.spec.ts: events
// created via a direct authenticated API call (`apiSession`), every
// note/visibility assertion driven through the REAL browser UI, isolation via
// the `circleId`/`account` fixtures, cleanup in `finally`.

const APPT_PREFIX = 'ZZ_E2E_NOTESFEED_APPT_';

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Today" in the CARE RECIPIENT's timezone — CalendarPage's default week
 *  anchor, so an appointment scheduled here needs no week navigation. */
function dateInTz(tz: string, offsetDays: number): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

async function circleTimezone(session: ApiSession, circleId: string): Promise<string> {
  const res = await session.get(`/api/circles/${circleId}`);
  if (!res.ok()) {
    throw new Error(`GET /api/circles/${circleId} failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: { circle?: { care_recipient_timezone?: string } } };
  return body?.data?.circle?.care_recipient_timezone || 'America/New_York';
}

interface CreatedEvent {
  id: string;
}

async function createAppointment(
  session: ApiSession,
  circleId: string,
  title: string,
  date: string
): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'appointment',
    title,
    scheduled_date: date,
    scheduled_time: '10:00',
  });
  if (!res.ok()) {
    throw new Error(`create appointment failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { event: CreatedEvent } };
  return body.data.event.id;
}

async function deleteEvent(session: ApiSession, circleId: string, eventId: string): Promise<void> {
  await session.delete(`/api/circles/${circleId}/events/${eventId}`).catch(() => {});
}

// --- Calendar navigation / notes panel (medication-notes.spec.ts idiom) -----

async function gotoCalendarSettled(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
}

function dayCell(page: Page, date: string): Locator {
  return page.locator(`[role="gridcell"][data-date="${date}"]`);
}

async function openChip(page: Page, date: string, titleRe: RegExp): Promise<Locator> {
  const chip = dayCell(page, date).getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });
  await chip.first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // exact: true — the appointment title itself contains "Notes" nowhere, but
  // this still disambiguates from the modal's own h2 title heading, matching
  // the established idiom.
  await expect(dialog.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  return dialog;
}

async function closeDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close event details' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
}

async function addEventNote(
  page: Page,
  date: string,
  titleRe: RegExp,
  noteBody: string
): Promise<void> {
  const dialog = await openChip(page, date, titleRe);
  await dialog.locator('#event-note-composer').fill(noteBody);
  await dialog.getByRole('button', { name: 'Add note' }).click();
  await expect(dialog.getByText(noteBody)).toBeVisible({ timeout: 25_000 });
  await closeDialog(page);
}

async function gotoActivitySettled(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/activity`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading activity...')).toHaveCount(0, { timeout: 20_000 });
}

test.describe('notes first-class: feed previews + deep links', () => {
  test('event note: the Activity row shows the preview as a link, and opens the calendar on that event\'s notes', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow(); // several full-page navigations
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);

    const title = `${APPT_PREFIX}${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(title));
    const noteBody = `E2E event note ${uniqueSuffix()}`;

    const eventId = await createAppointment(session, circleId, title, today);
    try {
      // --- Add the note through the real UI ---
      await gotoCalendarSettled(page, circleId);
      await addEventNote(page, today, titleRe, noteBody);

      // --- The Activity feed shows it as a LINK, preview text included ---
      await gotoActivitySettled(page, circleId);
      const link = page.getByRole('link', {
        name: new RegExp(`Added a note to ${escapeRegExp(title)}.*${escapeRegExp(noteBody)}`, 's'),
      });
      await expect(link).toBeVisible({ timeout: 25_000 });

      // --- Clicking it opens the calendar on that event's date, notes visible ---
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/calendar\\?.*eventId=`));
      const reopened = page.getByRole('dialog');
      await expect(reopened).toBeVisible({ timeout: 20_000 });
      await expect(reopened.getByRole('heading', { name: titleRe })).toBeVisible();
      await expect(reopened.getByText(noteBody)).toBeVisible({ timeout: 15_000 });

      // The deep-link params are scrubbed once resolved (plan task 26).
      await expect(page).not.toHaveURL(/eventId=/, { timeout: 15_000 });
    } finally {
      await deleteEvent(session, circleId, eventId);
    }
  });

  test('care note: the Activity row shows the preview as a link, and opens the Notes page at that date', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const noteBody = `E2E care note ${uniqueSuffix()}`;

    await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Add a note', { exact: true }).fill(noteBody);
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByText(noteBody)).toBeVisible({ timeout: 25_000 });

    let noteId: string | undefined;
    try {
      await gotoActivitySettled(page, circleId);
      // The care-note row renders from its description_key (params {}),
      // so the translated wording is required, not the English fallback.
      const link = page.getByRole('link', {
        name: new RegExp(`Added a daily care note.*${escapeRegExp(noteBody)}`, 's'),
      });
      await expect(link).toBeVisible({ timeout: 25_000 });

      await link.click();
      await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notes\\?date=`));
      await expect(page.getByText(noteBody)).toBeVisible({ timeout: 20_000 });

      // The deep-link param is scrubbed once resolved (plan task 27).
      await expect(page).not.toHaveURL(/[?&]date=/, { timeout: 15_000 });

      noteId = dbQuery<{ id: string }>(
        `select id from care_notes where circle_id = ${sqlStr(circleId)} and body = ${sqlStr(noteBody)}`
      )[0]?.id;
    } finally {
      if (noteId) await session.delete(`/api/circles/${circleId}/care-notes/${noteId}`).catch(() => {});
    }
  });

  test('deleting an event note removes its Activity row', async ({ page, request, circleId, account }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);

    const title = `${APPT_PREFIX}${uniqueSuffix()}`;
    const titleRe = new RegExp(escapeRegExp(title));
    const noteBody = `E2E delete-me note ${uniqueSuffix()}`;

    const eventId = await createAppointment(session, circleId, title, today);
    try {
      await gotoCalendarSettled(page, circleId);
      await addEventNote(page, today, titleRe, noteBody);

      // Confirm the row exists before deleting it — otherwise "gone after
      // delete" could pass vacuously (it was never there to begin with, e.g.
      // if the write silently failed).
      await gotoActivitySettled(page, circleId);
      await expect(page.getByText(noteBody)).toBeVisible({ timeout: 25_000 });

      // --- Delete the note from the calendar ---
      await gotoCalendarSettled(page, circleId);
      const dialog = await openChip(page, today, titleRe);
      const noteItem = dialog.locator('li', { hasText: noteBody });
      await noteItem.getByRole('button', { name: 'Delete' }).click();
      const confirm = page.getByRole('dialog', { name: 'Delete note' });
      await expect(confirm).toBeVisible({ timeout: 10_000 });
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(dialog.getByText(noteBody)).toHaveCount(0, { timeout: 15_000 });
      await closeDialog(page);

      // --- Its Activity row is gone (plan decision 3) ---
      await gotoActivitySettled(page, circleId);
      await expect(page.getByText(noteBody)).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await deleteEvent(session, circleId, eventId);
    }
  });

  // The backend RETURNS a feed row whose note is gone, flagged `note_missing`
  // (never drops it — clients page by the raw row count; production carries
  // 12 such orphaned care-note rows with no cleanup migration). The web feed
  // must hide it while the rest of the page renders normally.
  test('an orphaned care-note row (note deleted, feed row left behind) is hidden on the Activity feed', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const keptBody = `E2E kept care note ${uniqueSuffix()}`;
    const orphanBody = `E2E orphaned care note ${uniqueSuffix()}`;

    const ids: string[] = [];
    try {
      for (const body of [keptBody, orphanBody]) {
        const res = await session.post(`/api/circles/${circleId}/care-notes`, { body });
        if (!res.ok()) throw new Error(`create care note failed: ${res.status()} ${await res.text()}`);
        ids.push(((await res.json()) as { data: { note: { id: string } } }).data.note.id);
      }

      // Both visible first — otherwise "hidden" could pass vacuously.
      await gotoActivitySettled(page, circleId);
      // `.first()`: the newest row also renders in the Latest hero.
      await expect(page.getByText(orphanBody).first()).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText(keptBody).first()).toBeVisible();

      // Orphan it the way HEAD's DELETE did: the note goes, its feed row stays.
      assertLocalDbTargets('notes-feed orphan');
      sqlExec(`delete from care_notes where id = ${sqlStr(ids[1])}`);
      expect(
        dbQuery<{ id: string }>(
          `select id from activity_feed where subject_type = 'care_note' and subject_id = ${sqlStr(ids[1])}`
        )
      ).toHaveLength(1);

      await gotoActivitySettled(page, circleId);
      await expect(page.getByText(keptBody).first()).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText(orphanBody)).toHaveCount(0);
      // The orphan has no preview any more, so "its text is gone" alone would
      // pass even if the row still rendered. The discriminating check: the
      // NEWEST care-note row in the list must now be the kept one — an
      // unfiltered feed would put the (preview-less) orphan row there.
      await expect(
        page.getByRole('listitem').filter({ hasText: 'Added a daily care note' }).first()
      ).toContainText(keptBody);
    } finally {
      for (const id of ids) {
        await session.delete(`/api/circles/${circleId}/care-notes/${id}`).catch(() => {});
      }
      sqlExec(
        `delete from activity_feed where subject_type = 'care_note' and subject_id in (${ids
          .map((id) => sqlStr(id))
          .join(', ') || 'null'})`
      );
    }
  });
});
