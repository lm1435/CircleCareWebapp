import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { sqlExec } from '../../db';
import { dbCount, failRequest, sqlStr, type ApiSession, type FaultHandle } from '../../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  settle,
  uniq,
  type ScopedAccount,
} from './_helpers';

// ===========================================================================
// X12 / PK9 for the calendar EVENT NOTES composer (EventNotesPanel, inside the
// event detail modal). A FORCED sign-out (the note POST 401s and the refresh
// fails) saves the half-typed note to sessionStorage; the SAME user, signing back
// in within 30 minutes and reopening the SAME event, gets it back with the
// "restored" notice, and nothing is written until they press "Add note"
// themselves. The draft key is `eventNote:<circle>:<event>:<date>`, so it must
// NOT turn up on another event, in another circle, or for another user.
//
// The care-note composer (session-expiry-mid-write.spec.ts), the emergency
// editors (draft-circle-scope / draft-entry-identity) and the Add event / Add
// reading forms (draft-event-vital) have e2e; this composer was vitest-only.
//
// Tests (all through the real UI; setup data goes in through the real API):
//   1. EN: restore on the same event + NO restore on a look-alike event in
//      another circle, nor on another event of the same circle; the restore
//      writes nothing, "Add note" then writes exactly one row.
//   2. EN: a DIFFERENT user (a member of the circle) signing in gets no restore,
//      sees none of the typed text, and the entry is purged.
//   3. ES: the same restore with "Recuperamos tu borrador sin guardar.".
//
// FALSIFY (PW_FALSIFY=<token>[,<token>], each makes exactly the named assertion go
// red; plain `draft-event-notes` = `:signout`):
//   draft-event-notes:signout  the refresh SUCCEEDS, so the 401 is retried and the
//                              note is written: no forced sign-out, no draft
//   draft-event-notes:drop     the stored draft is deleted just before the event is
//                              reopened (tab closed / expired): nothing to restore
//   draft-event-notes:circle   test 1 opens the origin circle's event where it
//                              expects the look-alike in the other circle
//   draft-event-notes:event    test 1 opens the typed-in event where it expects
//                              the other event of the same circle
//   draft-event-notes:user     test 2 signs back in as the SAME user, not the other
//
// PRODUCT MUTATIONS (each applied in place to the app file, spec run, file restored
// and diffed identical; the named tests went red, the rest stayed green):
//   EventNotesPanel: useSessionDraft call removed        -> tests 1, 2, 3 (no entry is saved)
//   EventNotesPanel: key `eventNote:<circle>` (no event)  -> tests 1, 3 (visit two gets the draft)
//   EventNotesPanel: constant key `eventNote`             -> tests 1, 3 (the circle-B look-alike gets it)
//   EventNotesPanel: restore callback is a no-op          -> tests 1, 3 (composer comes back empty)
//   lib/sessionDraft.ts: hashUser() constant (one shared entry for every user)
//                                                         -> test 2 (the member inherits the owner's note)
//
// Run-scoped accounts with their own circles; the worker account is never touched.
// ===========================================================================

type Step = 'signout' | 'drop' | 'circle' | 'event' | 'user';
const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
const falsify = (step: Step): boolean =>
  FALSIFY.has(`draft-event-notes:${step}`) || (step === 'signout' && FALSIFY.has('draft-event-notes'));

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180_000);

const NOTES_PATH = '/api/circles/:id/events/:id/notes';

interface Copy {
  composer: RegExp;
  addNote: string;
  notice: string;
}
const COPY: Record<'en' | 'es', Copy> = {
  en: { composer: /^Add a note/, addNote: 'Add note', notice: 'We restored your unsaved draft.' },
  es: { composer: /^Agregar una nota/, addNote: 'Agregar nota', notice: 'Recuperamos tu borrador sin guardar.' },
};

const DRAFT_ENTRIES = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('cc:draft:')));

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const noteRows = (circleId: string, body: string): number =>
  dbCount(`select 1 from event_notes where circle_id = ${sqlStr(circleId)}::uuid and body = ${sqlStr(body)}`);

async function loginViaForm(page: Page, acct: ScopedAccount): Promise<void> {
  await page.locator('#login-email').fill(acct.email);
  await page.locator('#login-password').fill(acct.password);
  // The login page may already speak the account's language (es) after a forced sign-out.
  await page.getByRole('button', { name: /^(Sign in|Iniciar sesión)$/ }).click();
  await expect(page).toHaveURL(/\/circles\//, { timeout: 30_000 });
}

/** Today's date in the circle's care-recipient timezone (the frame the calendar uses). */
async function recipientToday(api: ApiSession, circleId: string): Promise<string> {
  const res = await api.get(`/api/circles/${circleId}`);
  expect(res.ok(), `GET circle ${circleId}: ${res.status()}`).toBe(true);
  const body = (await res.json()) as { data?: { circle?: { care_recipient_timezone?: string } } };
  const tz = body.data?.circle?.care_recipient_timezone || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date()
  );
}

