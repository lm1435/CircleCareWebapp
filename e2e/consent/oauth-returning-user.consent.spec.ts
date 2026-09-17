import { consentTest as test, expect } from '../consent';
import { countRequests } from '../unhappy';
import {
  OAUTH_SESSION_PATH,
  WITHDRAW_PATH,
  findStrings,
  freshAccount,
  mintPasswordSession,
  oauthCallbackPath,
  parkSignupAnalyticsAnswer,
  readLocalConsent,
  readServerConsent,
  setServerConsent,
} from './_helpers';

// ===========================================================================
// CRITICAL 1 REGRESSION — a parked signup DECLINE is recorded only for an
// account the OAuth sign-in CREATED (`/auth/oauth-session` → `is_new_user`,
// src/pages/AuthCallbackPage.tsx). A returning user who taps "Sign up with
// Google" arrives with a default-unticked decline they never chose; recording
// it would withdraw their consent and delete their PostHog person.
//
// Real tokens: the password grant of the local GoTrue for a run-scoped account,
// delivered in the fragment AuthCallbackPage parses. The backend decides
// new-vs-returning from GoTrue's created_at/last_sign_in_at, so the returning
// account is backdated and the new one is signed in right after creation.
//
// Falsification: the stubbed `is_new_user: true` test drives the same flow
// through the recording branch and every detector the returning-user test
// relies on fires (withdraw POST, DB stamp, no identify).
// ===========================================================================

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 120_000 });

function oauthSessionResponse(page: import('@playwright/test').Page) {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === OAUTH_SESSION_PATH,
    { timeout: 25_000 }
  );
}

test('returning user with a parked decline: consent untouched, no withdraw, identified as granted', async ({
  page,
  posthog,
}) => {
  const acct = await freshAccount('oauth-ret', { backdateMinutes: 90 });
  setServerConsent(acct.userId, 'granted'); // run-scoped account: nothing to restore
  const before = readServerConsent(acct.userId);
  const withdraws = countRequests(page, 'POST', WITHDRAW_PATH);

  await page.goto('/signup');
  await parkSignupAnalyticsAnswer(page, false);
  const session = await mintPasswordSession(acct);
  const exchanged = oauthSessionResponse(page);
  await page.goto(oauthCallbackPath(session));

  const body = (await (await exchanged).json()) as { data?: { is_new_user?: boolean; user?: { id?: string } } };
  expect(body.data?.user?.id).toBe(acct.userId);
  expect(body.data?.is_new_user, 'the backend classifies this sign-in as RETURNING').toBe(false);

  const identify = await posthog.waitForEvent('$identify', {
    timeoutMs: 25_000,
    predicate: (e) => e.distinctId === acct.userId,
  });
  expect(identify.distinctId).toBe(acct.userId);

  await withdraws.expectCount(0, { settleMs: 4_000 });
  expect(readServerConsent(acct.userId), 'server consent unchanged').toEqual(before);
  expect(before.withdrawn_at).toBeNull();
  const local = await readLocalConsent(page);
  expect(local.parked, 'the parked answer is consumed').toBeNull();
  expect(local.pending, 'nothing queued for delivery').toBeNull();
  expect(local.enabled, 'reconciled to the account’s own grant').toBe('true');
  expect(local.owner).toBe(acct.userId);

  expect(
    findStrings(posthog.events, [session.access_token, session.refresh_token]),
    'no OAuth credential in any decoded payload'
  ).toEqual([]);
});

test('negative control: the same flow answered is_new_user=true DOES record and deliver the decline', async ({
  page,
  posthog,
}) => {
  const acct = await freshAccount('oauth-stub', { backdateMinutes: 90 });
  setServerConsent(acct.userId, 'granted');
  const withdraws = countRequests(page, 'POST', WITHDRAW_PATH);
  let realIsNewUser: unknown = 'not seen';
  await page.route(
    (url) => url.pathname === OAUTH_SESSION_PATH,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await route.fetch();
      const json = (await response.json()) as { data: { is_new_user?: boolean } };
      realIsNewUser = json.data.is_new_user;
      json.data.is_new_user = true;
      await route.fulfill({ response, json });
    }
  );

  await page.goto('/signup');
  await parkSignupAnalyticsAnswer(page, false);
  const session = await mintPasswordSession(acct);
  const exchanged = oauthSessionResponse(page);
  await page.goto(oauthCallbackPath(session));
  await exchanged;
  expect(realIsNewUser, 'the only difference from the returning-user test is the stubbed flag').toBe(false);

  await posthog.waitForEvent('$pageview', { timeoutMs: 25_000 }); // positive control
  await withdraws.expectCount(1);
  await expect.poll(() => readServerConsent(acct.userId).withdrawn_at, { timeout: 15_000 }).not.toBeNull();
  await posthog.expectNoEvent('$identify', { settleMs: 5_000 });
  const local = await readLocalConsent(page);
  expect(local.enabled).toBe('false');
  expect(local.owner).toBe(acct.userId);
  expect(local.parked).toBeNull();
});

test('new user (created seconds ago) with a parked decline: recorded and delivered exactly once', async ({
  page,
  posthog,
}) => {
  const acct = await freshAccount('oauth-new');
  expect(readServerConsent(acct.userId)).toEqual({ granted_at: null, withdrawn_at: null });
  const withdraws = countRequests(page, 'POST', WITHDRAW_PATH);

  await page.goto('/signup');
  await parkSignupAnalyticsAnswer(page, false);
  const session = await mintPasswordSession(acct);
  const exchanged = oauthSessionResponse(page);
  await page.goto(oauthCallbackPath(session));

  const body = (await (await exchanged).json()) as { data?: { is_new_user?: boolean } };
  expect(body.data?.is_new_user, 'the backend classifies this sign-in as NEW (no stub)').toBe(true);

  await posthog.waitForEvent('$pageview', { timeoutMs: 25_000 }); // positive control
  await withdraws.expectCount(1, { settleMs: 3_000 });
  await expect.poll(() => readServerConsent(acct.userId).withdrawn_at, { timeout: 15_000 }).not.toBeNull();
  await posthog.expectNoEvent('$identify', { settleMs: 5_000 });
  const local = await readLocalConsent(page);
  expect(local.enabled).toBe('false');
  expect(local.owner).toBe(acct.userId);
  expect(local.parked).toBeNull();
  expect(local.pending, 'delivered, so nothing left queued').toBeNull();
  expect(
    findStrings(posthog.events, [session.access_token, session.refresh_token]),
    'no OAuth credential in any decoded payload'
  ).toEqual([]);
});
