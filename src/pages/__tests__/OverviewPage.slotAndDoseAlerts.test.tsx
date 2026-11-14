import { useSyncExternalStore } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import OverviewPage from '@/pages/OverviewPage';
import { useCircle } from '@/hooks/useCircle';
import { useNextUp, type UseNextUpResult } from '@/hooks/useNextUp';
import { useNextStep } from '@/hooks/useNextStep';
import { useAnswerDoseAlerts, useDoseAlerts, type DoseAlertsView } from '@/hooks/useDoseAlerts';
import { useAuthStore } from '@/store/authStore';
import { useDoseAlertsResumedStore } from '@/store/doseAlertsResumedStore';
import { Analytics, __resetDoseAlertsNoticeShownForTests } from '@/lib/analytics';
import { resetLargeTextReports } from '@/hooks/useLargeTextLayout';
import type { NextUpItem } from '@/components/overview/nextUpItems';
import type { DoseAlertsState } from '@/api/doseAlerts';

// Today, 1.4.2:
//  - the SLOT landing (?slot_date=&slot_time=) from a grouped dose alert / "doses taken" summary;
//  - the quiet-circle notice as the ONE coaching element.

vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useEarnedUpsell', () => ({ useEarnedUpsell: vi.fn() }));
vi.mock('@/hooks/useNextUp', () => ({ useNextUp: vi.fn() }));
vi.mock('@/hooks/useNextStep', () => ({ useNextStep: vi.fn() }));
vi.mock('@/hooks/useDoseAlerts', () => ({ useDoseAlerts: vi.fn(), useAnswerDoseAlerts: vi.fn() }));
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
    NextUp: ({ landing }: { landing?: { key: string; keys?: string[]; entry: string } | null }) => (
      <div
        data-testid="next-up"
        data-landing-key={landing?.key ?? ''}
        data-landing-keys={(landing?.keys ?? []).join(',')}
        data-landing-entry={landing?.entry ?? ''}
      />
    ),
  };
});

const DATE = '2026-11-20';
function dose(id: string, time = '08:00:00', date = DATE): NextUpItem {
  return {
    key: `medication:${id}`,
    type: 'medication',
    id,
    title: id,
    detail: null,
    time,
    date,
    late: false,
    lateHours: null,
    med: { id, event_type: 'medication', title: id, scheduled_date: date, scheduled_time: time } as NextUpItem['med'],
  };
}

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

const NOT_PAUSED: DoseAlertsState = { paused: false, paused_since: null, answer: null, can_answer: true };
const PAUSED: DoseAlertsState = {
  paused: true,
  paused_since: '2026-11-13T17:00:00.000Z',
  answer: null,
  can_answer: true,
};
let doseAlertsView: DoseAlertsView;
function setDoseAlerts(state: DoseAlertsState | null, over: Partial<DoseAlertsView> = {}): void {
  doseAlertsView = { state, settled: state !== null, isError: false, refetch: vi.fn(), ...over };
}
const mutateAsync = vi.fn();

function Probe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="where" data-path={location.pathname} data-search={location.search} />;
}
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
      <Routes>
        <Route path="/circles/:circleId" element={<OverviewPage />} />
        <Route path="/circles/:circleId/calendar" element={<div data-testid="calendar-page" />} />
        <Route path="/circles/:circleId/routine-check-in" element={<div data-testid="checkin-page" />} />
      </Routes>
    </MemoryRouter>
  );
}
const where = () => {
  const el = screen.getByTestId('where');
  return { path: el.dataset.path!, search: el.dataset.search! };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  resetLargeTextReports();
  __resetDoseAlertsNoticeShownForTests();
  useDoseAlertsResumedStore.setState({ resumed: {} });
  vi.mocked(useNextUp).mockImplementation(useNextUpStore);
  setNextUp([]);
  setDoseAlerts(NOT_PAUSED);
  vi.mocked(useDoseAlerts).mockImplementation(() => doseAlertsView);
  mutateAsync.mockResolvedValue({ ...NOT_PAUSED, resumed: true });
  vi.mocked(useAnswerDoseAlerts).mockReturnValue({ mutateAsync, isPending: false } as never);
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
  vi.spyOn(Analytics, 'doseAlertsNoticeShown').mockImplementation(() => {});
  vi.spyOn(Analytics, 'routineCheckinAnswered').mockImplementation(() => {});
});

