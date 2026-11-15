import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import {
  answerYesterdaysDose,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  uniqueSuffix,
} from '../notesFirstClassShared';

// 1.4.2 grouped dose alert (docs/plans/notification-grouping-1-4-2.md): ONE inbox row per
// time slot ("3 of Mom's 00:05 meds aren't marked"). Tapping it opens Today with EVERY dose of
// that slot revealed and highlighted, focus on the first Taken, and each dose marked ONE BY ONE
// (there is no mark-all). Marking 2 of 3 leaves exactly the third on Today.
//
// The /api/inbox endpoints are stubbed (the backend switch `medication_alert_grouping` ships
// 'off', so no real grouped row exists yet); the doses, Next up, the matching and the Taken
// writes are REAL (backend + DB). Doses at 00:05 recipient time (always due); a run within
// 10 minutes of that zone's midnight is skipped, like notifications-inbox-dose-landing.spec.ts.
// A 4th med at 00:06 is a DIFFERENT slot and must never be highlighted.

const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: process.env.DOSE_VIEWER_TZ ?? 'America/Denver' });
test.setTimeout(120_000);

function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(
    new Date()
  );
  return (Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
}

async function stubInbox(page: Page, items: Array<Record<string, unknown>>): Promise<void> {
  await page.route(/\/api\/inbox(\/|\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ json: { success: true, data: { updated: 1 } } });
    if (req.url().includes('/unread-count')) {
      return route.fulfill({ json: { success: true, data: { unread_count: items.length } } });
    }
    return route.fulfill({ json: { success: true, data: { items, unread_count: items.length } } });
  });
}

function slotRow(circleId: string, date: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const data = {
    type: 'medication_slot_alert',
    slotTier: 'tier1',
    tier: 1,
    circleId,
    circle_id: circleId,
    scheduledDate: date,
    scheduled_date: date,
    scheduledTime: '00:05:00',
    scheduled_time: '00:05:00',
    slotKey: `${circleId}:${date}:00:05:00`,
    doseCount: 3,
    unmarkedCount: 3,
  };
  return {
    id: crypto.randomUUID(),
    type: 'medication_slot_alert',
    circle_id: circleId,
    circle_name: 'Circle',
    title: 'Meds not marked yet',
    body: "3 of Rose's meds aren't marked yet (scheduled for 12:05 AM)",
    data,
    state: null,
    read_at: null,
    created_at: now,
    updated_at: now,
    target_status: 'ok',
    ...over,
  };
}

test('a grouped "not marked" row lands on Today on its slot; doses are marked one by one', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.skip(
    (() => {
      const m = minutesIntoDay(RECIPIENT_TZ);
      return m < 10 || m > 24 * 60 - 5;
    })(),
    'within 10 minutes of midnight in the recipient zone'
  );
  const owner = await createScopedAccount('slotland');
  sqlExec(`update users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq('slotland'));
  const tz = await circleTimezone(session, circleId);
  const sfx = uniqueSuffix();
  const yesterday = dateInTz(tz, -1);
  const today = dateInTz(tz, 0);
  const roots: string[] = [];
  const slotNames: string[] = [];
  try {
    for (const [i, time] of ['00:05', '00:05', '00:05', '00:06'].entries()) {
      const name = `ZZ_E2E_SLOT${i + 1}_${sfx}`;
      const root = await createDailyMedication(session, circleId, name, yesterday, { time });
      await answerYesterdaysDose(session, circleId, root, tz);
      roots.push(root);
      if (time === '00:05') slotNames.push(name);
    }
    const otherSlot = `ZZ_E2E_SLOT4_${sfx}`;

    await stubInbox(page, [slotRow(circleId, today)]);
    await cookieLogin(context, owner, baseURL);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    // The row shows the server's text, one row for the whole slot.
    const row = page.getByTestId('inbox-row');
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row).toContainText("3 of Rose's meds aren't marked yet");
    await row.click();

    // Today, every 00:05 dose highlighted; the 00:06 dose (another slot) is not.
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
    for (const name of slotNames) {
      const r = page.locator('[data-testid="next-up-row"]').filter({ hasText: name });
      await expect(r.locator('[data-highlighted="true"]')).toBeVisible({ timeout: 30_000 });
    }
    await expect(
      page.locator('[data-testid="next-up-row"]').filter({ hasText: otherSlot }).locator('[data-highlighted="true"]')
    ).toHaveCount(0);
    // Focus is on the FIRST dose of the slot as SHOWN. Same-time doses are tie-broken by item
    // key (a random med id, nextUpItems.ts), so creation order says nothing about which is first.
    const shown = await page.locator('[data-testid="next-up-row"]').allTextContents();
    const firstShown = shown.map((text) => slotNames.find((n) => text.includes(n))).find(Boolean);
    expect(firstShown, `a slot dose is on Next up: ${shown.join(' | ')}`).toBeTruthy();
    await expect(page.getByRole('button', { name: new RegExp(`^Taken, ${firstShown}`) })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: "3 doses aren't marked yet" })).toHaveCount(1);

    // No mark-all anywhere on the page.
    await expect(page.getByRole('button', { name: /mark all|all taken/i })).toHaveCount(0);

    // Mark 2 of the 3, one by one.
    for (const name of slotNames.slice(0, 2)) {
      await page.getByRole('button', { name: new RegExp(`^Taken, ${name}`) }).click();
      await expect(page.getByRole('button', { name: new RegExp(`^Undo ${name}`) })).toBeVisible();
    }
    // After the undo window, exactly the third dose of the slot is still on Today.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="next-up-row"]').filter({ hasText: slotNames[2] })).toBeVisible({
      timeout: 30_000,
    });
    for (const name of slotNames.slice(0, 2)) {
      await expect
        .poll(() => page.locator('[data-testid="next-up-row"]').filter({ hasText: name }).count(), { timeout: 30_000 })
        .toBe(0);
    }
  } finally {
    for (const root of roots) await deleteSeries(session, circleId, root);
  }
});

test('the "doses taken" summary row shows its counts and opens Today without a fallback page', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('slotsum');
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq('slotsum'));
  const tz = await circleTimezone(session, circleId);
  const today = dateInTz(tz, 0);
  const now = new Date().toISOString();
  await stubInbox(page, [
    {
      id: crypto.randomUUID(),
      type: 'medication_taken_summary',
      circle_id: circleId,
      circle_name: 'Circle',
      title: "Rose's meds (8:00 AM)",
      body: '2 taken, 1 skipped (Sam, Ana)',
      data: {
        type: 'medication_taken_summary',
        circleId,
        circle_id: circleId,
        scheduledDate: today,
        scheduled_date: today,
        scheduledTime: '08:00:00',
        scheduled_time: '08:00:00',
        summaryId: crypto.randomUUID(),
        doseCount: 3,
        takenCount: 2,
        skippedCount: 1,
        markersCount: 2,
      },
      state: null,
      read_at: null,
      created_at: now,
      updated_at: now,
      target_status: 'ok',
    },
  ]);
  await cookieLogin(context, owner, baseURL);
  await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  const row = page.getByTestId('inbox-row');
  await expect(row).toContainText("Rose's meds (8:00 AM)", { timeout: 30_000 });
  await expect(row).toContainText('2 taken, 1 skipped (Sam, Ana)');
  await expect(row).not.toContainText(/missed/i);
  await row.click();
  // Nothing of the slot is left to mark: plain Today, params gone, no calendar fallback.
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
});
