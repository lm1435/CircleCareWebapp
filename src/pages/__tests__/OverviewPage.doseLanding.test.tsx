import { useSyncExternalStore } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import '@/i18n';
import OverviewPage from '@/pages/OverviewPage';
import { useCircle } from '@/hooks/useCircle';
import { useNextUp, type UseNextUpResult } from '@/hooks/useNextUp';
import { useNextStep } from '@/hooks/useNextStep';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/hooks/useLargeTextLayout';
import type { NextUpItem } from '@/components/overview/nextUpItems';

// Today's dose landing (?dose=&date=&time=, from an inbox row for a dose not marked yet):
// found -> NextUp is told which row to highlight and the params leave the URL; not found ->
// replace to the calendar event sheet; nothing happens before Next up has answered.

vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useEarnedUpsell', () => ({ useEarnedUpsell: vi.fn() }));
vi.mock('@/hooks/useNextUp', () => ({ useNextUp: vi.fn() }));
vi.mock('@/hooks/useNextStep', () => ({ useNextStep: vi.fn() }));
vi.mock('@/components/calendar/AddEventModal', () => ({ AddEventModal: () => null }));
vi.mock('@/components/overview/QuickAccess', () => ({ QuickAccess: () => null }));
vi.mock('@/components/overview/UpcomingAppointments', () => ({
  UpcomingAppointments: () => null,
  useHasUpcomingAppointments: () => false,
}));
vi.mock('@/components/overview/DailyUpdateCard', () => ({ DailyUpdateCard: () => null }));
vi.mock('@/components/overview/FirstMedMarkIt', () => ({ FirstMedMarkIt: () => null }));
vi.mock('@/components/circles/firstRun/FirstRunWizardModal', () => ({ FirstRunWizardModal: () => null }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({ useSubscriptionStatus: () => ({ data: undefined }) }));
vi.mock('@/components/overview/NextUp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/overview/NextUp')>();
  return {
    ...actual,
    NextUp: ({ landing }: { landing?: { key: string; entry: string } | null }) => (
      <div
        data-testid="next-up"
        data-landing-key={landing?.key ?? ''}
        data-landing-entry={landing?.entry ?? ''}
      />
    ),
  };
});

const DOSE = '11111111-1111-4111-8111-111111111111';
const DATE = '2026-10-29';

function item(id: string, over: Partial<NonNullable<NextUpItem['med']>> = {}): NextUpItem {
  return {
    key: `medication:${id}`,
    type: 'medication',
    id,
    title: id,
    detail: null,
    time: '08:00:00',
    date: DATE,
    late: false,
    lateHours: null,
    med: { id, event_type: 'medication', title: id, scheduled_date: DATE, scheduled_time: '08:00:00', ...over } as NextUpItem['med'],
  };
}

// A live store behind the mocked hook: Next up can "arrive" after the first render.
let nextUpState: UseNextUpResult;
const listeners = new Set<() => void>();
function setNextUp(items: NextUpItem[], over: Partial<UseNextUpResult> = {}): void {
  nextUpState = { items, settled: true, isError: false, today: DATE, refetch: vi.fn(), ...over };
  listeners.forEach((l) => l());
}
function useNextUpStore(): UseNextUpResult {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => nextUpState
  );
}

function Probe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="where" data-path={location.pathname} data-search={location.search} />;
}
function Hop({ to }: { to: string }): React.ReactElement {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      hop
    </button>
  );
}

function renderAt(url: string) {
  const ui = (
    <MemoryRouter initialEntries={[url]}>
      <Probe />
      <Hop to="/circles/c2" />
      <Routes>
        <Route path="/circles/:circleId" element={<OverviewPage />} />
        <Route path="/circles/:circleId/calendar" element={<div data-testid="calendar-page" />} />
      </Routes>
    </MemoryRouter>
  );
  return render(ui);
}

const where = (): { path: string; search: string } => {
  const el = screen.getByTestId('where');
  return { path: el.dataset.path!, search: el.dataset.search! };
};

