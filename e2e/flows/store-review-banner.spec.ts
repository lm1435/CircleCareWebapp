import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';

// Store-review banner (components/StoreReviewBanner): shown ONLY to users with
// a registered mobile device (push_tokens row), at least 2 days after first
// eligibility, and (2026-11-03, lib/reviewMoments.ts) ONLY at a good moment
// after an 8 s quiet period. The moment used here is the real "first person
// joined a circle you own": the circle's member baseline is seeded at 1 (just
// the owner), and the owner's circle list (2+ members) is the join. Web-only
// users must never see it. Tests in this file run in order within one worker:
// the web-only assertion runs FIRST, before the device row is seeded, and the
// row is removed again at the end.

const STATE_KEY = 'cc_store_review_state';
const BASELINE_KEY = 'cc_review_member_baseline';
const DAY_MS = 1000 * 60 * 60 * 24;

/** Seed banner state BEFORE the app boots, without clobbering what the app
 *  writes afterwards (init scripts re-run on every navigation). */
function seedStateOnce(stateJson: string): string {
  return `
    try {
      if (!window.localStorage.getItem(${JSON.stringify(STATE_KEY)})) {
        window.localStorage.setItem(${JSON.stringify(STATE_KEY)}, ${JSON.stringify(stateJson)});
      }
    } catch {}
  `;
}

/** Record window.open calls instead of opening real external tabs. */
const STUB_OPEN = `
  window.__openedUrls = [];
  window.open = (url) => { window.__openedUrls.push(String(url)); return null; };
`;

/** The circle as last seen with only its owner: the loaded list is the first join. */
function seedMemberJoinOnce(circleId: string): string {
  return `
    try {
      if (!window.sessionStorage.getItem('e2e_baseline_seeded')) {
        window.sessionStorage.setItem('e2e_baseline_seeded', '1');
        window.localStorage.setItem(${JSON.stringify(BASELINE_KEY)}, ${JSON.stringify(JSON.stringify({ [circleId]: 1 }))});
      }
    } catch {}
  `;
}

function eligibleState(): string {
  return JSON.stringify({ firstSeenAt: new Date(Date.now() - 4 * DAY_MS).toISOString() });
}

function seedDevice(userId: string, slot: number | string): void {
  sqlExec(`
    insert into push_tokens (user_id, device_token, platform, is_active)
    values (${sqlStr(userId)}, ${sqlStr(`ExponentPushToken[e2e-store-review-${slot}]`)}, 'ios', true)
    on conflict (user_id, device_token) do update set is_active = true, platform = 'ios';
  `);
}

function deleteTokens(userId: string): void {
  sqlExec(`delete from push_tokens where user_id = ${sqlStr(userId)};`);
}

test.afterAll(({ account }) => {
  deleteTokens(account.userId);
});

test('a web-only user (no registered device) never sees the banner', async ({
  page,
  circleId,
  account,
}) => {
  deleteTokens(account.userId);
  await page.addInitScript(seedStateOnce(eligibleState()));
  await page.addInitScript(seedMemberJoinOnce(circleId));

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  // Settle on a rendered page, past the quiet period, before asserting absence.
  await expect(page.locator('#main')).toBeVisible();
  await page.waitForTimeout(10_000);
  await expect(page.getByTestId('store-review-banner')).toHaveCount(0);
});

test('an eligible app user is NOT asked on a plain visit: no moment, no banner', async ({
  page,
  circleId,
  account,
}) => {
  seedDevice(account.userId, account.slot);
  await page.addInitScript(seedStateOnce(eligibleState()));

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#main')).toBeVisible();
  await page.waitForTimeout(10_000);
  await expect(page.getByTestId('store-review-banner')).toHaveCount(0);
  // The visit recorded the circle's baseline; the next visit is no moment either.
  const baseline = await page.evaluate((k) => window.localStorage.getItem(k), BASELINE_KEY);
  expect(baseline).toContain(circleId);
});

test('an iOS app user sees the banner when someone first joins their circle; dismissal persists across reload', async ({
  page,
  circleId,
  account,
}) => {
  seedDevice(account.userId, account.slot);
  await page.addInitScript(seedStateOnce(eligibleState()));
  await page.addInitScript(seedMemberJoinOnce(circleId));
  await page.addInitScript(STUB_OPEN);

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const banner = page.getByTestId('store-review-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByTestId('store-review-banner')).toHaveCount(0);
});

test('Rate CircleCare opens the App Store write-review link and ends the ask', async ({
  page,
  circleId,
  account,
}) => {
  seedDevice(account.userId, account.slot);
  await page.addInitScript(seedStateOnce(eligibleState()));
  await page.addInitScript(seedMemberJoinOnce(circleId));
  await page.addInitScript(STUB_OPEN);

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const banner = page.getByTestId('store-review-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Rate CircleCare' }).click();

  const opened = await page.evaluate(() => (window as { __openedUrls?: string[] }).__openedUrls);
  expect(opened).toEqual(['https://apps.apple.com/app/id6757629684?action=write-review']);
  await expect(banner).toHaveCount(0);

  // `done` persists: a reload never shows the ask again.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByTestId('store-review-banner')).toHaveCount(0);
});
