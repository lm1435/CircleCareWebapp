import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import { apiClient } from '@/lib/api';
import { setPendingAnalyticsConsent } from '@/lib/pendingAnalyticsConsent';
import {
  getAnalyticsConsentState,
  __resetAnalyticsConsentCache,
} from '@/lib/analyticsConsent';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { useAuthStore } from '@/store/authStore';

/**
 * THE OAUTH HALF OF THE CONSENT MOMENT.
 *
 * Most signups are Google/Apple, and those leave the page entirely: the
 * checkbox state cannot survive the provider round-trip. SignUpPage parks the
 * answer in sessionStorage (lib/pendingAnalyticsConsent) exactly the way it
 * already parks the Terms acceptance, and this page is where it becomes a
 * recorded decision — but ONLY on a completed sign-in, and ONLY when an answer
 * was actually parked (an OAuth LOGIN parks nothing and must record nothing).
 */

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const order: string[] = [];
const identifyUser = vi.fn(() => void order.push('identify'));
const initAnalytics = vi.fn(() => void order.push('init'));
vi.mock('@/lib/posthog', () => ({
  identifyUser: (...a: unknown[]) => identifyUser(...(a as [])),
  initAnalytics: (...a: unknown[]) => initAnalytics(...(a as [])),
  disableAnalytics: vi.fn(),
  resetAnalytics: vi.fn(),
  captureException: vi.fn(),
}));

const mockedPost = vi.mocked(apiClient.post);

/** The store's real `signIn`, restored before every test (one test wraps it). */
const REAL_SIGN_IN = useAuthStore.getState().signIn;

/** A provider sign-in that CREATED the account (backend `is_new_user: true`). */
const sessionEnvelope = {
  success: true,
  data: {
    session: { access_token: 'exchanged-access', expires_at: 1234567890 },
    user: { id: 'user-1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
    is_new_user: true,
  },
};

/** The same exchange for an account that already existed. */
const returningEnvelope = {
  ...sessionEnvelope,
  data: { ...sessionEnvelope.data, is_new_user: false },
};

/** A backend that predates the flag: the field is simply absent. */
const legacyEnvelope = {
  ...sessionEnvelope,
  data: {
    session: sessionEnvelope.data.session,
    user: sessionEnvelope.data.user,
  },
};

const PENDING_SYNC_KEY = 'analytics_consent_pending_sync';
const PARKED_KEY = 'cc_pending_analytics_consent';

/** Route the exchange to `envelope`; every other POST (consent endpoints) succeeds. */
function routeExchange(envelope: unknown): void {
  mockedPost.mockImplementation(((url: string) =>
    Promise.resolve(url === '/auth/oauth-session' ? envelope : { success: true })) as never);
}

const consentPosts = (): string[] =>
  mockedPost.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('analytics-consent'));