describe('Today dose landing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNextUp).mockImplementation(useNextUpStore);
    localStorage.clear();
    sessionStorage.clear();
    resetLargeTextReports();
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'u1', recipient_name: 'Rose', is_self_care: false },
      members: [],
      timezone: 'America/New_York',
      isLoading: false,
      canEdit: true,
      viewOnly: false,
      isPremiumCircle: true,
      hasShifts: false,
      isOwner: true,
    } as unknown as ReturnType<typeof useCircle>);
    vi.mocked(useNextStep).mockReturnValue({ status: 'none' });
    vi.spyOn(Analytics, 'todayViewed').mockImplementation(() => {});
    vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
  });

  it('found: NextUp is told the row (entry inbox) and dose/date/time leave the URL', () => {
    setNextUp([item('other'), item(DOSE)]);
    renderAt(`/circles/c1?dose=${DOSE}&date=${DATE}&time=08:00:00`);
    const next = screen.getByTestId('next-up');
    expect(next.dataset.landingKey).toBe(`medication:${DOSE}`);
    expect(next.dataset.landingEntry).toBe('inbox');
    expect(where()).toEqual({ path: '/circles/c1', search: '' });
  });

  it('found through a virtual instance id', () => {
    setNextUp([item(`${DOSE}_${DATE}`)]);
    renderAt(`/circles/c1?dose=${DOSE}&date=${DATE}`);
    expect(screen.getByTestId('next-up').dataset.landingKey).toBe(`medication:${DOSE}_${DATE}`);
  });

  it('not found: replaces to the calendar event sheet', () => {
    setNextUp([item('other')]);
    renderAt(`/circles/c1?dose=${DOSE}&date=${DATE}&time=08:00:00`);
    expect(screen.getByTestId('calendar-page')).toBeInTheDocument();
    expect(where()).toEqual({ path: '/circles/c1/calendar', search: `?date=${DATE}&eventId=${DOSE}` });
  });

  it('not found without a date: ?eventId= alone', () => {
    setNextUp([]);
    renderAt(`/circles/c1?dose=${DOSE}`);
    expect(where()).toEqual({ path: '/circles/c1/calendar', search: `?eventId=${DOSE}` });
  });

  it('waits for Next up: nothing happens while it loads, then it resolves', () => {
    setNextUp([], { settled: false });
    renderAt(`/circles/c1?dose=${DOSE}&date=${DATE}`);
    expect(where().path).toBe('/circles/c1');
    expect(where().search).toContain('dose=');
    expect(screen.getByTestId('next-up').dataset.landingKey).toBe('');
    act(() => setNextUp([item(DOSE)]));
    expect(screen.getByTestId('next-up').dataset.landingKey).toBe(`medication:${DOSE}`);
    expect(where().search).toBe('');
  });

  it('an errored list that later recovers still resolves the landing', () => {
    setNextUp([], { isError: true });
    renderAt(`/circles/c1?dose=${DOSE}&date=${DATE}`);
    expect(where().search).toContain('dose=');
    act(() => setNextUp([]));
    expect(where().path).toBe('/circles/c1/calendar');
  });

  it('does not decide on an errored list', () => {
    setNextUp([], { isError: true });
    renderAt(`/circles/c1?dose=${DOSE}&date=${DATE}`);
    expect(where().path).toBe('/circles/c1');
    expect(where().search).toContain('dose=');
  });

  it('ignores an invalid dose id', () => {
    setNextUp([]);
    renderAt('/circles/c1?dose=not-a-uuid&date=2026-10-29');
    expect(where().path).toBe('/circles/c1');
    expect(screen.getByTestId('next-up').dataset.landingKey).toBe('');
  });

  it('no params: no landing and no navigation', () => {
    setNextUp([item(DOSE)]);
    renderAt('/circles/c1');
    expect(screen.getByTestId('next-up').dataset.landingKey).toBe('');
    expect(where()).toEqual({ path: '/circles/c1', search: '' });
  });

  it('a landing pending for one circle does not act for another when the page is reused', async () => {
    const user = userEvent.setup();
    setNextUp([], { settled: false });
    renderAt(`/circles/c1?dose=${DOSE}&date=${DATE}`);
    await user.click(screen.getByRole('button', { name: 'hop' }));
    expect(where().path).toBe('/circles/c2');
    act(() => setNextUp([])); // settled, and the dose is not there
    // No redirect to c1's (or c2's) calendar: that landing belonged to c1.
    expect(where().path).toBe('/circles/c2');
    expect(screen.queryByTestId('calendar-page')).not.toBeInTheDocument();
  });
});
