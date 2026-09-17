import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import SignUpPage from '@/pages/SignUpPage';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import { apiClient } from '@/lib/api';
import { setPendingAnalyticsConsent } from '@/lib/pendingAnalyticsConsent';
import {
  getAnalyticsConsentState,
  getAnalyticsConsentOwner,
  __resetAnalyticsConsentCache,
} from '@/lib/analyticsConsent';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { useAuthStore } from '@/store/authStore';

/**
 * THE SERVER HALF OF THE SIGNUP CONSENT MOMENT.
 *
 * The signup checkbox used to record the CLIENT half only:
 * `recordAnalyticsConsentDecision` writes localStorage and configures the
 * PostHog client, and both signup surfaces stopped there. Nothing ever called
 * the server half, so `users.analytics_consent_withdrawn_at` stayed NULL — and
 * NULL means CAPTURE ALLOWED on the backend (`capturePostHogEvent` gates on
 * `hasWithdrawnAnalyticsConsent`). A web user who DECLINED at signup was
 * therefore correctly silent on the client and still had a PostHog person
 * created for them the first time a server-side event fired against their user
 * id (the earliest is a RevenueCat webhook), for the life of the account.
 *
 * These tests pin the whole chain — checkbox → queued decision → the delivery
 * `authStore.signIn` makes — for BOTH signup surfaces, at the level of the
 * actual HTTP call, because everything between the checkbox and the request is
 * designed to fail silently.
 *
 * WHY THE DECISION IS QUEUED RATHER THAN POSTED FROM THE SIGNUP SURFACE.
 * Neither surface has a session of its own at the moment it records: email
 * signup gets an OTP back, not a session, and the OAuth callback records
 * BEFORE `signIn` (it must — `identifyUser` is refused until consent is
 * stored). A POST fired there carries whatever token this browser happens to
 * hold, and /signup and /auth/callback are PUBLIC routes reachable while
 * another account is signed in — that request would stamp the wrong account.
 * So the decision is written to the retry marker under the NEW user's id and
 * `flushAnalyticsConsentSync`, which runs inside `signIn` a moment later with
 * that user's own token, is what delivers it. See lib/analyticsConsentSync.ts.
 */

const PENDING_KEY = 'analytics_consent_pending_sync';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Real consent modules (the point of this file is what they actually do);
// posthog and the event taxonomy are stubbed so nothing leaves the process.
vi.mock('@/lib/posthog', () => ({
  identifyUser: vi.fn(),
  initAnalytics: vi.fn(),
  disableAnalytics: vi.fn(),
  resetAnalytics: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    signupStarted: vi.fn(),
    signupCompleted: vi.fn(),
    signupFailed: vi.fn(),
    loginCompleted: vi.fn(),
    loginFailed: vi.fn(),
    logout: vi.fn(),
    errorOccurred: vi.fn(),
  },
}));

const mockedPost = vi.mocked(apiClient.post);

const NEW_USER = {
  id: 'new-user-1',
  email: 'pat@example.com',
  first_name: 'Pat',
  last_name: 'Rivera',
};

const signUpEnvelope = {
  success: true,
  data: { user: NEW_USER, message: 'Please check your email for a verification code.' },
};

/** An exchange for an account the provider sign-in just CREATED. */
const sessionEnvelope = {
  success: true,
  data: {
    session: { access_token: 'exchanged-access', expires_at: 4102444800 },
    user: NEW_USER,
    is_new_user: true,
  },
};

/** The same exchange for an account that already existed. */
const returningSessionEnvelope = {
  ...sessionEnvelope,
  data: { ...sessionEnvelope.data, is_new_user: false },
};

/** Route every POST: the signup/exchange call plus the consent endpoints. */
function routePosts(signupResult: unknown = signUpEnvelope): void {
  mockedPost.mockImplementation(((url: string) => {
    if (url === '/auth/signup' || url === '/auth/oauth-session') {
      return Promise.resolve(signupResult);
    }
    return Promise.resolve({ success: true });
  }) as never);
}

const consentCalls = (): string[] =>
  mockedPost.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes('analytics-consent'));

/**
 * The retry store is keyed BY ACCOUNT (one undelivered decision per user), so
 * that a signup on a shared browser cannot discard the previous account's
 * still-undelivered withdrawal. This reads the entry for one account.
 */
const readMarkerFor = (userId: string): { enabled: boolean; token: string } | null => {
  const raw = localStorage.getItem(PENDING_KEY);
  if (raw === null) return null;
  const map = JSON.parse(raw) as Record<string, { enabled: boolean; token: string }>;
  return map[userId] ?? null;
};

