import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import SignUpPage from '@/pages/SignUpPage';
import { apiClient } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import {
  getAnalyticsConsentState,
  hasAnsweredAnalyticsConsent,
  setAnalyticsConsent,
  __resetAnalyticsConsentCache,
} from '@/lib/analyticsConsent';
import { consumePendingAnalyticsConsent } from '@/lib/pendingAnalyticsConsent';
import { consumePendingTermsConsent } from '@/lib/pendingTermsConsent';
import { expectAccountLinkDisclosed, splitOffSentence } from '@/lib/__tests__/consentCopyClaims';

/**
 * THE CONSENT MOMENT.
 *
 * Until this existed, `setAnalyticsConsent` had exactly one non-test caller —
 * a toggle buried in Profile > Privacy — and the stored default was false. So
 * every web user was in the "declined" cohort without ever being asked, which
 * is both a measurement problem (the cohort is ~100% of users, and once the
 * anonymous mode ships every event loses `circle_id`) and a compliance one
 * ("never asked" was indistinguishable from "declined").
 *
 * DESIGN RULES PINNED HERE:
 *   - The box is UNTICKED by default. A pre-ticked box is not consent, and it
 *     is never pre-seeded from a previous account's choice either: signup
 *     means a NEW person may be at this browser.
 *   - It NEVER gates signup. Analytics is not a condition of having an account
 *     (unlike the Terms box next to it, which is).
 *   - Declining is at least as easy as accepting: accepting costs a click,
 *     declining costs none — and BOTH are recorded.
 */

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Real consent modules (we assert on their storage); posthog is stubbed so we
// can prove identify() is never reached during a signup.
const identifyUser = vi.fn();
const initAnalytics = vi.fn();
const disableAnalytics = vi.fn();
vi.mock('@/lib/posthog', () => ({
  identifyUser: (...a: unknown[]) => identifyUser(...a),
  initAnalytics: (...a: unknown[]) => initAnalytics(...a),
  disableAnalytics: (...a: unknown[]) => disableAnalytics(...a),
  resetAnalytics: vi.fn(),
  captureException: vi.fn(),
}));

const order: string[] = [];
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    signupStarted: vi.fn(() => void order.push('signup_started')),
    signupCompleted: vi.fn(() => void order.push('signup_completed')),
    signupFailed: vi.fn(() => void order.push('signup_failed')),
  },
}));

const mockedPost = vi.mocked(apiClient.post);

const VALID = {
  firstName: 'Pat',
  lastName: 'Rivera',
  email: 'pat@example.com',
  password: 'Secret#123',
};

function renderSignUp() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <SignUpPage />
    </MemoryRouter>
  );
}

const termsCheckbox = () => screen.getByRole('checkbox', { name: /^I am 18 or older/ });
const analyticsCheckbox = () => screen.getByRole('checkbox', { name: /^Share usage data/ });
const submitButton = () => screen.getByRole('button', { name: 'Create account' });

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^First Name/), VALID.firstName);
  await user.type(screen.getByLabelText(/^Last Name/), VALID.lastName);
  await user.type(screen.getByLabelText(/^Email/), VALID.email);
  await user.type(screen.getByLabelText(/^Password/), VALID.password);
  await user.type(screen.getByLabelText(/^Confirm Password/), VALID.password);
  await user.click(termsCheckbox());
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockedPost.mockReset();
  identifyUser.mockReset();
  initAnalytics.mockReset();
  disableAnalytics.mockReset();
  order.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  __resetAnalyticsConsentCache();
});

