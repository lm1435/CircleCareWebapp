import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import {
  addDaysISO,
  circleTimezone,
  dateInTz,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';
import { sqlExec, sqlStr } from '../db';
import type { ApiSession } from '../unhappy';
import { apiCreateEvent } from '../unhappy/writes/_helpers';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// Notes by doctor (docs/plans/notes-by-doctor.md), web half, against the real
// backend (PROVIDERS_API_CONTRACT.md):
//   - link an appointment to a doctor in the add form (location prefilled);
//   - Medical Info -> "Visits & notes" (count, keyboard) and appointment -> "See all visits";
//   - Visits & notes: next visit, year groups, notes inline, "more", paging;
//   - "No notes yet - Add a note" into the existing note flow, then the note shows inline;
//   - a removed doctor, a view-only member, the empty state, dark mode - each with axe.
//
// Every test runs on its OWN scoped owner + circle (like appointment-detail-assignee),
// so the doctors and visits it creates never reach another spec's Medical Info.
// All dates are in the CARE RECIPIENT's zone, never the runner's.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

interface Doctor {
  id: string;
  name: string;
  is_primary: boolean;
}

async function apiCreateDoctor(
  api: ApiSession,
  circleId: string,
  body: { name: string; specialty?: string; address?: string; phone?: string }
): Promise<Doctor> {
  const res = await api.post(`/api/circles/${circleId}/providers`, body);
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { data: { provider: Doctor } }).data.provider;
}

async function apiAddNote(api: ApiSession, circleId: string, eventId: string, body: string): Promise<void> {
  const res = await api.post(`/api/circles/${circleId}/events/${eventId}/notes`, { body });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

async function apiVisitCount(api: ApiSession, circleId: string, doctorId: string): Promise<number> {
  const res = await api.get(`/api/circles/${circleId}/providers?include_archived=true`);
  expect(res.ok()).toBe(true);
  const rows = ((await res.json()) as { data: { providers: Array<{ id: string; visit_count: number }> } }).data
    .providers;
  return rows.find((p) => p.id === doctorId)?.visit_count ?? -1;
}

interface Seed {
  api: ApiSession;
  circleId: string;
  tz: string;
  today: string;
  at: (n: number) => string;
  owner: { email: string; password: string; userId: string };
}

/** A scoped owner (never the worker's account) with a fresh circle, logged in in the browser. */
async function seed(
  context: BrowserContext,
  request: APIRequestContext,
  baseURL: string | undefined,
  label: string
): Promise<Seed> {
  const owner = await createScopedAccount(label);
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq(label));
  const tz = await circleTimezone(api, circleId);
  const today = dateInTz(tz, 0);
  await cookieLogin(context, owner, baseURL);
  return { api, circleId, tz, today, at: (n) => addDaysISO(today, n), owner };
}

const visitsPath = (circleId: string, doctorId: string) => `/circles/${circleId}/providers/${doctorId}`;

/** The doctor card on Medical Info (its heading's card). */
function doctorCard(page: Page, name: string) {
  return page.locator('div.print-card', { has: page.getByRole('heading', { level: 3, name }) });
}

async function gotoVisits(page: Page, circleId: string, doctorId: string): Promise<void> {
  await page.goto(visitsPath(circleId, doctorId), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 25_000 });
}

