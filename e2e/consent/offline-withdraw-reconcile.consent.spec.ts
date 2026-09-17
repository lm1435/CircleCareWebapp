import { consentTest as test, expect, presetAnalyticsConsent } from '../consent';
import { countRequests, failRequest, holdRequest } from '../unhappy';
import {
  USERS_ME_PATH,
  WITHDRAW_PATH,
  consentSwitch,
  countResponses,
  eventsSince,
  expectAnonymousEvents,
  expectNoEventSince,
  holdFirstRead,
  nowSec,
  openAccountMenuItem,
  readLocalConsent,
  readServerConsent,
  setServerConsent,
  signInViaForm,
  signOutViaMenu,
  waitForEventSince,
} from './_helpers';

// ===========================================================================
// CRITICAL 2 REGRESSION — a queued, undelivered consent decision must not be
// overridden by the server reconcile. The guard in
// src/lib/analyticsConsentServerReconcile.ts has TWO halves:
//
//     const queuedBeforeRead = queuedFor(userId);          // snapshot, before the read
//     …await the /users/me read…
//     if (queuedBeforeRead || queuedFor(userId)) return;   // + decision-time check
//
// Every test starts as a GRANTED user (server granted_at set). What each proves:
//
// 1. RELOAD. Withdraw aborted → queued; reload. Bootstrap hands the reconcile an
//    already-fetched profile, and the queue exists from before the read until
//    after the decision, so EITHER half alone protects it. It proves the guard
//    exists (red only when both halves are removed), not which half.
// 2. SIGN-OUT + SIGN-IN, flush held until the read has answered. Same shape: the
//    queue exists throughout the read; either half alone protects it.
// 3. PRE-READ SNAPSHOT. Queued when the reconcile starts; the flush then delivers
//    and CLEARS the queue BEFORE the stale (pre-withdraw, granted) read returns.
//    At decision time nothing is queued, so ONLY `queuedBeforeRead` protects it.
// 4. DECISION-TIME CHECK. Nothing queued when the read starts; the user turns
//    analytics OFF (withdraw aborted → queued) while the read is in flight; the
//    read then returns granted. ONLY the decision-time `queuedFor(userId)` sees it.
//
// "Protects" = no $identify, events stay anonymous, the local record stays
// declined. Falsified against mutated copies of the webapp (see e2e/README.md,
// "Consent project"): M2 = snapshot removed (`queuedBeforeRead = false`) turns
// ONLY test 3 red; M3 = decision-time check removed (`if (queuedBeforeRead)`)
// turns ONLY test 4 red; both removed turns 1 and 2 red.
// ===========================================================================

test.describe.configure({ timeout: 120_000 });

const restores: Array<() => void> = [];
test.afterEach(() => {
  while (restores.length > 0) restores.pop()!();
});

test('offline withdraw survives a reload: no $identify, events anonymous, the queued flush lands once', async ({
  page,
  posthog,
  account,
  circleId,
  secondCircleId,
}) => {
  const identity = { userId: account.userId, email: account.email, circleIds: [circleId, secondCircleId] };
  restores.push(setServerConsent(account.userId, 'granted'));
  await presetAnalyticsConsent(page, 'granted', account.userId);

  await page.goto('/profile');
  const toggle = consentSwitch(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  expect((await posthog.waitForEvent('$identify', { timeoutMs: 20_000 })).distinctId).toBe(account.userId);

  const fault = await failRequest(page, 'POST', WITHDRAW_PATH, { abort: true, times: 1 });
  const withdrawsSent = countRequests(page, 'POST', WITHDRAW_PATH);
  const withdrawsOk = countResponses(page, 'POST', WITHDRAW_PATH, 200);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await fault.expectHits(1);
  await expect
    .poll(async () => (await readLocalConsent(page)).pending?.[account.userId]?.enabled ?? null, { timeout: 10_000 })
    .toBe(false);
  expect(readServerConsent(account.userId).withdrawn_at, 'the server never heard the withdrawal').toBeNull();

  // ── Bootstrap with the decision still queued ──
  const reloadAt = nowSec();
  await page.reload();
  await waitForEventSince(posthog, '$pageview', reloadAt, { timeoutMs: 25_000 }); // positive control
  await expectNoEventSince(posthog, '$identify', reloadAt, 6_000);
  expectAnonymousEvents(eventsSince(posthog, reloadAt), identity, 'after reload');
  await expect(consentSwitch(page)).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });
  expect((await readLocalConsent(page)).enabled).toBe('false');

  // ── The queued flush delivered it ──
  await expect.poll(() => readServerConsent(account.userId).withdrawn_at, { timeout: 15_000 }).not.toBeNull();
  await withdrawsSent.expectCount(2); // the aborted one + the flush
  await expect.poll(() => withdrawsOk.count, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await readLocalConsent(page)).pending, { timeout: 10_000 }).toBeNull();
  expect(withdrawsOk.count, 'exactly one successful withdraw POST').toBe(1);
});

