import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { InviteMemberModal } from '../InviteMemberModal';

// ── Hook mocks ──────────────────────────────────────────────────────────────
const mutate = vi.fn();
vi.mock('@/hooks/useInvites', () => ({
  useCreateInvite: () => ({ mutate, isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const CIRCLE_ID = 'circle-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InviteMemberModal', () => {
  it('blocks submit and shows + focuses the email error when email is empty', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate).not.toHaveBeenCalled();
    const emailInput = screen.getByLabelText('Email address');
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveFocus();
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
  });

  it('blocks submit on a malformed email', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
  });

  it('submits caregiver by default with the trimmed email', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), '  ana@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      email: 'ana@example.com',
      member_type: 'caregiver',
    });
  });

  it('lets the user choose the care_recipient role for a non-self-care circle', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'rose@example.com');
    await user.click(screen.getByRole('radio', { name: /Care Recipient/i }));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate.mock.calls[0][0]).toEqual({
      email: 'rose@example.com',
      member_type: 'care_recipient',
    });
  });

  it('hides the care_recipient option (and role picker) for a self-care circle', () => {
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare onClose={vi.fn()} />);

    // With only the single caregiver option, the role radio group is hidden.
    expect(screen.queryByRole('radio', { name: /Care Recipient/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('always sends member_type "caregiver" for a self-care circle', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'help@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate.mock.calls[0][0].member_type).toBe('caregiver');
  });

  it('surfaces the free-tier cap note when the invite is rejected with 402', async () => {
    const user = userEvent.setup();
    // Make the mutation invoke its onError with a SUBSCRIPTION_REQUIRED envelope.
    mutate.mockImplementation((_vars, opts) => {
      opts?.onError?.({ error: { code: 'SUBSCRIPTION_REQUIRED' } });
    });
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'extra@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/open the CircleCare app to upgrade/i);
    });
  });

  it('closes and toasts on a successful invite', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={onClose} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(showToast).toHaveBeenCalledWith('Invitation sent to ana@example.com.', 'success');
    expect(onClose).toHaveBeenCalled();
  });
});
