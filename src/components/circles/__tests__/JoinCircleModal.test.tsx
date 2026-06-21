import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { JoinCircleModal } from '../JoinCircleModal';

// Web port parity test for mobile's JoinCircleModal. Mocks the lookup/accept
// mutations + toast so the test focuses on the two-step flow:
//   - look up a code → preview the circle (name / caring for / role)
//   - a bad code surfaces a localized error
//   - accept → toast + close + onJoined(circleId)
//   - "enter a different code" returns to the code entry step

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

const INVITE = {
  id: 'invite-1',
  invite_code: 'ABC123',
  member_type: 'caregiver' as const,
  circle: { id: 'circle-1', name: "Rose's Circle", recipient_name: 'Rose Meza' },
  invited_by: { email: 'ada@example.com', first_name: 'Ada', last_name: null },
  expires_at: '2026-07-01T00:00:00Z',
};

function renderModal(overrides: Partial<Parameters<typeof JoinCircleModal>[0]> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onJoined = overrides.onJoined ?? vi.fn();
  render(
    <MemoryRouter>
      <JoinCircleModal onClose={onClose} onJoined={onJoined} />
    </MemoryRouter>
  );
  return { onClose, onJoined };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JoinCircleModal', () => {
  it('looks up a code (normalized) and previews the circle', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));

    expect(lookupMutate).toHaveBeenCalledWith('ABC123', expect.anything());
    await waitFor(() => expect(screen.getByText("Rose's Circle")).toBeInTheDocument());
    expect(screen.getByText('Rose Meza')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Joining as Caregiver')).toBeInTheDocument();
  });

  it('shows a localized error when the code is invalid', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) =>
      opts?.onError?.({ error: { code: 'INVITE_NOT_FOUND' } })
    );
    renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'BADCODE');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "We couldn't find that invite code. Double-check it and try again."
      )
    );
    // Still on the code-entry step.
    expect(screen.getByRole('button', { name: 'Look up code' })).toBeInTheDocument();
  });

  it('accepts the invite → toast, close, and onJoined with the circle id', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    acceptMutate.mockImplementation((_code, opts) => opts?.onSuccess?.());
    const { onClose, onJoined } = renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));
    await screen.findByText("Rose's Circle");
    await user.click(screen.getByRole('button', { name: 'Join circle' }));

    expect(acceptMutate).toHaveBeenCalledWith('ABC123', expect.anything());
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('circle-1'));
    expect(onClose).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("You've joined Rose's Circle.", 'success');
  });

  it('"enter a different code" returns to the code-entry step', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));
    await screen.findByText("Rose's Circle");

    await user.click(screen.getByRole('button', { name: 'Enter a different code' }));

    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
    expect(screen.queryByText("Rose's Circle")).not.toBeInTheDocument();
  });
});