describe('the control', () => {
  it('renders a real checkbox, unticked, separate from the Terms checkbox', () => {
    renderSignUp();

    expect(analyticsCheckbox()).toBeInTheDocument();
    expect(analyticsCheckbox()).not.toBeChecked();
    expect(analyticsCheckbox()).toHaveAttribute('type', 'checkbox');
    expect(analyticsCheckbox()).not.toBe(termsCheckbox());
  });

  it('is NOT marked required — analytics is not a condition of signing up', () => {
    renderSignUp();
    expect(analyticsCheckbox()).not.toHaveAttribute('aria-required', 'true');
    // …while the Terms one, which IS a condition, still is.
    expect(termsCheckbox()).toHaveAttribute('aria-required', 'true');
  });

  it('does not gate the submit button or the OAuth buttons', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.click(termsCheckbox());

    expect(analyticsCheckbox()).not.toBeChecked();
    expect(submitButton()).toBeEnabled();
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Continue with Apple/ })).toBeEnabled();
  });

  it('ticking analytics does not tick Terms, and vice versa', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.click(analyticsCheckbox());
    expect(analyticsCheckbox()).toBeChecked();
    expect(termsCheckbox()).not.toBeChecked();

    await user.click(termsCheckbox());
    await user.click(analyticsCheckbox());
    expect(analyticsCheckbox()).not.toBeChecked();
    expect(termsCheckbox()).toBeChecked();
  });

  it('is keyboard operable: Space toggles it, both ways', async () => {
    const user = userEvent.setup();
    renderSignUp();

    analyticsCheckbox().focus();
    expect(analyticsCheckbox()).toHaveFocus();
    await user.keyboard(' ');
    expect(analyticsCheckbox()).toBeChecked();
    await user.keyboard(' ');
    expect(analyticsCheckbox()).not.toBeChecked();
  });

  it('describes what is collected, and the description is programmatically associated', () => {
    renderSignUp();

    const describedBy = analyticsCheckbox().getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const detail = document.getElementById(describedBy as string);
    expect(detail).toBeTruthy();
    // Says what it is linked to (the account) — positively, in the ACCEPT
    // sentences, not "never linked to your account" — and what declining still
    // means, in the decline sentence itself.
    const text = detail?.textContent ?? '';
    const split = splitOffSentence(text, 'If you leave this unchecked');
    expect(split, `detail must carry the decline sentence: "${text}"`).not.toBeNull();
    expectAccountLinkDisclosed(split?.rest ?? '', 'en');
    expect(split?.off ?? '').toMatch(/anonymous/i);
    expect(split?.rest ?? '').not.toMatch(/anonymous/i);
    // …and does NOT claim the email is attached: identify sends the user id
    // only (proven against the real lib/posthog.ts in
    // lib/__tests__/signupConsentCopy.test.ts; posthog is stubbed here).
    expect(detail?.textContent ?? '').not.toMatch(/e-?mail/i);
  });

  /**
   * NEVER PRE-SEEDED FROM A STORED GRANT. Signup creates a NEW account, and a
   * browser is shared in ways a phone is not: person A's recorded "yes" must
   * not appear as a ticked box that person B can consent-by-inaction to.
   */
  it('stays unticked even when this browser already holds a GRANTED decision', () => {
    setAnalyticsConsent(true);
    renderSignUp();
    expect(analyticsCheckbox()).not.toBeChecked();
  });
});

/**
 * A real /auth/signup success: the account exists, so it carries the new user's
 * id. The answer is recorded only once that id is present — a blocked-domain
 * fake 200 has no `data`, and recording then would leave an ownerless answer
 * for the next account on this browser (signupAnalyticsConsentServerHalf).
 */
const SIGNUP_OK = {
  success: true,
  data: {
    user: { id: 'new-user-1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
    message: 'Please check your email for a verification code.',
  },
};

describe('email/password signup records the answer', () => {
  it('accepting records GRANTED', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValue(SIGNUP_OK as never);
    renderSignUp();

    await fillValidForm(user);
    await user.click(analyticsCheckbox());
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('granted');
    expect(initAnalytics).toHaveBeenCalled();
  });

  /** Declining costs zero clicks — and is still WRITTEN DOWN. */
  it('leaving it alone records DECLINED, not "unasked"', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValue(SIGNUP_OK as never);
    renderSignUp();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(getAnalyticsConsentState()).toBe('declined');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
    expect(initAnalytics).not.toHaveBeenCalled();
  });

  it('records the answer BEFORE signup_completed fires', async () => {
    const user = userEvent.setup();
    let stateAtCompletion: string | null = null;
    const { Analytics } = await import('@/lib/analytics');
    vi.mocked(Analytics.signupCompleted).mockImplementation(() => {
      stateAtCompletion = localStorage.getItem('cc_analytics_enabled');
    });
    mockedPost.mockResolvedValue(SIGNUP_OK as never);
    renderSignUp();

    await fillValidForm(user);
    await user.click(analyticsCheckbox());
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    // Otherwise the completion event — the one that matters most in the
    // activation funnel — is captured under the old, un-consented mode.
    expect(stateAtCompletion).toBe('true');
  });

  /**
   * A failed signup created no account, so it stamps no decision: the visitor
   * is still owed the question when they retry.
   */
  it('records NOTHING when the signup request fails', async () => {
    const user = userEvent.setup();
    mockedPost.mockRejectedValue(new Error('boom'));
    renderSignUp();

    await fillValidForm(user);
    await user.click(analyticsCheckbox());
    await user.click(submitButton());

    await waitFor(() => expect(order).toContain('signup_failed'));
    expect(getAnalyticsConsentState()).toBe('unasked');
    expect(hasAnsweredAnalyticsConsent()).toBe(false);
  });

  it('never identifies anyone during signup', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValue(SIGNUP_OK as never);
    renderSignUp();

    await fillValidForm(user);
    await user.click(analyticsCheckbox());
    await user.click(submitButton());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    // Email signup returns no session — there is no user id yet, so nothing
    // may be joined to an identity even though consent was just granted.
    expect(identifyUser).not.toHaveBeenCalled();
  });
});

