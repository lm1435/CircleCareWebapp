import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import {
  addDaysISO,
  apiSession,
  circleTimezone,
  createAppointment,
  dateInTz,
  deleteEventById,
} from '../notesFirstClassShared';

// docs/plans/notes-first-class.md, Slice 4, task 30: the care-summary share
// dialog gains "Include visit notes" (default ON) / "Include daily care
// notes" (default OFF) switches and a live count line over the SAME
// last-30-days-to-today window the export itself uses; task notes are never
// counted (the visit-notes fetch is `event_type=appointment` only). Sharing
// hands a complete HTML document to a hidden iframe's `print()` (printHtml.ts).
//
// CAPTURE STRATEGY. `page.addInitScript` runs in EVERY frame — including a
// dynamically created `srcdoc` iframe — before that frame's own document
// finishes loading (Playwright/CDP guarantee, not a page-JS-timing race). It
// overrides `window.print` globally, so the iframe's REAL print pipeline
// never runs. `printHtml.ts` only removes the iframe on the `afterprint`
// event (or a 60s fallback) — with the real print() replaced, `afterprint`
// never fires, so the iframe stays in the DOM for the full 60s, which is
// what makes reading it reliable. An earlier version tried to catch and
// patch the iframe's `print` via a `MutationObserver` AFTER it appeared;
// that raced the real create → print → afterprint → remove cycle (which can
// complete before a same-page microtask observer gets a turn) and the
// iframe was gone before it could be read.

const PREFIX = 'ZZ_E2E_CARESUMMARY_';

async function armPrintCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.print = () => {
      (window as unknown as { __ccPrinted?: boolean }).__ccPrinted = true;
    };
  });
}

function printIframeLocator(page: Page) {
  return page.locator('iframe[aria-hidden="true"]');
}

async function hasPrintIframe(page: Page): Promise<boolean> {
  return (await printIframeLocator(page).count()) > 0;
}

async function readPrintIframeHtml(page: Page): Promise<string> {
  const iframe = printIframeLocator(page);
  await expect(iframe).toHaveCount(1, { timeout: 20_000 });
  // The iframe is attached BEFORE its srcdoc document has loaded: while it
  // navigates from about:blank, documentElement can be null for a moment (a
  // one-shot read threw once under 3-worker load, coverage run 2026-10-02).
  // Poll until the srcdoc document itself is readable.
  let html = '';
  await expect
    .poll(
      async () => {
        html = await page.evaluate(() => {
          const el = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement | null;
          const doc = el?.contentDocument;
          if (!doc || doc.URL !== 'about:srcdoc' || doc.readyState === 'loading') return '';
          return doc.documentElement?.outerHTML ?? '';
        });
        return html.length > 0;
      },
      { timeout: 20_000, message: 'print iframe srcdoc document readable' }
    )
    .toBe(true);
  return html;
}

/**
 * Click the masthead "Share" action and wait for the dialog. Retries the
 * click a couple of times: an occasional first click right after navigation
 * lands with no visible effect (observed a handful of times across repeated
 * runs, always recovering on Playwright's own test-level retry) — cheaper to
 * absorb here than to chase further, since the dialog's CONTENT is what this
 * spec actually verifies.
 */
async function openShareDialog(page: Page) {
  // WAIT FOR THE MASTHEAD TO SETTLE FIRST. EmergencyInfoPage renders Share as
  // the masthead's RIGHT action until `useCircle(circleId).canEdit` resolves;
  // for an owner it then becomes "Edit medical information" and Share moves
  // to the secondary slot. A click aimed at Share in that window lands on the
  // Edit control and opens the "Medical information" modal, whose overlay then
  // blocks every retry (observed 1 in 3 runs, 2026-09-28). This spec always
  // runs as the owner persona, so the Edit control's presence is the signal
  // that the layout is final.
  await expect(page.getByRole('button', { name: 'Edit medical information' })).toBeVisible({
    timeout: 20_000,
  });
  const shareButton = page.getByRole('button', { name: 'Share', exact: true });
  await expect(shareButton).toBeEnabled({ timeout: 20_000 });
  const dialog = page.getByRole('dialog', { name: 'Share care summary' });
  for (let attempt = 0; attempt < 3; attempt++) {
    await shareButton.click();
    try {
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      return dialog;
    } catch {
      if (attempt === 2) throw new Error('Share dialog never opened after 3 attempts');
    }
  }
  return dialog;
}

