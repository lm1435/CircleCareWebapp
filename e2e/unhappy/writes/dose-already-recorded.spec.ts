import { randomUUID } from 'node:crypto';
import { test, expect, uniqueLabel } from '../../fixtures';
import { sqlExec } from '../../db';
import { ACCOUNT_PASSWORD } from '../../isolation';
import { apiSession, dbQuery, sqlStr } from '../../unhappy';
import { dateInZone, escapeRe, purgeEventsTitled, recipientTimezone } from './_helpers';

// PK1 (decided 2026-09-29) — TWO CAREGIVERS, ONE DOSE, TWO BROWSERS.
//
// "I wouldn't overwrite. Just warn I guess user xyz already marked it?"
//
// Caregiver A (the circle's owner) and caregiver B (the freeMember persona)
// both have Home open on the same dose. A marks it Taken in HER browser. B's
// page is STALE — it drew the dose before A answered and still offers
// Take/Skip — and B presses Skip. The real backend refuses to overwrite A
// (409 DOSE_ALREADY_RECORDED); B must see "Already marked taken by <A> at
// <time>." as a calm status toast (never an error), B's row must refetch to
// A's answer, and the DB row must still be A's Taken.
//
// NOTHING IS INJECTED: two real sessions, the real backend, the real DB.

test.use({ persona: 'freeMember' });
// Two browsers, two 5 s undo windows, two Home paints: well past the default budget
// on a loaded machine.
test.setTimeout(120_000);

const CONFIRM = /\/api\/circles\/[^/]+\/medications\/confirm$/;

/** HH:MM for `now − minutes` in `tz`, or null when that is yesterday there. */
function pastTimeInZone(tz: string, minutes: number): string | null {
  const at = new Date(Date.now() - minutes * 60_000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  if (day !== dateInZone(tz, 0)) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Wait for the dose's row on Home's Today's medications, expanding the card if it is past the limit. */
async function revealDose(page: import('@playwright/test').Page, title: string) {
  const card = page.getByRole('region', { name: "Today's medications" });
  const skip = card.getByRole('button', { name: `Skip ${title}` });
  // Two lists can each carry a "Show all" (Needs attention, then today's).
  const showAll = card.getByRole('button', { name: /^Show all/ });
  await expect(skip.or(showAll.first()).first()).toBeVisible({ timeout: 20_000 });
  while (!(await skip.isVisible()) && (await showAll.count()) > 0) {
    await showAll.last().click();
  }
  await expect(skip).toBeVisible({ timeout: 10_000 });
}

test('A marks Taken in her browser; B\'s stale page presses Skip → calm "already marked taken by A", DB keeps A\'s answer', async ({
  page,
  browser,
  request,
  account,
  circleId,
  personaHandle,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const ownerLogin = { email: personaHandle.ownerEmail, password: ACCOUNT_PASSWORD };
  const apiB = await apiSession(request, account);
  const tz = await recipientTimezone(apiB, circleId);
  const time = pastTimeInZone(tz, 30);
  test.skip(time === null, 'within 30 minutes of midnight in the recipient zone — no past dose today');

  const title = uniqueLabel('PK1 dose');
  // Seeded as a ROW, not through POST /events: the create route's medication
  // start-roll moves a dose whose time has already passed today to TOMORROW
  // (the late-add rule), and this test needs a dose that is due right now.
  const med = { id: randomUUID() };
  sqlExec(`
    insert into calendar_events
      (id, circle_id, event_type, title, medication_name, scheduled_date, scheduled_time,
       notifications_enabled, created_by)
    values (${sqlStr(med.id)}::uuid, ${sqlStr(circleId)}::uuid, 'medication', ${sqlStr(title)}, ${sqlStr(title)},
            ${sqlStr(dateInZone(tz, 0))}::date, ${sqlStr(`${time}:00`)}::time, false,
            ${sqlStr(personaHandle.ownerUserId)}::uuid)`);

  const ownerName =
    dbQuery<{ first_name: string | null }>(
      `select first_name from users where email = ${sqlStr(personaHandle.ownerEmail)}`
    )[0]?.first_name?.trim() || null;

  const ctxA = await browser.newContext({ baseURL: origin });
  try {
    // ── B's page draws the dose FIRST (it will be stale). ──────────────────
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await revealDose(page, title);
    const skipB = page.getByRole('button', { name: `Skip ${title}` });

    // ── A answers Taken in HER OWN browser. ────────────────────────────────
    const login = await ctxA.request.post('/api/auth/login', {
      headers: { 'X-Session-Mode': 'cookie', Origin: origin },
      data: ownerLogin,
    });
    expect(login.status(), await login.text()).toBe(200);
    const pageA = await ctxA.newPage();
    await pageA.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await revealDose(pageA, title);
    const takeA = pageA.getByRole('button', { name: `Confirm ${title}` });
    const answeredA = pageA.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM.test(new URL(r.url()).pathname), {
      timeout: 40_000,
    });
    await takeA.click();
    expect((await answeredA).status(), "A's Taken (after her 5 s undo window)").toBe(201);

    const rowAfterA = dbQuery<{ confirmed_by: string; status: string; confirmed_at: string }>(
      `select confirmed_by::text, status, confirmed_at::text from medication_confirmations where event_id = ${sqlStr(med.id)}::uuid`
    );
    expect(rowAfterA).toHaveLength(1);
    expect(rowAfterA[0].confirmed_by).toBe(personaHandle.ownerUserId);
    expect(rowAfterA[0].status).toMatch(/^taken/);

    // ── B's STALE page still offers Skip. B presses it. ────────────────────
    await expect(skipB).toBeVisible();
    const answeredB = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM.test(new URL(r.url()).pathname), {
      timeout: 40_000,
    });
    await skipB.click();
    const resB = await answeredB;
    expect(resB.status(), "B's Skip is refused, not written").toBe(409);
    expect(((await resB.json()) as { error: { code: string } }).error.code).toBe('DOSE_ALREADY_RECORDED');

    // The calm who-and-when message, as a STATUS toast — never an alert.
    const who = ownerName ? escapeRe(ownerName) : 'another caregiver';
    const message = new RegExp(`Already marked taken by ${who} at \\d{1,2}:\\d{2}( [AP]M)?\\.`);
    await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert').filter({ hasText: /couldn|fail/i })).toHaveCount(0);

    // B's row refetched to A's answer: no Skip/Take left for this dose.
    await expect(page.getByRole('button', { name: `Skip ${title}` })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: `Confirm ${title}` })).toHaveCount(0);

    // The DB is byte-identical to A's answer.
    const rowAfterB = dbQuery<{ confirmed_by: string; status: string; confirmed_at: string }>(
      `select confirmed_by::text, status, confirmed_at::text from medication_confirmations where event_id = ${sqlStr(med.id)}::uuid`
    );
    expect(rowAfterB).toEqual(rowAfterA);
  } finally {
    await ctxA.close().catch(() => undefined);
    purgeEventsTitled(circleId, title);
  }
});
