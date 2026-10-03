import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import {
  circleTimezone,
  createDailyMedication,
  dateInTz,
  dayCell,
  deleteSeries,
  escapeRegExp,
  gotoWeekContaining,
  markDoseTaken,
  openChip,
  setProfileLanguage,
  uniqueSuffix,
  weekOffset,
} from '../notesFirstClassShared';

// K11 (web test gaps 2026-09-29). The Calendar detail dialog writes the RIGHT
// status: "Skip dose" -> `skipped`, and a Mark taken on a dose that is long
// overdue -> `taken_late` (the late rule is judged in the CARE RECIPIENT's
// zone, backend medicationConfirmations.ts). After each write the reopened
// detail shows the recorded answer and no longer offers Mark taken / Skip dose.
// The time shown in "Skipped at ..." / "Taken late at ..." is the confirmation
// instant in the RECIPIENT's zone, so a viewer in another zone is checked too.
//
// NOT here: 500 / abort / timeouts (verify-before-alert owns those) and 409
// already-recorded (unhappy/writes/dose-second-caregiver.spec.ts).
//
// TIMEZONES (env, default Denver/Denver):
//   DOSE_VIEWER_TZ     the BROWSER's timezoneId
//   DOSE_RECIPIENT_TZ  the OWNER's profile zone = the care recipient's (no
//                      recipient account), so it can differ from the viewer's.

const VIEWER_TZ = process.env.DOSE_VIEWER_TZ ?? 'America/Denver';
const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: VIEWER_TZ });
test.setTimeout(120_000);

const CONFIRM = '/api/circles/:id/medications/confirm';

interface Row {
  status: string;
  confirmed_by: string;
  confirmed_at: string;
  scheduled_date: string;
}

const rowOn = (circleId: string, root: string, date: string): Row[] =>
  dbQuery<Row>(
    `select mc.status, mc.confirmed_by::text, mc.confirmed_at::text, ce.scheduled_date::text
       from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
      where ce.circle_id = ${sqlStr(circleId)}::uuid
        and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)
        and ce.scheduled_date = ${sqlStr(date)}::date`
  );

