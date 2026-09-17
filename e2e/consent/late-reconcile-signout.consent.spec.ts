import { consentTest as test, expect, presetAnalyticsConsent } from '../consent';
import { apiSession, countRequests, holdRequest } from '../unhappy';
import {
  RESTORE_PATH,
  USERS_ME_PATH,
  WITHDRAW_PATH,
  nowSec,
  readLocalConsent,
  readServerConsent,
  setServerConsent,
  signInViaForm,
  signOutViaMenu,
  waitForEventSince,
} from './_helpers';

// ===========================================================================
// A RECONCILE THAT OUTLIVES ITS SESSION must do nothing (session epoch,
// src/store/authStore.ts; checks in src/lib/analyticsConsentServerReconcile.ts).
//
// Sign in through the form (authStore.signIn → reconcile reads GET /users/me),
// HOLD that read, sign out, then answer it with the account's real profile
// (fetched moments earlier through the API — the answer that read would have
// had). A held request released after logout would otherwise reach a revoked
// session and 401, which would make "nothing happened" vacuous.
//
//   unasked local + server granted: guarded by the check before recording
//     (a late run records GRANTED and identifies).
//   granted local + server granted: the reconcile agrees and returns; guarded
//     by the check before `identifyUser` (a late run identifies).
//
// Falsified in the mutant copy by removing each check in turn.
// ===========================================================================

test.describe.configure({ timeout: 120_000 });

const restores: Array<() => void> = [];
test.afterEach(() => {
  while (restores.length > 0) restores.pop()!();
});

for (const local of ['unasked', 'granted'] as const) {
  test(`late /users/me after sign-out (${local} local, granted server): no $identify, nothing recorded`, async ({
    page,
    posthog,
    account,
    request,
  }) => {
    restores.push(setServerConsent(account.userId, 'granted'));
    const pinned = readServerConsent(account.userId);
    const api = await apiSession(request, account);
    const meRes = await api.get(USERS_ME_PATH);
    expect(meRes.status()).toBe(200);
    const meBody = (await meRes.json()) as { data: { user: { id: string; analytics_consent_granted_at: string | null } } };
    expect(meBody.data.user.id).toBe(account.userId);
    expect(meBody.data.user.analytics_consent_granted_at, 'the late answer says GRANTED').not.toBeNull();

    await page.context().clearCookies(); // start signed out
    await presetAnalyticsConsent(page, local, local === 'granted' ? account.userId : undefined);
    const withdraws = countRequests(page, 'POST', WITHDRAW_PATH);
    const restoresSent = countRequests(page, 'POST', RESTORE_PATH);

    await page.goto('/login');
    await posthog.waitForEvent('$pageview', { timeoutMs: 20_000 }); // the SDK is live before sign-in

    const hold = await holdRequest(page, 'GET', USERS_ME_PATH);
    await signInViaForm(page, account);
    await hold.waitForHeld(1, { timeoutMs: 20_000 });
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });

    await signOutViaMenu(page);
    await posthog.waitForEvent('logout', { timeoutMs: 20_000 }); // positive control

    const releasedAt = nowSec();
    await hold.releaseWith({ status: 200, body: meBody });
    // Positive control AFTER the late answer: capture still flows.
    await page.getByRole('link', { name: 'Create one' }).click();
    await waitForEventSince(posthog, '$pageview', releasedAt, { timeoutMs: 20_000 });

    await posthog.expectNoEvent('$identify', { settleMs: 6_000 });
    expect(posthog.identifies()).toHaveLength(0);

    const state = await readLocalConsent(page);
    if (local === 'unasked') {
      expect(state.enabled, 'no decision recorded for the departed account').toBeNull();
      expect(state.owner).toBeNull();
    } else {
      expect(state.enabled).toBe('true');
      expect(state.owner).toBe(account.userId);
    }
    expect(state.pending).toBeNull();
    await withdraws.expectCount(0);
    await restoresSent.expectCount(0);
    expect(readServerConsent(account.userId)).toEqual(pinned);
  });
}
