import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { apiSession, dbQuery, sqlStr, countRequests, type ApiSession } from '../unhappy';
import { checkA11y } from '../helpers';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';

// docs/plans/prn-medications.md — AS-NEEDED (PRN) medications, web, end to end
// against the real backend + the real DB (migration 20261005120000):
//
//   add (Repeat -> As needed, optional reason) -> card "Not given yet"
//   -> Gave a dose -> Undo (NO request) -> Gave a dose -> ONE POST, ONE row
//   -> "Last given … by you" -> dose log -> Remove (tombstone)
//   TWO PEOPLE: the second member's stale card -> 409 -> "Marco just logged a
//   dose. Log another?" -> acknowledge_recent -> two rows
//   VIEW-ONLY: no "Gave a dose" in the UI, and the server says 403 VIEW_ONLY.
//
// NO LIMITS: the card carries no counter, no "OK again", no warning.
//
// Run-scoped accounts only (own owner, own circle, own member).

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER_FIRST = 'Olivia';
const MEMBER_FIRST = 'Marco';

interface Scene {
  owner: ScopedAccount;
  ownerSession: ApiSession;
  member: ScopedAccount;
  memberSession: ApiSession;
  circleId: string;
}

async function scene(request: APIRequestContext): Promise<Scene> {
  const tag = uniq('prn').replace(/[^a-z0-9]/g, '');
  const owner = await createScopedAccount('prn-owner');
  // The recipient zone falls back to the OWNER's users.timezone, and createAccount
  // (e2e/isolation.ts) gives every scoped account America/Denver, the same zone the
  // browser contexts run in. The History/Calendar tests below assert RECIPIENT-zone
  // days against RECIPIENT_TZ (New York), so pin the owner to it here; otherwise the
  // two assertions only agree by coincidence of the clock (they split between 22:00
  // and 24:00 Denver, when New York is already on the next date).
  sqlExec(
    `update public.users set first_name = ${sqlStr(OWNER_FIRST)}, last_name = 'Owner', timezone = 'America/New_York' where id = ${sqlStr(owner.userId)}::uuid;`
  );
  const ownerSession = await apiSession(request, owner);
  const circleId = await createCircle(ownerSession, `prn ${tag}`);
  const member = await createScopedAccount('prn-member');
  sqlExec(
    `update public.users set first_name = ${sqlStr(MEMBER_FIRST)}, last_name = 'Member' where id = ${sqlStr(member.userId)}::uuid;`
  );
  const memberSession = await apiSession(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  return { owner, ownerSession, member, memberSession, circleId };
}

async function newCtx(browser: Browser, baseURL: string | undefined, acc: ScopedAccount): Promise<BrowserContext> {
  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const ctx = await browser.newContext({
    baseURL: origin,
    timezoneId: process.env.PW_E2E_TZ || 'America/Denver',
  });
  await cookieLogin(ctx, acc, baseURL);
  return ctx;
}

async function createPrn(session: ApiSession, circleId: string, name: string, reason = 'pain'): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '200 mg',
    scheduled_date: new Date().toISOString().slice(0, 10),
    as_needed: true,
    as_needed_reason: reason,
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const body = (await res.json()) as { data: { event: { id: string; as_needed: boolean } } };
  expect(body.data.event.as_needed).toBe(true);
  return body.data.event.id;
}

const doseRows = (eventId: string) =>
  dbQuery<{ id: string; client_request_id: string | null; note: string | null; removed_at: string | null; given_by: string }>(
    `select id, client_request_id, note, removed_at, given_by from medication_as_needed_doses where event_id = ${sqlStr(eventId)} order by created_at`
  );

async function gotoMeds(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Medications' })).toBeVisible({ timeout: 30_000 });
}

const cardOf = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });

test('add a PRN medication in the form: As needed hides the schedule, saves the reason, no limits', async ({
  browser,
  request,
  baseURL,
}) => {
  const s = await scene(request);
  const ctx = await newCtx(browser, baseURL, s.owner);
  try {
    const page = await ctx.newPage();
    const name = `Ibuprofen ${uniq('x').slice(-6)}`;
    await gotoMeds(page, s.circleId);
    await page.getByRole('button', { name: 'Add medication' }).first().click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/Medication name/i).fill(name);
    await form.getByLabel(/Dosage/i).fill('200 mg');

    await form.getByLabel('Repeat').selectOption('as_needed');
    // The schedule is gone; the one optional note is here; no limit fields.
    await expect(form.getByLabel(/^Time/)).toHaveCount(0);
    await expect(form.getByLabel(/^Date/)).toHaveCount(0);
    await expect(form.getByText("No reminders. As-needed medications don't have a schedule.")).toBeVisible();
    await expect(form.getByLabel(/minimum|maximum|interval/i)).toHaveCount(0);
    await form.getByLabel(/What is it for\?/).fill('back pain');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Medication added')).toBeVisible({ timeout: 20_000 });

    // Real DB row: no schedule, no reminders.
    const row = dbQuery<{
      as_needed: boolean;
      as_needed_reason: string | null;
      scheduled_time: string | null;
      recurrence_rule: string | null;
      reminder_at_due: boolean;
      id: string;
    }>(
      `select id, as_needed, as_needed_reason, scheduled_time, recurrence_rule, reminder_at_due from calendar_events where circle_id = ${sqlStr(s.circleId)} and medication_name = ${sqlStr(name)}`
    );
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({
      as_needed: true,
      as_needed_reason: 'back pain',
      scheduled_time: null,
      recurrence_rule: null,
      reminder_at_due: false,
    });

    // It lives in the As needed section, with "Not given yet" and a Gave a dose button.
    const section = page.getByRole('region', { name: 'As needed' });
    await expect(section.getByText(name)).toBeVisible();
    await expect(section.getByText('for back pain')).toBeVisible();
    await expect(section.getByTestId('as-needed-last-given')).toHaveText('Not given yet');

    // LOCKED after create: edit shows Repeat read-only, only the reason is editable.
    await cardOf(page, name).getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog');
    await expect(edit.getByTestId('as-needed-locked-repeat')).toBeVisible();
    await expect(edit.getByRole('combobox', { name: 'Repeat' })).toHaveCount(0);
    await edit.getByLabel(/What is it for\?/).fill('headache');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible({ timeout: 20_000 });
    expect(dbQuery<{ as_needed_reason: string }>(`select as_needed_reason from calendar_events where id = ${sqlStr(row[0].id)}`)[0].as_needed_reason).toBe('headache');

    // The server refuses to flip it (AS_NEEDED_IMMUTABLE).
    const flip = await s.ownerSession.patch(`/api/circles/${s.circleId}/events/${row[0].id}`, { as_needed: false });
    expect(flip.status()).toBe(400);
    expect(((await flip.json()) as { error: { code: string } }).error.code).toBe('AS_NEEDED_IMMUTABLE');
  } finally {
    await ctx.close();
  }
});