test('offline withdraw survives sign-out + sign-in: no $identify, events anonymous, the queued flush lands once', async ({
  page,
  posthog,
  account,
  circleId,
  secondCircleId,
}) => {
  const identity = { userId: account.userId, email: account.email, circleIds: [circleId, secondCircleId] };
  restores.push(setServerConsent(account.userId, 'granted'));
  await presetAnalyticsConsent(page, 'granted', account.userId);

  await page.goto('/profile');
  const toggle = consentSwitch(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  expect((await posthog.waitForEvent('$identify', { timeoutMs: 20_000 })).distinctId).toBe(account.userId);

  // Abort the toggle's POST AND sign-out's last-chance flush, so the decision
  // is still queued when the account signs back in.
  const fault = await failRequest(page, 'POST', WITHDRAW_PATH, { abort: true, times: 2 });
  const withdrawsSent = countRequests(page, 'POST', WITHDRAW_PATH);
  const withdrawsOk = countResponses(page, 'POST', WITHDRAW_PATH, 200);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await fault.expectHits(1);

  await signOutViaMenu(page);
  await fault.expectHits(2);
  expect((await readLocalConsent(page)).pending?.[account.userId]?.enabled, 'still queued after sign-out').toBe(false);
  expect(readServerConsent(account.userId).withdrawn_at).toBeNull();

  // ── Sign in with the decision queued ──
  // signIn starts the reconcile's GET /users/me and the flush side by side.
  // Hold the flush until the (stale, granted) read has been answered — the
  // order in which the reconcile would override the queued decision.
  const hold = await holdRequest(page, 'POST', WITHDRAW_PATH);
  const meRead = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === USERS_ME_PATH,
    { timeout: 20_000 }
  );
  const signInAt = nowSec();
  await signInViaForm(page, account);
  expect((await meRead).status()).toBe(200);
  await hold.waitForHeld(1, { timeoutMs: 20_000 });
  await hold.release();

  await waitForEventSince(posthog, '$pageview', signInAt, { timeoutMs: 25_000 }); // positive control
  await expectNoEventSince(posthog, '$identify', signInAt, 6_000);
  expectAnonymousEvents(eventsSince(posthog, signInAt), identity, 'after sign-in');

  await expect.poll(() => readServerConsent(account.userId).withdrawn_at, { timeout: 15_000 }).not.toBeNull();
  await withdrawsSent.expectCount(3); // toggle (aborted) + sign-out flush (aborted) + sign-in flush
  await expect.poll(() => withdrawsOk.count, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await readLocalConsent(page)).pending, { timeout: 10_000 }).toBeNull();

  await openAccountMenuItem(page, 'Profile');
  await expect(consentSwitch(page)).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });
  await expectNoEventSince(posthog, '$identify', signInAt, 1_000);
  expect(withdrawsOk.count, 'exactly one successful withdraw POST').toBe(1);
});

/** `data.user` consent stamps of a /users/me envelope. */
function stampsOf(json: unknown): { granted: unknown; withdrawn: unknown } {
  const user = (json as { data?: { user?: Record<string, unknown> } } | null)?.data?.user ?? {};
  return { granted: user.analytics_consent_granted_at, withdrawn: user.analytics_consent_withdrawn_at };
}

