import { test, expect } from '../fixtures';
import { apiSession, createAppointment, dateInTz, deleteEventById } from '../notesFirstClassShared';

// docs/plans/notes-first-class.md, Slice 1, task 11: GET /api/users/me/export
// gains `eventNotes` and `careNotes` on every owned circle (task 11's
// `OwnedCircleExport` shape), alongside the pre-existing tables — a strictly
// additive change. Seeds one of each note kind, triggers the real "Download
// my data" button, reads the network response directly (the button turns it
// into a Blob download; the JSON body is identical either way and does not
// need a real file-save round trip to verify), and asserts both new arrays
// carry the seeded notes while every old key survives.

const NOTE_MARKER = 'ZZ_E2E_EXPORT_NOTES_';

interface ExportedNote {
  body: string;
}

interface OwnedCircleExport {
  circle: { id: string };
  eventNotes: ExportedNote[];
  careNotes: ExportedNote[];
  medications: unknown[];
  calendar_events: unknown[];
  vitals: unknown[];
  documents: unknown[];
}

interface UserDataExport {
  format_version: string;
  generated_at: string;
  user: Record<string, unknown>;
  owned_circles: OwnedCircleExport[];
  member_circles: unknown[];
}

test.describe('Data export includes notes', () => {
  test('event notes and care notes appear in the export, old keys still present', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const today = dateInTz('UTC', 0);
    const eventNoteBody = `${NOTE_MARKER}event_${Date.now()}`;
    const careNoteBody = `${NOTE_MARKER}care_${Date.now()}`;

    const apptId = await createAppointment(session, circleId, `${NOTE_MARKER}appt_${Date.now()}`, today);
    let eventNoteId: string | undefined;
    let careNoteId: string | undefined;

    try {
      const noteRes = await session.post(`/api/circles/${circleId}/events/${apptId}/notes`, {
        body: eventNoteBody,
      });
      expect(noteRes.ok(), `create event note failed: ${noteRes.status()} ${await noteRes.text()}`).toBe(true);
      eventNoteId = ((await noteRes.json()) as { data: { note: { id: string } } }).data.note.id;

      const careRes = await session.post(`/api/circles/${circleId}/care-notes`, { body: careNoteBody });
      expect(careRes.ok(), `create care note failed: ${careRes.status()} ${await careRes.text()}`).toBe(true);
      careNoteId = ((await careRes.json()) as { data: { note: { id: string } } }).data.note.id;

      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/users/me/export') && r.request().method() === 'GET'
        ),
        page.getByRole('button', { name: 'Download my data' }).click(),
      ]);
      expect(response.ok(), `export request failed: ${response.status()}`).toBe(true);
      const body = (await response.json()) as UserDataExport;

      expect(body.format_version).toBeTruthy();
      expect(body.owned_circles).toBeTruthy();
      const owned = body.owned_circles.find((c) => c.circle.id === circleId);
      expect(owned, 'the test circle must be in owned_circles').toBeTruthy();

      // New: both note kinds present with the seeded bodies.
      expect(owned!.eventNotes.some((n) => n.body === eventNoteBody)).toBe(true);
      expect(owned!.careNotes.some((n) => n.body === careNoteBody)).toBe(true);

      // Old keys still present (additive change, nothing removed).
      expect(Array.isArray(owned!.medications)).toBe(true);
      expect(Array.isArray(owned!.calendar_events)).toBe(true);
      expect(Array.isArray(owned!.vitals)).toBe(true);
      expect(Array.isArray(owned!.documents)).toBe(true);

      await expect(page.getByText('Your data export has been downloaded.')).toBeVisible({ timeout: 15_000 });
    } finally {
      if (eventNoteId) await session.delete(`/api/circles/${circleId}/events/${apptId}/notes/${eventNoteId}`).catch(() => {});
      if (careNoteId) await session.delete(`/api/circles/${circleId}/care-notes/${careNoteId}`).catch(() => {});
      await deleteEventById(session, circleId, apptId);
    }
  });
});
