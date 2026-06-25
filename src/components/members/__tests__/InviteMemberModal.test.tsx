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

// The cap note renders an inline "Upgrade" button only when web billing is
// configured; force it on so the button is testable.
vi.mock('@/lib/purchases', () => ({ isWebBillingConfigured: () => true }));

// The cap note's Upgrade button routes via useNavigate — stub it so the modal
// can render outside a Router and we can assert the destination.
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const CIRCLE_ID = 'circle-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InviteMemberModal — email-required', () => {
  it('disables the send button until an email is entered', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled();

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeEnabled();
  });

  it('blocks the invite on a malformed email', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
  });

  it('sends an invite with the trimmed email and member_type, then closes', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    const onClose = vi.fn();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={onClose} />);

    await user.type(screen.getByLabelText('Email address'), '  ana@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      email: 'ana@example.com',
      member_type: 'caregiver',
    });
    expect(showToast).toHaveBeenCalledWith('Invitation sent to ana@example.com.', 'success');
    expect(onClose).toHaveBeenCalled();
  });

  it('passes the chosen role through for a non-self-care circle', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /Care Recipient/i }));
    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate.mock.calls[0][0]).toEqual({
      email: 'ana@example.com',
      member_type: 'care_recipient',
    });
  });

  it('hides the role picker for a self-care circle', () => {
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare onClose={vi.fn()} />);
    expect(screen.queryByRole('radio', { name: /Care Recipient/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('surfaces the free-tier cap note when the invite is rejected with 402', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onError?.({ error: { code: 'SUBSCRIPTION_REQUIRED' } })
    );
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/up to two caregivers\. Upgrade to Premium/i);
    });
  });

  it('routes to /upgrade from the cap note when web billing is configured', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onError?.({ error: { code: 'SUBSCRIPTION_REQUIRED' } })
    );
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    const upgrade = await screen.findByRole('button', { name: 'Upgrade' });
    await user.click(upgrade);

    expect(navigate).toHaveBeenCalledWith('/upgrade');
  });
});
