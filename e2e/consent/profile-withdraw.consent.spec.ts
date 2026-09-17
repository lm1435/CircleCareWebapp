import { consentTest as test, expect, presetAnalyticsConsent } from '../consent';
import { countRequests } from '../unhappy';
import {
  RESTORE_PATH,
  WITHDRAW_PATH,
  consentSwitch,
  eventsSince,
  expectAnonymousEvents,
  expectNoEventSince,
  nowSec,
  openAccountMenuItem,
  readLocalConsent,
  readServerConsent,
  setServerConsent,
  waitForEventSince,
} from './_helpers';

// ===========================================================================
// PROFILE > PRIVACY toggle: OFF withdraws (one POST, DB stamped, client torn
// down, later events anonymous); ON restores (one POST, DB cleared, identify).
// ===========================================================================

test.describe.configure({ timeout: 120_000 });

const restores: Array<() => void> = [];
test.afterEach(() => {
  while (restores.length > 0) restores.pop()!();
});

test('toggle OFF: one withdraw POST, DB stamped, events anonymous after; toggle ON: restore POST then identify', async ({
  page,
  posthog,
  account,
  circleId,
  secondCircleId,
}) => {
  restores.push(setServerConsent(account.userId, 'granted'));
  await presetAnalyticsConsent(page, 'granted', account.userId);
  const withdraws = countRequests(page, 'POST', WITHDRAW_PATH);
  const restoresSent = countRequests(page, 'POST', RESTORE_PATH);

  await page.goto('/profile');
  const toggle = consentSwitch(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  const firstIdentify = await posthog.waitForEvent('$identify', { timeoutMs: 20_000 });
  expect(firstIdentify.distinctId).toBe(account.userId);

  // ── OFF ──
  const offAt = nowSec();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await withdraws.expectCount(1);
  await expect.poll(() => readServerConsent(account.userId).withdrawn_at, { timeout: 15_000 }).not.toBeNull();
  expect((await readLocalConsent(page)).enabled).toBe('false');

  await openAccountMenuItem(page, 'Help & FAQ');
  await expect(page).toHaveURL(/\/help$/);
  await waitForEventSince(posthog, '$pageview', offAt); // positive control
  await expectNoEventSince(posthog, '$identify', offAt);
  expectAnonymousEvents(
    eventsSince(posthog, offAt),
    { userId: account.userId, email: account.email, circleIds: [circleId, secondCircleId] },
    'after withdrawal'
  );
  await restoresSent.expectCount(0);

  // ── ON ──
  await openAccountMenuItem(page, 'Profile');
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });
  const onAt = nowSec();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await restoresSent.expectCount(1);
  await expect
    .poll(() => {
      const s = readServerConsent(account.userId);
      return s.withdrawn_at === null && s.granted_at !== null;
    }, { timeout: 15_000 })
    .toBe(true);
  const reIdentify = await waitForEventSince(posthog, '$identify', onAt);
  expect(reIdentify.distinctId, 're-grant identifies the account again').toBe(account.userId);
  await withdraws.expectCount(1);
});
