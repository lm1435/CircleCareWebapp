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

// Inbox row for a dose that is NOT MARKED YET -> the circle's Today, with that dose's row
// scrolled into view, highlighted, focused on its Taken button, and one tap on Taken marks it.
// A dose Today does not list falls back to the calendar's event sheet. The /api/inbox
// endpoints are stubbed (like notifications-inbox.spec.ts); the doses are REAL (backend + DB),
// so Next up, the matching and the Taken write are the real thing.
//
// The doses sit at 00:01..00:04 in the recipient's zone (always due); a run within 5 minutes
// of that zone's midnight is skipped, like todays-meds-undo.spec.ts.

const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: process.env.DOSE_VIEWER_TZ ?? 'America/Denver' });
test.setTimeout(90_000);

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

function inboxRow(circleId: string, over: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: 'medication_late',
    circle_id: circleId,
    circle_name: 'Circle',
    title: 'Dose not marked',
    body: 'Nobody has marked this dose yet',
    data: {},
    state: null,
    read_at: null,
    created_at: now,
    updated_at: now,
    target_status: 'ok',
    ...over,
  };
}

async function arrange(request: import('@playwright/test').APIRequestContext) {
  test.skip(
    (() => {
      const m = minutesIntoDay(RECIPIENT_TZ);
      return m < 5 || m > 24 * 60 - 5;
    })(),
    'within 5 minutes of midnight in the recipient zone'
  );
  const owner = await createScopedAccount('doseland');
  sqlExec(`update users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq('doseland'));
  const tz = await circleTimezone(session, circleId);
  const sfx = uniqueSuffix();
  const yesterday = dateInTz(tz, -1);
  const roots: string[] = [];
  const names: string[] = [];
  // Four meds at 00:01..00:04: the TARGET (00:04) is the 4th row of Next up.
  for (const [i, time] of ['00:01', '00:02', '00:03', '00:04'].entries()) {
    const name = `ZZ_E2E_LAND${i + 1}_${sfx}`;
    const root = await createDailyMedication(session, circleId, name, yesterday, { time });
    await answerYesterdaysDose(session, circleId, root, tz);
    roots.push(root);
    names.push(name);
  }
  return { owner, session, circleId, tz, roots, names, today: dateInTz(tz, 0) };
}

test('an unmarked-dose inbox row lands on Today: 4th row in view, highlighted, focused; Taken marks it', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request);
  try {
    // Short window: the 4th row is below the fold, so "in view" proves the scroll happened.
    await page.setViewportSize({ width: 1280, height: 420 });
    await stubInbox(page, [
      inboxRow(s.circleId, {
        data: { eventId: s.roots[3], scheduledDate: s.today, scheduledTime: '00:04:00' },
      }),
    ]);
    await cookieLogin(context, s.owner, baseURL);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('inbox-row').first().click({ timeout: 30_000 });

    const row = page.locator('[data-testid="next-up-row"]').filter({ hasText: s.names[3] });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('next-up-row')).toHaveCount(4);
    await expect(row.locator('[data-highlighted="true"]')).toBeVisible();
    const taken = row.getByRole('button', { name: new RegExp(`^Taken, ${s.names[3]}`) });
    await expect(taken).toBeFocused();
    await expect(row).toBeInViewport();
    await expect(page.getByRole('status').filter({ hasText: "This dose hasn't been marked yet." })).toHaveCount(1);
    // The landing params leave the URL: a refresh never replays it.
    await expect(page).toHaveURL(new RegExp(`/circles/${s.circleId}$`));

    await taken.click();
    await expect(row.getByRole('button', { name: new RegExp(`^Undo ${s.names[3]}`) })).toBeVisible();
  } finally {
    for (const root of s.roots) await deleteSeries(s.session, s.circleId, root);
  }
});

test('a dose Today does not list falls back to the calendar event sheet (replace)', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request);
  const missing = '00000000-0000-4000-8000-00000000d05e';
  try {
    await stubInbox(page, [
      inboxRow(s.circleId, { data: { eventId: missing, scheduledDate: s.today, scheduledTime: '00:04:00' } }),
    ]);
    await cookieLogin(context, s.owner, baseURL);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('inbox-row').first().click({ timeout: 30_000 });
    await expect(page).toHaveURL(
      new RegExp(`/circles/${s.circleId}/calendar\\?date=${s.today}&eventId=${missing}`),
      { timeout: 30_000 }
    );
    // replace, not push: Back returns to the inbox, never to the dose-landing URL.
    await page.goBack();
    await expect(page).toHaveURL(/\/notifications$/);
  } finally {
    for (const root of s.roots) await deleteSeries(s.session, s.circleId, root);
  }
});
