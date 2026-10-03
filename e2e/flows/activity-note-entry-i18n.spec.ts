import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import {
  apiSession,
  circleTimezone,
  createAppointment,
  dateInTz,
  deleteEventById,
  escapeRegExp,
  gotoActivitySettled,
  setProfileLanguage,
  uniqueSuffix,
} from '../notesFirstClassShared';

// docs/plans/notes-first-class.md, Slice 2/backend task 3 + web task 24: new
// note-added Activity entries render through `description_key` +
// `description_params`, so a Spanish-language viewer sees the TRANSLATED
// sentence ("Agregó una nota a …" / "Agregó una nota de cuidado diaria"), not
// the English `description` fallback — plus the live preview line, which
// renders regardless of language (it is not a translated string).

const PREFIX = 'ZZ_E2E_ACTIVITYI18N_';

test.describe('Activity feed: note entries render translated text in Spanish', () => {
  test('event note and care note entries are in Spanish, with their preview line', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);

    const apptTitle = `${PREFIX}appt_${uniqueSuffix()}`;
    const eventNoteBody = `${PREFIX}eventnote_${uniqueSuffix()}`;
    const careNoteBody = `${PREFIX}carenote_${uniqueSuffix()}`;

    const apptId = await createAppointment(session, circleId, apptTitle, today);
    let eventNoteId: string | undefined;
    let careNoteId: string | undefined;

    try {
      const noteRes = await session.post(`/api/circles/${circleId}/events/${apptId}/notes`, {
        body: eventNoteBody,
      });
      expect(noteRes.ok()).toBe(true);
      eventNoteId = ((await noteRes.json()) as { data: { note: { id: string } } }).data.note.id;

      const careRes = await session.post(`/api/circles/${circleId}/care-notes`, { body: careNoteBody });
      expect(careRes.ok()).toBe(true);
      careNoteId = ((await careRes.json()) as { data: { note: { id: string } } }).data.note.id;

      // --- Switch to Spanish ---
      await setProfileLanguage(page, 'es');

      await gotoActivitySettled(page, circleId);

      // `.first()`: a matching row can also mirror into a "Latest" highlight
      // region elsewhere on the page.
      const eventRow = page
        .getByText(new RegExp(`Agregó una nota a ${escapeRegExp(apptTitle)}.*${escapeRegExp(eventNoteBody)}`, 's'))
        .first();
      await expect(eventRow).toBeVisible({ timeout: 25_000 });

      const careRow = page
        .getByText(new RegExp(`Agregó una nota de cuidado diaria.*${escapeRegExp(careNoteBody)}`, 's'))
        .first();
      await expect(careRow).toBeVisible({ timeout: 25_000 });

      // New UI state: Spanish-rendered note entries with their preview line.
      await checkA11y(page, `/circles/${circleId}/activity`, testInfo);
    } finally {
      await setProfileLanguage(page, 'en').catch(() => {});
      if (eventNoteId) await session.delete(`/api/circles/${circleId}/events/${apptId}/notes/${eventNoteId}`).catch(() => {});
      if (careNoteId) await session.delete(`/api/circles/${circleId}/care-notes/${careNoteId}`).catch(() => {});
      await deleteEventById(session, circleId, apptId);
    }
  });
});