/** Let `signIn`'s fire-and-forget flush and reconcile settle before asserting absence. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={['/auth/callback']}>
      <AuthCallbackPage />
    </MemoryRouter>
  );
}

function withTokens(): void {
  window.history.replaceState(
    null,
    '',
    '/auth/callback#access_token=oauth-access&refresh_token=oauth-refresh&token_type=bearer'
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockedPost.mockReset();
  identifyUser.mockClear();
  initAnalytics.mockClear();
  order.length = 0;
  tokenAccessor.clear();
  localStorage.clear();
  sessionStorage.clear();
  __resetAnalyticsConsentCache();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isBootstrapping: false,
    signIn: REAL_SIGN_IN,
  });
  window.history.replaceState(null, '', '/auth/callback');
});

describe('a parked acceptance', () => {
  it('is recorded as GRANTED on a successful exchange', async () => {
    setPendingAnalyticsConsent(true);
    withTokens();
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('granted');
  });

  /**
   * ORDER IS LOAD-BEARING. `authStore.signIn` calls `identifyUser`, and
   * `identifyUser` refuses unless the mode is 'full'. Record the consent after
   * the sign-in and the brand-new consenting user is never identified for the
   * rest of the session — the exact silent failure this whole change exists to
   * remove.
   *
   * Watching `identifyUser` alone cannot see a reorder: `signIn` identifies
   * only after an ASYNC server reconcile, so by then a record moved below it
   * has long since run. What CAN see it is the moment `signIn` is invoked:
   * `signIn` runs `flushAnalyticsConsentSync`, which reads the server-half
   * marker SYNCHRONOUSLY — a marker written after that read is never
   * delivered. So the local answer, its owner stamp and the queued server
   * marker must all already exist when `signIn` is called.
   */
  it('is recorded BEFORE the sign-in that identifies the user', async () => {
    setPendingAnalyticsConsent(true);
    withTokens();
    const atSignIn: { consent: string | null; owner: string | null; marker: string | null }[] = [];
    useAuthStore.setState({
      signIn: (session, user) => {
        atSignIn.push({
          consent: localStorage.getItem('cc_analytics_enabled'),
          owner: localStorage.getItem('cc_analytics_consent_user'),
          marker: localStorage.getItem('analytics_consent_pending_sync'),
        });
        REAL_SIGN_IN(session, user);
      },
    });
    // EVERY identify, not just the last one: the recorder calls `identifyUser`
    // itself when it is handed a user, so asserting on a single mutable
    // variable would be satisfied by that later call even if the FIRST
    // identify — the one `signIn` makes — ran while consent was still unset.
    const statesAtIdentify: (string | null)[] = [];
    identifyUser.mockImplementation(() => {
      statesAtIdentify.push(localStorage.getItem('cc_analytics_enabled'));
      order.push('identify');
    });
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(identifyUser).toHaveBeenCalled());
    expect(statesAtIdentify.length).toBeGreaterThan(0);
    expect(statesAtIdentify.every((state) => state === 'true')).toBe(true);

    await waitFor(() => expect(atSignIn).toHaveLength(1));
    expect(atSignIn[0].consent).toBe('true');
    expect(atSignIn[0].owner).toBe('user-1');
    expect(atSignIn[0].marker).not.toBeNull();
    expect(atSignIn[0].marker).toContain('user-1');
  });

  /**
   * IDENTIFY BY ID ONLY ON THE OAUTH PATH, TOO.
   *
   * The exchange response carries the user's EMAIL (and name). If identify
   * ever regains a traits/email parameter and this page — or the recorder or
   * `signIn` it calls — passes it along, every call here must fail: each
   * identify gets exactly `['user-1']`, nothing else. Both identify sites are
   * waited for: the recorder's synchronous one AND `signIn`'s deferred one
   * (behind the `/users/me` reconcile).
   */
  it('identifies with exactly the user id — no email, no traits — on every identify call', async () => {
    setPendingAnalyticsConsent(true);
    withTokens();
    const identifySites: string[] = [];
    useAuthStore.setState({
      signIn: (session, user) => {
        identifySites.push('signIn');
        REAL_SIGN_IN(session, user);
      },
    });
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    await waitFor(() => expect(identifyUser).toHaveBeenCalled());
    // Let signIn's fire-and-forget reconcile settle so its identify (if any)
    // is recorded before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(identifySites).toEqual(['signIn']);

    const calls = identifyUser.mock.calls as unknown[][];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toEqual(['user-1']);
    }
    expect(JSON.stringify(calls)).not.toContain(sessionEnvelope.data.user.email);
  });
});

describe('a parked decline', () => {
  it('is recorded as DECLINED — an answer, not an absence', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('declined');
  });
});

/**
 * THE SIGN-UP PAGE'S PROVIDER BUTTONS ALSO SIGN IN EXISTING ACCOUNTS.
 *
 * Its analytics box defaults to unticked, so a returning user who taps "Sign
 * up with Google" arrives here with a parked DECLINE they never chose. Recorded
 * and queued, `signIn` flushes it as a POST to withdraw-analytics-consent —
 * which stamps `withdrawn_at` and deletes the PostHog person WITH their events.
 * Only an account this sign-in created (`is_new_user === true`) may have the
 * parked answer recorded; everything else records nothing, sends nothing, and
 * still clears the parked value.
 */
