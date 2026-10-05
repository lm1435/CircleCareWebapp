import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { JoinCircleModal } from '../JoinCircleModal';

const lookupMutate = vi.fn();
vi.mock('@/hooks/useJoinCircle', () => ({
  useLookupInviteByCode: () => ({ mutate: lookupMutate, isPending: false }),
  useAcceptInviteByCode: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ Analytics: { inviteAccepted: vi.fn() } }));

const base = {
  id: 'invite-1',
  invite_code: 'ABC123',
  circle: { id: 'circle-1', name: 'Luis', recipient_name: 'Luis' },
  invited_by: { email: 'ada@example.com', first_name: 'Ada', last_name: null },
  expires_at: '2026-07-01T00:00:00Z',
};

async function preview(memberType: 'care_recipient' | 'caregiver', inviter = base.invited_by) {
  const user = userEvent.setup();
  lookupMutate.mockImplementation((_c, opts) =>
    opts?.onSuccess?.({ ...base, member_type: memberType, invited_by: inviter })
  );
  render(
    <MemoryRouter>
      <JoinCircleModal onClose={vi.fn()} onJoined={vi.fn()} />
    </MemoryRouter>
  );
  const group = screen.getByRole('group', { name: /Invite code|Código de invitación/ });
  await user.click(group.querySelectorAll('input')[0] as HTMLElement);
  await user.paste('abc123');
  await user.click(screen.getByRole('button', { name: /Find circle|Buscar círculo/ }));
}

describe('JoinCircleModal — care recipient copy', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('EN recipient', async () => {
    await preview('care_recipient');
    expect(await screen.findByText('Your care circle')).toBeInTheDocument();
    expect(screen.getByText('Ada set up CircleCare to help with your care')).toBeInTheDocument();
    expect(screen.queryByText('Caring for')).not.toBeInTheDocument();
    expect(screen.getByText('Care recipient')).toBeInTheDocument();
  });

  it('ES recipient', async () => {
    await i18n.changeLanguage('es');
    await preview('care_recipient');
    expect(await screen.findByText('Tu círculo de cuidado')).toBeInTheDocument();
    expect(
      screen.getByText('Ada configuró CircleCare para ayudarte con tu cuidado')
    ).toBeInTheDocument();
  });

  it('caregiver unchanged', async () => {
    await preview('caregiver');
    await waitFor(() => expect(screen.getByText('Caring for')).toBeInTheDocument());
    expect(screen.queryByText('Your care circle')).not.toBeInTheDocument();
  });
});
