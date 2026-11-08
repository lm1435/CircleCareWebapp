import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// approved-recs-2026-09-30 B6 / PK10, REPLACED in 1.4.0 ("their phone dictates"):
// the profile zone follows the device with NO confirmation and NO exception for
// circles whose recipient has no zone of their own (their dose times follow the
// owner's zone and move with it). Profile shows it read-only with a helper line.
// Mobile twin: mobile/.maestro/parity/profile/pk10-tz-warning.yaml (+ unit tests;
// a simulator cannot change its own zone).
//
// Run-scoped accounts only. The browser runs in Asia/Tokyo; the seeded zone is Denver.

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'Asia/Tokyo' });
test.setTimeout(120_000);

const zoneOf = (userId: string): string | null =>
  dbQuery<{ timezone: string | null }>(
    `select timezone from users where id = ${sqlStr(userId)}::uuid`
  )[0]?.timezone ?? null;

test('owner with a recipient-without-account circle: the zone follows the browser, no prompt, read-only row', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('tz-owner');
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq('tzrecipient'));
  expect(circleId).toBeTruthy();
  expect(zoneOf(owner.userId)).not.toBe('Asia/Tokyo');

  await cookieLogin(context, owner, baseURL);
  await page.goto('/profile/timezone', { waitUntil: 'domcontentloaded' });
  const row = page.getByTestId('profile-timezone');
  await expect(row).toContainText('Tokyo', { timeout: 20_000 });
  await expect(row).toContainText(
    'Set by your device. Used for your quiet hours and the times in your reminders and emails.'
  );
  await expect.poll(() => zoneOf(owner.userId), { timeout: 20_000 }).toBe('Asia/Tokyo');
  // No prompt, no controls.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row.getByRole('button')).toHaveCount(0);
  await expect(row.getByRole('combobox')).toHaveCount(0);

  // axe on the settled page.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  );
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    axe.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => `${n.html.slice(0, 140)} :: ${n.any[0]?.message ?? ''}`).join(' ;; ')}`
    )
  ).toEqual([]);
});

test('owner with no dependent circle: the zone follows the device with no prompt', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('tz-solo');
  await ownerApi(request, owner); // no circles at all
  await cookieLogin(context, owner, baseURL);
  await page.goto('/profile/timezone', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => zoneOf(owner.userId), { timeout: 20_000 }).toBe('Asia/Tokyo');
  await expect(page.getByTestId('profile-timezone')).toContainText('Tokyo', { timeout: 20_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
