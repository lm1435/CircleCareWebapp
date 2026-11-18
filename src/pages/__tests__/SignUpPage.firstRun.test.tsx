import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import SignUpPage from '@/pages/SignUpPage';
import { clearFirstRun, peekFirstRunDraft, setFirstRunDraft } from '@/lib/firstRunDraft';
import { clearPendingInviteCode, setPendingInviteCode } from '@/lib/pendingInviteCode';
import { resetFirstRunFunnelForTests } from '@/lib/firstRunFunnel';

// First run v2 (1.4.3) on /signup: "Who are you caring for?" is step 1, the account step 2.
// Positive and negative cases, named.

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => {
  clearFirstRun();
  clearPendingInviteCode();
  resetFirstRunFunnelForTests();
  sessionStorage.clear();
  mockNavigate.mockReset();
});

function renderSignUp() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <SignUpPage />
    </MemoryRouter>
  );
}

describe('SignUpPage first run v2', () => {
  it('POSITIVE: an owner sees the one question first (step 1 of 4), not the account form', () => {
    renderSignUp();
    expect(screen.getByRole('heading', { level: 1, name: 'Who are you caring for?' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Step 1 of 4' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();
  });

  it('POSITIVE: a name leads to Create account with "This saves Rosa\'s circle to your account."', async () => {
    renderSignUp();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/^Their name/), 'Rosa');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText("This saves Rosa's circle to your account.")).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Step 2 of 4' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
  });

  it('POSITIVE: "It\'s for me" leads to the self-care subtitle', async () => {
    renderSignUp();
    await userEvent.setup().click(screen.getByRole('button', { name: "It's for me" }));
    expect(screen.getByText('This saves your circle to your account.')).toBeInTheDocument();
  });

  it('POSITIVE: Back on the account step returns to the question with the name still there', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    renderSignUp();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/^Their name/)).toHaveValue('Rosa');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('NEGATIVE: an invited person (invite code parked) skips the question and any stored name is deleted', () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    setPendingInviteCode('ABCD2345');
    renderSignUp();
    expect(screen.queryByRole('heading', { name: 'Who are you caring for?' })).not.toBeInTheDocument();
    expect(screen.getByText('Coordinate care together with everyone who helps')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(peekFirstRunDraft()).toBeNull();
  });

  it('NEGATIVE: the name is never put in router state or the URL', async () => {
    renderSignUp();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/^Their name/), 'Rosa');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(JSON.stringify(mockNavigate.mock.calls)).not.toContain('Rosa');
    expect(window.location.href).not.toContain('Rosa');
  });

  it('a11y POSITIVE: Continue on the question moves focus to the Create account heading (not <body>)', async () => {
    renderSignUp();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/^Their name/), 'Rosa');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Create account' })).toHaveFocus();
  });

  it('POSITIVE: "I have an invite code" on the question step opens code entry; a 6-character code goes to the join flow', async () => {
    renderSignUp();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'I have an invite code' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your invite code' })).toHaveFocus();
    const continueBtn = screen.getByTestId('signup-invite-code-continue');
    await u.type(screen.getByLabelText(/^Invite code/), 'abc-123');
    expect(continueBtn).toBeEnabled();
    await u.click(continueBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/invite/ABC123');
  });

  it('NEGATIVE: a code-holder never sees the care question; any answer is dropped and the path is invited', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    clearFirstRun();
    renderSignUp();
    await userEvent.setup().type(screen.getByLabelText(/^Their name/), 'Rosa');
    await userEvent.setup().click(screen.getByRole('button', { name: 'I have an invite code' }));
    expect(screen.queryByRole('heading', { name: 'Who are you caring for?' })).not.toBeInTheDocument();
    expect(peekFirstRunDraft()).toBeNull();
    expect(sessionStorage.getItem('cc.firstRun.path')).toBe('invited');
  });

  it('NEGATIVE: a 7-character code cannot continue (codes are 6 or 8)', async () => {
    renderSignUp();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'I have an invite code' }));
    await u.type(screen.getByLabelText(/^Invite code/), 'ABCD234');
    expect(screen.getByTestId('signup-invite-code-continue')).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
