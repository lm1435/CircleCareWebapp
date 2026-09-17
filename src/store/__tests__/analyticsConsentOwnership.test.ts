import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONSENT IS ACCOUNT-SCOPED ON THE SERVER AND WAS BROWSER-SCOPED ON THE CLIENT.
 *
 * `analytics_consent_withdrawn_at` is a COLUMN ON A USER. `cc_analytics_enabled`
 * is one key in one browser with nobody's name on it — and `authStore.signIn`
 * called `identifyUser` unconditionally (then with the email too; by id only
 * since 2026-09-10), reading that nameless key through `currentAnalyticsMode()`.
 *
 * `lib/analyticsConsentSync.ts` already knew this was the threat model and put
 * a userId on the SERVER half's marker for exactly this reason ("a marker
 * written by account A must never be delivered under account B's session").
 * The client half had no equivalent.
 *
 * THE FAILURE, on a shared browser and with no exotic timing:
 *
 *   A signs up and DECLINES  -> local 'declined', A withdrawn server-side,
 *                               A's PostHog person deleted.
 *   A signs out.
 *   B signs up and ACCEPTS   -> local flips to 'granted'.
 *   B signs out.
 *   A LOGS BACK IN           -> login never re-asks, the mode reads 'full'
 *                               off B's answer, and A is identified to PostHog
 *                               by account id on the strength of B's consent —
 *                               while A's own server record still says
 *                               withdrawn.
 *
 * THE FIX, and why this shape: the recorded answer carries the id of the
 * account it belongs to, and the arriving account reconciles against it before
 * anything can be identified.
 *
 *   - It FAILS CLOSED. An answer that cannot be proven to belong to the
 *     signed-in account is forgotten, which resolves to 'unasked' ->
 *     anonymous -> no identify. A mismatch can never resolve to a grant.
 *   - It leaves the PRE-AUTH WINDOW untouched. `signup_started` fires before a
 *     session exists; the tri-state key and its mode resolution are unchanged,
 *     so nothing that runs before there is a user id had to learn about users.
 *   - An OWNERLESS answer is ADOPTED rather than discarded. Email/password
 *     signup records its answer before any session exists (the backend returns
 *     an OTP, not a token), and legacy answers from the old Profile-only
 *     toggle have no owner either. The first account to sign in after such an
 *     answer is the account that gave it.
 *   - Nothing authoritative is lost by forgetting: the durable per-account
 *     record is the server column, which this never touches.
 */

vi.mock('@/lib/posthog', () => ({
  identifyUser: vi.fn(),
  resetAnalytics: vi.fn(),
  initAnalytics: vi.fn(),
  disableAnalytics: vi.fn(),
}));

vi.mock('@/lib/analyticsConsentSync', () => ({
  flushAnalyticsConsentSync: vi.fn(() => Promise.resolve()),
}));

const mockI18n = { language: 'en' };
vi.mock('@/i18n', () => ({ default: mockI18n }));

class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
}

const USER_A = { id: 'user-A', email: 'a@example.com', first_name: 'A', last_name: 'One' };
const USER_B = { id: 'user-B', email: 'b@example.com', first_name: 'B', last_name: 'Two' };

async function loadModules() {
  const consent = await import('@/lib/analyticsConsent');
  const posthogLib = await import('@/lib/posthog');
  const { useAuthStore } = await import('@/store/authStore');
  return { consent, posthogLib, useAuthStore };
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
});

