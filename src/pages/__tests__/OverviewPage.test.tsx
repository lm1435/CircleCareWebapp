import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import OverviewPage from '@/pages/OverviewPage';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';

// OverviewPage is a COMPOSITION layer (spec §6.3): its job is the hero, the
// two-column grid, the section order and the first-run hand-off. Every block's
// own behavior is covered in src/components/overview/__tests__ (and in
// OpenTasksCard / GettingStartedChecklist / FirstRunWizardModal's own tests),
// so the children are stubbed here.
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));

vi.mock('@/components/meds/TodaysMeds', () => ({
  TodaysMeds: ({ circleId, limit }: { circleId?: string; limit?: number }) => (
    <div data-testid="todays-meds" data-circle-id={circleId} data-limit={String(limit)} />
  ),
}));
vi.mock('@/components/tasks/OpenTasksCard', () => ({
  OpenTasksCard: ({ circleId, limit }: { circleId: string; limit?: number }) => (
    <div data-testid="open-tasks-card" data-circle-id={circleId} data-limit={String(limit)} />
  ),
}));
vi.mock('@/components/circles/GettingStartedChecklist', () => ({
  GettingStartedChecklist: ({ circleId }: { circleId: string }) => (
    <div data-testid="getting-started" data-circle-id={circleId} />
  ),
}));
vi.mock('@/components/overview/AdherenceCard', () => ({
  AdherenceCard: ({ circleId }: { circleId: string }) => (
    <div data-testid="adherence-card" data-circle-id={circleId} />
  ),
}));
vi.mock('@/components/overview/QuickAccess', () => ({
  QuickAccess: ({ circleId }: { circleId: string }) => (
    <div data-testid="quick-access" data-circle-id={circleId} />
  ),
}));
vi.mock('@/components/overview/CareTeam', () => ({
  CareTeam: ({ circleId, isOwner }: { circleId: string; isOwner: boolean }) => (
    <div data-testid="care-team" data-circle-id={circleId} data-owner={String(isOwner)} />
  ),
}));
vi.mock('@/components/overview/SettingsRows', () => ({
  SettingsRows: ({ circleId, isOwner }: { circleId: string; isOwner: boolean }) => (
    <div data-testid="settings-rows" data-circle-id={circleId} data-owner={String(isOwner)} />
  ),
}));
vi.mock('@/components/overview/UpcomingAppointments', () => ({
  UpcomingAppointments: ({ circleId, timezone }: { circleId: string; timezone: string }) => (
    <div data-testid="upcoming-appointments" data-circle-id={circleId} data-timezone={timezone} />
  ),
}));
vi.mock('@/components/circles/firstRun/FirstRunWizardModal', () => ({
  FirstRunWizardModal: ({ circleName }: { circleName: string }) => (
    <div data-testid="first-run-wizard" data-circle-name={circleName} />
  ),
}));

const mockUseCircle = vi.mocked(useCircle);

interface Options {
  ownerId?: string;
  recipientName?: string;
  recipientDob?: string | null;
  isLoading?: boolean;
  /** Pass `null` to model "the circle detail has not arrived yet". */
  circle?: null;
}

function setCircle(opts: Options = {}): void {
  mockUseCircle.mockReturnValue({
    circle:
      opts.circle === null
        ? undefined
        : {
            id: 'c1',
            owner_id: opts.ownerId ?? 'u1',
            recipient_name: opts.recipientName ?? 'Rose',
            recipient_photo_url: null,
            recipient_dob: opts.recipientDob ?? null,
            is_self_care: false,
          },
    members:
      opts.circle === null
        ? []
        : [
            {
              id: 'u1',
              first_name: 'Pat',
              last_name: 'Lee',
              email: 'pat@example.com',
              is_care_recipient: false,
              is_medication_responsible: false,
              role: 'owner',
            },
            {
              id: 'u2',
              first_name: 'Sam',
              last_name: 'Ng',
              email: 'sam@example.com',
              is_care_recipient: false,
              is_medication_responsible: false,
              role: 'member',
            },
          ],
    timezone: 'America/New_York',
    isLoading: opts.isLoading ?? false,
  } as unknown as ReturnType<typeof useCircle>);
}

