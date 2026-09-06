import { test, expect, type Page } from '@playwright/test';

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
 * The shared storageState is the demo account, whose circles are all
 * Denver -> Denver. Every conversion there is the IDENTITY case — exactly where
 * these bugs hide, and a suite that only saw that data would pass with the
 * conversion deleted. These log in as a cross-timezone circle owner instead
 * (seeded by mobile/scripts/seed-cross-timezone.mjs).
 *
 * Skips itself, loudly, if that seed is absent rather than passing vacuously.
 */

const PASSWORD = process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!';
const RECIPIENT = { email: 'tz-owner-tokyo@tz.test', zone: 'Asia/Tokyo' };

async function loginAs(page: Page, email: string): Promise<boolean> {
  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const CIRCLE_URL = /\/circles\/[0-9a-f-]{36}/;

/**
 * Land on the owner's only circle and return its id.
 *
 * A user with a single circle is auto-redirected straight into it
 * (CirclePickerPage.tsx's single-circle `useEffect`; CircleCard.tsx's own
 * comment confirms the picker grid "only ever renders when there are 2+
 * circles"). That redirect fires client-side after the circles query
 * resolves, so `waitForURL` past `/login` can land on the picker for a
 * moment before it navigates again — check for the circle URL first, give
 * the auto-redirect a beat to happen, and only then fall back to clicking a
 * card (for a seed that ever grows a second circle for this owner). The
 * card's `aria-label` composes role/med-status text around the circle name
 * (CircleCard.tsx `cardLabel`), so matching by `href` + the seeded circle's
 * name is more robust than depending on that composed sentence.
 */
async function openCircle(page: Page): Promise<string> {
  const onCircle = (): boolean => CIRCLE_URL.test(page.url());

  if (!onCircle()) {
    await page.waitForURL(CIRCLE_URL, { timeout: 5_000 }).catch(() => {});
  }
  if (!onCircle()) {
    const card = page.locator('a[href^="/circles/"]').filter({ hasText: /tokyo/i });
    await expect(card.first()).toBeVisible({ timeout: 20_000 });
    await card.first().click();
    await page.waitForURL(CIRCLE_URL, { timeout: 20_000 });
  }
  return new URL(page.url()).pathname.split('/')[2];
}

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
      test.skip(!(await loginAs(page, RECIPIENT.email)), 'cross-timezone seed missing');
      const circleId = await openCircle(page);
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

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
      const conversion = dialog.locator('text=/\\d{1,2}:\\d{2}.*=.*\\d{1,2}:\\d{2}/');
      await expect(
        conversion.first(),
        `no conversion shown from ${timezoneId} to ${RECIPIENT.zone}`
      ).toBeVisible({ timeout: 10_000 });
    });

    test('native date/time controls round-trip what we set', async ({ page }) => {
      // Guards the jsdom gap directly: whatever the browser's widgets do with a
      // typed value under this locale/timezone, the form must still hold it.
      test.skip(!(await loginAs(page, RECIPIENT.email)), 'cross-timezone seed missing');
      const circleId = await openCircle(page);
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

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
    test.skip(!(await loginAs(page, RECIPIENT.email)), 'cross-timezone seed missing');
    const circleId = await openCircle(page);
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    await openCreateOption(page, 'Med');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#scheduled_time').fill('20:00');

    await expect(dialog.locator('text=/\\d{1,2}:\\d{2}.*=.*\\d{1,2}:\\d{2}/')).toHaveCount(0);
  });
});
