import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { apiSession, type ApiSession } from './unhappy';
import { sqlExec } from './db';

// Shared helpers for the notes-first-class + medication-remove-occurrence e2e
// coverage (docs/plans/notes-first-class.md, docs/plans/medication-remove-occurrence.md).
// Modeled directly on the patterns already established in
// flows/medication-notes.spec.ts and flows/notes-feed.spec.ts — extracted here
// because ten new specs share them and duplicating ~200 lines ten times would
// make the real assertions harder to find, not easier.

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Date math, all in the CARE RECIPIENT's timezone -----------------------

export function toUTCms(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysISO(dateStr: string, days: number): string {
  return new Date(toUTCms(dateStr) + days * 86_400_000).toISOString().slice(0, 10);
}

export function dayOfWeek(dateStr: string): number {
  return new Date(toUTCms(dateStr)).getUTCDay();
}

/** Whole weeks from the week containing `fromDate` to the week containing `toDate`. */
export function weekOffset(fromDate: string, toDate: string): number {
  const fromWeekStart = addDaysISO(fromDate, -dayOfWeek(fromDate));
  const toWeekStart = addDaysISO(toDate, -dayOfWeek(toDate));
  return Math.round((toUTCms(toWeekStart) - toUTCms(fromWeekStart)) / (7 * 86_400_000));
}

export function dateInTz(tz: string, offsetDays: number): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export async function circleTimezone(session: ApiSession, circleId: string): Promise<string> {
  const res = await session.get(`/api/circles/${circleId}`);
  if (!res.ok()) {
    throw new Error(`GET /api/circles/${circleId} failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: { circle?: { care_recipient_timezone?: string } } };
  return body?.data?.circle?.care_recipient_timezone || 'America/New_York';
}

export { apiSession };
export type { ApiSession };

// --- Event creation (API) ---------------------------------------------------

export interface CreatedEvent {
  id: string;
}

export interface CreateMedOptions {
  time?: string;
  dosage?: string;
  refillGroupId?: string;
  trackRefills?: boolean;
  quantityRemaining?: number;
}

export async function createDailyMedication(
  session: ApiSession,
  circleId: string,
  name: string,
  startDate: string,
  opts: CreateMedOptions = {}
): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: opts.dosage ?? '10mg',
    scheduled_date: startDate,
    scheduled_time: opts.time ?? '08:00',
    recurrence_rule: 'daily',
    ...(opts.refillGroupId ? { refill_group_id: opts.refillGroupId } : {}),
    ...(opts.trackRefills ? { track_refills: true, quantity_remaining: opts.quantityRemaining ?? 30 } : {}),
  });
  if (!res.ok()) {
    throw new Error(`create daily medication failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { event: CreatedEvent } };
  return body.data.event.id;
}

export async function createAppointment(
  session: ApiSession,
  circleId: string,
  title: string,
  date: string,
  time = '10:00'
): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'appointment',
    title,
    scheduled_date: date,
    scheduled_time: time,
  });
  if (!res.ok()) {
    throw new Error(`create appointment failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { event: CreatedEvent } };
  return body.data.event.id;
}

export async function deleteSeries(session: ApiSession, circleId: string, rootId: string): Promise<void> {
  await session.delete(`/api/circles/${circleId}/events/${rootId}?deleteScope=series`).catch(() => {});
}

export async function deleteEventById(session: ApiSession, circleId: string, eventId: string): Promise<void> {
  await session.delete(`/api/circles/${circleId}/events/${eventId}`).catch(() => {});
}

/** Force the (clock-bound) materializer to run NOW — mints physical children
 *  for today/+1/+2 in the care recipient's timezone for every eligible
 *  recurring parent. Local-only (sqlExec asserts it). */
export function materializeRecurringInstances(): void {
  sqlExec('select materialize_recurring_instances();');
}

// --- Calendar navigation -----------------------------------------------------

export async function gotoCalendarSettled(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
}

const WEEK_RANGE_HEADING = /^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}, \d{4}$/;

export async function stepWeeks(page: Page, weeks: number): Promise<void> {
  if (weeks === 0) return;
  const label = weeks < 0 ? 'Previous week' : 'Next week';
  const range = page.getByRole('heading', { level: 2, name: WEEK_RANGE_HEADING });
  for (let i = 0; i < Math.abs(weeks); i++) {
    await expect(range).toBeVisible({ timeout: 25_000 });
    const from = (await range.textContent())?.trim() ?? '';
    await page.getByRole('button', { name: label }).click();
    await expect(range, `week range moved off "${from}"`).not.toHaveText(from, { timeout: 25_000 });
  }
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 25_000 });
}

/** The WeekView gridcell for `date` — works for both the timed grid
 *  (medications) and the all-day row (tasks/appointments); both mark `data-date`. */
export function dayCell(page: Page, date: string): Locator {
  return page.locator(`[role="gridcell"][data-date="${date}"]`);
}

export async function gotoWeekContaining(
  page: Page,
  circleId: string,
  todayInTz: string,
  date: string
): Promise<void> {
  await gotoCalendarSettled(page, circleId);
  await stepWeeks(page, weekOffset(todayInTz, date));
  await expect(dayCell(page, date).first()).toBeVisible({ timeout: 20_000 });
}

// --- Event detail dialog helpers ---------------------------------------------

export async function openChip(page: Page, date: string, titleRe: RegExp): Promise<Locator> {
  const chip = dayCell(page, date).getByRole('button', { name: titleRe });
  await expect(chip.first()).toBeVisible({ timeout: 20_000 });
  await chip.first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

export async function closeDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close event details' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
}

export async function assertChipAbsent(page: Page, date: string, titleRe: RegExp): Promise<void> {
  // The day itself must be on screen first — otherwise a date outside the
  // displayed (Sunday-start) week has no cell and "0 chips" passes vacuously.
  await expect(dayCell(page, date).first(), `day cell ${date} must be rendered`).toBeVisible({
    timeout: 20_000,
  });
  await expect(dayCell(page, date).getByRole('button', { name: titleRe })).toHaveCount(0, {
    timeout: 15_000,
  });
}

export async function assertChipPresent(page: Page, date: string, titleRe: RegExp): Promise<void> {
  await expect(dayCell(page, date).getByRole('button', { name: titleRe }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Delete the currently-open detail dialog's MEDICATION dose via the real "This
 * dose only" / "This and all future doses" flow. Every caller is a medication
 * spec, and the dialog names the item type ("Delete medication"). More actions
 * -> Delete -> (recurring) pick the scope radio -> Delete. Leaves the detail dialog closed
 * and the DeleteEventDialog dismissed once the request settles.
 */
export async function deleteViaMoreMenu(
  page: Page,
  detailDialog: Locator,
  scope: 'single' | 'future'
): Promise<void> {
  await detailDialog.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  // NOTE: `detailDialog` is a generic `page.getByRole('dialog')` locator, so
  // it matches whichever dialog is on screen — the detail modal closes and
  // DeleteEventDialog opens in its place, and the dialog COUNT never drops to
  // 0 in between. Wait for the SPECIFIC delete dialog instead of asserting
  // the old one's disappearance.
  const deleteDialog = page.getByRole('dialog', { name: 'Delete medication' });
  await expect(deleteDialog).toBeVisible({ timeout: 10_000 });
  if (scope === 'future') {
    await deleteDialog.getByRole('radio', { name: 'This and all future doses' }).check();
  }
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(deleteDialog).toHaveCount(0, { timeout: 20_000 });
}

/** Mark a dose Taken from its (already-open) detail dialog's action row. */
export async function markDoseTaken(page: Page, detailDialog: Locator): Promise<void> {
  await detailDialog.getByRole('button', { name: 'Mark taken' }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'Confirm medication' });
  await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
  await confirmDialog.getByRole('button', { name: 'Save' }).click();
  await expect(confirmDialog).toBeHidden({ timeout: 20_000 });
}

// --- Activity feed ------------------------------------------------------------

export async function gotoActivitySettled(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/activity`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading activity...')).toHaveCount(0, { timeout: 20_000 });
}

// --- Profile language ---------------------------------------------------------

/**
 * Set the profile language, IDEMPOTENTLY. Two hazards, both handled:
 *   1. Already selected (e.g. left over from an earlier failed test in the
 *      same worker/account) — checked first, no-ops rather than clicking.
 *   2. The radio is CONTROLLED by the profile query (`value={user.language}`),
 *      not by native uncontrolled DOM state: the browser flips `checked` on
 *      the native click instantly, but React reasserts the OLD value on its
 *      next render until the PATCH resolves and the cache updates — which
 *      makes Playwright's `.check()` (click, then verify settled-checked)
 *      fail with "did not change its state" if that revert lands inside its
 *      own short verification window. A plain `.click()` (no post-click
 *      verification) sidesteps it; the toast below is the real confirmation.
 */
export async function setProfileLanguage(page: Page, lang: 'en' | 'es'): Promise<void> {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  const label = lang === 'es' ? 'Español' : 'English';
  const radio = page.getByRole('radio', { name: label, exact: true });
  await expect(radio).toBeVisible({ timeout: 15_000 });
  if (await radio.isChecked()) return;
  await radio.scrollIntoViewIfNeeded();
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/users/me') && r.request().method() === 'PATCH',
      { timeout: 15_000 }
    ),
    radio.click(),
  ]);
  if (!response.ok()) {
    throw new Error(`PATCH /users/me (language=${lang}) failed: ${response.status()} ${await response.text()}`);
  }
  await expect(radio).toBeChecked({ timeout: 10_000 });
}