describe('the new-vs-returning gate', () => {
  it('(a) a RETURNING user with a parked decline: nothing recorded, nothing queued, no withdrawal, parked value cleared', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    routeExchange(returningEnvelope);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    await settle();
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(localStorage.getItem('cc_analytics_enabled')).toBeNull();
    expect(localStorage.getItem(PENDING_SYNC_KEY)).toBeNull();
    expect(consentPosts()).not.toContain('/users/me/withdraw-analytics-consent');
    expect(consentPosts()).toEqual([]);
    expect(sessionStorage.getItem(PARKED_KEY)).toBeNull();
  });

  it('(a) a returning user whose browser already says GRANTED keeps it — the parked decline cannot reverse it', async () => {
    localStorage.setItem('cc_analytics_enabled', 'true');
    __resetAnalyticsConsentCache();
    setPendingAnalyticsConsent(false);
    withTokens();
    routeExchange(returningEnvelope);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    await settle();
    expect(getAnalyticsConsentState()).toBe('granted');
    expect(consentPosts()).not.toContain('/users/me/withdraw-analytics-consent');
  });

  it('(a) a returning user with a parked ACCEPT: nothing recorded or sent either', async () => {
    setPendingAnalyticsConsent(true);
    withTokens();
    routeExchange(returningEnvelope);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    await settle();
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(localStorage.getItem(PENDING_SYNC_KEY)).toBeNull();
    expect(consentPosts()).toEqual([]);
    expect(sessionStorage.getItem(PARKED_KEY)).toBeNull();
  });

  it('(b) a NEW user with a parked decline: recorded, queued, and delivered as a withdrawal', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    routeExchange(sessionEnvelope);
    let markerAtSignIn: string | null = null;
    useAuthStore.setState({
      signIn: (session, user) => {
        markerAtSignIn = localStorage.getItem(PENDING_SYNC_KEY);
        REAL_SIGN_IN(session, user);
      },
    });

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('declined');
    expect(markerAtSignIn).not.toBeNull();
    expect(JSON.parse(markerAtSignIn as unknown as string)).toEqual({
      'user-1': { enabled: false, token: expect.any(String) },
    });
    await waitFor(() =>
      expect(consentPosts()).toContain('/users/me/withdraw-analytics-consent')
    );
    expect(sessionStorage.getItem(PARKED_KEY)).toBeNull();
  });

  it('(c) a NEW user with a parked accept: recorded as granted and delivered as a restore', async () => {
    setPendingAnalyticsConsent(true);
    withTokens();
    routeExchange(sessionEnvelope);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('granted');
    await waitFor(() => expect(consentPosts()).toContain('/users/me/restore-analytics-consent'));
    expect(consentPosts()).not.toContain('/users/me/withdraw-analytics-consent');
  });

  it('(d) the field MISSING (older backend) is treated as returning: nothing recorded or sent, parked value cleared', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    routeExchange(legacyEnvelope);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    await settle();
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(localStorage.getItem(PENDING_SYNC_KEY)).toBeNull();
    expect(consentPosts()).toEqual([]);
    expect(sessionStorage.getItem(PARKED_KEY)).toBeNull();
  });

  it('(d) a non-boolean truthy flag is not `true` either', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    routeExchange({ ...sessionEnvelope, data: { ...sessionEnvelope.data, is_new_user: 'true' } });

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    await settle();
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(consentPosts()).toEqual([]);
  });

  /**
   * The parked value must not survive a returning-user sign-in to be picked up
   * by a LATER one — e.g. this browser signing in as a genuinely new account.
   */
  it('a returning-user sign-in leaves nothing parked for the next callback', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    routeExchange(returningEnvelope);

    const first = renderCallback();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    first.unmount();

    mockNavigate.mockReset();
    withTokens();
    routeExchange(sessionEnvelope);
    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    await settle();
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(consentPosts()).toEqual([]);
  });
});

describe('an OAuth LOGIN (nothing parked)', () => {
  it('records nothing — the visitor stays unasked', async () => {
    withTokens();
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('unasked');
  });

  it('does not overwrite a decision this browser already holds', async () => {
    localStorage.setItem('cc_analytics_enabled', 'true');
    __resetAnalyticsConsentCache();
    withTokens();
    mockedPost.mockResolvedValueOnce(sessionEnvelope as never);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('granted');
  });
});

describe('a handshake that does not complete', () => {
  it('records nothing when the provider returned no tokens', async () => {
    setPendingAnalyticsConsent(true);
    window.history.replaceState(null, '', '/auth/callback#error=server_error');

    renderCallback();

    await waitFor(() => expect(getAnalyticsConsentState()).toBe('unasked'));
  });

  it('records nothing when the token exchange fails', async () => {
    setPendingAnalyticsConsent(true);
    withTokens();
    mockedPost.mockRejectedValueOnce(new Error('boom'));

    renderCallback();

    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('unasked');
  });

  /**
   * READ-AND-CLEAR on every exit path, the same contract
   * `consumePendingAuthMethod` has: a stale answer must never be attributed to
   * a later, unrelated sign-in — this browser can be signed in as a different
   * account minutes later.
   */
  it('discards the parked answer so it cannot leak into a later sign-in', async () => {
    setPendingAnalyticsConsent(true);
    window.history.replaceState(null, '', '/auth/callback#error=server_error');

    renderCallback();

    await waitFor(() =>
      expect(sessionStorage.getItem('cc_pending_analytics_consent')).toBeNull()
    );
  });
});