/** Nothing pending for anyone — the store is removed, not left as `{}`. */
const readMarker = (): { enabled: boolean; token: string } | null => readMarkerFor(NEW_USER.id);

/** The delivery `signIn` performs — the only authenticated moment in the flow. */
function signInAs(userId: string): void {
  useAuthStore.getState().signIn(
    { access_token: `token-for-${userId}`, expires_at: 4102444800 } as never,
    { id: userId, email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' }
  );
}

const VALID = { firstName: 'Pat', lastName: 'Rivera', password: 'Secret#123' };

const termsCheckbox = () => screen.getByRole('checkbox', { name: /^I am 18 or older/ });
const analyticsCheckbox = () => screen.getByRole('checkbox', { name: /^Share usage data/ });
const submitButton = () => screen.getByRole('button', { name: 'Create account' });

async function fillValidForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/^First Name/), VALID.firstName);
  await user.type(screen.getByLabelText(/^Last Name/), VALID.lastName);
  await user.type(screen.getByLabelText(/^Email/), NEW_USER.email);
  await user.type(screen.getByLabelText(/^Password/), VALID.password);
  await user.type(screen.getByLabelText(/^Confirm Password/), VALID.password);
  await user.click(termsCheckbox());
}

function renderSignUp() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <SignUpPage />
    </MemoryRouter>
  );
}

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

// Captured before any test can swap it out (the ordering test below replaces
// `signIn` with a spy that delegates here).
const REAL_SIGN_IN = useAuthStore.getState().signIn;

beforeEach(() => {
  mockNavigate.mockReset();
  mockedPost.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  tokenAccessor.clear();
  __resetAnalyticsConsentCache();
  useAuthStore.setState({
    signIn: REAL_SIGN_IN,
    user: null,
    isAuthenticated: false,
    isBootstrapping: false,
  });
  window.history.replaceState(null, '', '/');
});

describe('email/password signup — the server half', () => {
  it('queues a DECLINE against the account that was just created', async () => {
    const user = userEvent.setup();
    routePosts();
    renderSignUp();

    await fillValidForm(user);
    // Declining is LEAVING THE BOX ALONE — the commonest path, and the one
    // that fires no change handler at all.
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(readMarkerFor(NEW_USER.id)).toEqual({ enabled: false, token: expect.any(String) });
  });

  /**
   * …AND STAMPS THE CLIENT HALF WITH THE SAME ACCOUNT.
   *
   * The client answer is recorded before any session exists, so it lands
   * OWNERLESS — and an ownerless answer is adopted by whichever account signs
   * in next on this browser, which need not be the one that just signed up.
   * The account row exists by this point even though its session does not, so
   * the id is available and the window closes here rather than at /verify-email.
   */
  it('stamps the client-side answer as belonging to the new account', async () => {
    const user = userEvent.setup();
    routePosts();
    renderSignUp();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentOwner()).toBe(NEW_USER.id);
  });

  it('and it reaches the server as a withdrawal the moment that user signs in', async () => {
    const user = userEvent.setup();
    routePosts();
    renderSignUp();

    await fillValidForm(user);
    await user.click(submitButton());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

    // /verify-email exchanges the OTP and calls exactly this.
    signInAs(NEW_USER.id);

    await waitFor(() =>
      expect(consentCalls()).toContain('/users/me/withdraw-analytics-consent')
    );
    expect(consentCalls()).not.toContain('/users/me/restore-analytics-consent');
    // Delivered → the retry marker is retired.
    await waitFor(() => expect(readMarker()).toBeNull());
  });

  it('an acceptance reaches the server as a restore, never a withdrawal', async () => {
    const user = userEvent.setup();
    routePosts();
    renderSignUp();

    await fillValidForm(user);
    await user.click(analyticsCheckbox());
    await user.click(submitButton());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

    signInAs(NEW_USER.id);

    await waitFor(() => expect(consentCalls()).toContain('/users/me/restore-analytics-consent'));
    expect(consentCalls()).not.toContain('/users/me/withdraw-analytics-consent');
  });

  /**
   * The two halves are written by different modules and fail in different
   * directions; a decline that is silent on the client but permitted on the
   * server is exactly the bug this file exists to close.
   */
  it('the client half and the queued server half say the same thing', async () => {
    const user = userEvent.setup();
    routePosts();
    renderSignUp();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('declined');
    expect(readMarker()?.enabled).toBe(false);
  });

  /**
   * NOTHING IS DELIVERED FROM THE SIGNUP SURFACE ITSELF. /signup is a public
   * route: a signed-in visitor creating a second account still has a live
   * token here, and a consent POST fired now would be authenticated AS THEM.
   */
  it('sends no consent request while the signup surface holds someone else’s token', async () => {
    const user = userEvent.setup();
    tokenAccessor.setToken('another-accounts-token', 4102444800);
    routePosts();
    renderSignUp();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(consentCalls()).toEqual([]);
  });

  /**
   * A failed signup created no account, so it must leave nothing behind for
   * the next person at this browser to inherit.
   */
  it('a failed signup queues nothing, and a later sign-in delivers nothing', async () => {
    const user = userEvent.setup();
    mockedPost.mockRejectedValue(new Error('boom'));
    renderSignUp();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(readMarker()).toBeNull();

    mockedPost.mockReset();
    routePosts();
    signInAs('somebody-else');

    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(consentCalls()).toEqual([]);
  });

  /**
   * Blocked signup domains get a fake 200 with NO `data` envelope (see
   * backend/src/routes/auth.ts). No account exists, so nothing is queued — and
   * reading the id must not throw on the way past.
   */
  it('queues nothing when the signup response carries no user', async () => {
    const user = userEvent.setup();
    routePosts({ success: true, message: 'Please check your email to verify your account' });
    renderSignUp();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(readMarker()).toBeNull();
  });

  /**
   * …AND RECORDS NOTHING ON THE CLIENT EITHER. The client half used to be
   * written BEFORE the id check, so the fake 200 stored an OWNERLESS answer —
   * adopted by whichever account signs in next on this browser.
   */
  it('records nothing client-side when the signup response carries no user', async () => {
    const user = userEvent.setup();
    routePosts({ success: true, message: 'Please check your email to verify your account' });
    renderSignUp();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(localStorage.getItem('cc_analytics_enabled')).toBeNull();
    expect(getAnalyticsConsentOwner()).toBeNull();

    // And the next account to sign in here inherits nothing.
    signInAs('somebody-else');
    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(consentCalls()).toEqual([]);
    expect(getAnalyticsConsentState()).toBe('unasked');
  });
});