test.describe('Visits & notes: the main journey', () => {
  test('link an appointment to a doctor, open Visits & notes from Medical Info and from the appointment, read and add notes, page back', async ({
    page,
    context,
    request,
    baseURL,
  }, testInfo) => {
    const s = await seed(context, request, baseURL, 'docvisits');
    const sfx = uniqueSuffix().replace(/[^0-9a-z]/gi, '');
    const patelName = `Dr. Patel ${sfx}`;
    const patel = await apiCreateDoctor(s.api, s.circleId, {
      name: patelName,
      specialty: 'Cardiology',
      address: '100 Heart Center Way\nSuite 300',
      phone: '5552013344',
    });
    const kim = await apiCreateDoctor(s.api, s.circleId, { name: `Dr. Kim ${sfx}`, specialty: 'Family medicine' });
    const patelOption = `${patel.name} · Cardiology${patel.is_primary ? ' · Primary' : ''}`;

    // --- 1. Link an appointment to a doctor in the ADD form. ----------------
    const linkedTitle = `E2E Linked ${sfx}`;
    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add event' }).first().click();
    const form = page.getByRole('dialog');
    await expect(form).toBeVisible({ timeout: 20_000 });
    await form.locator('#event_type').selectOption('appointment');
    await form.locator('#title').fill(linkedTitle);

    // The Doctor row: None first, then the active doctors (never a removed one).
    const doctorSelect = form.locator('#provider_id');
    await expect(doctorSelect).toBeVisible();
    // The doctors arrive over the network after the form opens: None + the two.
    await expect(doctorSelect.locator('option')).toHaveCount(3, { timeout: 20_000 });
    const labels = await doctorSelect.locator('option').allTextContents();
    expect(labels[0]).toBe('None');
    expect(labels).toContain(patelOption);
    expect(labels).toContain(`${kim.name} · Family medicine${kim.is_primary ? ' · Primary' : ''}`);

    // Picking the doctor fills the EMPTY location from its address, and says so.
    await doctorSelect.selectOption({ label: patelOption });
    await expect(form.getByLabel(/^Location/)).toHaveValue('100 Heart Center Way, Suite 300');
    await expect(form.getByText(`Filled in from ${patelName}'s address`)).toBeVisible();

    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/circles/${s.circleId}/events`
    );
    await form.getByRole('button', { name: 'Create' }).click();
    const createdRes = await created;
    expect(createdRes.status()).toBe(201);
    expect(createdRes.request().postDataJSON()).toMatchObject({ event_type: 'appointment', provider_id: patel.id });
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

    // --- 2. Seed history through the API: notes, no notes, a long note, years back, and 20+ past visits. -------
    const followUp = `E2E Follow-up ${sfx}`;
    const noNotes = `E2E Checkup ${sfx}`;
    const oldVisit = `E2E First visit ${sfx}`;
    const long = `Referred for palpitations. ${'Holter monitor for 48 hours, then review the results together with the family. '.repeat(6)}END-OF-LONG-NOTE`;
    const upcoming = await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: `E2E Later ${sfx}`,
      scheduled_date: s.at(5),
      scheduled_time: '10:30',
      provider_id: patel.id,
    });
    const a = await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: followUp,
      scheduled_date: s.at(-10),
      scheduled_time: '09:00',
      provider_id: patel.id,
    });
    await apiAddNote(s.api, s.circleId, a.id, 'BP looks better. Keep lisinopril at 10 mg.');
    await apiAddNote(s.api, s.circleId, a.id, 'Wants fasting labs a week before the next visit.');
    const b = await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: noNotes,
      scheduled_date: s.at(-40),
      scheduled_time: '09:00',
      provider_id: patel.id,
    });
    for (let i = 0; i < 20; i++) {
      await apiCreateEvent(s.api, s.circleId, {
        event_type: 'appointment',
        title: `E2E Filler ${i} ${sfx}`,
        scheduled_date: s.at(-50 - i),
        provider_id: patel.id,
      });
    }
    const old = await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: oldVisit,
      scheduled_date: s.at(-400),
      scheduled_time: '09:00',
      provider_id: patel.id,
    });
    await apiAddNote(s.api, s.circleId, old.id, long);
    // Another doctor's appointment must never appear under Dr. Patel.
    await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: `E2E Kim only ${sfx}`,
      scheduled_date: s.at(-12),
      provider_id: kim.id,
    });
    expect(upcoming.id).toBeTruthy();
    expect(b.id).toBeTruthy();

    // --- 3. Medical Info: the row, its count, and keyboard activation. -------
    await page.goto(`/circles/${s.circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    const card = doctorCard(page, patelName);
    const row = card.getByRole('link', { name: /Visits & notes/ });
    await expect(row).toBeVisible({ timeout: 25_000 });
    const expected = await apiVisitCount(s.api, s.circleId, patel.id);
    expect(expected).toBeGreaterThan(20);
    await expect(row).toHaveText(
      new RegExp(`^Visits & notes with ${escapeRegExp(patelName)}\\s*${expected}$`)
    );
    await expect(row).toHaveAccessibleName(new RegExp(`Visits & notes with ${escapeRegExp(patelName)}`));
    await checkA11y(page, 'doctor-visits-medical-info', testInfo);

    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(visitsPath(s.circleId, patel.id))}$`));

    // --- 4. The Visits & notes page. ---------------------------------------
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText(patelName, { timeout: 25_000 });
    await expect(page.getByText('Cardiology', { exact: true })).toBeVisible();
    // Focus lands on the page heading after the navigation (RouteFocus).
    await expect(h1).toBeFocused();

    // Next visit: the soonest upcoming linked appointment is the one created in the form (today, all day).
    const next = page.getByTestId('provider-next-visit');
    await expect(next).toContainText(linkedTitle);
    await expect(next).toContainText('100 Heart Center Way, Suite 300');

    // Notes inline, with author and count; the other doctor's visit is not here.
    const visitA = page.getByTestId('provider-visit').filter({ hasText: followUp });
    await expect(visitA).toContainText('2 notes');
    await expect(visitA).toContainText('BP looks better. Keep lisinopril at 10 mg.');
    await expect(visitA).toContainText('Wants fasting labs a week before the next visit.');
    await expect(page.getByText(`E2E Kim only ${sfx}`)).toHaveCount(0);

    // Year grouping: one heading per year, newest first; the 400-day-old visit is still ahead of us.
    const thisYear = Number(s.today.slice(0, 4));
    await expect(page.getByRole('group', { name: String(thisYear) })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Past visits', exact: true })).toBeVisible();
    await expect(page.getByText(oldVisit)).toHaveCount(0);

    // A visit with no notes offers "Add a note" into the existing flow.
    const visitB = page.getByTestId('provider-visit').filter({ hasText: noNotes });
    await expect(visitB).toContainText('No notes yet');
    await checkA11y(page, 'doctor-visits-page', testInfo);

    // --- 5. Show earlier visits: pages, appends, ends, and moves focus. ------
    const more = page.getByTestId('provider-visits-show-earlier');
    const allVisits = page.getByTestId('provider-visit');
    const loadedBefore = await allVisits.count();
    expect(loadedBefore).toBeGreaterThanOrEqual(20);
    await more.click();
    const oldCard = page.getByTestId('provider-visit').filter({ hasText: oldVisit });
    await expect(oldCard).toBeVisible({ timeout: 25_000 });
    await expect(more).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Past visits', exact: true })).toBeVisible();
    // Focus moved onto the FIRST newly loaded visit (the button is gone), not to <body>.
    expect(await allVisits.count()).toBeGreaterThan(loadedBefore);
    await expect(allVisits.nth(loadedBefore).getByRole('link').first()).toBeFocused();
    // Another year group appeared for the old visit (400 days back is at least last year).
    const oldYear = Number(s.at(-400).slice(0, 4));
    expect(oldYear).toBeLessThan(thisYear);
    await expect(page.getByRole('group', { name: String(oldYear) })).toBeVisible();

    // The long note is clamped with "more" and expands.
    const longNote = oldCard.locator('p', { hasText: 'Referred for palpitations.' });
    const toggle = oldCard.getByRole('button', { name: 'more' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(oldCard.getByRole('button', { name: 'less' })).toHaveAttribute('aria-expanded', 'true');
    await expect(longNote).toContainText('END-OF-LONG-NOTE');

    // --- 6. "Add a note" on a visit with none -> the appointment's notes -> back, and it shows inline. -------
    const noteText = `E2E note from the visit ${sfx}`;
    await visitB.getByRole('link', { name: /Add a note/ }).click();
    await expect(page).toHaveURL(/\/calendar/);
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible({ timeout: 25_000 });
    await expect(detail.getByRole('heading', { name: 'Notes' })).toBeVisible();
    await detail.getByLabel('Add a note').fill(noteText);
    const posted = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/events\/[^/]+\/notes$/.test(new URL(r.url()).pathname)
    );
    await detail.getByRole('button', { name: 'Add note' }).click();
    expect((await posted).status()).toBeLessThan(300);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(visitsPath(s.circleId, patel.id))}$`));
    await expect(
      page.getByTestId('provider-visit').filter({ hasText: noNotes }).getByText(noteText)
    ).toBeVisible({ timeout: 25_000 });

    // --- 7. The second entry point: the appointment -> "See all visits". ------
    await gotoWeekContaining(page, s.circleId, s.today, s.today);
    const apptDialog = await openChip(page, s.today, new RegExp(escapeRegExp(linkedTitle)));
    const seeAll = apptDialog.getByRole('link', { name: `${patelName} · See all visits` });
    await expect(seeAll).toBeVisible();
    await checkA11y(page, 'doctor-visits-appointment-detail', testInfo);
    await seeAll.click();
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(visitsPath(s.circleId, patel.id))}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(patelName, { timeout: 25_000 });
  });
});