function renderOverview(state?: unknown): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/circles/c1', state }]}>
      <Routes>
        <Route path="/circles/:circleId" element={<OverviewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });

  it('leads with the recipient hero, not a "Caring for" title', () => {
    setCircle();
    renderOverview();
    expect(screen.getByRole('heading', { name: 'Rose' })).toBeInTheDocument();
    expect(screen.getByText('Cared for by')).toBeInTheDocument();
  });

  it('mounts every Home block for this circle', () => {
    setCircle();
    renderOverview();
    for (const id of [
      'adherence-card',
      'quick-access',
      'care-team',
      'settings-rows',
      'todays-meds',
      'upcoming-appointments',
      'open-tasks-card',
      'getting-started',
    ]) {
      expect(screen.getByTestId(id)).toHaveAttribute('data-circle-id', 'c1');
    }
  });

  it('caps the two right-column lists the way mobile does', () => {
    setCircle();
    renderOverview();
    expect(screen.getByTestId('todays-meds')).toHaveAttribute('data-limit', '5');
    expect(screen.getByTestId('open-tasks-card')).toHaveAttribute('data-limit', '3');
  });

  it('hands the resolved care-recipient timezone to the appointments card', () => {
    setCircle();
    renderOverview();
    expect(screen.getByTestId('upcoming-appointments')).toHaveAttribute(
      'data-timezone',
      'America/New_York'
    );
  });

  it('orders the sections as mobile does: left column, then right column', () => {
    setCircle();
    renderOverview();
    const ids = Array.from(document.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string => id !== null && id !== 'first-run-wizard');
    expect(ids).toEqual([
      'getting-started',
      'adherence-card',
      'quick-access',
      'care-team',
      'settings-rows',
      'todays-meds',
      'upcoming-appointments',
      'open-tasks-card',
    ]);
  });

  it('lays the blocks out in two columns from 1024px up, hero spanning both', () => {
    setCircle();
    const { container } = render(
      <MemoryRouter initialEntries={['/circles/c1']}>
        <Routes>
          <Route path="/circles/:circleId" element={<OverviewPage />} />
        </Routes>
      </MemoryRouter>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).toHaveClass('xl:grid-cols-2');
    // The hero is OUTSIDE the grid, so it spans the full width at every size.
    expect(grid?.querySelector('header')).toBeNull();
  });

  it('tells the owner blocks who the owner is', () => {
    setCircle({ ownerId: 'u1' });
    renderOverview();
    expect(screen.getByTestId('settings-rows')).toHaveAttribute('data-owner', 'true');
    expect(screen.getByTestId('care-team')).toHaveAttribute('data-owner', 'true');
  });

  it('does not call a non-owner the owner', () => {
    setCircle({ ownerId: 'someone-else' });
    renderOverview();
    expect(screen.getByTestId('settings-rows')).toHaveAttribute('data-owner', 'false');
  });

  // The activity feed is one Quick Access ROW on mobile's home, never a card —
  // the old web card duplicated the feed's own page on the same screen.
  it('carries no recent-activity card', () => {
    setCircle();
    renderOverview();
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
  });

  it('keeps the get-started checklist mounted (it owns its own gating)', () => {
    setCircle();
    renderOverview();
    expect(screen.getByTestId('getting-started')).toBeInTheDocument();
  });

  describe('first run', () => {
    it('opens the wizard from the creation navigation state', () => {
      setCircle();
      renderOverview({ firstRun: true, firstRunRecipientName: 'Rose' });
      expect(screen.getByTestId('first-run-wizard')).toHaveAttribute('data-circle-name', 'Rose');
    });

    it('stays shut on a plain visit', () => {
      setCircle();
      renderOverview();
      expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument();
    });

    // The circle detail's own name wins once it lands; the navigation-carried
    // name only covers the seconds before it does.
    it('prefers the loaded recipient name over the one carried on the navigation', () => {
      setCircle({ recipientName: 'Rose Meza' });
      renderOverview({ firstRun: true, firstRunRecipientName: 'Rose' });
      expect(screen.getByTestId('first-run-wizard')).toHaveAttribute(
        'data-circle-name',
        'Rose Meza'
      );
    });
  });

  it('shows a hero placeholder rather than an empty name while the circle loads', () => {
    setCircle({ circle: null, isLoading: true });
    renderOverview();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