describe('Today slot landing (grouped dose alert / doses taken summary)', () => {
  it('P grouped push opens Today on the right slot: every 8:00 dose is revealed, focus on the first', () => {
    setNextUp([dose('a', '07:00:00'), dose('b'), dose('c'), dose('d', '08:05:00'), dose('e')]);
    renderAt(`/circles/c1?slot_date=${DATE}&slot_time=08:00:00`);
    const next = screen.getByTestId('next-up');
    expect(next.dataset.landingKey).toBe('medication:b');
    expect(next.dataset.landingKeys).toBe('medication:b,medication:c,medication:e');
    expect(next.dataset.landingEntry).toBe('inbox');
    // The params leave the URL: a refresh never replays the landing.
    expect(where()).toEqual({ path: '/circles/c1', search: '' });
  });

  it('N 8:00 and 8:05 are two slots; another day at 8:00 is not this slot', () => {
    setNextUp([dose('x', '08:05:00'), dose('y', '08:00:00', '2026-11-19'), dose('z')]);
    renderAt(`/circles/c1?slot_date=${DATE}&slot_time=08:00`);
    expect(screen.getByTestId('next-up').dataset.landingKeys).toBe('medication:z');
  });

  it('N none of the slot is left on Today (all marked): stays on Today, no fallback page', () => {
    setNextUp([dose('later', '20:00:00')]);
    renderAt(`/circles/c1?slot_date=${DATE}&slot_time=08:00:00`);
    expect(screen.getByTestId('next-up').dataset.landingKey).toBe('');
    expect(screen.queryByTestId('calendar-page')).not.toBeInTheDocument();
    expect(where()).toEqual({ path: '/circles/c1', search: '' });
  });

  it('waits for Next up, then lands', () => {
    setNextUp([], { settled: false });
    renderAt(`/circles/c1?slot_date=${DATE}&slot_time=08:00:00`);
    expect(where().search).toContain('slot_date=');
    act(() => setNextUp([dose('b'), dose('c')]));
    expect(screen.getByTestId('next-up').dataset.landingKeys).toBe('medication:b,medication:c');
    expect(where().search).toBe('');
  });

  it('N unusable slot params: plain Today, params removed, nothing landed', () => {
    setNextUp([dose('b')]);
    renderAt('/circles/c1?slot_date=2026-02-30&slot_time=08:00:00');
    expect(screen.getByTestId('next-up').dataset.landingKey).toBe('');
    expect(where()).toEqual({ path: '/circles/c1', search: '' });
  });
});

