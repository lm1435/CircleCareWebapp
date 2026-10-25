import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';

// Store-review banner (components/StoreReviewBanner): shown ONLY to users with
// a registered mobile device (push_tokens row), at least 3 days after first
// eligibility. Web-only users must never see it. Tests in this file run in
// order within one worker: the web-only assertion runs FIRST, before the
// device row is seeded, and the row is removed again at the end.

const STATE_KEY = 'cc_store_review_state';
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

function eligibleState(): string {
  return JSON.stringify({ firstSeenAt: new Date(Date.now() - 4 * DAY_MS).toISOString() });
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

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  // Settle on a rendered page before asserting absence.
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByTestId('store-review-banner')).toHaveCount(0);
});

test('an iOS app user past the 3-day clock sees the banner; dismissal persists across reload', async ({
  page,
  circleId,
  account,
}) => {
  sqlExec(`
    insert into push_tokens (user_id, device_token, platform, is_active)
    values (${sqlStr(account.userId)}, ${sqlStr(`ExponentPushToken[e2e-store-review-${account.slot}]`)}, 'ios', true)
    on conflict (user_id, device_token) do update set is_active = true, platform = 'ios';
  `);
  await page.addInitScript(seedStateOnce(eligibleState()));
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
  sqlExec(`
    insert into push_tokens (user_id, device_token, platform, is_active)
    values (${sqlStr(account.userId)}, ${sqlStr(`ExponentPushToken[e2e-store-review-${account.slot}]`)}, 'ios', true)
    on conflict (user_id, device_token) do update set is_active = true, platform = 'ios';
  `);
  await page.addInitScript(seedStateOnce(eligibleState()));
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
