import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import PendingInvitesPage from '@/pages/PendingInvitesPage';
import type { PendingInvite } from '@/api/invites';

const result: { data: PendingInvite[]; isPending: boolean; isError: boolean; refetch: () => void } =
  { data: [], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/hooks/useInvites', () => ({
  usePendingInvites: () => result,
  useAcceptInvite: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));

function invite(memberType: PendingInvite['member_type']): PendingInvite {
  return {
    id: 'inv-1',
    member_type: memberType,
    circle: { id: 'c1', name: 'Luis', recipient_name: 'Luis' },
    invited_by: { email: 'luis@example.com', first_name: 'Luis', last_name: 'Meza' },
    created_at: '2026-06-01T00:00:00Z',
    expires_at: '2026-06-08T00:00:00Z',
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <PendingInvitesPage />
    </MemoryRouter>
  );
}

describe('PendingInvitesPage — care recipient copy', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('EN recipient: set-up sentence + "Your care circle"', () => {
    result.data = [invite('care_recipient')];
    renderPage();
    expect(
      screen.getByText('Luis Meza set up CircleCare to help with your care')
    ).toBeInTheDocument();
    expect(screen.getByText(/Your care circle/)).toBeInTheDocument();
    expect(screen.queryByText(/help care for/)).not.toBeInTheDocument();
  });

  it('ES recipient', async () => {
    await i18n.changeLanguage('es');
    result.data = [invite('care_recipient')];
    renderPage();
    expect(
      screen.getByText('Luis Meza configuró CircleCare para ayudarte con tu cuidado')
    ).toBeInTheDocument();
    expect(screen.getByText(/Tu círculo de cuidado/)).toBeInTheDocument();
  });

  it('caregiver unchanged', () => {
    result.data = [invite('caregiver')];
    renderPage();
    expect(screen.getByText('Luis Meza invited you to help care for Luis')).toBeInTheDocument();
    expect(screen.queryByText(/set up CircleCare/)).not.toBeInTheDocument();
  });
});
