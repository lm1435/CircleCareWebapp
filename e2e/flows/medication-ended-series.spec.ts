import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { dbQuery, sqlStr } from '../unhappy';
import { sqlExec } from '../db';
import { currentRunId } from '../runId';
import {
  apiSession,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  deleteViaMoreMenu,
  escapeRegExp,
  gotoWeekContaining,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';

// docs/plans/meds-roster-ended-series.md, Task 4/6 (web). A recurring med
// stopped with "This & future" gets `recurrence_end_date = cut - 1` and NO
// `discontinued_at`. The Meds roster bucketed by `discontinued_at` alone, so
// the med stayed under Active — and vanished altogether once its last dose left
// the GET /events default window (today-15). Now: "ended" uses the Care Summary
// PDF's definition (shared `isMedicationSeriesEnded`), the card sits under
// Inactive labelled "Ended <date>" with no Reactivate, and the roster request
// sends `includeInactiveRoots=true` so the backend adds the series ROOT of a med
// that stopped long ago.
//
// Fixture prefix: ENDSER_<runId>_ — matched by no other cleanup (not `ZZ_`).

const prefix = () => `ENDSER_${currentRunId()}_`;

const ACTIVE = 'Active';
const INACTIVE = 'Inactive / Past medications';

/** "Jan 5, 2026" for a naive YYYY-MM-DD, never shifted by the runner's zone. */
function shortDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Open the Meds roster and wait for THE roster request (asserting its flags). */
async function gotoMedsRoster(page: Page, circleId: string): Promise<void> {
  const rosterRequest = page.waitForRequest(
    (req) =>
      req.method() === 'GET' &&
      new URL(req.url()).pathname.endsWith(`/api/circles/${circleId}/events`) &&
      new URL(req.url()).searchParams.get('includeDiscontinued') === 'true',
    { timeout: 25_000 }
  );
  await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
  const req = await rosterRequest;
  expect(new URL(req.url()).searchParams.get('includeInactiveRoots')).toBe('true');
}

/** Stop a series by its end date the way "This & future" does, straight in the DB. */
function endSeriesInDb(rootId: string, endDate: string): void {
  // The materializer may already have minted physical children past the end;
  // a real "This & future" delete removes them, so the seed does too.
  sqlExec(
    `delete from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date > ${sqlStr(endDate)};` +
      ` update calendar_events set recurrence_end_date = ${sqlStr(endDate)} where id = ${sqlStr(rootId)};`
  );
}

test.describe('Meds roster: an ENDED series is Inactive ("Ended <date>")', () => {
  test('"This & future" on a daily med moves it to Inactive as "Ended <date>", no Reactivate', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const yesterday = dateInTz(tz, -1);
    const name = `${prefix()}FUT_${uniqueSuffix()}`;
    const rootId = await createDailyMedication(session, circleId, name, dateInTz(tz, -5));
    try {
      // Live first: listed under Active.
      await gotoMedsRoster(page, circleId);
      const activeCard = page
        .getByRole('region', { name: ACTIVE, exact: true })
        .locator('li')
        .filter({ hasText: name });
      await expect(activeCard).toBeVisible({ timeout: 20_000 });

      // "This and all future doses" from TODAY's dose, through the calendar UI.
      await gotoWeekContaining(page, circleId, today, today);
      const dialog = await openChip(page, today, new RegExp(escapeRegExp(name)));
      await deleteViaMoreMenu(page, dialog, 'future');

      // DB: the series ended yesterday, and was NOT discontinued.
      const root = dbQuery<{ recurrence_end_date: string | null; discontinued_at: string | null }>(
        `select recurrence_end_date::text, discontinued_at from calendar_events where id = ${sqlStr(rootId)}`
      );
      expect(root).toHaveLength(1);
      expect(root[0].recurrence_end_date).toBe(yesterday);
      expect(root[0].discontinued_at).toBeNull();

      // Roster: under Inactive, "Ended <yesterday>", not under Active.
      await gotoMedsRoster(page, circleId);
      const inactiveCard = page
        .getByRole('region', { name: INACTIVE, exact: true })
        .locator('li')
        .filter({ hasText: name });
      await expect(inactiveCard).toBeVisible({ timeout: 20_000 });
      const endedLabel = `Ended ${shortDate(yesterday)}`;
      await expect(inactiveCard).toContainText(endedLabel);
      await expect(
        page.getByRole('region', { name: ACTIVE, exact: true }).locator('li').filter({ hasText: name })
      ).toHaveCount(0);
      // The Ended label is part of the card's accessible name.
      await expect(
        inactiveCard.getByRole('button', { name: `View details for ${name}, ${endedLabel}` })
      ).toBeVisible();

      // No Reactivate (it cannot restart a series) and no Discontinue (nothing
      // left to stop) — Edit and Delete stay.
      await inactiveCard.getByRole('button', { name: `More actions for ${name}` }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Reactivate' })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: 'Discontinue' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();

      await checkA11y(page, `/circles/:id/meds (ended present)`, testInfo);
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });

  test('a med whose series ended >15 days ago (outside the window) is still listed under Inactive', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const endDate = dateInTz(tz, -20);
    const name = `${prefix()}OLD_${uniqueSuffix()}`;
    // An OLDER stop, created first and named to sort first alphabetically, so
    // "most recent stop first" is what puts `name` above it.
    const olderName = `${prefix()}AAA_${uniqueSuffix()}`;
    const olderId = await createDailyMedication(session, circleId, olderName, dateInTz(tz, -70));
    const rootId = await createDailyMedication(session, circleId, name, dateInTz(tz, -60));
    try {
      endSeriesInDb(olderId, dateInTz(tz, -40));
      endSeriesInDb(rootId, endDate);
      // Precondition: nothing of this series is inside the default window, so
      // only the `includeInactiveRoots` root can put it on the roster.
      const inWindow = dbQuery<{ n: number }>(
        `select count(*)::int as n from calendar_events where (id = ${sqlStr(rootId)} or parent_event_id = ${sqlStr(rootId)}) and scheduled_date >= ${sqlStr(dateInTz(tz, -15))}`
      );
      expect(inWindow[0].n).toBe(0);

      await gotoMedsRoster(page, circleId);
      const inactiveCard = page
        .getByRole('region', { name: INACTIVE, exact: true })
        .locator('li')
        .filter({ hasText: name });
      await expect(inactiveCard).toBeVisible({ timeout: 20_000 });
      await expect(inactiveCard).toContainText(`Ended ${shortDate(endDate)}`);

      // Inactive order: most recent stop first — `name` (ended today-20) above
      // `olderName` (ended today-40), whatever the alphabet says.
      const inactiveNames = await page
        .getByRole('region', { name: INACTIVE, exact: true })
        .getByRole('button', { name: /^View details for / })
        .allTextContents();
      const at = inactiveNames.indexOf(name);
      const olderAt = inactiveNames.indexOf(olderName);
      expect(at, 'recent stop is listed').toBeGreaterThanOrEqual(0);
      expect(olderAt, 'older stop is listed').toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(olderAt);
    } finally {
      await deleteSeries(session, circleId, rootId);
      await deleteSeries(session, circleId, olderId);
    }
  });

  test('a two-series med with ONE series ended stays Active', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const name = `${prefix()}TWO_${uniqueSuffix()}`;
    const start = dateInTz(tz, -30);
    // Same name + dose = ONE medication card, two series (8am + 8pm).
    const amId = await createDailyMedication(session, circleId, name, start, { time: '08:00' });
    const pmId = await createDailyMedication(session, circleId, name, start, { time: '20:00' });
    try {
      endSeriesInDb(amId, dateInTz(tz, -20));

      await gotoMedsRoster(page, circleId);
      const activeCard = page
        .getByRole('region', { name: ACTIVE, exact: true })
        .locator('li')
        .filter({ hasText: name });
      await expect(activeCard).toBeVisible({ timeout: 20_000 });
      await expect(activeCard).toHaveCount(1);
      await expect(activeCard).not.toContainText('Ended');
      await expect(page.locator('li').filter({ hasText: name })).toHaveCount(1);
      // The live series still offers Discontinue.
      await activeCard.getByRole('button', { name: `More actions for ${name}` }).click();
      await expect(page.getByRole('menuitem', { name: 'Discontinue', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    } finally {
      await deleteSeries(session, circleId, amId);
      await deleteSeries(session, circleId, pmId);
    }
  });

  test('a stopped series whose window holds ONLY confirmed doses is one Inactive card (per-series status)', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    // Confirmed doses on today-15..today-10 are physical CHILDREN with no stamp
    // of their own; the stamp (end date / discontinue) is on the root, dated
    // outside the window. The backend adds that root under the flag, and the
    // roster must judge each child by its SERIES.
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const endDate = dateInTz(tz, -10);
    const endedName = `${prefix()}CHE_${uniqueSuffix()}`;
    const discName = `${prefix()}CHD_${uniqueSuffix()}`;
    const endedId = await createDailyMedication(session, circleId, endedName, dateInTz(tz, -60), {
      trackRefills: true,
      quantityRemaining: 5,
    });
    const discId = await createDailyMedication(session, circleId, discName, dateInTz(tz, -60));
    try {
      for (const rootId of [endedId, discId]) {
        for (let n = -15; n <= -10; n++) {
          const res = await session.post(`/api/circles/${circleId}/medications/confirm`, {
            event_id: `${rootId}_${dateInTz(tz, n)}`,
            status: 'taken',
            scheduled_time: '08:00:00',
          });
          expect(res.ok(), `confirm ${n}: ${res.status()} ${await res.text()}`).toBe(true);
        }
        endSeriesInDb(rootId, endDate);
      }
      sqlExec(
        `update calendar_events set discontinued_at = now() - interval '10 days' where id = ${sqlStr(discId)};`
      );
      // Precondition: in the window, both series are confirmed children only.
      for (const rootId of [endedId, discId]) {
        const rows = dbQuery<{ n: number; stamped: number }>(
          `select count(*)::int as n, count(*) filter (where discontinued_at is not null or recurrence_end_date is not null)::int as stamped
             from calendar_events where parent_event_id = ${sqlStr(rootId)} and scheduled_date >= ${sqlStr(dateInTz(tz, -15))}`
        );
        expect(rows[0]).toEqual({ n: 6, stamped: 0 });
      }

      await gotoMedsRoster(page, circleId);
      const inactive = page.getByRole('region', { name: INACTIVE, exact: true });
      const active = page.getByRole('region', { name: ACTIVE, exact: true });

      // Ended: one card, "Ended <date>", no Reactivate/Discontinue, no stock.
      const endedCard = inactive.locator('li').filter({ hasText: endedName });
      await expect(endedCard).toHaveCount(1, { timeout: 20_000 });
      await expect(endedCard).toContainText(`Ended ${shortDate(endDate)}`);
      await expect(endedCard).not.toContainText(/days? left/);
      await expect(active.locator('li').filter({ hasText: endedName })).toHaveCount(0);
      await endedCard.getByRole('button', { name: `More actions for ${endedName}` }).click();
      await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Reactivate' })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Discontinue' })).toHaveCount(0);
      await page.keyboard.press('Escape');

      // Discontinued (and ended): one card, "Inactive", Reactivate offered.
      const discCard = inactive.locator('li').filter({ hasText: discName });
      await expect(discCard).toHaveCount(1);
      await expect(discCard).toContainText('Inactive');
      await expect(discCard).not.toContainText('Ended');
      await expect(active.locator('li').filter({ hasText: discName })).toHaveCount(0);
      await discCard.getByRole('button', { name: `More actions for ${discName}` }).click();
      await expect(page.getByRole('menuitem', { name: 'Reactivate' })).toBeVisible();
      await page.keyboard.press('Escape');
    } finally {
      await deleteSeries(session, circleId, endedId);
      await deleteSeries(session, circleId, discId);
    }
  });
});