describe('Today quiet-circle notice', () => {
  it('N paused:false: no notice, coaching as before', () => {
    vi.mocked(useNextStep).mockReturnValue({
      status: 'step',
      step: 'first_med',
      position: 1,
      total: 3,
      snooze: vi.fn(),
    });
    renderAt('/circles/c1');
    expect(screen.queryByTestId('dose-alerts-notice-today')).not.toBeInTheDocument();
    expect(screen.getByTestId('next-step-card')).toBeInTheDocument();
    expect(Analytics.doseAlertsNoticeShown).not.toHaveBeenCalled();
  });

  it('P paused: the notice is the ONE coaching element (outranks the next step) and today_viewed says so', () => {
    setDoseAlerts(PAUSED);
    vi.mocked(useNextStep).mockReturnValue({
      status: 'step',
      step: 'first_med',
      position: 1,
      total: 3,
      snooze: vi.fn(),
    });
    renderAt('/circles/c1');
    const notice = screen.getByTestId('dose-alerts-notice-today');
    expect(within(notice).getByRole('heading', { name: 'Follow-up alerts are paused' })).toBeInTheDocument();
    expect(screen.queryByTestId('next-step-card')).not.toBeInTheDocument();
    expect(Analytics.doseAlertsNoticeShown).toHaveBeenCalledWith({ surface: 'today', canAnswer: true });
    expect(vi.mocked(Analytics.todayViewed).mock.calls[0][0].coaching).toBe('dose_alerts');
  });

  it('coaching waits for the dose-alerts read (no card swapped under the pointer)', () => {
    setDoseAlerts(null);
    vi.mocked(useNextStep).mockReturnValue({
      status: 'step',
      step: 'first_med',
      position: 1,
      total: 3,
      snooze: vi.fn(),
    });
    renderAt('/circles/c1');
    expect(screen.queryByTestId('next-step-card')).not.toBeInTheDocument();
    expect(Analytics.todayViewed).not.toHaveBeenCalled();
  });

  it('a failed read is "not paused": no notice, coaching shows', () => {
    setDoseAlerts(NOT_PAUSED, { isError: true, settled: true });
    vi.mocked(useNextStep).mockReturnValue({
      status: 'step',
      step: 'first_med',
      position: 1,
      total: 3,
      snooze: vi.fn(),
    });
    renderAt('/circles/c1');
    expect(screen.queryByTestId('dose-alerts-notice-today')).not.toBeInTheDocument();
    expect(screen.getByTestId('next-step-card')).toBeInTheDocument();
  });

  it('P "Turn alerts back on" posts still_giving with source notice, hides the notice, says "Alerts are on" and keeps focus', async () => {
    const user = userEvent.setup();
    setDoseAlerts(PAUSED);
    renderAt('/circles/c1');
    mutateAsync.mockImplementation(async () => {
      // The hook writes the response into the cache and marks the resume (useAnswerDoseAlerts).
      setDoseAlerts(NOT_PAUSED);
      useDoseAlertsResumedStore.getState().markResumed('c1');
      return { ...NOT_PAUSED, resumed: true };
    });
    await user.click(screen.getByRole('button', { name: 'Turn alerts back on' }));
    expect(mutateAsync).toHaveBeenCalledWith({ answer: 'still_giving', source: 'notice' });
    expect(screen.queryByTestId('dose-alerts-notice-today')).not.toBeInTheDocument();
    const line = screen.getByTestId('dose-alerts-resumed-today');
    expect(line).toHaveTextContent('Alerts are on');
    expect(line).toHaveAttribute('role', 'status');
    // The pressed button unmounted: focus lands on the confirmation, never on <body>.
    expect(document.activeElement).toBe(line);
    expect(Analytics.routineCheckinAnswered).toHaveBeenCalledWith({
      answer: 'still_giving',
      source: 'notice',
      isOwner: true,
    });
  });

  it('"Has the routine changed?" opens the check-in with source notice', async () => {
    const user = userEvent.setup();
    setDoseAlerts(PAUSED);
    renderAt('/circles/c1');
    await user.click(screen.getByRole('button', { name: 'Has the routine changed?' }));
    expect(screen.getByTestId('checkin-page')).toBeInTheDocument();
    expect(where().path).toBe('/circles/c1/routine-check-in');
  });

  it('N view-only: the notice shows with NO buttons', () => {
    setDoseAlerts({ ...PAUSED, can_answer: false });
    renderAt('/circles/c1');
    const notice = screen.getByTestId('dose-alerts-notice-today');
    expect(notice).toHaveTextContent('Follow-up alerts are paused');
    expect(within(notice).queryAllByRole('button')).toHaveLength(0);
    expect(Analytics.doseAlertsNoticeShown).toHaveBeenCalledWith({ surface: 'today', canAnswer: false });
  });

  it('keep_paused reads as acknowledged and keeps "Turn alerts back on"', () => {
    setDoseAlerts({ ...PAUSED, answer: 'keep_paused' });
    renderAt('/circles/c1');
    const notice = screen.getByTestId('dose-alerts-notice-today');
    expect(notice).toHaveTextContent('You chose to keep follow-up alerts paused for now.');
    expect(within(notice).getByRole('button', { name: 'Turn alerts back on' })).toBeInTheDocument();
  });

  it('N no mark-all action anywhere on the notice (only resume and the check-in link)', () => {
    setDoseAlerts(PAUSED);
    renderAt('/circles/c1');
    const names = within(screen.getByTestId('dose-alerts-notice-today'))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['Turn alerts back on', 'Has the routine changed?']);
    expect(document.body.textContent ?? '').not.toMatch(/mark all|all taken/i);
  });
});
