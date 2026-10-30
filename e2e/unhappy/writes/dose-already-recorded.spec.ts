import { randomUUID } from 'node:crypto';
import { test, expect, uniqueLabel } from '../../fixtures';
import { sqlExec } from '../../db';
import { dbQuery, sqlStr } from '../../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../auth-invites/_helpers';
import { dateInZone, escapeRe, purgeEventsTitled, recipientTimezone } from './_helpers';

// PK1 (decided 2026-09-29) — TWO CAREGIVERS, ONE DOSE, TWO BROWSERS.
//
// "I wouldn't overwrite. Just warn I guess user xyz already marked it?"
//
// Caregiver A (the circle's owner) and caregiver B (a member) both have Today
// open on the same dose. A SKIPS it (through her own real session). B's page is STALE -
// it drew the dose before A answered and still offers Taken - and B presses it.
// (Today's Next up has one action per row, so there is no Skip there; the
// conflict is the same one.) Run in a fresh circle of its own: Next up shows
// only the first 3 rows, and a cloned demo circle has more than that due. The real backend refuses to overwrite A
// (409 DOSE_ALREADY_RECORDED); B must see "Already skipped by <A> at
// <time>." as a calm status toast (never an error), B's row must refetch to
// A's answer, and the DB row must still be A's Skipped.
//
// NOTHING IS INJECTED: two real sessions, the real backend, the real DB.

test.use({ storageState: { cookies: [], origins: [] } });
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

/** Wait for the dose's row in Today's Next up. */
async function revealDose(page: import('@playwright/test').Page, title: string) {
  const card = page.getByRole('region', { name: 'Next up' });
  await expect(card.getByRole('button', { name: `Taken, ${title}` })).toBeVisible({ timeout: 20_000 });
}

test('A skips the dose; B\'s stale page presses Taken → calm "already skipped by A", DB keeps A\'s answer', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const a = await createScopedAccount('dar-a');
  const b = await createScopedAccount('dar-b');
  sqlExec(`update users set timezone = 'America/Denver', first_name = 'Ana' where id = ${sqlStr(a.userId)}::uuid;`);
  const apiA = await ownerApi(request, a);
  const circleId = await createCircle(apiA, uniq('dar'));
  sqlExec(`insert into circle_memberships (circle_id, user_id, role, is_care_recipient, joined_at, view_only)
           values (${sqlStr(circleId)}::uuid, ${sqlStr(b.userId)}::uuid, 'member', false, now(), false);`);
  const personaHandle = { ownerEmail: a.email, ownerUserId: a.userId };
  const tz = await recipientTimezone(apiA, circleId);
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

  try {
    // ── B's page draws the dose FIRST (it will be stale). ──────────────────
    await cookieLogin(context, b, baseURL);
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await revealDose(page, title);
    const takenB = page.getByRole('button', { name: `Taken, ${title}` });

    // ── A SKIPS the dose (Next up has no Skip button, so through her own real session). ──
    // B's stale page still offers Taken; a Taken over A's different answer is the conflict.
    const skipA = await apiA.post(`/api/circles/${circleId}/medications/confirm`, {
      event_id: med.id,
      status: 'skipped',
      scheduled_time: `${time}:00`,
    });
    expect(skipA.status(), await skipA.text()).toBe(201);

    const rowAfterA = dbQuery<{ confirmed_by: string; status: string; confirmed_at: string }>(
      `select confirmed_by::text, status, confirmed_at::text from medication_confirmations where event_id = ${sqlStr(med.id)}::uuid`
    );
    expect(rowAfterA).toHaveLength(1);
    expect(rowAfterA[0].confirmed_by).toBe(personaHandle.ownerUserId);
    expect(rowAfterA[0].status).toBe('skipped');

    // ── B's STALE page still offers Taken. B presses it. ────────────────────
    await expect(takenB).toBeVisible();
    const answeredB = page.waitForResponse((r) => r.request().method() === 'POST' && CONFIRM.test(new URL(r.url()).pathname), {
      timeout: 40_000,
    });
    await takenB.click();
    const resB = await answeredB;
    expect(resB.status(), "B's Taken is refused, not written").toBe(409);
    expect(((await resB.json()) as { error: { code: string } }).error.code).toBe('DOSE_ALREADY_RECORDED');

    // The calm who-and-when message, as a STATUS toast — never an alert.
    const who = ownerName ? escapeRe(ownerName) : 'another caregiver';
    const message = new RegExp(`Already skipped by ${who} at \\d{1,2}:\\d{2}( [AP]M)?\\.`);
    await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert').filter({ hasText: /couldn|fail/i })).toHaveCount(0);

    // B's row refetched to A's answer: no Taken left for this dose.
    await expect(page.getByRole('button', { name: `Taken, ${title}` })).toHaveCount(0, { timeout: 10_000 });

    // The DB is byte-identical to A's answer.
    const rowAfterB = dbQuery<{ confirmed_by: string; status: string; confirmed_at: string }>(
      `select confirmed_by::text, status, confirmed_at::text from medication_confirmations where event_id = ${sqlStr(med.id)}::uuid`
    );
    expect(rowAfterB).toEqual(rowAfterA);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});