test('give a dose: Undo sends NOTHING; the second try writes ONE row with a client_request_id; remove tombstones it', async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  const s = await scene(request);
  const name = `Tylenol ${uniq('x').slice(-6)}`;
  const medId = await createPrn(s.ownerSession, s.circleId, name);
  const ctx = await newCtx(browser, baseURL, s.owner);
  try {
    const page = await ctx.newPage();
    await gotoMeds(page, s.circleId);
    const card = cardOf(page, name);
    await expect(card.getByTestId('as-needed-last-given')).toHaveText('Not given yet');

    const posts = countRequests(page, 'POST', '/api/circles/:id/medications/:id/as-needed-doses');

    // 1) Give -> Undo inside the window: no request, no row.
    await card.getByRole('button', { name: `Gave a dose of ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: `Log a dose of ${name}?` });
    await expect(dialog).toBeVisible();
    await checkA11y(page, 'as-needed log dialog', testInfo, { include: '[role="dialog"]' });
    await dialog.getByRole('button', { name: 'Log dose' }).click();
    await card.getByRole('button', { name: `Undo ${name}` }).click();
    await expect(card.getByRole('button', { name: `Gave a dose of ${name}` })).toBeVisible();
    await page.waitForTimeout(6_000);
    await posts.expectCount(0, { settleMs: 500 });
    expect(doseRows(medId)).toHaveLength(0);

    // 2) Give again with a note: ONE POST after the window.
    await card.getByRole('button', { name: `Gave a dose of ${name}` }).click();
    const dialog2 = page.getByRole('dialog', { name: `Log a dose of ${name}?` });
    await dialog2.getByLabel('Note').fill('after dinner');
    await dialog2.getByRole('button', { name: 'Log dose' }).click();
    await expect(card.getByRole('button', { name: `Undo ${name}` })).toBeVisible();
    expect(doseRows(medId), 'nothing written inside the undo window').toHaveLength(0);
    await expect(page.getByText('Dose logged')).toBeVisible({ timeout: 20_000 });
    await posts.expectCount(1, { settleMs: 500 });

    const rows = doseRows(medId);
    expect(rows).toHaveLength(1);
    expect(rows[0].client_request_id).toMatch(UUID);
    expect(rows[0].note).toBe('after dinner');
    expect(rows[0].given_by).toBe(s.owner.userId);

    // The card: "Last given … by you" — and NO counter, limit or warning.
    await expect(card.getByTestId('as-needed-last-given')).toContainText(/^Last given .* by you$/);
    const text = (await card.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/\d+ of \d+|in 24 ?h|OK again|limit|at least/i);

    // The activity feed got the new row (English).
    await page.goto(`/circles/${s.circleId}/activity`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(new RegExp(`Logged a dose: ${name}`)).first()).toBeVisible({ timeout: 20_000 });

    // 3) Dose history: remove it (confirm names the time and who).
    await gotoMeds(page, s.circleId);
    await card.getByRole('button', { name: `History for ${name}` }).click();
    const history = page.getByRole('dialog', { name: 'Dose history' });
    await expect(history.getByTestId('dose-row')).toHaveCount(1);
    await expect(history.getByText('“after dinner”')).toBeVisible();
    await history.getByRole('button', { name: /Remove this dose, logged at/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove this dose?' });
    await expect(confirm).toContainText(`by ${OWNER_FIRST} Owner`);
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByText('Dose removed')).toBeVisible({ timeout: 20_000 });
    const after = doseRows(medId);
    expect(after).toHaveLength(1);
    expect(after[0].removed_at, 'tombstoned, not deleted').not.toBeNull();
    // The removed row stays visible, struck through, with who removed it.
    const removedRow = page.getByRole('dialog', { name: 'Dose history' }).getByTestId('dose-row');
    await expect(removedRow).toHaveAttribute('data-removed', 'true');
    await expect(removedRow).toContainText(`Removed by ${OWNER_FIRST} Owner`);
  } finally {
    await ctx.close();
  }
});

test('two people: the second member\'s stale card gets 409 -> "Marco just logged a dose. Log another?" -> acknowledged retry; view-only sees no button', async ({
  browser,
  request,
  baseURL,
}) => {
  const s = await scene(request);
  const name = `Advil ${uniq('x').slice(-6)}`;
  const medId = await createPrn(s.ownerSession, s.circleId, name);
  const ctxO = await newCtx(browser, baseURL, s.owner);
  const ctxM = await newCtx(browser, baseURL, s.member);
  try {
    const ownerPage = await ctxO.newPage();
    const memberPage = await ctxM.newPage();
    // Both load the card while NOBODY has logged yet — the member's copy goes stale.
    await gotoMeds(memberPage, s.circleId);
    await expect(cardOf(memberPage, name).getByTestId('as-needed-last-given')).toHaveText('Not given yet');
    await gotoMeds(ownerPage, s.circleId);

    // The OWNER logs a dose through the UI.
    const oCard = cardOf(ownerPage, name);
    await oCard.getByRole('button', { name: `Gave a dose of ${name}` }).click();
    await ownerPage
      .getByRole('dialog', { name: `Log a dose of ${name}?` })
      .getByRole('button', { name: 'Log dose' })
      .click();
    await expect(ownerPage.getByText('Dose logged')).toBeVisible({ timeout: 20_000 });
    expect(doseRows(medId)).toHaveLength(1);

    // The MEMBER (stale card: still "Not given yet") logs too -> the server says
    // someone just did.
    const mCard = cardOf(memberPage, name);
    await expect(mCard.getByTestId('as-needed-last-given')).toHaveText('Not given yet');
    const mPosts = countRequests(memberPage, 'POST', '/api/circles/:id/medications/:id/as-needed-doses');
    await mCard.getByRole('button', { name: `Gave a dose of ${name}` }).click();
    await memberPage
      .getByRole('dialog', { name: `Log a dose of ${name}?` })
      .getByRole('button', { name: 'Log dose' })
      .click();
    const prompt = memberPage.getByRole('dialog', { name: `${OWNER_FIRST} just logged a dose` });
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await expect(prompt).toContainText(`${OWNER_FIRST} logged ${name}`);
    // The 409 wrote NOTHING.
    expect(doseRows(medId)).toHaveLength(1);
    await mPosts.expectCount(1, { settleMs: 500 });

    // "Log another dose": the same dose is re-sent, acknowledged.
    await prompt.getByRole('button', { name: 'Log another dose' }).click();
    await expect(memberPage.getByText('Dose logged')).toBeVisible({ timeout: 20_000 });
    const rows = doseRows(medId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.given_by).sort()).toEqual([s.owner.userId, s.member.userId].sort());
    // Both requests carried the SAME client_request_id (idempotent replay key).
    expect(mPosts.count).toBe(2);
    const bodies = mPosts.requests.map((r) => r.postDataJSON() as Record<string, unknown>);
    expect(bodies[1].client_request_id).toBe(bodies[0].client_request_id);
    expect(bodies[1].acknowledge_recent).toBe(true);
    expect('acknowledge_recent' in bodies[0]).toBe(false);

    // A re-sent request with the SAME id is a replay, not a third dose.
    const replay = await s.memberSession.post(`/api/circles/${s.circleId}/medications/${medId}/as-needed-doses`, {
      client_request_id: bodies[0].client_request_id,
      acknowledge_recent: true,
    });
    expect(replay.status()).toBe(200);
    expect(doseRows(medId)).toHaveLength(2);

    // VIEW-ONLY: the seat flag is stored, the UI hides the button, the server refuses.
    sqlExec(
      `update public.circle_memberships set view_only = true where circle_id = ${sqlStr(s.circleId)}::uuid and user_id = ${sqlStr(s.member.userId)}::uuid;`
    );
    await gotoMeds(memberPage, s.circleId);
    await expect(cardOf(memberPage, name).getByTestId('as-needed-last-given')).toBeVisible();
    await expect(memberPage.getByRole('button', { name: /Gave a dose/ })).toHaveCount(0);
    await expect(memberPage.getByRole('button', { name: `History for ${name}` })).toBeVisible();
    const refused = await s.memberSession.post(`/api/circles/${s.circleId}/medications/${medId}/as-needed-doses`, {
      client_request_id: '7d1d6f4c-4f2e-4d5e-9d0a-2f3b8c7a1e55',
    });
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('VIEW_ONLY');
    expect(doseRows(medId)).toHaveLength(2);
  } finally {
    await ctxO.close();
    await ctxM.close();
  }
});

test('Home: the As needed section is its own list and never makes "all done"; Spanish copy', async ({
  browser,
  request,
  baseURL,
}) => {
  const s = await scene(request);
  const name = `Ibuprofeno ${uniq('x').slice(-6)}`;
  await createPrn(s.ownerSession, s.circleId, name, 'dolor');
  const ctx = await newCtx(browser, baseURL, s.owner);
  try {
    const page = await ctx.newPage();
    await page.goto(`/circles/${s.circleId}`, { waitUntil: 'domcontentloaded' });
    const section = page.getByRole('region', { name: 'As needed' });
    await expect(section.getByText(name)).toBeVisible({ timeout: 30_000 });
    // A circle with only an as-needed medication is NOT a first-run circle and has no dose to answer.
    await expect(page.getByText(/No medications yet/)).toHaveCount(0);
    await expect(page.getByText('All medications answered for today')).toHaveCount(0);
    await expect(section.getByRole('button', { name: /^Confirm|^Skip/ })).toHaveCount(0);

    // Spanish.
    sqlExec(`update public.users set language = 'es' where id = ${sqlStr(s.owner.userId)}::uuid;`);
    await page.goto(`/circles/${s.circleId}`, { waitUntil: 'domcontentloaded' });
    const seccion = page.getByRole('region', { name: 'Según se necesite' });
    await expect(seccion.getByText(name)).toBeVisible({ timeout: 30_000 });
    await expect(seccion.getByText('para dolor')).toBeVisible();
    await expect(seccion.getByTestId('as-needed-last-given')).toHaveText('Aún no se ha dado');
    await seccion.getByRole('button', { name: `Di una dosis de ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: `¿Registrar una dosis de ${name}?` });
    await expect(dialog.getByRole('button', { name: 'Registrar dosis' })).toBeVisible();
    await expect(dialog.getByText('Todos en el círculo lo verán.')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// History tab merge, calendar marker, recipient "you" copy (web half of the
// remaining PRN pieces). Doses are written through the real API (the give/undo
// UI flow is covered above); what is under test here is how they are READ back.
// ---------------------------------------------------------------------------

/** The circle is created with the API default recipient zone (New York). */
const RECIPIENT_TZ = 'America/New_York';

const dayIn = (tz: string, at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The instant that reads `hh:mm` on the day BEFORE `now`, in `tz`. */
function yesterdayAtLocal(tz: string, now: Date, hh: number, mm: number): Date {
  const yesterday = dayIn(tz, new Date(now.getTime() - 24 * 3_600_000));
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let t = now.getTime() - 47 * 3_600_000; t < now.getTime(); t += 60_000) {
    const at = new Date(t);
    if (dayIn(tz, at) === yesterday && fmt.format(at) === `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) {
      return at;
    }
  }
  throw new Error('no such instant');
}

async function logDose(
  session: ApiSession,
  circleId: string,
  eventId: string,
  body: { given_at?: string; note?: string } = {}
): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/medications/${eventId}/as-needed-doses`, {
    client_request_id: crypto.randomUUID(),
    acknowledge_recent: true,
    ...body,
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ((await res.json()) as { data: { dose: { id: string } } }).data.dose.id;
}

test('History tab: PRN doses sit in their RECIPIENT-zone day group; a removed dose is struck through with "Removed by"', async ({
  browser,
  request,
  baseURL,
}) => {
  const s = await scene(request);
  const name = `Ibuprofen ${uniq('x').slice(-6)}`;
  const medId = await createPrn(s.ownerSession, s.circleId, name);
  const now = new Date();
  await logDose(s.ownerSession, s.circleId, medId, { note: 'after lunch' });
  // YESTERDAY 21:30 in the RECIPIENT's zone: in UTC that instant is already TODAY's
  // date, so a day grouped by the UTC date (or `given_at.split('T')[0]`) lands
  // under "Today" instead of "Yesterday".
  const old = yesterdayAtLocal(RECIPIENT_TZ, now, 21, 30);
  await logDose(s.ownerSession, s.circleId, medId, { given_at: old.toISOString() });
  const removedId = await logDose(s.ownerSession, s.circleId, medId, {
    given_at: new Date(now.getTime() - 20 * 60_000).toISOString(),
    note: 'tapped twice',
  });
  const rm = await s.memberSession.post(
    `/api/circles/${s.circleId}/medications/${medId}/as-needed-doses/${removedId}/remove`,
    {}
  );
  expect(rm.status(), await rm.text()).toBeLessThan(300);

  const ctx = await newCtx(browser, baseURL, s.owner);
  try {
    const page = await ctx.newPage();
    await page.goto(`/circles/${s.circleId}/meds?tab=history`, { waitUntil: 'domcontentloaded' });
    const rows = page.getByTestId('history-dose-row');
    await expect(rows).toHaveCount(3, { timeout: 30_000 });
    // No empty state: only PRN doses exist.
    await expect(page.getByText('No medication history')).toHaveCount(0);

    // The newest live dose: "Given · name · by <you>" under TODAY (recipient zone).
    const live = rows.filter({ hasText: 'after lunch' });
    await expect(live).toHaveAttribute('aria-label', `Given · ${name} · by ${OWNER_FIRST} Owner`);
    await expect(live).toContainText(`by ${OWNER_FIRST} Owner`);
    await expect(live).toHaveAttribute('data-removed', 'false');
    await expect(page.locator('section').filter({ has: live }).getByRole('heading', { level: 3 })).toHaveText('Today');

    // That dose lives in the RECIPIENT's yesterday (not the browser's, not UTC's).
    const expectedHeading = 'Yesterday';
    const olderRow = rows.filter({ hasNotText: /after lunch|tapped twice/ });
    await expect(page.locator('section').filter({ has: olderRow }).getByRole('heading', { level: 3 })).toHaveText(
      expectedHeading
    );

    // The removed dose: struck through, muted, and says who removed it.
    const removed = rows.filter({ hasText: 'tapped twice' });
    await expect(removed).toHaveAttribute('data-removed', 'true');
    await expect(removed).toContainText(`Removed by ${MEMBER_FIRST} Member`);
    await expect(removed.locator('.line-through').first()).toBeVisible();
    expect(
      await removed.getByText(name, { exact: true }).evaluate((el) => getComputedStyle(el.closest('p')!).textDecorationLine)
    ).toContain('line-through');

    // The filter offers the as-needed medication's NAME.
    await page.getByRole('button', { name: /Filter by:/ }).click();
    await page.getByRole('menuitem', { name }).click();
    await expect(rows).toHaveCount(3);
  } finally {
    await ctx.close();
  }
});

test('Calendar: a day with logged doses gets the marker and a day row that opens THAT medication\'s dose history (removed doses do not count)', async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  const s = await scene(request);
  const name = `Advil ${uniq('x').slice(-6)}`;
  const medId = await createPrn(s.ownerSession, s.circleId, name);
  await logDose(s.ownerSession, s.circleId, medId);
  await logDose(s.ownerSession, s.circleId, medId);
  const gone = await logDose(s.ownerSession, s.circleId, medId);
  const rm = await s.ownerSession.post(
    `/api/circles/${s.circleId}/medications/${medId}/as-needed-doses/${gone}/remove`,
    {}
  );
  expect(rm.status(), await rm.text()).toBeLessThan(300);

  const ctx = await newCtx(browser, baseURL, s.owner);
  try {
    const page = await ctx.newPage();
    const eventsReads = countRequests(page, 'GET', '/api/circles/:id/events');
    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Month', exact: true }).click();
    const today = dayIn(RECIPIENT_TZ, new Date());
    const cell = page.locator(`button[data-date="${today}"]`);
    await expect(cell).toBeVisible({ timeout: 30_000 });
    await expect(cell).toHaveAttribute('aria-label', /as-needed dose given/);
    await expect(cell.getByTestId('as-needed-marker')).toBeVisible();
    // Another day has no marker.
    await expect(page.getByTestId('as-needed-marker')).toHaveCount(1);

    await cell.click();
    const panel = page.getByRole('complementary');
    const row = panel.getByTestId('as-needed-day-row');
    await expect(row).toContainText(name);
    // No count of any kind on an as-needed row (owner rule).
    await expect(row).toContainText('Given as needed');
    await expect(row.getByText('Given as needed')).not.toHaveText(/\d/);
    await expect(row).toHaveText(`${name}Given as needed`);
    await checkA11y(page, 'calendar as-needed day panel', testInfo, { include: '[aria-label]' });

    await row.click();
    const history = page.getByRole('dialog', { name: 'Dose history' });
    await expect(history).toBeVisible();
    await expect(history.getByText(`Every dose logged for ${name}, newest first.`)).toBeVisible();
    // The per-medication log still shows the removed dose (struck through).
    await expect(history.getByTestId('dose-row')).toHaveCount(3);
    await expect(history.locator('[data-removed="true"]')).toHaveCount(1);

    // The calendar's OWN event read never asks for as-needed rows.
    for (const req of eventsReads.requests) {
      expect(new URL(req.url()).searchParams.has('includeAsNeeded')).toBe(false);
    }
  } finally {
    await ctx.close();
  }
});

test('the care recipient is asked "Did you take …?"; a caregiver keeps "Log a dose of …?"', async ({
  browser,
  request,
  baseURL,
}) => {
  const s = await scene(request);
  const name = `Tums ${uniq('x').slice(-6)}`;
  await createPrn(s.ownerSession, s.circleId, name);
  // A self-care circle flags the owner's own seat; do the same to the owner here.
  sqlExec(
    `update public.circle_memberships set is_care_recipient = true where circle_id = ${sqlStr(s.circleId)}::uuid and user_id = ${sqlStr(s.owner.userId)}::uuid;`
  );
  const ctxO = await newCtx(browser, baseURL, s.owner);
  const ctxM = await newCtx(browser, baseURL, s.member);
  try {
    const owner = await ctxO.newPage();
    await gotoMeds(owner, s.circleId);
    await cardOf(owner, name).getByRole('button', { name: `Gave a dose of ${name}` }).click();
    const self = owner.getByRole('dialog', { name: `Did you take ${name}?` });
    await expect(self).toBeVisible();
    await expect(self.getByText('Everyone in your circle will see this.')).toBeVisible();
    await expect(self.getByRole('button', { name: 'Log that you took a dose' })).toBeVisible();

    const member = await ctxM.newPage();
    await gotoMeds(member, s.circleId);
    await cardOf(member, name).getByRole('button', { name: `Gave a dose of ${name}` }).click();
    const third = member.getByRole('dialog', { name: `Log a dose of ${name}?` });
    await expect(third).toBeVisible();
    await expect(third.getByRole('button', { name: 'Log dose' })).toBeVisible();
    await expect(member.getByText(`Did you take ${name}?`)).toHaveCount(0);
  } finally {
    await ctxO.close();
    await ctxM.close();
  }
});
