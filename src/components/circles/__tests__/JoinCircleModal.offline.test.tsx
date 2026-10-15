import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { JoinCircleModal } from '../JoinCircleModal';
import { __resetOfflineWriteForTests, setOfflineWriteExplainer } from '@/lib/offlineWrite';

// OFFLINE = READ-ONLY (owner decision 2026-10-14) — join by code. Both steps
// are writes: the lookup submit and the details-step "Join circle" accept carry
// offlineKind="save". Offline the accept is aria-disabled (still focusable), a
// press explains "You're offline. Connect to save this." and sends nothing, and
// the found invite stays on screen. Mobile twin:
// mobile/src/__tests__/offlineReadOnly/circle/JoinCircleModalOffline.test.tsx.

const lookupMutate = vi.fn();
const acceptMutate = vi.fn();
vi.mock('@/hooks/useJoinCircle', () => ({
  useLookupInviteByCode: () => ({ mutate: lookupMutate, isPending: false }),
  useAcceptInviteByCode: () => ({ mutate: acceptMutate, isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ Analytics: { inviteAccepted: vi.fn() } }));

const INVITE = {
  id: 'invite-1',
  invite_code: 'ABC123',
  member_type: 'caregiver' as const,
  circle: { id: 'circle-1', name: "Rose's Circle", recipient_name: 'Rose Meza' },
  invited_by: { email: 'ada@example.com', first_name: 'Ada', last_name: null },
  expires_at: '2026-07-01T00:00:00Z',
};

const explained = vi.fn();

function renderModal() {
  const onClose = vi.fn();
  const onJoined = vi.fn();
  render(
    <MemoryRouter>
      <JoinCircleModal onClose={onClose} onJoined={onJoined} />
    </MemoryRouter>
  );
  return { onClose, onJoined };
}

/** Online: type the code and look it up, landing on the details step. */
async function reachDetails() {
  const boxes = within(screen.getByRole('group', { name: 'Invite code' })).getAllByRole('textbox');
  fireEvent.paste(boxes[0], { clipboardData: { getData: () => 'ABC123' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Find circle' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Find circle' }));
  await screen.findByText("Rose's Circle");
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetOfflineWriteForTests();
  setOfflineWriteExplainer(explained);
  lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
});
afterEach(() => {
  setOfflineWriteExplainer(null);
  act(() => onlineManager.setOnline(true));
});

describe('JoinCircleModal offline', () => {
  it('"Join circle" offline: aria-disabled, explains with the save sentence, accepts nothing, keeps the invite', async () => {
    const { onClose, onJoined } = renderModal();
    await reachDetails();
    expect(lookupMutate).toHaveBeenCalledTimes(1);

    act(() => onlineManager.setOnline(false));
    const join = screen.getByRole('button', { name: 'Join circle' });
    expect(join).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(join);

    expect(explained).toHaveBeenCalledTimes(1);
    expect(explained).toHaveBeenCalledWith("You're offline. Connect to save this.");
    expect(acceptMutate).not.toHaveBeenCalled();
    expect(onJoined).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Rose's Circle")).toBeInTheDocument();
  });

  it('control, online: "Join circle" is live and sends the accept', async () => {
    renderModal();
    await reachDetails();
    const join = screen.getByRole('button', { name: 'Join circle' });
    expect(join).not.toHaveAttribute('aria-disabled');
    fireEvent.click(join);
    expect(acceptMutate).toHaveBeenCalledTimes(1);
    expect(explained).not.toHaveBeenCalled();
  });
});