async function arrange(request: APIRequestContext, label: string) {
  const owner = await createScopedAccount(label);
  sqlExec(`update users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  const tz = await circleTimezone(session, circleId);
  expect(tz, 'recipient zone follows the owner profile zone').toBe(RECIPIENT_TZ);
  const name = `ZZ_E2E_SKIPCAL_${uniqueSuffix()}`;
  // Start -3 at 08:00: days -3 (the root itself), -2 and -1 are all long overdue.
  const root = await createDailyMedication(session, circleId, name, dateInTz(tz, -3), { time: '08:00' });
  return { owner, session, circleId, tz, name, root, titleRe: new RegExp(escapeRegExp(name)) };
}

/** Minutes past midnight of `instant` in `tz`. */
function minutesInZone(instant: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(
    new Date(instant)
  );
  return (Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
}

/** "10:14 AM" / "10:14" / "22:14" -> minutes past midnight. */
function minutesOfClock(text: string): number {
  const m = /(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?/.exec(text);
  if (!m) throw new Error(`no clock time in "${text}"`);
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}

/** Escape closes whatever dialogs are open (the detail may stay open behind Save). */
async function closeAllDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
}

/** Reopen the chip and assert the recorded answer + the gone actions. */
async function assertRecorded(
  page: Page,
  a: { date: string; titleRe: RegExp; row: Row; tz: string },
  copy: { badge: RegExp; markTaken: string; skipDose: string }
): Promise<Locator> {
  await closeAllDialogs(page);
  const detail = await openChip(page, a.date, a.titleRe);
  const badge = detail.getByText(copy.badge).first();
  await expect(badge).toBeVisible({ timeout: 15_000 });
  // The clock shown is the confirmation instant in the RECIPIENT's zone.
  expect(minutesOfClock((await badge.textContent()) ?? '')).toBe(minutesInZone(a.row.confirmed_at, a.tz));
  await expect(detail.getByRole('button', { name: copy.markTaken })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: copy.skipDose })).toHaveCount(0);
  return detail;
}

const EN = { markTaken: 'Mark taken', skipDose: 'Skip dose' };

test('(a) Skip dose on day -2: dialog pre-checks Skipped, DB skipped by the owner, reopened detail shows "Skipped at" and no actions', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'skcala');
  const day = dateInTz(s.tz, -2);
  try {
    await cookieLogin(context, s.owner, baseURL);
    await gotoWeekContaining(page, s.circleId, dateInTz(s.tz, 0), day);
    const detail = await openChip(page, day, s.titleRe);
    const posts = countRequests(page, 'POST', CONFIRM);

    await detail.getByRole('button', { name: 'Skip dose' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm medication' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole('radio', { name: 'Skipped' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Taken' })).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as skipped/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    await posts.expectCount(1);

    const rows = rowOn(s.circleId, s.root, day);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('skipped');
    expect(rows[0].confirmed_by).toBe(s.owner.userId);
    // The neighbouring days were not touched.
    expect(rowOn(s.circleId, s.root, dateInTz(s.tz, -1))).toHaveLength(0);
    expect(rowOn(s.circleId, s.root, dateInTz(s.tz, -3))).toHaveLength(0);

    await assertRecorded(page, { date: day, titleRe: s.titleRe, row: rows[0], tz: s.tz }, { badge: /^Skipped at /, ...EN });
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(b) Mark taken on day -1 (long overdue): DB taken_late, reopened detail shows "Taken late at" and no actions', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'skcalb');
  const day = dateInTz(s.tz, -1);
  try {
    await cookieLogin(context, s.owner, baseURL);
    await gotoWeekContaining(page, s.circleId, dateInTz(s.tz, 0), day);
    const detail = await openChip(page, day, s.titleRe);
    const posts = countRequests(page, 'POST', CONFIRM);

    await markDoseTaken(page, detail);
    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as taken/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    await posts.expectCount(1);

    const rows = rowOn(s.circleId, s.root, day);
    expect(rows).toHaveLength(1);
    // 08:00 yesterday in the recipient's zone is hours past the 30-minute grace.
    expect(rows[0].status).toBe('taken_late');
    expect(rows[0].confirmed_by).toBe(s.owner.userId);

    await assertRecorded(page, { date: day, titleRe: s.titleRe, row: rows[0], tz: s.tz }, { badge: /^Taken late at /, ...EN });
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(c) Spanish: Omitir dosis on day -3 writes skipped; copy and badge are Spanish', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'skcalc');
  const day = dateInTz(s.tz, -3);
  try {
    await cookieLogin(context, s.owner, baseURL);
    await setProfileLanguage(page, 'es');
    // stepWeeks() reads English labels; step with the Spanish button name.
    await page.goto(`/circles/${s.circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
    const steps = Math.abs(weekOffset(dateInTz(s.tz, 0), day));
    for (let i = 0; i < steps; i++) {
      const before = await page.locator('[role="gridcell"][data-date]').first().getAttribute('data-date');
      await page.getByRole('button', { name: 'Semana anterior' }).click();
      await expect(page.locator('[role="gridcell"][data-date]').first()).not.toHaveAttribute('data-date', before ?? '', {
        timeout: 25_000,
      });
    }
    await expect(dayCell(page, day).first()).toBeVisible({ timeout: 20_000 });

    const detail = await openChip(page, day, s.titleRe);
    const posts = countRequests(page, 'POST', CONFIRM);
    await detail.getByRole('button', { name: 'Omitir dosis' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirmar medicamento' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole('radio', { name: 'Omitido' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^\s*Marcado como omitido/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    await posts.expectCount(1);

    const rows = rowOn(s.circleId, s.root, day);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('skipped');
    expect(rows[0].confirmed_by).toBe(s.owner.userId);

    await assertRecorded(
      page,
      { date: day, titleRe: s.titleRe, row: rows[0], tz: s.tz },
      { badge: /^Omitido a las /, markTaken: 'Marcar como tomada', skipDose: 'Omitir dosis' }
    );
  } finally {
    await closeAllDialogs(page).catch(() => undefined);
    await setProfileLanguage(page, 'en').catch(() => undefined);
    await deleteSeries(s.session, s.circleId, s.root);
  }
});