describe('OAuth signup carries the answer across the redirect', () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://provider.example' },
      error: null,
    } as never);
  });

  it('parks TRUE when the box is ticked', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.click(termsCheckbox());
    await user.click(analyticsCheckbox());
    await user.click(screen.getByRole('button', { name: /Continue with Google/ }));

    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalled());
    expect(consumePendingAnalyticsConsent()).toBe(true);
  });

  /** The path the majority of signups take — it must record a decline too. */
  it('parks FALSE when the box is left alone', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.click(termsCheckbox());
    await user.click(screen.getByRole('button', { name: /Continue with Apple/ }));

    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalled());
    expect(consumePendingAnalyticsConsent()).toBe(false);
  });

  it('does not record the decision locally yet — the callback does, on success', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.click(termsCheckbox());
    await user.click(analyticsCheckbox());
    await user.click(screen.getByRole('button', { name: /Continue with Google/ }));

    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalled());
    // The handshake can still fail or be cancelled; only a completed sign-in
    // is a completed signup.
    expect(getAnalyticsConsentState()).toBe('unasked');
  });

  it('parks nothing when the OAuth call itself is blocked by the Terms gate', async () => {
    const user = userEvent.setup();
    renderSignUp();

    // Terms not ticked -> the buttons are disabled, so nothing is parked.
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeDisabled();
    await user.click(analyticsCheckbox());
    expect(consumePendingAnalyticsConsent()).toBeNull();
  });
});

/**
 * A HANDSHAKE THAT NEVER STARTS MUST LEAVE NOTHING BEHIND.
 *
 * `AuthCallbackPage` clears the parked answer on every path IT reaches — but
 * when `signInWithOAuth` fails before the redirect (offline, Supabase 5xx, a
 * blocked popup) the browser never reaches /auth/callback at all, and the
 * parked value survives for the life of the TAB, across SPA navigation.
 *
 * The failure that buys: tick Terms, leave analytics unticked (the default),
 * click Continue with Google, it fails, walk over to /login, Continue with
 * Google, it succeeds. The callback consumes the stale '0' as if this returning
 * user had just declined, and the server half (`withdraw-analytics-consent`)
 * calls `deletePostHogPerson(userId)` with `delete_events=true` — irreversible
 * destruction of a returning user's analytics record, from a box they never
 * touched. That is verbatim the outcome the three-state design exists to
 * prevent (see lib/pendingAnalyticsConsent.ts).
 *
 * The parked TERMS acceptance has the same seam and a smaller blast radius:
 * a later OAuth LOGIN would relay `termsAccepted: true` for a returning user
 * who ticked nothing, stamping `users.terms_accepted_at` on an account whose
 * column was still NULL. Cleared here for the same reason.
 */
describe('an OAuth handshake that fails to start parks nothing', () => {
  async function clickGoogleWithBoxUnticked(user: ReturnType<typeof userEvent.setup>) {
    renderSignUp();
    await user.click(termsCheckbox());
    // Analytics box deliberately left alone — the default, and the answer
    // whose staleness is destructive.
    await user.click(screen.getByRole('button', { name: /Continue with Google/ }));
    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalled());
  }

  it('clears the parked analytics answer when signInWithOAuth returns an error', async () => {
    const user = userEvent.setup();
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: null },
      error: { message: 'network' },
    } as never);

    await clickGoogleWithBoxUnticked(user);

    await screen.findByRole('alert');
    expect(consumePendingAnalyticsConsent()).toBeNull();
    expect(consumePendingTermsConsent()).toBe(false);
  });

  it('clears the parked analytics answer when signInWithOAuth throws', async () => {
    const user = userEvent.setup();
    vi.mocked(supabase.auth.signInWithOAuth).mockRejectedValue(new Error('offline'));

    await clickGoogleWithBoxUnticked(user);

    await screen.findByRole('alert');
    expect(consumePendingAnalyticsConsent()).toBeNull();
    expect(consumePendingTermsConsent()).toBe(false);
  });

  /**
   * The clear is scoped to FAILURE. A handshake that actually started still
   * has to carry the answer across the redirect — deleting it there would lose
   * every OAuth decline, which is the gap this whole change closes.
   */
  it('still parks the answer when the handshake starts normally', async () => {
    const user = userEvent.setup();
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://provider.example' },
      error: null,
    } as never);

    await clickGoogleWithBoxUnticked(user);

    expect(consumePendingAnalyticsConsent()).toBe(false);
    expect(consumePendingTermsConsent()).toBe(true);
  });
});
