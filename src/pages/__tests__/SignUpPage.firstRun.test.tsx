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

// FIRST RUN FUNNEL (owner 2026-11-22): account failures with a closed reason, Back on every step,
// the invite-code door is the `join` step.
describe('SignUpPage first run funnel', () => {
  let stepFailed: ReturnType<typeof vi.spyOn>;
  let stepViewed: ReturnType<typeof vi.spyOn>;
  let stepCompleted: ReturnType<typeof vi.spyOn>;
  let backTapped: ReturnType<typeof vi.spyOn>;
  let mockedPost: ReturnType<typeof vi.mocked<typeof import('@/lib/api').apiClient.post>>;
  beforeEach(async () => {
    const { Analytics } = await import('@/lib/analytics');
    const { apiClient } = await import('@/lib/api');
    mockedPost = vi.mocked(apiClient.post);
    mockedPost.mockReset();
    stepFailed = vi.spyOn(Analytics, 'firstRunStepFailed').mockImplementation(() => {});
    stepViewed = vi.spyOn(Analytics, 'firstRunStepViewed').mockImplementation(() => {});
    stepCompleted = vi.spyOn(Analytics, 'firstRunStepCompleted').mockImplementation(() => {});
    backTapped = vi.spyOn(Analytics, 'firstRunBackTapped').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  async function fillAccount(u: ReturnType<typeof userEvent.setup>) {
    await u.type(screen.getByLabelText(/^First Name/), 'Pat');
    await u.type(screen.getByLabelText(/^Last Name/), 'Rivera');
    await u.type(screen.getByLabelText(/^Email/), 'pat@example.com');
    await u.type(screen.getByLabelText(/^Password/), 'Secret#123');
    await u.click(screen.getByRole('checkbox', { name: /^I am 18 or older/ }));
  }

  it('POSITIVE: an address already registered is a failed account with already_exists (path email), not completed', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'USER_EXISTS', message: 'User already registered' } });
    renderSignUp();
    const u = userEvent.setup();
    await fillAccount(u);
    await u.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('alert');
    expect(stepFailed).toHaveBeenCalledTimes(1);
    expect(stepFailed).toHaveBeenCalledWith('account', 'already_exists', 'email');
    expect(stepCompleted).not.toHaveBeenCalledWith('account', expect.anything(), expect.anything(), undefined);
    // PII never rides on the event.
    expect(JSON.stringify(stepFailed.mock.calls)).not.toContain('pat@example.com');
  });

  it('POSITIVE: no answer at all is network; a 5xx is server', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    mockedPost.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true }));
    renderSignUp();
    const u = userEvent.setup();
    await fillAccount(u);
    await u.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('alert');
    expect(stepFailed).toHaveBeenLastCalledWith('account', 'network', 'email');
    mockedPost.mockRejectedValueOnce({ success: false, error: { code: 'SERVER_ERROR', message: 'x' } });
    await u.click(screen.getByRole('button', { name: 'Create account' }));
    await vi.waitFor(() => expect(stepFailed).toHaveBeenLastCalledWith('account', 'server', 'email'));
  });

  it('POSITIVE: a form the schema refuses is a failed account with validation; nothing is sent', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    renderSignUp();
    const u = userEvent.setup();
    await u.click(screen.getByRole('checkbox', { name: /^I am 18 or older/ }));
    await u.click(screen.getByRole('button', { name: 'Create account' }));
    expect(stepFailed).toHaveBeenCalledWith('account', 'validation', 'email');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a signup the server accepts completes the account step and sends no failure', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    mockedPost.mockResolvedValueOnce({ success: true, data: { user: { id: 'u-1' } } });
    renderSignUp();
    const u = userEvent.setup();
    await fillAccount(u);
    await u.click(screen.getByRole('button', { name: 'Create account' }));
    await vi.waitFor(() => expect(stepCompleted).toHaveBeenCalledWith('account', expect.any(String), 'email', undefined));
    expect(stepFailed).not.toHaveBeenCalled();
  });

  it('POSITIVE: Back on the account step is a back on account; Back on the question is a back on who', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    renderSignUp();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(backTapped).toHaveBeenLastCalledWith('account');
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(backTapped).toHaveBeenLastCalledWith('who');
  });

  it('POSITIVE: "I have an invite code" is the join step (viewed with path invited); its Back is a back on join', async () => {
    renderSignUp();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'I have an invite code' }));
    expect(stepViewed).toHaveBeenCalledWith(undefined, 'join', 'invited');
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(backTapped).toHaveBeenCalledWith('join');
  });

  it('NEGATIVE: a path left in the tab by an earlier invite link never labels an owner sign-up', () => {
    sessionStorage.setItem('cc.firstRun.path', 'invited');
    renderSignUp();
    expect(stepViewed).toHaveBeenCalledWith(undefined, 'who', 'email');
  });
});