test('PRE-READ SNAPSHOT: a flush that clears the queue before a stale read returns does not reopen the override', async ({
  page,
  posthog,
  account,
  circleId,
  secondCircleId,
}) => {
  const identity = { userId: account.userId, email: account.email, circleIds: [circleId, secondCircleId] };
  restores.push(setServerConsent(account.userId, 'granted'));
  await presetAnalyticsConsent(page, 'granted', account.userId);

  await page.goto('/profile');
  const toggle = consentSwitch(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  expect((await posthog.waitForEvent('$identify', { timeoutMs: 20_000 })).distinctId).toBe(account.userId);

  // Queue the withdrawal: the toggle's POST and sign-out's flush both aborted.
  const fault = await failRequest(page, 'POST', WITHDRAW_PATH, { abort: true, times: 2 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await fault.expectHits(1);
  await signOutViaMenu(page);
  await fault.expectHits(2);
  expect((await readLocalConsent(page)).pending?.[account.userId]?.enabled, 'queued before sign-in').toBe(false);
  expect(readServerConsent(account.userId).withdrawn_at).toBeNull();

  // ── Sign in: the reconcile snapshots "queued", then its read is HELD ──
  const read = await holdFirstRead(page, USERS_ME_PATH);
  const flush = await holdRequest(page, 'POST', WITHDRAW_PATH);
  const withdrawsOk = countResponses(page, 'POST', WITHDRAW_PATH, 200);
  const signInAt = nowSec();
  await signInViaForm(page, account);
  await read.waitForFetched();
  expect(stampsOf(read.json), 'the held read carries the PRE-withdraw (granted) server state').toEqual({
    granted: expect.any(String),
    withdrawn: null,
  });

  // ── The flush delivers and CLEARS the queue while that read is still held ──
  await flush.waitForHeld(1, { timeoutMs: 20_000 });
  await flush.release();
  await expect.poll(() => readServerConsent(account.userId).withdrawn_at, { timeout: 15_000 }).not.toBeNull();
  await expect.poll(async () => (await readLocalConsent(page)).pending, { timeout: 15_000 }).toBeNull();
  await expect.poll(() => withdrawsOk.count, { timeout: 10_000 }).toBe(1);
  expect(read.released, 'the stale read is still held when the queue is cleared').toBe(false);

  // ── Only now does the stale read return: server "granted" vs local declined, nothing queued ──
  await read.releaseAndWait();
  await waitForEventSince(posthog, '$pageview', signInAt, { timeoutMs: 25_000 }); // positive control
  await expectNoEventSince(posthog, '$identify', signInAt, 6_000);
  expectAnonymousEvents(eventsSince(posthog, signInAt), identity, 'after the stale read');
  expect((await readLocalConsent(page)).enabled, 'the local withdrawal stands').toBe('false');

  await openAccountMenuItem(page, 'Profile');
  await expect(consentSwitch(page)).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });
  await expectNoEventSince(posthog, '$identify', signInAt, 1_000);
});

test('DECISION-TIME CHECK: a toggle made while the reconcile read is in flight is not overwritten by that read', async ({
  page,
  posthog,
  account,
  circleId,
  secondCircleId,
}) => {
  const identity = { userId: account.userId, email: account.email, circleIds: [circleId, secondCircleId] };
  restores.push(setServerConsent(account.userId, 'granted'));
  await presetAnalyticsConsent(page, 'granted', account.userId);

  await page.goto('/profile');
  await expect(consentSwitch(page)).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  expect((await posthog.waitForEvent('$identify', { timeoutMs: 20_000 })).distinctId).toBe(account.userId);

  await signOutViaMenu(page);
  expect((await readLocalConsent(page)).pending, 'nothing queued when the read starts').toBeNull();

  // ── Sign in: the reconcile's read is HELD with nothing queued ──
  const read = await holdFirstRead(page, USERS_ME_PATH);
  const signInAt = nowSec();
  await signInViaForm(page, account);
  await read.waitForFetched();
  expect(stampsOf(read.json), 'the held read carries the granted server state').toEqual({
    granted: expect.any(String),
    withdrawn: null,
  });

  // ── While it is in flight: Profile → analytics OFF, withdraw aborted → queued ──
  const fault = await failRequest(page, 'POST', WITHDRAW_PATH, { abort: true, times: 1 });
  await openAccountMenuItem(page, 'Profile');
  const toggle = consentSwitch(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await fault.expectHits(1);
  await expect
    .poll(async () => (await readLocalConsent(page)).pending?.[account.userId]?.enabled ?? null, { timeout: 10_000 })
    .toBe(false);
  expect(read.released, 'the toggle happened while the read was held').toBe(false);

  // ── The read (asked before the toggle) now returns granted ──
  const releasedAt = nowSec();
  await read.releaseAndWait();
  await expectNoEventSince(posthog, '$identify', signInAt, 6_000);
  expect((await readLocalConsent(page)).enabled, 'the toggle stands').toBe('false');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // Positive control after the decision: an SPA pageview, captured anonymously.
  await openAccountMenuItem(page, 'Help & FAQ');
  await waitForEventSince(posthog, '$pageview', releasedAt, {
    timeoutMs: 25_000,
    predicate: (e) => String(e.properties.$pathname).startsWith('/help'),
  });
  expectAnonymousEvents(eventsSince(posthog, releasedAt), identity, 'after the in-flight read returned');
  await expectNoEventSince(posthog, '$identify', signInAt, 1_000);
});
