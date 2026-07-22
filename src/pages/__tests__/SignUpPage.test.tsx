import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import SignUpPage from '@/pages/SignUpPage';
import { apiClient } from '@/lib/api';

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
});