describe('OAuth signup — the server half', () => {
  it('a RETURNING user with a parked DECLINE sends no withdrawal and queues nothing', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    routePosts(returningSessionEnvelope);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readMarker()).toBeNull();
    expect(consentCalls()).not.toContain('/users/me/withdraw-analytics-consent');
    expect(consentCalls()).toEqual([]);
  });

  it('a parked DECLINE reaches the server as a withdrawal', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    routePosts(sessionEnvelope);

    renderCallback();

    await waitFor(() =>
      expect(consentCalls()).toContain('/users/me/withdraw-analytics-consent')
    );
    expect(consentCalls()).not.toContain('/users/me/restore-analytics-consent');
  });

  it('a parked ACCEPTANCE reaches the server as a restore', async () => {
    setPendingAnalyticsConsent(true);
    withTokens();
    routePosts(sessionEnvelope);

    renderCallback();

    await waitFor(() => expect(consentCalls()).toContain('/users/me/restore-analytics-consent'));
    expect(consentCalls()).not.toContain('/users/me/withdraw-analytics-consent');
  });

  /**
   * ORDER IS LOAD-BEARING, and mobile found this the hard way: `signIn` is what
   * READS the marker (via `flushAnalyticsConsentSync`), so a decision written
   * after it — or written asynchronously and not awaited — races its own flush
   * and is silently dropped for exactly the signups that go through a provider.
   * Pinned here so a future fire-and-forget refactor fails instead of shipping.
   */
  it('writes the decision BEFORE signIn reads the marker', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    routePosts(sessionEnvelope);

    let markerAtSignIn: string | null = null;
    useAuthStore.setState({
      signIn: (session, user) => {
        markerAtSignIn = localStorage.getItem(PENDING_KEY);
        REAL_SIGN_IN(session, user);
      },
    });

    renderCallback();

    await waitFor(() => expect(markerAtSignIn).not.toBeNull());
    expect(JSON.parse(markerAtSignIn as unknown as string)).toEqual({
      [NEW_USER.id]: { enabled: false, token: expect.any(String) },
    });
  });

  it('an OAuth LOGIN (nothing parked) queues nothing and delivers nothing', async () => {
    withTokens();
    routePosts(sessionEnvelope);

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(readMarker()).toBeNull();
    expect(consentCalls()).toEqual([]);
  });

  it('a failed token exchange queues nothing and delivers nothing', async () => {
    setPendingAnalyticsConsent(false);
    withTokens();
    mockedPost.mockRejectedValue(new Error('boom'));

    renderCallback();

    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(readMarker()).toBeNull();
    expect(consentCalls()).toEqual([]);
  });
});