async function createAppointment(
  api: ApiSession,
  circleId: string,
  title: string,
  date: string,
  time: string
): Promise<void> {
  const res = await api.post(`/api/circles/${circleId}/events`, {
    event_type: 'appointment',
    title,
    scheduled_date: date,
    scheduled_time: time,
  });
  expect(res.ok(), `create appointment "${title}": ${res.status()} ${await res.text()}`).toBe(true);
}

interface World {
  owner: ScopedAccount;
  ownerSession: ApiSession;
  circleA: string;
  circleB: string;
  /** Circle A's today / circle B's today (their care-recipient timezones). */
  dateA: string;
  dateB: string;
  /** Circle A holds visits 1 and 2; circle B holds a LOOK-ALIKE of visit 1 (same title, day, time). */
  title1: string;
  title2: string;
}

async function world(request: APIRequestContext, lang: 'en' | 'es'): Promise<World> {
  const owner = await createScopedAccount(`pk9en-${lang}`);
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() where id = ${sqlStr(owner.userId)}::uuid;`
  );
  const ownerSession = await ownerApi(request, owner);
  const circleA = await createCircle(ownerSession, uniq(`pk9enA${lang}`));
  const circleB = await createCircle(ownerSession, uniq(`pk9enB${lang}`));
  const dateA = await recipientToday(ownerSession, circleA);
  const dateB = await recipientToday(ownerSession, circleB);
  const tag = uniq('visit');
  const title1 = `Visit one ${tag}`;
  const title2 = `Visit two ${tag}`;
  await createAppointment(ownerSession, circleA, title1, dateA, '10:00');
  await createAppointment(ownerSession, circleA, title2, dateA, '14:00');
  await createAppointment(ownerSession, circleB, title1, dateB, '10:00');
  return { owner, ownerSession, circleA, circleB, dateA, dateB, title1, title2 };
}

/** A second REAL account joined to `circleId` as a caregiver, through the invite API. */
async function addMember(request: APIRequestContext, ownerSession: ApiSession, circleId: string): Promise<ScopedAccount> {
  const member = await createScopedAccount('pk9en-member');
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const accepted = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(accepted.status(), await accepted.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);
  return member;
}

/** Open the calendar of `circleId`, click the chip titled `title` on `date`, return the detail dialog. */
async function openEvent(page: Page, circleId: string, date: string, title: string): Promise<Locator> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  const chip = page
    .locator(`[role="gridcell"][data-date="${date}"]`)
    .getByRole('button', { name: new RegExp(escapeRe(title)) })
    .first();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await chip.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText(title).first()).toBeVisible();
  return dialog;
}

const composerOf = (dialog: Locator, copy: Copy): Locator => dialog.getByRole('textbox', { name: copy.composer });

/**
 * Open `title`'s detail dialog, type `note`, kill the session on "Add note" (the
 * POST 401s, every refresh 401s) and wait for /login. The refused POST writes nothing.
 */
async function typeNoteAndLoseSession(
  page: Page,
  w: World,
  copy: Copy,
  note: string
): Promise<void> {
  const dialog = await openEvent(page, w.circleA, w.dateA, w.title1);
  const composer = composerOf(dialog, copy);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill(note);

  const handles: FaultHandle[] = [];
  if (!falsify('signout')) {
    handles.push(await failRequest(page, 'POST', '/api/auth/refresh', { status: 401, code: 'UNAUTHORIZED', times: 5 }));
  }
  const write = await failRequest(page, 'POST', NOTES_PATH, { status: 401, code: 'UNAUTHORIZED', times: 1 });
  handles.push(write);
  await dialog.getByRole('button', { name: copy.addNote, exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await write.expectHits(1);
  await Promise.all(handles.map((h) => h.dispose()));

  // Parked in sessionStorage only, never localStorage; the refused POST wrote nothing.
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(note);
  expect(noteRows(w.circleA, note)).toBe(0);
}

/** FALSIFY `:drop`: the saved draft vanishes (tab closed / expired) before the event is reopened. */
async function dropDraftIfFalsified(page: Page): Promise<void> {
  if (falsify('drop')) await page.evaluate(() => sessionStorage.clear());
}

/** Open an event whose composer must come up EMPTY, with no notice, leaving any saved draft untouched. */
async function expectNoRestore(
  page: Page,
  circleId: string,
  date: string,
  title: string,
  copy: Copy,
  what: string
): Promise<void> {
  const dialog = await openEvent(page, circleId, date, title);
  const composer = composerOf(dialog, copy);
  await expect(composer, what).toBeVisible({ timeout: 20_000 });
  await settle(); // a late restore effect would have landed by now
  await expect(composer, `${what}: composer must be empty`).toHaveValue('');
  await expect(page.getByText(copy.notice), `${what}: no restored notice`).toHaveCount(0);
}

test('PK9 event note (EN): after a forced sign-out and re-login, the SAME event restores the note with the notice; another event and a look-alike in another circle do not; nothing is written until Add note', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const w = await world(request, 'en');
  const copy = COPY.en;
  const note = `DRAFT-EVENT-NOTE-${uniq('n')}`;
  await cookieLogin(context, w.owner, baseURL);

  await typeNoteAndLoseSession(page, w, copy, note);
  await loginViaForm(page, w.owner);

  // A look-alike (same title, day and time) in the user's OTHER circle: its own
  // event id and circle id, so it must come up empty and leave the draft alone.
  if (falsify('circle')) {
    await expectNoRestore(page, w.circleA, w.dateA, w.title1, copy, 'circle B look-alike (falsified: opened circle A event 1)');
  } else {
    await expectNoRestore(page, w.circleB, w.dateB, w.title1, copy, 'circle B look-alike of the event');
  }
  expect(await DRAFT_ENTRIES(page), 'the look-alike must not consume the draft').toHaveLength(1);

  // Another event in the SAME circle: also empty, draft still there.
  if (falsify('event')) {
    await expectNoRestore(page, w.circleA, w.dateA, w.title1, copy, 'visit two (falsified: opened visit one)');
  } else {
    await expectNoRestore(page, w.circleA, w.dateA, w.title2, copy, 'visit two of the same circle');
  }
  expect(await DRAFT_ENTRIES(page), 'the other event must not consume the draft').toHaveLength(1);

  // The event the note was typed in: restored, with the notice, then consumed.
  await dropDraftIfFalsified(page);
  const dialog = await openEvent(page, w.circleA, w.dateA, w.title1);
  const composer = composerOf(dialog, copy);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveValue(note, { timeout: 5_000 });
  await expect(page.getByText(copy.notice)).toBeVisible();
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  // The restore itself writes nothing...
  expect(noteRows(w.circleA, note)).toBe(0);
  // ...and the restored note saves exactly once when the user presses the button.
  await dialog.getByRole('button', { name: copy.addNote, exact: true }).click();
  await expect.poll(() => noteRows(w.circleA, note), { timeout: 20_000 }).toBe(1);
  await expect(composer).toHaveValue('', { timeout: 10_000 });
  await expect(dialog.getByText(note)).toBeVisible({ timeout: 10_000 });
  expect(noteRows(w.circleA, note)).toBe(1);
  expect(noteRows(w.circleB, note)).toBe(0);
});

test('PK9 event note privacy (EN): a DIFFERENT user (a circle member) signing in gets no restore, sees none of the typed text, and the entry is purged', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const w = await world(request, 'en');
  const copy = COPY.en;
  const member = await addMember(request, w.ownerSession, w.circleA);
  const note = `DRAFT-EVENT-NOTE-${uniq('o')}`;
  await cookieLogin(context, w.owner, baseURL);

  await typeNoteAndLoseSession(page, w, copy, note);

  // The member signs in on the same browser (the form, as a real second person would).
  await loginViaForm(page, falsify('user') ? w.owner : member);
  expect(await DRAFT_ENTRIES(page), "another user's sign-in purges the entry").toHaveLength(0);

  // The member opens the very event the note was typed in: nothing of it is there.
  await expectNoRestore(page, w.circleA, w.dateA, w.title1, copy, "the member opening the owner's event");
  await expect(page.getByText(note)).toHaveCount(0);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  expect(noteRows(w.circleA, note)).toBe(0);
});

test('PK9 event note (ES): the restored note comes back with "Recuperamos tu borrador sin guardar."; nothing is written until "Agregar nota"', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const w = await world(request, 'es');
  const copy = COPY.es;
  const note = `BORRADOR-NOTA-${uniq('e')}`;
  await cookieLogin(context, w.owner, baseURL);

  await typeNoteAndLoseSession(page, w, copy, note);
  await loginViaForm(page, w.owner);

  // The other visit of the same circle (Spanish UI): empty, no notice, draft kept.
  await expectNoRestore(page, w.circleA, w.dateA, w.title2, copy, 'visit two (ES)');
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);

  await dropDraftIfFalsified(page);
  const dialog = await openEvent(page, w.circleA, w.dateA, w.title1);
  const composer = composerOf(dialog, copy);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveValue(note, { timeout: 5_000 });
  await expect(page.getByText('Recuperamos tu borrador sin guardar.')).toBeVisible();
  // The English notice must not leak into the Spanish UI.
  await expect(page.getByText('We restored your unsaved draft.')).toHaveCount(0);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  expect(noteRows(w.circleA, note)).toBe(0);

  await dialog.getByRole('button', { name: copy.addNote, exact: true }).click();
  await expect.poll(() => noteRows(w.circleA, note), { timeout: 20_000 }).toBe(1);
  await expect(composer).toHaveValue('', { timeout: 10_000 });
});
