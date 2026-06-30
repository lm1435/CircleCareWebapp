import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import SignUpPage from '@/pages/SignUpPage';
import { apiClient } from '@/lib/api';

// Mirrors LoginPage.test.tsx mocking style: `@/lib/api` + `@/lib/supabase` are
// mocked by the global setup; here we assert the page calls authApi.signup with
// the right body (including timezone + language) and routes to /verify-email
// with the email in router STATE (never in query params).

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

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<typeof VALID> & { confirmPassword?: string } = {}
) {
  const values = { ...VALID, confirmPassword: VALID.password, ...overrides };
  // Labels carry a RequiredMarker (" * (required)") now that the fields pass
  // `required`, so match the leading label text rather than the exact string.
  await user.type(screen.getByLabelText(/^First Name/), values.firstName);
  await user.type(screen.getByLabelText(/^Last Name/), values.lastName);
  await user.type(screen.getByLabelText(/^Email/), values.email);
  await user.type(screen.getByLabelText(/^Password/), values.password);
  await user.type(screen.getByLabelText(/^Confirm Password/), values.confirmPassword);
}

describe('SignUpPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedPost.mockReset();
  });

  it('validates locally and never calls the API with an empty form', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('blocks submit on a weak password', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await fillValidForm(user, { password: 'weak', confirmPassword: 'weak' });
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

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
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('signs up with the full body (timezone + language) and routes to /verify-email with email in state', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/signup', {
        email: VALID.email,
        password: VALID.password,
        first_name: 'Pat',
        last_name: 'Rivera',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: 'en',
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
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'An account with this email already exists. Please sign in instead.'
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
