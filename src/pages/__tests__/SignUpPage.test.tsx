import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import SignUpPage from '@/pages/SignUpPage';
import { apiClient } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { clickTwice, neverSettles, submitFormTwice } from '@/test/doubleSubmit';

// Mirrors LoginPage.test.tsx mocking style: `@/lib/api` + `@/lib/supabase` are
// mocked by the global setup; here we assert the page calls authApi.signup with
// the right body (including timezone + language + termsAccepted) and routes to
// /verify-email with the email in router STATE (never in query params).

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockedPost = vi.mocked(apiClient.post);

// AuthGuard redirects with `replace`, so /login can be history entry 0 —
// `useAuthBack` reads the real `window.history.length` (not MemoryRouter's
// own stack), so these tests stub that getter directly.
function mockHistoryLength(length: number): () => void {
  const original = Object.getOwnPropertyDescriptor(window.history, 'length');
  Object.defineProperty(window.history, 'length', { configurable: true, get: () => length });
  return () => {
    if (original) Object.defineProperty(window.history, 'length', original);
  };
}

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

// Anchored regex, never an exact string: the label renders <a> children (Terms
// of Service / Privacy Policy links) via Trans, and exact accessible-name
// matches break on composed content (same gotcha as RequiredMarker labels).
function termsCheckbox() {
  return screen.getByRole('checkbox', { name: /^I am 18 or older/ });
}

function submitButton() {
  return screen.getByRole('button', { name: 'Create account' });
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<typeof VALID> & { confirmPassword?: string; acceptTerms?: boolean } = {}
) {
  const values = {
    ...VALID,
    confirmPassword: VALID.password,
    acceptTerms: true,
    ...overrides,
  };
  // Labels carry a RequiredMarker (" * (required)") now that the fields pass
  // `required`, so match the leading label text rather than the exact string.
  await user.type(screen.getByLabelText(/^First Name/), values.firstName);
  await user.type(screen.getByLabelText(/^Last Name/), values.lastName);
  await user.type(screen.getByLabelText(/^Email/), values.email);
  await user.type(screen.getByLabelText(/^Password/), values.password);
  await user.type(screen.getByLabelText(/^Confirm Password/), values.confirmPassword);
  if (values.acceptTerms) {
    await user.click(termsCheckbox());
  }
}

