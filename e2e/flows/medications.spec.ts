import { request as apiRequest, type Locator, type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { IsolatedAccount } from '../isolation';
import { checkA11y } from '../helpers';

// Medication lifecycle flows (Medications page — /circles/:id/meds).
//
// Covers the discontinue/reactivate feature end-to-end against the live
// backend:
//   1. Roster round-trip: create a recurring daily med via the calendar add
//      flow → appears under Active on the Meds page → discontinue → moves to
//      "Inactive / Past medications", its FUTURE occurrences drop off the
//      calendar while its PAST ones stay (flagged Inactive) → reactivate →
//      back under Active and back on the calendar. Axe scans the page in both
//      states (active-only and with the inactive section rendered).
//
//      DISCONTINUE IS A STOP INSTANT, NOT A HIDE FLAG. `discontinued_at` is
//      stamped on the series root and every physical child so the pg_cron
//      functions treat the series as inert — it does NOT mean "this medication
//      never existed". Doses that came due BEFORE that instant really happened,
//      keep their confirmation state, and stay on the calendar (the adherence
//      report has always counted them); only occurrences after it are hidden.
//      This suite used to assert the opposite — that the med vanished from the
//      calendar entirely — which is what let a bug that erased a medication's
//      whole history ship.
//
//      AND THOSE HISTORICAL DOSES ARE STILL LOGGABLE. The first fix left them
//      visible but inert, which was worse in one specific way: a dose actually
//      given but not yet logged when the medication was stopped could never be
//      logged, so it counts as scheduled-and-missed in the clinician-facing
//      adherence report forever. The calendar fetches without
//      `includeDiscontinued` and the backend returns only due-before-stop
//      occurrences, so anything the grid shows is confirmable — the detail
//      modal keeps Mark taken / Skip dose on an inactive dose. (The Meds roster
//      does pass the flag, can hold not-due occurrences, and therefore has no
//      dose-confirmation control at all.)
//   2. Inactive-edit guard: Edit on an inactive med prompts to reactivate
//      first — the edit modal must NOT open.
//   3. Whole-medication semantics: two series of the same name + dose (08:00
//      and 20:00) group into ONE card; discontinuing from that card
//      inactivates BOTH series (calendar shows neither, one inactive card).
//
// Data hygiene: every med name is prefixed ZZ_E2E_MED_ + run-unique suffix so
// parallel/repeat runs never collide and cleanup is targeted. Cleanup is a
// pure-API sweep in afterEach (cookie-mode login → bearer token → whole-series
// deletes), NOT UI clicks: one roster card groups MULTIPLE series by
// name+dosage, so deleting series 1 re-groups the card around series 2 and
// remounts the Delete button — a UI click-loop races those remounts
// ("element was detached from the DOM") until the test times out. The UI
// delete path is a tested behavior elsewhere; cleanup must not depend on it.
//
// Conventions per calendar.spec.ts / create-menu.spec.ts: role/label
// selectors, dialog-scoped lookups (dialogs are named via their titles),
// generous post-mutation timeouts.

const ORIGIN = process.env.PW_BASE_URL ?? 'http://localhost:5173';

const MED_PREFIX = 'ZZ_E2E_MED_';

// Names created by THIS worker process. The afterAll sweep only deletes these:
// with fullyParallel the file's tests spread across workers, so a global
// ZZ_E2E_MED_% sweep from the first worker to finish would delete a med a
// concurrently-running test just created (observed as a 404 on the
// medication-status PATCH mid-test).
const createdMedNames = new Set<string>();

/** Run-unique medication name with the targeted-cleanup prefix. */
function uniqueMedName(tag: string): string {
  const name = `${MED_PREFIX}${tag}_${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  createdMedNames.add(name);
  return name;
}

function todayISO(): string {
  // Local date as YYYY-MM-DD; the created series starts in the current views.
  return daysAgoISO(0);
}

/**
 * Local date N days ago as YYYY-MM-DD.
 *
 * Used to start a series in the PAST so the discontinue assertions have real
 * history to check. `daysAgoISO(7)` is deliberate: with Sunday-start weeks,
 * today-7 ALWAYS falls in the previous week no matter which weekday the suite
 * runs on (previous week spans today-dow-7 … today-dow-1, and 0 ≤ dow ≤ 6), so
 * "click Previous week and find an occurrence" is deterministic every day.
 */
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Submit the add/edit event form. Saving a medication whose time already
 * passed TODAY (circle timezone) interposes a non-blocking "Time already
 * passed" notice — whether it appears depends on the wall clock, so continue
 * through it when shown.
 */
async function submitEventForm(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Create' }).click();
  const notice = page.getByRole('dialog', { name: /^(Time already passed|Starts with the next dose)$/ });
  const shown = await notice
    .waitFor({ state: 'visible', timeout: 2_500 })
    .then(() => true)
    .catch(() => false);
  if (shown) await notice.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

/**
 * Create a DAILY recurring medication via the calendar's Add event flow.
 * `startDate` defaults to today; pass a past date to give the series real
 * history (the form imposes no minimum date, and the "Time already passed"
 * notice only appears for TODAY, so a past start simply saves).
 */
async function createDailyMed(
  page: Page,
  circleId: string,
  name: string,
  dosage: string,
  time: string,
  startDate: string = todayISO()
): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add event' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New event' });
  await expect(dialog).toBeVisible();

  await dialog.locator('#event_type').selectOption('medication');
  await dialog.locator('#medication_name').fill(name);
  await dialog.locator('#medication_dosage').fill(dosage);
  await dialog.locator('#scheduled_date').fill(startDate);
  await dialog.locator('#scheduled_time').fill(time);
  await dialog.locator('#recurrence_rule').selectOption('daily');
  await submitEventForm(page, dialog);
}

/**
 * The week-range heading between the prev/next arrows ("Sep 13 – Sep 19, 2026",
 * CalendarPage.tsx `rangeLabel`).
 */
const WEEK_RANGE_HEADING = /^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}, \d{4}$/;

/**
 * The calendar grid, LOADED. This is a positive signal, not a settle-and-hope:
 * CalendarPage renders `role="grid"` (WeekView) only when the events query has
 * resolved AND returned at least one event — loading shows CalendarSkeleton
 * (no grid) and an empty range shows EmptyState (no grid). The isolated
 * account's cloned circle carries daily medications with no end date, so every
 * week has events and a visible grid always means "this week's data arrived".
 */
async function gotoCalendarSettled(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
}

/**
 * Step the (default) week view forward/back N weeks and wait for THAT week to
 * be loaded.
 *
 * Discontinue assertions must be scoped to a week that is entirely in the past
 * or entirely in the future — the CURRENT week straddles the stop instant, so
 * whether today's own dose is still shown depends on the wall clock (a med
 * stopped at 2pm keeps its 8am dose and loses its 8pm one). Stepping one week
 * either side removes the clock from the assertion completely.
 *
 * Each step waits for the range heading to CHANGE, and the final one for the
 * grid (see gotoCalendarSettled for why a visible grid means "loaded"). The
 * range change is what stops the grid check from being satisfied by the week
 * we just left.
 */
async function stepWeeks(page: Page, weeks: number): Promise<void> {
  const label = weeks < 0 ? 'Previous week' : 'Next week';
  const range = page.getByRole('heading', { level: 2, name: WEEK_RANGE_HEADING });
  for (let i = 0; i < Math.abs(weeks); i++) {
    await expect(range).toBeVisible({ timeout: 15_000 });
    const from = (await range.textContent())?.trim() ?? '';
    await page.getByRole('button', { name: label }).click();
    await expect(range, `week range moved off "${from}"`).not.toHaveText(from, {
      timeout: 15_000,
    });
  }
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
}

/**
 * API cleanup: delete every leftover series whose medication_name was created
 * by THIS worker (see createdMedNames). Cookie-mode login → bearer token →
 * list meds (includeDiscontinued so inactive leftovers are found too) →
 * DELETE deleteScope=series per distinct root, mirroring the app's own
 * contract. Deliberately silent on partial failure — cleanup must never turn
 * a green test red; leftovers are caught by the next run's sweep or the
 * post-run DB check.
 */
// Bearer token cache for the sweep — ONE login per worker process, not one per
// afterEach. Logins share the backend's per-IP auth rate-limit budget with the
// per-test fixture logins (dev: 100 per 5 min), so the sweep must not burn
// extra attempts. Suite runs finish well inside the token's lifetime.
let sweepToken: string | undefined;

async function getSweepToken(
  ctx: Awaited<ReturnType<typeof apiRequest.newContext>>,
  account: IsolatedAccount
) {
  if (sweepToken) return sweepToken;
  const login = await ctx.post('/api/auth/login', {
    headers: { 'X-Session-Mode': 'cookie', Origin: ORIGIN },
    data: { email: account.email, password: account.password },
  });
  if (!login.ok()) return undefined;
  sweepToken = (await login.json())?.data?.session?.access_token as string | undefined;
  return sweepToken;
}

async function sweepCreatedMeds(circleId: string, account: IsolatedAccount): Promise<void> {
  if (createdMedNames.size === 0) return;
  const ctx = await apiRequest.newContext({ baseURL: ORIGIN });
  try {
    const token = await getSweepToken(ctx, account);
    if (!token) return;
    const auth = { Authorization: `Bearer ${token}` };

    const res = await ctx.get(
      `/api/circles/${circleId}/events?event_type=medication&includeDiscontinued=true`,
      { headers: auth }
    );
    if (!res.ok()) return;
    const events = ((await res.json())?.data?.events ?? []) as Array<{
      id: string;
      parent_event_id: string | null;
      medication_name: string | null;
    }>;

    // Distinct series roots of leftover ZZ_E2E_MED_% events. deleteScope=series
    // on the root removes the parent row AND all materialized children (CASCADE)
    // in one call — no per-date scoping, no dependence on roster grouping.
    const roots = new Set<string>();
    for (const e of events) {
      if (!e.medication_name || !createdMedNames.has(e.medication_name)) continue;
      roots.add(e.parent_event_id ?? e.id);
    }
    for (const rootId of roots) {
      await ctx
        .delete(`/api/circles/${circleId}/events/${rootId}?deleteScope=series`, { headers: auth })
        .catch(() => {});
    }
  } catch {
    // Network hiccup mid-sweep: leave it to the next sweep / post-run check.
  } finally {
    await ctx.dispose();
  }
}

test.describe('medication lifecycle', () => {
  // Runs after EVERY test — pass, fail, or timeout — so a test that died
  // mid-flow never leaves ZZ_E2E_MED_% series behind for the next test (or the
  // next run) to trip over.
  test.afterEach(async ({ circleId, account }) => {
    await sweepCreatedMeds(circleId, account);
  });

  test('roster round-trip: create → discontinue → reactivate', async ({
    page,
    circleId,
  }, testInfo) => {
    test.slow(); // multi-surface round-trip + two axe scans — needs 3x timeout
    const name = uniqueMedName('roundtrip');
    const dosage = '5 mg';
    const chip = page.getByRole('button', { name: new RegExp(name) });

    // Start the series a WEEK AGO so it has real history to check after the
    // discontinue — "the past stays" is only assertable if a past dose exists.
    await createDailyMed(page, circleId, name, dosage, '08:00', daysAgoISO(7));
    // The new series renders on the calendar (recurring → at least one chip).
    await expect(chip.first()).toBeVisible({ timeout: 20_000 });

    // NEXT week HAS doses before the discontinue. Without this, "next week has
    // none" below is an absence that a week which never showed the series
    // would satisfy just as well.
    await gotoCalendarSettled(page, circleId);
    await stepWeeks(page, 1);
    await expect(chip.first(), 'next week shows the series before it is stopped').toBeVisible({
      timeout: 20_000,
    });

    // --- Active roster shows name + dosage ---
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    const activeRegion = page.getByRole('region', { name: 'Active', exact: true });
    const activeCard = activeRegion.locator('li').filter({ hasText: name });
    await expect(activeCard).toBeVisible({ timeout: 20_000 });
    await expect(activeCard).toContainText(dosage);
    await expect(activeCard).toContainText('Daily');
    await checkA11y(page, `/circles/:id/meds (active)`, testInfo);

    // --- Discontinue (confirm dialog) ---
    // The three row actions (Edit / Discontinue / Delete) live behind one
    // MoreMenu trigger now (spec §6.4), not separate inline buttons.
    await activeCard.getByRole('button', { name: `More actions for ${name}` }).click();
    const activeMenu = page.getByRole('menu');
    await expect(activeMenu).toBeVisible();
    await activeMenu.getByRole('menuitem', { name: 'Discontinue', exact: true }).click();
    const discontinueDialog = page.getByRole('dialog', { name: 'Discontinue medication' });
    await expect(discontinueDialog).toBeVisible();
    await discontinueDialog.getByRole('button', { name: 'Discontinue', exact: true }).click();
    await expect(discontinueDialog).toBeHidden({ timeout: 20_000 });

    // Moves to the Inactive section, flagged with the Inactive badge.
    const inactiveRegion = page.getByRole('region', { name: 'Inactive / Past medications', exact: true });
    const inactiveCard = inactiveRegion.locator('li').filter({ hasText: name });
    await expect(inactiveCard).toBeVisible({ timeout: 20_000 });
    await expect(inactiveCard).toContainText('Inactive');
    await expect(activeRegion.locator('li').filter({ hasText: name })).toHaveCount(0);
    await checkA11y(page, `/circles/:id/meds (inactive present)`, testInfo);

    // --- Calendar: the FUTURE stops, the PAST stays -------------------------
    // `discontinued_at` is a STOP INSTANT. The default GET no longer excludes
    // discontinued rows wholesale (that erased the medication's entire history);
    // it keeps every occurrence that came due at or before the stop instant and
    // hides the ones that never came due.
    await gotoCalendarSettled(page, circleId);

    // NEXT week is entirely after the stop instant → not a single occurrence.
    await stepWeeks(page, 1);
    await expect(chip).toHaveCount(0, { timeout: 20_000 });

    // PREVIOUS week is entirely before today, and the series started 7 days ago,
    // so it always contains at least one occurrence (see daysAgoISO). Those
    // doses really happened: they stay on the calendar, labelled "Inactive" in
    // TEXT (never colour alone — WCAG 2.1 AA 1.4.1) in the chip's accessible
    // name. Under the old behaviour this count was 0 — the bug this asserts.
    await stepWeeks(page, -2);
    await expect(chip.first()).toBeVisible({ timeout: 20_000 });
    const inactiveChip = page
      .getByRole('button', { name: new RegExp(`${name}.*Inactive`) })
      .first();
    await expect(inactiveChip).toBeVisible({ timeout: 20_000 });

    // ...and that historical dose is still ANSWERABLE. Only the medication is
    // inactive; the dose is one the backend already found due, so the detail
    // modal keeps its confirm controls. Without them, a dose really given but
    // never logged is stuck as "missed" in the adherence report with no remedy.
    // The Inactive marker stays — in TEXT, alongside the controls.
    //
    // TIMING NOTE: this chip is from a PAST week (see stepWeeks above), and a
    // dose whose day has passed is always confirmable. Do NOT retarget this
    // assertion at a dose later today — Take/Skip only open
    // DOSE_EARLY_CONFIRM_WINDOW_MINUTES (2h) before the scheduled moment
    // (utils/timezone.ts `isDoseConfirmable`), so a dose further out than that
    // renders no controls at all and this would fail for the wrong reason.
    await inactiveChip.click();
    const doseDetail = page.getByRole('dialog').filter({ hasText: name });
    await expect(doseDetail).toBeVisible({ timeout: 20_000 });
    await expect(doseDetail.getByText('Inactive').first()).toBeVisible();
    await expect(doseDetail.getByRole('button', { name: 'Mark taken' })).toBeVisible();
    await expect(doseDetail.getByRole('button', { name: 'Skip dose' })).toBeVisible();
    // Leave the dose unlogged — the reactivate assertions below expect the
    // series untouched.
    await page.keyboard.press('Escape');
    await expect(doseDetail).toBeHidden({ timeout: 20_000 });

    // --- Reactivate from the inactive card ---
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    await expect(inactiveCard).toBeVisible({ timeout: 20_000 });
    await inactiveCard.getByRole('button', { name: `More actions for ${name}` }).click();
    const inactiveMenu = page.getByRole('menu');
    await expect(inactiveMenu).toBeVisible();
    await inactiveMenu.getByRole('menuitem', { name: 'Reactivate', exact: true }).click();
    const reactivateDialog = page.getByRole('dialog', { name: 'Reactivate medication' });
    await expect(reactivateDialog).toBeVisible();
    await reactivateDialog.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await expect(reactivateDialog).toBeHidden({ timeout: 20_000 });

    await expect(activeRegion.locator('li').filter({ hasText: name })).toBeVisible({
      timeout: 20_000,
    });
    await expect(inactiveRegion.locator('li').filter({ hasText: name })).toHaveCount(0);

    // --- Back on the calendar ---
    await gotoCalendarSettled(page, circleId);
    await expect(chip.first()).toBeVisible({ timeout: 20_000 });
    // Cleanup: afterEach API sweep.
  });

  test('inactive-edit guard: Edit on an inactive med prompts to reactivate', async ({
    page,
    circleId,
  }) => {
    test.slow(); // create + discontinue + guard — needs 3x timeout
    const name = uniqueMedName('editguard');
    await createDailyMed(page, circleId, name, '10 mg', '08:00');

    // Discontinue it first.
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: `More actions for ${name}` }).click();
    const rowMenu = page.getByRole('menu');
    await expect(rowMenu).toBeVisible();
    await rowMenu.getByRole('menuitem', { name: 'Discontinue', exact: true }).click();
    const discontinueDialog = page.getByRole('dialog', { name: 'Discontinue medication' });
    await discontinueDialog.getByRole('button', { name: 'Discontinue', exact: true }).click();
    await expect(discontinueDialog).toBeHidden({ timeout: 20_000 });

    const inactiveRegion = page.getByRole('region', { name: 'Inactive / Past medications', exact: true });
    await expect(inactiveRegion.locator('li').filter({ hasText: name })).toBeVisible({
      timeout: 20_000,
    });

    // Edit on the inactive card → the reactivate-first prompt, NOT the editor.
    await page.getByRole('button', { name: `More actions for ${name}` }).click();
    const editMenu = page.getByRole('menu');
    await expect(editMenu).toBeVisible();
    await editMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    const guard = page.getByRole('dialog', { name: 'Medication is inactive' });
    await expect(guard).toBeVisible();
    await expect(guard).toContainText('Reactivate it to make changes');
    await expect(page.getByRole('dialog', { name: 'Edit event' })).toHaveCount(0);

    // Decline — the med stays inactive.
    await guard.getByRole('button', { name: 'Cancel' }).click();
    await expect(guard).toBeHidden();
    await expect(inactiveRegion.locator('li').filter({ hasText: name })).toBeVisible();
    // Cleanup: afterEach API sweep.
  });

  test('whole-medication discontinue: both series of one med toggle together', async ({
    page,
    circleId,
  }) => {
    test.slow(); // two series + roster + calendar assertions — needs 3x timeout
    const name = uniqueMedName('wholemed');
    const dosage = '20 mg';
    const chip = page.getByRole('button', { name: new RegExp(name) });

    // Two series of the SAME name + dose at different times (morning/evening).
    // The times are asserted verbatim below ("8:00 AM"/"8:00 PM" on the roster
    // card), so they stay fixed rather than computed. Whether today's doses are
    // still ahead depends on the wall clock, but NEXT week is entirely ahead of
    // both series' starts, so it deterministically holds doses of both — which
    // is also the week the "gone" assertion below checks. Show it populated
    // FIRST, so that absence is a change, not a week that never had doses.
    await createDailyMed(page, circleId, name, dosage, '08:00');
    await createDailyMed(page, circleId, name, dosage, '20:00');
    await gotoCalendarSettled(page, circleId);
    await stepWeeks(page, 1);
    await expect(chip.first()).toBeVisible({ timeout: 20_000 });
    // EACH series, by its own time. A bare `chip.count() >= 2` passed with ONE
    // series: a single daily series already puts seven chips in the week. The
    // chip's accessible name carries its time (WeekView.tsx ariaLabel:
    // "<title>, Medication, 8:00 AM, …"), so the two series are told apart by
    // it. `\s*` because Intl may separate "AM" with a narrow no-break space.
    for (const [time, meridiem] of [
      ['8:00', 'AM'],
      ['8:00', 'PM'],
    ] as const) {
      const seriesChip = page.getByRole('button', {
        name: new RegExp(`${name}.*\\b${time}\\s*${meridiem}\\b`),
      });
      await expect
        .poll(() => seriesChip.count(), {
          timeout: 20_000,
          message: `next week shows doses of the ${time} ${meridiem} series`,
        })
        .toBeGreaterThanOrEqual(1);
    }

    // ONE grouped card listing both times.
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    const activeRegion = page.getByRole('region', { name: 'Active', exact: true });
    const activeCard = activeRegion.locator('li').filter({ hasText: name });
    await expect(activeCard).toHaveCount(1, { timeout: 20_000 });
    await expect(activeCard).toContainText('8:00 AM');
    await expect(activeCard).toContainText('8:00 PM');

    // Discontinue from the single card → BOTH series go inactive.
    await activeCard.getByRole('button', { name: `More actions for ${name}` }).click();
    const wholeMedMenu = page.getByRole('menu');
    await expect(wholeMedMenu).toBeVisible();
    await wholeMedMenu.getByRole('menuitem', { name: 'Discontinue', exact: true }).click();
    const discontinueDialog = page.getByRole('dialog', { name: 'Discontinue medication' });
    await discontinueDialog.getByRole('button', { name: 'Discontinue', exact: true }).click();
    await expect(discontinueDialog).toBeHidden({ timeout: 20_000 });

    const inactiveRegion = page.getByRole('region', { name: 'Inactive / Past medications', exact: true });
    await expect(inactiveRegion.locator('li').filter({ hasText: name })).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(activeRegion.locator('li').filter({ hasText: name })).toHaveCount(0);

    // Neither series has any FUTURE occurrence left. Both were created starting
    // TODAY, so the current week straddles the stop instant (whether today's own
    // 08:00 dose is still shown depends on the wall clock — `discontinued_at` is
    // a stop instant, resolved by dose time, not a hide flag). Next week is
    // unambiguously after it, so this is the deterministic form of "gone".
    await gotoCalendarSettled(page, circleId);
    await stepWeeks(page, 1);
    await expect(chip).toHaveCount(0, { timeout: 20_000 });
    // Cleanup: afterEach API sweep (both series roots).
  });
});