/**
 * The notes ALREADY in the dialog's window before this spec seeds anything.
 *
 * DETERMINISM: the per-worker circle is a clone of the demo account, whose
 * seed carries appointment notes on dates relative to when it was seeded — so
 * how many fall inside "the last 30 days to today" depends on today's date.
 * A hard-coded count is a date bomb. Instead the spec reads the baseline from
 * the backend for the SAME window the dialog uses (careSummaryNotesWindow:
 * today-30 .. today, recipient zone; visit notes = `event_type=appointment`
 * only) and asserts the dialog shows baseline + exactly what it seeded: +1
 * visit note, +1 care note — the seeded TASK note must add nothing (a
 * regression that counts task notes shows +2 and fails).
 */
async function baselineNoteCounts(
  session: Awaited<ReturnType<typeof apiSession>>,
  circleId: string,
  tz: string
): Promise<{ visit: number; care: number }> {
  const to = dateInTz(tz, 0);
  const from = addDaysISO(to, -30);
  const visitRes = await session.get(
    `/api/circles/${circleId}/event-notes?from=${from}&to=${to}&event_type=appointment`
  );
  if (!visitRes.ok()) throw new Error(`baseline event-notes failed: ${visitRes.status()}`);
  const visit = ((await visitRes.json()) as { data: { notes: unknown[] } }).data.notes.length;
  const careRes = await session.get(`/api/circles/${circleId}/care-notes?from=${from}&to=${to}`);
  if (!careRes.ok()) throw new Error(`baseline care-notes failed: ${careRes.status()}`);
  const care = ((await careRes.json()) as { data: { notes: unknown[] } }).data.notes.length;
  return { visit, care };
}

function countLine(counts: { visit: number; care: number }): string {
  return `Includes ${counts.visit} visit notes and ${counts.care} daily care notes`;
}

async function seedNotes(session: Awaited<ReturnType<typeof apiSession>>, circleId: string, tz: string, suffix: string) {
  const today = dateInTz(tz, 0);
  const apptTitle = `${PREFIX}appt_${suffix}`;
  const apptId = await createAppointment(session, circleId, apptTitle, today);
  const visitNoteBody = `${PREFIX}visitnote_${suffix}`;
  const visitNoteRes = await session.post(`/api/circles/${circleId}/events/${apptId}/notes`, {
    body: visitNoteBody,
  });
  if (!visitNoteRes.ok()) throw new Error(`create visit note failed: ${visitNoteRes.status()}`);
  const visitNoteId = ((await visitNoteRes.json()) as { data: { note: { id: string } } }).data.note.id;

  // A task note — must never be counted or included (visit notes = appointments only).
  const taskRes = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'task',
    title: `${PREFIX}task_${suffix}`,
    scheduled_date: today,
  });
  if (!taskRes.ok()) throw new Error(`create task failed: ${taskRes.status()}`);
  const taskId = ((await taskRes.json()) as { data: { event: { id: string } } }).data.event.id;
  const taskNoteRes = await session.post(`/api/circles/${circleId}/events/${taskId}/notes`, {
    body: `${PREFIX}tasknote_${suffix}`,
  });
  if (!taskNoteRes.ok()) throw new Error(`create task note failed: ${taskNoteRes.status()}`);

  const careNoteBody = `${PREFIX}carenote_${suffix}`;
  const careRes = await session.post(`/api/circles/${circleId}/care-notes`, { body: careNoteBody });
  if (!careRes.ok()) throw new Error(`create care note failed: ${careRes.status()}`);
  const careNoteId = ((await careRes.json()) as { data: { note: { id: string } } }).data.note.id;

  return { apptId, apptTitle, visitNoteId, visitNoteBody, taskId, careNoteId, careNoteBody };
}