describe('SignUpPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
  });

  it('renders the consent checkbox UNCHECKED by default with submit and OAuth disabled', () => {
    renderSignUp();

    expect(termsCheckbox()).not.toBeChecked();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: /Continue with Apple/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeDisabled();
  });

  it('enables submit and OAuth once the checkbox is ticked, and disables again when unticked', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.click(termsCheckbox());
    expect(termsCheckbox()).toBeChecked();
    expect(submitButton()).toBeEnabled();
    expect(screen.getByRole('button', { name: /Continue with Apple/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeEnabled();

    await user.click(termsCheckbox());
    expect(termsCheckbox()).not.toBeChecked();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeDisabled();
  });

  it('is keyboard operable: Space toggles the checkbox', async () => {
    const user = userEvent.setup();
    renderSignUp();

    termsCheckbox().focus();
    expect(termsCheckbox()).toHaveFocus();
    await user.keyboard(' ');
    expect(termsCheckbox()).toBeChecked();
    await user.keyboard(' ');
    expect(termsCheckbox()).not.toBeChecked();
  });

  it('is a native checkbox: pressing Enter does not submit the form', async () => {
    const user = userEvent.setup();
    renderSignUp();

    // A native <input type="checkbox"> only toggles on Space, never submits
    // its form on Enter — confirmed here by asserting no signup request ever
    // goes out.
    expect(termsCheckbox()).toHaveAttribute('type', 'checkbox');

    termsCheckbox().focus();
    await user.keyboard('{Enter}');

    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('toggles when the sentence text (not just the icon) is clicked, mirroring mobile\'s whole-row tap target', async () => {
    const user = userEvent.setup();
    renderSignUp();

    // Click on plain text within the label's sentence, not the checkbox
    // itself or one of the nested links.
    await user.click(screen.getByText(/I am 18 or older and I agree to the/));

    expect(termsCheckbox()).toBeChecked();
    expect(submitButton()).toBeEnabled();
  });

  it('keeps the Terms of Service link functional (href intact) inside the label', () => {
    renderSignUp();

    // OAuthButtons renders its own "Terms of Service" legal caption above this
    // row, so scope the query to the consent checkbox's own <label>.
    const label = termsCheckbox().closest('label');
    expect(label).not.toBeNull();
    const termsLink = within(label as HTMLElement).getByRole('link', {
      name: 'Terms of Service',
    });
    expect(termsLink).toHaveAttribute('href');
    expect(termsLink.getAttribute('href')).not.toBe('');
  });

  it('validates locally and never calls the API with an empty form', async () => {
    const user = userEvent.setup();
    renderSignUp();

    // Tick the consent checkbox so the (otherwise disabled) submit is clickable
    // while the text fields stay empty.
    await user.click(termsCheckbox());
    await user.click(submitButton());

    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('blocks submit on a weak password', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await fillValidForm(user, { password: 'weak', confirmPassword: 'weak' });
    await user.click(submitButton());

    expect(
      await screen.findByText(
        'Password must be at least 8 characters with an uppercase letter, a lowercase letter, a number, and a special character.'
      )
    ).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('blocks submit when the password confirmation does not match', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await fillValidForm(user, { confirmPassword: 'Different#123' });
    await user.click(submitButton());

    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // GoTrue rejects passwords over 72 UTF-8 BYTES (bcrypt's limit, not a
  // character count) — verified against the local stack: 72 chars → 200, 73
  // chars → 400, and a 72-JS-character/140-byte accented password → 400. A
  // client that admits either case is looser than the server, so signup fails
  // with an opaque upstream error after every other field already validated.
  it('blocks submit on a 73-character password (over the 72-byte server cap)', async () => {
    const user = userEvent.setup();
    renderSignUp();
    const password = 'Aa1!' + 'x'.repeat(73 - 4);
    expect(password).toHaveLength(73);

    await fillValidForm(user, { password, confirmPassword: password });
    await user.click(submitButton());

    expect(await screen.findByText('Password must be 72 characters or fewer.')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('blocks submit on a 72-character password that is over 72 UTF-8 bytes (accented)', async () => {
    const user = userEvent.setup();
    renderSignUp();
    // 'Aa1!' (4 ASCII bytes) + 68 'é' (2 bytes each) = 72 chars, 140 bytes.
    const password = 'Aa1!' + 'é'.repeat(68);
    expect(password).toHaveLength(72);

    await fillValidForm(user, { password, confirmPassword: password });
    await user.click(submitButton());

    expect(await screen.findByText('Password must be 72 characters or fewer.')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('accepts a 72-character ASCII password (exactly at the server cap)', async () => {
    mockedPost.mockResolvedValueOnce({
      success: true,
      data: {
        user: { id: 'u1', email: VALID.email, first_name: 'Pat', last_name: 'Rivera' },
        message: 'sent',
      },
    } as never);
    const user = userEvent.setup();
    renderSignUp();
    const password = 'Aa1!' + 'x'.repeat(72 - 4);
    expect(password).toHaveLength(72);

    await fillValidForm(user, { password, confirmPassword: password });
    await user.click(submitButton());

    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith('/verify-email', { state: { email: VALID.email } });
  });

  it('never calls the API while the checkbox is unchecked (form-level guard behind the disabled button)', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await fillValidForm(user, { acceptTerms: false });
    expect(submitButton()).toBeDisabled();
    await user.click(submitButton());

    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('signs up with the full body (timezone + language + termsAccepted) and routes to /verify-email with email in state', async () => {
    mockedPost.mockResolvedValueOnce({
      success: true,
      data: {
        user: { id: 'u1', email: VALID.email, first_name: 'Pat', last_name: 'Rivera' },
        message: 'sent',
      },
    } as never);

    const user = userEvent.setup();
    renderSignUp();
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/signup', {
        email: VALID.email,
        password: VALID.password,
        first_name: 'Pat',
        last_name: 'Rivera',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: 'en',
        termsAccepted: true,
      })
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/verify-email', {
        state: { email: VALID.email },
      })
    );
  });

  it('shows an inline "email exists" alert and does not navigate when the account is taken', async () => {
    mockedPost.mockRejectedValueOnce({
      success: false,
      error: { code: 'USER_EXISTS', message: 'User already registered' },
    });

    const user = userEvent.setup();
    renderSignUp();
    await fillValidForm(user);
    await user.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'An account with this email already exists. Please sign in instead.'
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  describe('back navigation (falls back to /login)', () => {
    it('navigates to /login when there is no prior history', async () => {
      const restore = mockHistoryLength(1);
      try {
        const user = userEvent.setup();
        renderSignUp();
        await user.click(screen.getByRole('button', { name: 'Back' }));
        expect(mockNavigate).toHaveBeenCalledWith('/login');
      } finally {
        restore();
      }
    });

    it('navigates through history when history is available', async () => {
      const restore = mockHistoryLength(3);
      try {
        const user = userEvent.setup();
        renderSignUp();
        await user.click(screen.getByRole('button', { name: 'Back' }));
        expect(mockNavigate).toHaveBeenCalledWith(-1);
      } finally {
        restore();
      }
    });
  });
});

// Regression — double submit (same class as the LoginPage one). /auth/signup
// sits on the 5-per-5-minutes `authRateLimit` bucket, and the second request
// 400s USER_EXISTS against the account the first one just created.
describe('SignUpPage — double-submit guard', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
    vi.mocked(supabase.auth.signInWithOAuth).mockClear();
  });

  it('sends exactly ONE /auth/signup when the form is submitted twice in the same tick', async () => {
    mockedPost.mockImplementation((() => neverSettles()) as never);
    const user = userEvent.setup();
    const { container } = renderSignUp();

    await fillValidForm(user);
    await submitFormTwice(container.querySelector('form') as HTMLFormElement);

    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('is still submittable after a validation failure (the guard releases, it does not latch)', async () => {
    const user = userEvent.setup();
    const { container } = renderSignUp();

    // Empty form: Zod fails and the handler returns before isSubmitting is set.
    await submitFormTwice(container.querySelector('form') as HTMLFormElement);
    expect(mockedPost).not.toHaveBeenCalled();

    mockedPost.mockImplementation((() => neverSettles()) as never);
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
  });

  it('starts exactly ONE OAuth handshake when a provider button is pressed twice in the same tick', async () => {
    const signInWithOAuth = vi.mocked(supabase.auth.signInWithOAuth);
    signInWithOAuth.mockImplementation((() => neverSettles()) as never);
    const user = userEvent.setup();
    renderSignUp();

    // The consent checkbox gates OAuth on this page — tick it first.
    await user.click(termsCheckbox());
    await clickTwice(screen.getByRole('button', { name: /Continue with Google/ }));

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  });
});