test.describe('Visits & notes: a removed doctor', () => {
  test('keeps its visits, reads "(removed)" everywhere, is offered only as the current value, and its link survives an edit', async ({
    page,
    context,
    request,
    baseURL,
  }, testInfo) => {
    const s = await seed(context, request, baseURL, 'docremoved');
    const sfx = uniqueSuffix().replace(/[^0-9a-z]/gi, '');
    const gone = await apiCreateDoctor(s.api, s.circleId, { name: `Dr. Gone ${sfx}`, specialty: 'Oncology' });
    const keep = await apiCreateDoctor(s.api, s.circleId, { name: `Dr. Keep ${sfx}` });
    const title = `E2E Removed doctor visit ${sfx}`;
    const ev = await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title,
      scheduled_date: s.today,
      provider_id: gone.id,
    });
    await apiAddNote(s.api, s.circleId, ev.id, 'Discussed the new schedule.');
    const archived = await s.api.post(`/api/circles/${s.circleId}/providers/${gone.id}/archive`, {});
    expect(archived.status()).toBe(200);

    // The page still opens for a removed doctor, with the visit and its note.
    await gotoVisits(page, s.circleId, gone.id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${gone.name} (removed)`);
    await expect(page.getByTestId('provider-next-visit')).toContainText(title);
    await checkA11y(page, 'doctor-visits-removed', testInfo);

    // The appointment says "(removed) - See all visits".
    await gotoWeekContaining(page, s.circleId, s.today, s.today);
    const dialog = await openChip(page, s.today, new RegExp(escapeRegExp(title)));
    await expect(dialog.getByRole('link', { name: `${gone.name} (removed) · See all visits` })).toBeVisible();

    // The edit form echoes the stored (removed) doctor and keeps it on an untouched save...
    await dialog.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit event', exact: true }).click();
    const form = page.getByRole('dialog');
    const select = form.locator('#provider_id');
    await expect(select).toHaveValue(gone.id);
    const options = await select.locator('option').allTextContents();
    expect(options).toContain(`${gone.name} (removed)`);
    expect(options).toContain(keep.name);
    const patched = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/circles/${s.circleId}/events/${ev.id}`
    );
    await form.getByRole('button', { name: 'Save changes' }).click();
    const patchRes = await patched;
    expect(patchRes.status()).toBe(200);
    expect(patchRes.request().postDataJSON()).toMatchObject({ provider_id: gone.id });
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

    // ...and the picker can move it to an active doctor.
    await gotoWeekContaining(page, s.circleId, s.today, s.today);
    const dialog2 = await openChip(page, s.today, new RegExp(escapeRegExp(title)));
    await dialog2.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit event', exact: true }).click();
    const form2 = page.getByRole('dialog');
    await form2.locator('#provider_id').selectOption({ label: keep.name });
    const moved = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/circles/${s.circleId}/events/${ev.id}`
    );
    await form2.getByRole('button', { name: 'Save changes' }).click();
    expect((await moved).request().postDataJSON()).toMatchObject({ provider_id: keep.id });
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    await gotoVisits(page, s.circleId, keep.id);
    await expect(page.getByTestId('provider-next-visit')).toContainText(title);
  });
});

test.describe('Visits & notes: the empty state', () => {
  test('a doctor with no visits says so; "Add an appointment" opens the form with the doctor and their address, and the new visit appears', async ({
    page,
    context,
    request,
    baseURL,
  }, testInfo) => {
    const s = await seed(context, request, baseURL, 'docempty');
    const sfx = uniqueSuffix().replace(/[^0-9a-z]/gi, '');
    const kim = await apiCreateDoctor(s.api, s.circleId, {
      name: `Dr. Kim ${sfx}`,
      specialty: 'Family medicine',
      address: '12 Elm St',
    });

    // Medical Info: the row is there with no count at 0.
    await page.goto(`/circles/${s.circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    const row = doctorCard(page, kim.name).getByRole('link', { name: /Visits & notes/ });
    await expect(row).toBeVisible({ timeout: 25_000 });
    // No count at 0: the text is the label and the (screen-reader) name, nothing else.
    await expect(row).toHaveText(`Visits & notes with ${kim.name}`);
    await row.click();

    await expect(page.getByTestId('provider-visits-empty')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(`No visits with ${kim.name} yet`)).toBeVisible();
    await expect(
      page.getByText(`Choose ${kim.name} as the doctor when you add or edit an appointment`, { exact: false })
    ).toBeVisible();
    await checkA11y(page, 'doctor-visits-empty', testInfo);

    await page.getByRole('button', { name: 'Add an appointment' }).click();
    const form = page.getByRole('dialog');
    await expect(form).toBeVisible({ timeout: 20_000 });
    await expect(form.locator('#provider_id')).toHaveValue(kim.id);
    await expect(form.getByLabel(/^Location/)).toHaveValue('12 Elm St');
    const title = `E2E From empty ${sfx}`;
    await form.locator('#title').fill(title);
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    // The page refreshed itself: the new appointment is now the next visit.
    await expect(page.getByTestId('provider-next-visit')).toContainText(title, { timeout: 25_000 });
    await expect(page.getByTestId('provider-visits-empty')).toHaveCount(0);
  });
});

