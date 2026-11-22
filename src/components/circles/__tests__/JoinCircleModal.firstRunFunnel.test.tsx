import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { JoinCircleModal } from '../JoinCircleModal';
import { getFirstRunPath, resetFirstRunFunnelForTests, setFirstRunPath } from '@/lib/firstRunFunnel';

// FIRST RUN FUNNEL (owner 2026-11-22): "I have an invite code" with no circle yet IS the invited first
// run's `join` step. viewed once; completed only when the ACCEPT succeeded; failed with a closed reason
// on a refused look-up / accept; back on a close without joining. A second circle is not onboarding.

const lookupMutate = vi.fn();
const acceptMutate = vi.fn();
vi.mock('@/hooks/useJoinCircle', () => ({
  useLookupInviteByCode: () => ({ mutate: lookupMutate, isPending: false }),
  useAcceptInviteByCode: () => ({ mutate: acceptMutate, isPending: false }),
}));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));

const viewed = vi.fn();
const completed = vi.fn();
const failed = vi.fn();
const back = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...actual,
    Analytics: {
      inviteAccepted: vi.fn(),
      firstRunStepViewed: (...a: unknown[]) => viewed(...a),
      firstRunStepCompleted: (...a: unknown[]) => completed(...a),
      firstRunStepFailed: (...a: unknown[]) => failed(...a),
      firstRunBackTapped: (...a: unknown[]) => back(...a),
      firstRunAbandoned: vi.fn(),
    },
  };
});

const INVITE = {
  id: 'invite-1',
  invite_code: 'ABC123',
  member_type: 'caregiver' as const,
  circle: { id: 'circle-1', name: "Rose's Circle", recipient_name: 'Rose Meza' },
  invited_by: { email: 'ada@example.com', first_name: 'Ada', last_name: null },
  expires_at: '2026-07-01T00:00:00Z',
};
const ACCEPT_RESULT = {
  circle: { id: 'circle-1', name: "Rose's Circle", recipient_name: 'Rose Meza', owner_id: 'o-1' },
  view_only: false,
};

function renderModal(firstRun: boolean) {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <JoinCircleModal onClose={onClose} onJoined={vi.fn()} firstRun={firstRun} />
    </MemoryRouter>
  );
  return { onClose };
}

async function lookUp(user: ReturnType<typeof userEvent.setup>, code = 'ABC123') {
  await user.click(screen.getByLabelText(/^Invite code/));
  await user.paste(code);
  await user.click(screen.getByRole('button', { name: 'Find circle' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFirstRunFunnelForTests();
});

describe('JoinCircleModal first run funnel (join step)', () => {
  it('POSITIVE: viewed once on arrival with path invited', () => {
    renderModal(true);
    expect(viewed).toHaveBeenCalledTimes(1);
    expect(viewed).toHaveBeenCalledWith(undefined, 'join', 'invited');
  });

  it('POSITIVE: completed only after the accept SUCCEEDED, never on the tap', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_c, opts) => opts?.onSuccess?.(INVITE));
    let settle: (() => void) | null = null;
    acceptMutate.mockImplementation((_c, opts) => {
      settle = () => opts?.onSuccess?.(ACCEPT_RESULT);
    });
    renderModal(true);
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Join circle' }));
    // Tapped, server has not answered yet: nothing.
    expect(completed).not.toHaveBeenCalled();
    settle!();
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(completed).toHaveBeenCalledWith('join', expect.any(String), 'invited', undefined);
    expect(failed).not.toHaveBeenCalled();
    // A successful join is not a back.
    expect(back).not.toHaveBeenCalled();
  });

  it('POSITIVE: a wrong code fails the join with invalid_code; an expired one with expired_code', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementationOnce((_c, opts) => {
      opts?.onError?.({ success: false, error: { code: 'INVITE_NOT_FOUND', message: 'x' } });
      opts?.onSettled?.();
    });
    renderModal(true);
    await lookUp(user);
    expect(failed).toHaveBeenLastCalledWith('join', 'invalid_code', 'invited');
    lookupMutate.mockImplementationOnce((_c, opts) => {
      opts?.onError?.({ success: false, error: { code: 'INVITE_EXPIRED', message: 'x' } });
      opts?.onSettled?.();
    });
    await user.click(screen.getByRole('button', { name: 'Find circle' }));
    expect(failed).toHaveBeenLastCalledWith('join', 'expired_code', 'invited');
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('POSITIVE: a spent invite on accept fails with invite_invalid', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_c, opts) => opts?.onSuccess?.(INVITE));
    acceptMutate.mockImplementation((_c, opts) => {
      opts?.onError?.({ success: false, error: { code: 'INVITE_ALREADY_USED', message: 'x' } });
      opts?.onSettled?.();
    });
    renderModal(true);
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Join circle' }));
    expect(failed).toHaveBeenCalledWith('join', 'invite_invalid', 'invited');
    expect(completed).not.toHaveBeenCalled();
  });

  it('POSITIVE: Cancel without joining is a back on join, and the path returns to the owner one', async () => {
    const user = userEvent.setup();
    setFirstRunPath('email');
    const { onClose } = renderModal(true);
    expect(getFirstRunPath()).toBe('invited');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(back).toHaveBeenCalledWith('join');
    expect(onClose).toHaveBeenCalled();
    expect(getFirstRunPath()).toBe('email');
  });

  it('NEGATIVE: joining a SECOND circle (not first run) sends no funnel event at all', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementationOnce((_c, opts) => {
      opts?.onError?.({ success: false, error: { code: 'INVITE_NOT_FOUND', message: 'x' } });
      opts?.onSettled?.();
    });
    renderModal(false);
    await lookUp(user);
    lookupMutate.mockImplementation((_c, opts) => opts?.onSuccess?.(INVITE));
    acceptMutate.mockImplementation((_c, opts) => opts?.onSuccess?.(ACCEPT_RESULT));
    await user.click(screen.getByRole('button', { name: 'Find circle' }));
    await user.click(await screen.findByRole('button', { name: 'Join circle' }));
    expect(viewed).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it('NEGATIVE: the typed code never reaches any funnel property', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_c, opts) => {
      opts?.onError?.({ success: false, error: { code: 'INVITE_NOT_FOUND', message: 'ZX9QK2 not found' } });
      opts?.onSettled?.();
    });
    renderModal(true);
    await lookUp(user, 'ZX9QK2');
    const sent = JSON.stringify([viewed.mock.calls, failed.mock.calls]);
    expect(sent).not.toContain('ZX9QK2');
    expect(sent).not.toContain('found');
  });
});
