import type { Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { sqlExec } from '../../db';
import { apiSession, countRequests, dbCount, dbQuery, holdRequest, sqlStr } from '../../unhappy';
import {
  apiCreateCareNote,
  apiCreateEvent,
  burstClick,
  dateInZone,
  doubleSubmitWhileHeld,
  errorToast,
  escapeRe,
  openCalendarEvent,
  purgeEventsTitled,
  recipientTimezone,
} from './_helpers';

// DOUBLE SUBMIT WHILE PENDING — notes: Daily Care Notes post / edit / delete
// (NotesPage guards) and the calendar event-notes composer (EventNotesPanel).
//
// Post and event-note create write a duplicate care record; a second DELETE
// 404s and toasts a failure over a delete that worked. Protocol per test:
// hold the write, activate twice in one tick and again while pending, release,
// then exactly ONE request and the expected row state in the database.

test.use({ persona: 'premiumOwner' });

const ACTIONS = /^Actions for note by /;

async function openNotes(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({ timeout: 20_000 });
}

function noteRow(page: Page, body: string) {
  return page
    .locator('li')
    .filter({ hasText: new RegExp(escapeRe(body)) })
    .filter({ has: page.getByRole('button', { name: ACTIONS }) })
    .last();
}

const deleteCareNotes = (circleId: string, ...bodies: string[]) =>
  sqlExec(
    `delete from care_notes where circle_id = ${sqlStr(circleId)}::uuid and body in (${bodies.map(sqlStr).join(', ')});`
  );

// WHAT POST CAN GUARANTEE, AND WHAT THIS PROVES.
//
// `handlePost` clears the composer the moment it claims the submit
// (NotesPage.tsx:162, optimistic), so once the first POST is pending an
// IDENTICAL duplicate can no longer be typed: the only identical-duplicate
// window is the same-tick burst, which only the synchronous `postGuard` claim
// can refuse (the burst below).
//
// While the POST is pending the product posts ONE note at a time: the guard is
// released in `onSettled` (NotesPage.tsx:159,184), and the composer disables
// Post and ignores submits while `submitting` (NoteComposer.tsx:82,166). It
// does NOT drop what the user types meanwhile (`onError` restores the failed
// draft only into an EMPTY composer, NotesPage.tsx:178-182). So the held phase
// types a NEW, different body, tries every way to post it (force click,
// `requestSubmit`), and requires: no second POST while held, the first note
// posted once, the new draft still in the composer, and it posts (once) only
// after the first settles.
//
// The held-phase refusal is TWO independent layers — the page's
// `isPending`/`postGuard` and the composer's `submitting` — and either alone
// refuses every UI path (the only way to reach `handlePost` is the composer's
// submit handler). Removing ONE layer is therefore not observable here and is
// out of scope; removing BOTH is (see the report for the mutations).
test('care note post: a same-tick burst posts one note; while it is pending a NEW draft cannot be posted, is kept, and posts once after', async ({
  page,
  circleId,
}) => {
  const first = uniqueLabel('DS note');
  const second = uniqueLabel('DS note next');
  const path = '/api/circles/:id/care-notes';
  const countBody = (body: string) =>
    dbCount(`select 1 from care_notes where circle_id = ${sqlStr(circleId)}::uuid and body = ${sqlStr(body)}`);
  try {
    await openNotes(page, circleId);
    const composer = page.getByLabel(/^Add a note/);
    const form = page.locator('form').filter({ has: composer });
    const post = form.getByRole('button', { name: 'Post', exact: true });
    await composer.fill(first);

    const hold = await holdRequest(page, 'POST', path);
    const sent = countRequests(page, 'POST', path);
    try {
      await burstClick(post);
      await hold.waitForHeld(1);
      await expect(composer, 'the composer cleared optimistically').toHaveValue('');
      // Well past any plausible cooldown guard (see doubleSubmitWhileHeld).
      await page.waitForTimeout(1_000);
      expect(sent.count, 'the burst sent exactly one POST').toBe(1);

      await composer.fill(second);
      await expect(post, 'Post is disabled while the first POST is pending').toBeDisabled();
      await post.click({ force: true });
      await form.evaluate((f) => (f as HTMLFormElement).requestSubmit());
      await page.waitForTimeout(500);
      expect(sent.count, 'no second POST while the first one is held').toBe(1);

      await hold.release();
      await sent.expectCount(1);
    } finally {
      await hold.dispose();
    }

    await expect(noteRow(page, first)).toBeVisible({ timeout: 20_000 });
    await expect(composer, 'the new draft survived the first post settling').toHaveValue(second);
    await expect(post).toBeEnabled();
    await post.click();
    await sent.expectCount(2);
    sent.dispose();
    await expect(noteRow(page, second)).toBeVisible({ timeout: 20_000 });
    expect(countBody(first), 'first note posted once').toBe(1);
    expect(countBody(second), 'second note posted once, after the first settled').toBe(1);
  } finally {
    deleteCareNotes(circleId, first, second);
  }
});

test('care note edit: double save while the PATCH is pending sends one PATCH', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const body = uniqueLabel('DS edit');
  const edited = `${body} edited`;
  const api = await apiSession(request, account);
  const noteId = await apiCreateCareNote(api, circleId, body);
  try {
    await openNotes(page, circleId);
    await noteRow(page, body).getByRole('button', { name: ACTIONS }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Edit', exact: true }).click();
    const field = page.locator(`#note-edit-${noteId}-body`);
    await expect(field).toBeVisible();
    await field.fill(edited);
    const form = page.locator('form').filter({ has: field });
    await doubleSubmitWhileHeld(page, {
      method: 'PATCH',
      path: '/api/circles/:id/care-notes/:noteId',
      submit: form.getByRole('button', { name: 'Save', exact: true }),
      form,
    });
    await expect(field).toBeHidden({ timeout: 20_000 });
    const rows = dbQuery<{ body: string }>(`select body from care_notes where id = ${sqlStr(noteId)}::uuid`);
    expect(rows).toEqual([{ body: edited }]);
  } finally {
    deleteCareNotes(circleId, body, edited);
  }
});

test('care note delete: double confirm while the DELETE is pending sends one DELETE and no error', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const body = uniqueLabel('DS del note');
  const api = await apiSession(request, account);
  const noteId = await apiCreateCareNote(api, circleId, body);
  try {
    await openNotes(page, circleId);
    await noteRow(page, body).getByRole('button', { name: ACTIONS }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete note?' });
    await expect(confirm).toBeVisible();
    await doubleSubmitWhileHeld(page, {
      method: 'DELETE',
      path: '/api/circles/:id/care-notes/:noteId',
      submit: confirm.getByRole('button', { name: 'Delete', exact: true }),
    });
    await expect(confirm).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(new RegExp(escapeRe(body)))).toHaveCount(0, { timeout: 20_000 });
    // A second DELETE would 404 and toast "Couldn't save the note" over a delete that worked.
    await expect(errorToast(page, "Couldn't save the note. Try again.")).toHaveCount(0);
    expect(dbCount(`select 1 from care_notes where id = ${sqlStr(noteId)}::uuid`)).toBe(0);
  } finally {
    deleteCareNotes(circleId, body);
  }
});

test('event note create: double submit while the POST is pending adds one note', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const title = uniqueLabel('DS host');
  const body = uniqueLabel('DS event note');
  const api = await apiSession(request, account);
  const tz = await recipientTimezone(api, circleId);
  const date = dateInZone(tz, 0);
  const event = await apiCreateEvent(api, circleId, { event_type: 'task', title, scheduled_date: date });
  try {
    const detail = await openCalendarEvent(page, circleId, date, title);
    const composer = detail.locator('#event-note-composer');
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await composer.fill(body);
    await doubleSubmitWhileHeld(page, {
      method: 'POST',
      path: '/api/circles/:id/events/:eventId/notes',
      submit: detail.getByRole('button', { name: 'Add note', exact: true }),
      form: detail.locator('form:has(#event-note-composer)'),
    });
    await expect(detail.getByText(body, { exact: true })).toHaveCount(1, { timeout: 20_000 });
    await expect(composer).toHaveValue('');
    expect(
      dbCount(`select 1 from event_notes where event_id = ${sqlStr(event.id)}::uuid and body = ${sqlStr(body)}`)
    ).toBe(1);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});