test.describe('Visits & notes: a view-only member', () => {
  test('sees the row, the visits and the notes, but no way to add or change anything', async ({
    page,
    context,
    request,
    baseURL,
  }, testInfo) => {
    const owner = await createScopedAccount('docviewowner');
    const ownerApiSession = await ownerApi(request, owner);
    const circleId = await createCircle(ownerApiSession, uniq('docview'));
    const sfx = uniqueSuffix().replace(/[^0-9a-z]/gi, '');
    const tz = await circleTimezone(ownerApiSession, circleId);
    const today = dateInTz(tz, 0);
    const doc = await apiCreateDoctor(ownerApiSession, circleId, { name: `Dr. View ${sfx}`, specialty: 'Cardiology' });
    const withNote = await apiCreateEvent(ownerApiSession, circleId, {
      event_type: 'appointment',
      title: `E2E With note ${sfx}`,
      scheduled_date: addDaysISO(today, -3),
      provider_id: doc.id,
    });
    await apiAddNote(ownerApiSession, circleId, withNote.id, 'Visible to everyone in the circle.');
    await apiCreateEvent(ownerApiSession, circleId, {
      event_type: 'appointment',
      title: `E2E Without note ${sfx}`,
      scheduled_date: addDaysISO(today, -9),
      provider_id: doc.id,
    });

    // A member who is then made view-only (the seat flag the personas use).
    const member = await createScopedAccount('docviewmember');
    const memberApi = await ownerApi(request, member);
    const invite = await createInvite(ownerApiSession, circleId);
    const accepted = await memberApi.post(`/api/invites/code/${invite.code}/accept`);
    expect(accepted.status(), await accepted.text()).toBeLessThan(300);
    sqlExec(
      `update circle_memberships set view_only = true where circle_id = ${sqlStr(circleId)}::uuid and user_id = ${sqlStr(member.userId)}::uuid;`
    );
    await cookieLogin(context, member, baseURL);

    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    const row = doctorCard(page, doc.name).getByRole('link', { name: /Visits & notes/ });
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: new RegExp(`Actions for ${escapeRegExp(doc.name)}`) })).toHaveCount(0);
    await row.click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.name, { timeout: 25_000 });
    const withNoteCard = page.getByTestId('provider-visit').filter({ hasText: `E2E With note ${sfx}` });
    await expect(withNoteCard).toContainText('Visible to everyone in the circle.');
    const withoutNoteCard = page.getByTestId('provider-visit').filter({ hasText: `E2E Without note ${sfx}` });
    await expect(withoutNoteCard).toContainText('No notes yet');
    await expect(withoutNoteCard.getByRole('link', { name: /Add a note/ })).toHaveCount(0);
    await checkA11y(page, 'doctor-visits-view-only', testInfo);

    // A phone-width viewport: no sideways scroll, and still clean under axe.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await checkA11y(page, 'doctor-visits-phone-width', testInfo);
  });
});