describe('a recorded answer belongs to one account', () => {
  it("does NOT identify A on the strength of B's consent, and forgets B's answer", async () => {
    const { consent, posthogLib, useAuthStore } = await loadModules();

    // A declines and the answer is stamped as A's.
    consent.setAnalyticsConsent(false);
    consent.setAnalyticsConsentOwner(USER_A.id);
    // B accepts on the same browser; the answer is now B's.
    consent.setAnalyticsConsent(true);
    consent.setAnalyticsConsentOwner(USER_B.id);
    expect(consent.getAnalyticsConsentState()).toBe('granted');

    // Capture the mode AT THE MOMENT the store identifies — that is the value
    // the real `identifyUser` consults (`identifyAllowed(currentAnalyticsMode())`),
    // so this is the actual go/no-go on transmitting A's email.
    const { currentAnalyticsMode, identifyAllowed } = await import('@/lib/analyticsMode');
    const modesAtIdentify: string[] = [];
    vi.mocked(posthogLib.identifyUser).mockImplementation(() => {
      modesAtIdentify.push(currentAnalyticsMode());
    });

    // A comes back. Login never re-asks the question.
    useAuthStore.getState().signIn({ access_token: 'tok' }, USER_A);
    // The identify is now deferred behind the server-consent reconcile (see
    // lib/analyticsConsentServerReconcile.ts). The OWNER reconcile asserted
    // below is still synchronous, so what this test pins is unchanged: it is
    // the mode AT THE MOMENT OF IDENTIFY that decides whether A is transmitted.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(posthogLib.identifyUser).toHaveBeenCalledWith('user-A');
    expect(modesAtIdentify).toEqual(['anonymous']);
    expect(identifyAllowed('anonymous')).toBe(false);
    // …because B's answer is no longer standing in for A's.
    expect(consent.getAnalyticsConsentState()).toBe('unasked');
    expect(consent.getAnalyticsConsentOwner()).toBeNull();
  });

  it('keeps the answer when the signing-in account is the one that gave it', async () => {
    const { consent, useAuthStore } = await loadModules();

    consent.setAnalyticsConsent(true);
    consent.setAnalyticsConsentOwner(USER_A.id);

    useAuthStore.getState().signIn({ access_token: 'tok' }, USER_A);

    expect(consent.getAnalyticsConsentState()).toBe('granted');
    expect(consent.getAnalyticsConsentOwner()).toBe('user-A');
  });

  it("forgets a DECLINE that belonged to someone else too, not just a grant", async () => {
    const { consent, useAuthStore } = await loadModules();

    consent.setAnalyticsConsent(false);
    consent.setAnalyticsConsentOwner(USER_B.id);

    useAuthStore.getState().signIn({ access_token: 'tok' }, USER_A);

    // A was never asked. Recording B's "no" against A would be as wrong as
    // recording B's "yes" — it is the same false attribution, and it is what
    // makes `hasAnsweredAnalyticsConsent` lie about who still owes an answer.
    expect(consent.getAnalyticsConsentState()).toBe('unasked');
  });

  it('adopts an OWNERLESS answer — the email-signup and legacy-toggle case', async () => {
    const { consent, useAuthStore } = await loadModules();

    // Email/password signup records before any session exists.
    consent.setAnalyticsConsent(true);
    expect(consent.getAnalyticsConsentOwner()).toBeNull();

    useAuthStore.getState().signIn({ access_token: 'tok' }, USER_A);

    expect(consent.getAnalyticsConsentState()).toBe('granted');
    expect(consent.getAnalyticsConsentOwner()).toBe('user-A');
  });

  it('leaves an UNASKED browser alone (and writes nothing)', async () => {
    const { consent, useAuthStore } = await loadModules();

    useAuthStore.getState().signIn({ access_token: 'tok' }, USER_A);

    expect(consent.getAnalyticsConsentState()).toBe('unasked');
    // The web threat model forbids the auth path from writing to JS-readable
    // storage; there is no answer here to own, so there is nothing to stamp.
    expect(localStorage.length).toBe(0);
  });

  /**
   * A RESTORED COOKIE SESSION IS A SIGN-IN. `bootstrap` identifies too, so it
   * has to reconcile too — otherwise the whole fix is bypassed by the single
   * commonest way this app authenticates: reloading the page.
   */
  it('reconciles on the bootstrap path as well as signIn', async () => {
    const { consent, useAuthStore } = await loadModules();
    const { apiClient } = await import('@/lib/api');
    const users = await import('@/api/users');
    document.cookie = 'cc_session=1; path=/';
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { session: { access_token: 'tok', expires_at: 1 } },
    } as never);
    vi.spyOn(users, 'getCurrentUser').mockResolvedValue(USER_A as never);

    consent.setAnalyticsConsent(true);
    consent.setAnalyticsConsentOwner(USER_B.id);

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(consent.getAnalyticsConsentState()).toBe('unasked');
    document.cookie = 'cc_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
});

describe('setAnalyticsConsent leaves no stale owner behind', () => {
  /**
   * A fresh answer with no known owner must not inherit the PREVIOUS answer's
   * owner — that is how B's decision at a signup form would end up stamped as
   * A's, which is the same false attribution in the other direction.
   */
  it('clears the owner, so a new answer starts ownerless', async () => {
    const { consent } = await loadModules();

    consent.setAnalyticsConsent(true);
    consent.setAnalyticsConsentOwner(USER_A.id);
    consent.setAnalyticsConsent(false);

    expect(consent.getAnalyticsConsentOwner()).toBeNull();
  });
});

describe('the surfaces that know who answered stamp it', () => {
  /**
   * `recordAnalyticsConsentDecision` is the ONE place a consent answer becomes
   * client state, so it is the one place the owner can be stamped without the
   * three surfaces drifting. Both answers are stamped: an unowned DECLINE is
   * adopted by the next account to sign in just as readily as an unowned grant.
   */
  it('recordAnalyticsConsentDecision stamps the user it was given', async () => {
    const { consent } = await loadModules();
    const { recordAnalyticsConsentDecision } = await import('@/lib/analyticsConsentDecision');

    recordAnalyticsConsentDecision(true, { id: USER_A.id });
    expect(consent.getAnalyticsConsentOwner()).toBe('user-A');

    recordAnalyticsConsentDecision(false, { id: USER_B.id });
    expect(consent.getAnalyticsConsentOwner()).toBe('user-B');
  });

  it('records ownerless when no user is known (email signup, pre-session)', async () => {
    const { consent } = await loadModules();
    const { recordAnalyticsConsentDecision } = await import('@/lib/analyticsConsentDecision');

    recordAnalyticsConsentDecision(true);

    expect(consent.getAnalyticsConsentState()).toBe('granted');
    expect(consent.getAnalyticsConsentOwner()).toBeNull();
  });
});
