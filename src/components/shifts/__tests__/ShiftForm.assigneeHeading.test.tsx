import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CircleMember } from '@/api/circleMembers';
import { ToastProvider } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { ShiftFormModal } from '../ShiftFormModal';

// Owner 2026-11-07: the assignee heading reads "Who's covering?" when the viewer IS the care recipient (self
// circle) or the recipient name is empty; otherwise "Who's with <name>?". Never keyed on a literal name.
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const members = [
  { id: 'u-me', first_name: 'Pat', last_name: 'L', email: 'p@x.test', role: 'owner', is_care_recipient: false },
  { id: 'u-rosa', first_name: 'Rosa', last_name: 'G', email: 'r@x.test', role: 'member', is_care_recipient: true },
] as unknown as CircleMember[];

function run(viewerId: string, recipientName: string) {
  useAuthStore.setState({ user: { id: viewerId, email: 'x@x.test' }, isAuthenticated: true } as never);
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c', recipient_name: recipientName, owner_id: 'u-me' },
    timezone: 'America/Chicago',
    members,
    canEdit: true,
    canManageMembers: true,
    viewerRole: 'owner',
  } as unknown as ReturnType<typeof useCircle>);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <ShiftFormModal circleId="c" initialDate="2027-03-09" onClose={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('shift form assignee heading', () => {
  it('normal name, viewer is a caregiver: "Who\'s with Rosa?"', () => {
    run('u-me', 'Rosa');
    expect(screen.getByRole('heading', { name: "Who's with Rosa?" })).toBeInTheDocument();
  });
  it('viewer is the care recipient: "Who\'s covering?" even with a name', () => {
    run('u-rosa', 'Rosa');
    expect(screen.getByRole('heading', { name: "Who's covering?" })).toBeInTheDocument();
    expect(screen.queryByText(/Who's with/)).not.toBeInTheDocument();
  });
  it('empty name: "Who\'s covering?"', () => {
    run('u-me', '');
    expect(screen.getByRole('heading', { name: "Who's covering?" })).toBeInTheDocument();
  });
});