test.describe('Care summary share dialog: notes switches + PDF sections', () => {
  test('defaults ON/OFF, count line excludes task notes, Share includes visit notes but not care notes', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const baseline = await baselineNoteCounts(session, circleId, tz);
    const suffix = `${Date.now()}`;
    const seeded = await seedNotes(session, circleId, tz, suffix);

    try {
      await armPrintCapture(page);
      await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
      const dialog = await openShareDialog(page);
      const visitSwitch = dialog.getByRole('switch', { name: 'Include visit notes' });
      const careSwitch = dialog.getByRole('switch', { name: 'Include daily care notes' });
      await expect(visitSwitch).toHaveAttribute('aria-checked', 'true');
      await expect(careSwitch).toHaveAttribute('aria-checked', 'false');

      // Count = what was already in the window + exactly the seeded 1 visit
      // note and 1 care note; the seeded task note is excluded.
      const expected = countLine({ visit: baseline.visit + 1, care: baseline.care + 1 });
      await expect(dialog.getByText(expected)).toBeVisible({
        timeout: 20_000,
      });

      // New UI state: the share dialog with its two note switches + live count.
      await checkA11y(page, `/circles/${circleId}/emergency`, testInfo);

      await dialog.getByRole('button', { name: 'Share', exact: true }).click();
      const html = await readPrintIframeHtml(page);
      expect(html).toContain('Visit notes');
      expect(html).toContain(seeded.visitNoteBody);
      expect(html).not.toContain('Daily care notes');
      expect(html).not.toContain(seeded.careNoteBody);
    } finally {
      await session.delete(`/api/circles/${circleId}/events/${seeded.apptId}/notes/${seeded.visitNoteId}`).catch(() => {});
      await session.delete(`/api/circles/${circleId}/care-notes/${seeded.careNoteId}`).catch(() => {});
      await deleteEventById(session, circleId, seeded.apptId);
      await deleteEventById(session, circleId, seeded.taskId);
    }
  });

  test('toggling "Include daily care notes" on and sharing includes both sections', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const baseline = await baselineNoteCounts(session, circleId, tz);
    const suffix = `${Date.now()}-2`;
    const seeded = await seedNotes(session, circleId, tz, suffix);

    try {
      await armPrintCapture(page);
      await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
      const dialog = await openShareDialog(page);
      const expected = countLine({ visit: baseline.visit + 1, care: baseline.care + 1 });
      await expect(dialog.getByText(expected)).toBeVisible({
        timeout: 20_000,
      });

      const careSwitch = dialog.getByRole('switch', { name: 'Include daily care notes' });
      await careSwitch.click();
      await expect(careSwitch).toHaveAttribute('aria-checked', 'true');
      // The count line reflects what actually exists in the window, not which
      // switches are on — it reads the same both before and after toggling.
      await expect(dialog.getByText(expected)).toBeVisible();

      await dialog.getByRole('button', { name: 'Share', exact: true }).click();
      const html = await readPrintIframeHtml(page);
      expect(html).toContain('Visit notes');
      expect(html).toContain(seeded.visitNoteBody);
      expect(html).toContain('Daily care notes');
      expect(html).toContain(seeded.careNoteBody);
    } finally {
      await session.delete(`/api/circles/${circleId}/events/${seeded.apptId}/notes/${seeded.visitNoteId}`).catch(() => {});
      await session.delete(`/api/circles/${circleId}/care-notes/${seeded.careNoteId}`).catch(() => {});
      await deleteEventById(session, circleId, seeded.apptId);
      await deleteEventById(session, circleId, seeded.taskId);
    }
  });

  test('Cancel prints nothing', async ({ page, circleId }) => {
    await armPrintCapture(page);
    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    const dialog = await openShareDialog(page);
    // The dialog's own icon-only close button also has an accessible name of
    // "Cancel" (ConfirmDialog's default `closeLabel`) — `getByText` matches
    // the VISIBLE TEXT footer button only, not the icon-only one.
    await dialog.getByText('Cancel', { exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    expect(await hasPrintIframe(page)).toBe(false);
  });
});
