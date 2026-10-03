import { test, expect, uniqueLabel } from '../../fixtures';
import { apiSession } from '../../unhappy';
import { apiCreateEvent, dateInZone, purgeEventsTitled, recipientTimezone } from './_helpers';

// A DATED CALENDAR LINK OPENED COLD LANDS ON ITS DAY, NOT TODAY (plan
// mobile-e2e-parity P10, web half).
//
// Mobile's defect: the link applied its day, then a once-per-mount "snap to
// today" that ran when the recipient zone arrived overwrote it. Web seeds the
// anchor from `?date=` on the first render and derives "today" only as the
// fallback, so it should not have the bug — this pins that, with the link's
// day ~6 weeks out so neither its week nor its month can be today's.
//
// A full page load IS the cold path on web (nothing is mounted before it).

test.use({ persona: 'premiumOwner' });

for (const view of ['week', 'month'] as const) {
  test(`cold load of ?date=D&eventId= shows D's ${view}, not today's`, async ({ page, request, account, circleId }) => {
    const title = uniqueLabel('Cold link');
    const api = await apiSession(request, account);
    const tz = await recipientTimezone(api, circleId);
    const day = dateInZone(tz, 45);
    const today = dateInZone(tz, 0);
    const appt = await apiCreateEvent(api, circleId, {
      event_type: 'appointment',
      title,
      scheduled_date: day,
      scheduled_time: '10:00',
    });
    try {
      await page.goto(`/circles/${circleId}/calendar?date=${day}&eventId=${appt.id}`, {
        waitUntil: 'domcontentloaded',
      });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      if (view === 'month') {
        await page.getByRole('tab', { name: 'Month', exact: true }).or(page.getByRole('button', { name: 'Month', exact: true })).first().click();
      }
      // The linked day's column/cell is on screen; today's is not. (`data-date`
      // sits on the week column's gridcell and on the month cell's button.)
      const cell = (d: string) => page.locator(`[role="gridcell"][data-date="${d}"], [role="gridcell"] [data-date="${d}"]`);
      await expect(cell(day).first()).toBeVisible({ timeout: 15_000 });
      await expect(cell(today)).toHaveCount(0);
      // And it stays there once every read has settled (the mobile bug moved it
      // AFTER the zone resolved, not on first paint).
      await page.waitForLoadState('networkidle');
      await expect(cell(day).first()).toBeVisible();
      await expect(cell(today)).toHaveCount(0);
    } finally {
      purgeEventsTitled(circleId, title);
    }
  });
}
