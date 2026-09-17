import { test, expect, type Page } from '@playwright/test';
import {
  CROSS_TZ,
  gotoCircleWithRecipientZone,
  loginAs,
  openCircle,
} from '../crossTimezoneLogin';

/**
 * THE VIEWER-FRAME CONTRACT, IN A REAL BROWSER, ACROSS REAL TIMEZONES.
 *
 * Everything else covering this runs in jsdom against Postgres fixtures. That
 * is the right home for the arithmetic, and it cannot test three things that
 * only a browser has:
 *
 *   1. `<input type="date">` / `<input type="time">` are NATIVE controls. The
 *      whole model rests on what they hold and hand back; jsdom approximates.
 *   2. The viewer's timezone IS the browser's timezone. Playwright's
 *      `timezoneId` is the only way to exercise the viewer side of a pairing
 *      for real — `process.env.TZ` in a unit run is a different mechanism
 *      reaching different code.
 *   3. Whether the user is TOLD. The live conversion is what makes
 *      converting-on-save honest rather than hidden, and it is rendered by the
 *      real Intl.
 *
 * ── WHY A SEPARATE LOGIN ────────────────────────────────────────────────
 *
 * Every isolated account's circles are cloned from the demo account, whose
 * circles are all Denver -> Denver. Every conversion there is the IDENTITY
 * case — exactly where these bugs hide, and a suite that only saw that data
 * would pass with the conversion deleted. These log in as a cross-timezone
 * circle owner instead.
 *
 * ── THE SEED, AND WHY THIS SPEC NEVER SKIPS ─────────────────────────────
 *
 * globalSetup seeds that owner idempotently (e2e/crossTimezoneSeed.ts) whenever
 * the run includes `chromium` against a local database. This spec used to
 * `test.skip` when the login failed — so on any machine where nobody had run
 * the mobile seeder by hand, all seven tests skipped, and the gate (failed +
 * flaky) stayed green. Now:
 *   - the seed is checked in the database first, and its absence FAILS with a
 *     message naming the fix;
 *   - a login failure FAILS with the login response's status, never a skip.
 */

const RECIPIENT = { email: CROSS_TZ.ownerEmail, zone: CROSS_TZ.recipientZone };

/**
 * Open the sidebar's "New" button and pick an AddMenu option by its VISIBLE
 * short label ("Med", "Appt", "Task", "Note" — that short form is the
 * accessible name; see AddMenu.tsx). Scoped to `<aside>` because the
 * FloatingNavBar pill below the `xl` breakpoint has a "New" button of its own
 * (CSS-hidden at this spec's desktop viewport, but scoping avoids ambiguity).
 */
async function openCreateOption(page: Page, name: string): Promise<void> {
  const newBtn = page.locator('aside').getByRole('button', { name: 'New', exact: true });
  await expect(newBtn).toBeVisible({ timeout: 15_000 });
  await newBtn.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** "8:00 PM Denver = 5:00 PM Tokyo" — the conversion line's shape. */
const CONVERSION_TEXT = 'text=/\\d{1,2}:\\d{2}.*=.*\\d{1,2}:\\d{2}/';

/**
 * Viewer zones chosen for what they expose, not for coverage: Denver is the dev
 * machine and the zone every seeded circle uses; Midway sits far WEST of Tokyo
 * so the conversion pushes the day forward; Kiritimati is +14.
 */
const VIEWER_ZONES = ['America/Denver', 'Pacific/Midway', 'Pacific/Kiritimati'];

for (const timezoneId of VIEWER_ZONES) {
  test.describe(`viewer in ${timezoneId}`, () => {
    test.use({ timezoneId, storageState: { cookies: [], origins: [] } });

    test('discloses the conversion instead of hiding it', async ({ page }) => {
      await loginAs(page, RECIPIENT.email);
      const circleId = await openCircle(page);
      await gotoCircleWithRecipientZone(page, circleId);

      await openCreateOption(page, 'Med');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // A medication's title field is `medication_name`, not `title` (see
      // AddEventModal's titleFieldId).
      await dialog.locator('#medication_name').fill('TZ e2e probe');
      await dialog.locator('#scheduled_date').fill('2026-09-01');
      await dialog.locator('#scheduled_time').fill('20:00');

      /**
       * The conversion must be VISIBLE.
       *
       * Its absence is the product failure: the save converts either way, so no
       * hint means the time moved silently. Asserting the SHAPE ("X = Y") not
       * exact digits — the arithmetic is owned by the Postgres-backed unit
       * suite, and re-deriving it here would just be a second implementation to
       * keep in step. This test's job is that the user is told.
       */
      const conversion = dialog.locator(CONVERSION_TEXT);
      await expect(
        conversion.first(),
        `no conversion shown from ${timezoneId} to ${RECIPIENT.zone}`
      ).toBeVisible({ timeout: 10_000 });
    });

    test('native date/time controls round-trip what we set', async ({ page }) => {
      // Guards the jsdom gap directly: whatever the browser's widgets do with a
      // typed value under this locale/timezone, the form must still hold it.
      await loginAs(page, RECIPIENT.email);
      const circleId = await openCircle(page);
      await gotoCircleWithRecipientZone(page, circleId);

      await openCreateOption(page, 'Med');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.locator('#scheduled_date').fill('2026-09-01');
      await dialog.locator('#scheduled_time').fill('20:00');

      await expect(dialog.locator('#scheduled_date')).toHaveValue('2026-09-01');
      await expect(dialog.locator('#scheduled_time')).toHaveValue('20:00');
    });
  });
}

/**
 * The single-zone case — the overwhelming majority of real circles, and where
 * clutter is a real cost: one time, no abbreviation noise.
 */
test.describe('viewer in the recipient’s own zone', () => {
  test.use({ timezoneId: RECIPIENT.zone, storageState: { cookies: [], origins: [] } });

  test('shows no conversion when the zones match', async ({ page }) => {
    await loginAs(page, RECIPIENT.email);
    const circleId = await openCircle(page);
    // Positive precondition: the recipient zone has LOADED. Without it the
    // modal has nothing to compare and shows no conversion regardless.
    await gotoCircleWithRecipientZone(page, circleId);

    await openCreateOption(page, 'Med');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Both halves of the conversion's input are filled — the line needs a date
    // AND a time, so filling only the time would make the absence vacuous.
    await dialog.locator('#medication_name').fill('TZ e2e probe');
    await dialog.locator('#scheduled_date').fill('2026-09-01');
    await dialog.locator('#scheduled_time').fill('20:00');

    // Positive: the form really rendered and holds the time being checked.
    await expect(dialog.locator('#scheduled_date')).toHaveValue('2026-09-01');
    await expect(dialog.locator('#scheduled_time')).toHaveValue('20:00');
    await expect(dialog.locator('#scheduled_time')).toBeVisible();

    // Then the absence: no conversion line and no dual-zone field hint.
    await expect(dialog.locator(CONVERSION_TEXT)).toHaveCount(0);
    await expect(dialog.getByText(/^Your time \//)).toHaveCount(0);
  });
});
