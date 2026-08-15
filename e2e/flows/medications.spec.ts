import { request as apiRequest, type Locator, type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';

// Medication lifecycle flows (Medications page — /circles/:id/meds).
//
// Covers the discontinue/reactivate feature end-to-end against the live
// backend:
//   1. Roster round-trip: create a recurring daily med via the calendar add
//      flow → appears under Active on the Meds page → discontinue → moves to
//      "Inactive / Past medications" and drops off the calendar → reactivate →
//      back under Active and back on the calendar. Axe scans the page in both
//      states (active-only and with the inactive section rendered).
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
const DEMO_EMAIL = process.env.PW_DEMO_EMAIL ?? 'demo@circlecare.app';
const DEMO_PASSWORD = process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!';

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
  const d = new Date();
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
  const notice = page.getByRole('dialog', { name: 'Time already passed' });
  const shown = await notice
    .waitFor({ state: 'visible', timeout: 2_500 })
    .then(() => true)
    .catch(() => false);
  if (shown) await notice.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

/** Create a DAILY recurring medication via the calendar's Add event flow. */
async function createDailyMed(
  page: Page,
  circleId: string,
  name: string,
  dosage: string,
  time: string
): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add event' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New event' });
  await expect(dialog).toBeVisible();

  await dialog.locator('#event_type').selectOption('medication');
  await dialog.locator('#medication_name').fill(name);
  await dialog.locator('#medication_dosage').fill(dosage);
  await dialog.locator('#scheduled_date').fill(todayISO());
  await dialog.locator('#scheduled_time').fill(time);
  await dialog.locator('#recurrence_rule').selectOption('daily');
  await submitEventForm(page, dialog);
}

/** The calendar grid, settled enough that an absence assertion is meaningful. */
async function gotoCalendarSettled(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
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

async function getSweepToken(ctx: Awaited<ReturnType<typeof apiRequest.newContext>>) {
  if (sweepToken) return sweepToken;
  const login = await ctx.post('/api/auth/login', {
    headers: { 'X-Session-Mode': 'cookie', Origin: ORIGIN },
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!login.ok()) return undefined;
  sweepToken = (await login.json())?.data?.session?.access_token as string | undefined;
  return sweepToken;
}

async function sweepCreatedMeds(circleId: string): Promise<void> {
  if (createdMedNames.size === 0) return;
  const ctx = await apiRequest.newContext({ baseURL: ORIGIN });
  try {
    const token = await getSweepToken(ctx);
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
  test.afterEach(async ({ circleId }) => {
    await sweepCreatedMeds(circleId);
  });

  test('roster round-trip: create → discontinue → reactivate', async ({
    page,
    circleId,
  }, testInfo) => {
    test.slow(); // multi-surface round-trip + two axe scans — needs 3x timeout
    const name = uniqueMedName('roundtrip');
    const dosage = '5 mg';
    const chip = page.getByRole('button', { name: new RegExp(name) });

    await createDailyMed(page, circleId, name, dosage, '08:00');
    // The new series renders on the calendar (recurring → at least one chip).
    await expect(chip.first()).toBeVisible({ timeout: 20_000 });

    // --- Active roster shows name + dosage ---
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    const activeRegion = page.getByRole('region', { name: 'Active', exact: true });
    const activeCard = activeRegion.locator('li').filter({ hasText: name });
    await expect(activeCard).toBeVisible({ timeout: 20_000 });
    await expect(activeCard).toContainText(dosage);
    await expect(activeCard).toContainText('Daily');
    await checkA11y(page, `/circles/:id/meds (active)`, testInfo);

    // --- Discontinue (confirm dialog) ---
    await activeCard.getByRole('button', { name: `Discontinue ${name}` }).click();
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

    // --- Gone from the calendar (default GET excludes discontinued meds) ---
    await gotoCalendarSettled(page, circleId);
    await expect(chip).toHaveCount(0, { timeout: 20_000 });

    // --- Reactivate from the inactive card ---
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    await expect(inactiveCard).toBeVisible({ timeout: 20_000 });
    await inactiveCard.getByRole('button', { name: `Reactivate ${name}` }).click();
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
    await page.getByRole('button', { name: `Discontinue ${name}` }).click();
    const discontinueDialog = page.getByRole('dialog', { name: 'Discontinue medication' });
    await discontinueDialog.getByRole('button', { name: 'Discontinue', exact: true }).click();
    await expect(discontinueDialog).toBeHidden({ timeout: 20_000 });

    const inactiveRegion = page.getByRole('region', { name: 'Inactive / Past medications', exact: true });
    await expect(inactiveRegion.locator('li').filter({ hasText: name })).toBeVisible({
      timeout: 20_000,
    });

    // Edit on the inactive card → the reactivate-first prompt, NOT the editor.
    await page.getByRole('button', { name: `Edit ${name}` }).click();
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
    await createDailyMed(page, circleId, name, dosage, '08:00');
    await createDailyMed(page, circleId, name, dosage, '20:00');
    await expect(chip.first()).toBeVisible({ timeout: 20_000 });

    // ONE grouped card listing both times.
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    const activeRegion = page.getByRole('region', { name: 'Active', exact: true });
    const activeCard = activeRegion.locator('li').filter({ hasText: name });
    await expect(activeCard).toHaveCount(1, { timeout: 20_000 });
    await expect(activeCard).toContainText('8:00 AM');
    await expect(activeCard).toContainText('8:00 PM');

    // Discontinue from the single card → BOTH series go inactive.
    await activeCard.getByRole('button', { name: `Discontinue ${name}` }).click();
    const discontinueDialog = page.getByRole('dialog', { name: 'Discontinue medication' });
    await discontinueDialog.getByRole('button', { name: 'Discontinue', exact: true }).click();
    await expect(discontinueDialog).toBeHidden({ timeout: 20_000 });

    const inactiveRegion = page.getByRole('region', { name: 'Inactive / Past medications', exact: true });
    await expect(inactiveRegion.locator('li').filter({ hasText: name })).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(activeRegion.locator('li').filter({ hasText: name })).toHaveCount(0);

    // Neither series renders on the calendar anymore.
    await gotoCalendarSettled(page, circleId);
    await expect(chip).toHaveCount(0, { timeout: 20_000 });
    // Cleanup: afterEach API sweep (both series roots).
  });
});