test.describe('Visits & notes: Spanish', () => {
  test('Medical Info, the Visits page, the appointment link and the Doctor field are all in Spanish (no raw keys)', async ({
    page,
    context,
    request,
    baseURL,
  }, testInfo) => {
    const s = await seed(context, request, baseURL, 'docspanish');
    sqlExec(
      `update public.users set language = 'es', language_set_at = now() where id = ${sqlStr(s.owner.userId)}::uuid;`
    );
    const sfx = uniqueSuffix().replace(/[^0-9a-z]/gi, '');
    const doc = await apiCreateDoctor(s.api, s.circleId, { name: `Dra. Luna ${sfx}`, specialty: 'Cardiología' });
    const ev = await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: `Cita ${sfx}`,
      scheduled_date: s.at(-3),
      provider_id: doc.id,
    });
    await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: `Cita sin notas ${sfx}`,
      scheduled_date: s.at(-6),
      provider_id: doc.id,
    });
    await apiAddNote(s.api, s.circleId, ev.id, 'Todo bien.');
    await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: `Cita futura ${sfx}`,
      scheduled_date: s.at(4),
      scheduled_time: '10:30',
      provider_id: doc.id,
    });

    await page.goto(`/circles/${s.circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', /^es/, { timeout: 25_000 });
    const row = doctorCard(page, doc.name).getByRole('link', { name: /Visitas y notas/ });
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.name, { timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 2, name: 'Próxima visita' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Visitas anteriores', exact: true })).toBeVisible();
    await expect(page.getByTestId('provider-visit').filter({ hasText: `Cita ${sfx}` })).toContainText('1 nota');
    await expect(page.getByText('Aún no hay notas')).toBeVisible();
    await expect(page.getByRole('link', { name: /Agregar nota a la visita del/ })).toBeVisible();
    // A raw i18n key (a missing string) would read like `providers.visits.x`.
    await expect(page.locator('main')).not.toContainText(/providers\.visits\./);
    await checkA11y(page, 'doctor-visits-es', testInfo);

    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Agregar evento/ }).first().click();
    const form = page.getByRole('dialog');
    await form.locator('#event_type').selectOption('appointment');
    await expect(form.getByLabel('Doctor')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Agregar un doctor' })).toBeVisible();
    await expect(form.locator('#provider_id option').first()).toHaveText('Ninguno');
  });
});

test.describe('Visits & notes: dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the page, the doctor card and the Doctor field pass axe (contrast included) on the dark palette', async ({
    page,
    context,
    request,
    baseURL,
  }, testInfo) => {
    const s = await seed(context, request, baseURL, 'docdark');
    const sfx = uniqueSuffix().replace(/[^0-9a-z]/gi, '');
    const doc = await apiCreateDoctor(s.api, s.circleId, {
      name: `Dr. Dark ${sfx}`,
      specialty: 'Cardiology',
      address: '1 Night St',
      phone: '5552013344',
    });
    const withNote = await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: `E2E Dark visit ${sfx}`,
      scheduled_date: s.at(-4),
      provider_id: doc.id,
    });
    await apiAddNote(s.api, s.circleId, withNote.id, 'A note shown on the dark palette.');
    await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: `E2E Dark none ${sfx}`,
      scheduled_date: s.at(-8),
      provider_id: doc.id,
    });
    await apiCreateEvent(s.api, s.circleId, {
      event_type: 'appointment',
      title: `E2E Dark next ${sfx}`,
      scheduled_date: s.at(6),
      scheduled_time: '10:30',
      provider_id: doc.id,
    });

    await page.goto(`/circles/${s.circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(doctorCard(page, doc.name).getByRole('link', { name: /Visits & notes/ })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark').catch(() => undefined);
    await checkA11y(page, 'doctor-visits-dark-medical-info', testInfo);

    await gotoVisits(page, s.circleId, doc.id);
    await expect(page.getByTestId('provider-next-visit')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('A note shown on the dark palette.')).toBeVisible();
    await checkA11y(page, 'doctor-visits-dark-page', testInfo);

    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add event' }).first().click();
    const form = page.getByRole('dialog');
    await form.locator('#event_type').selectOption('appointment');
    await form.locator('#provider_id').selectOption({ label: `${doc.name} · Cardiology${doc.is_primary ? ' · Primary' : ''}` });
    await expect(form.getByText(`Filled in from ${doc.name}'s address`)).toBeVisible();
    await checkA11y(page, 'doctor-visits-dark-form', testInfo);
  });
});
