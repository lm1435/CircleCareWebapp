import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import RoutineCheckInPage, { checkinSourceFromState, formatPausedSince } from '@/pages/RoutineCheckInPage';
import { useCircle } from '@/hooks/useCircle';
import { useAnswerDoseAlerts, useDoseAlerts, type DoseAlertsView } from '@/hooks/useDoseAlerts';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';
import type { DoseAlertsState } from '@/api/doseAlerts';

// The routine check-in (quiet-circle back-off 1.4.2): three answers, each calling
// POST /dose-alerts/answer with how the page was opened, then landing where the contract says.

vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useDoseAlerts', () => ({ useDoseAlerts: vi.fn(), useAnswerDoseAlerts: vi.fn() }));
vi.mock('@/components/layout/PageMasthead', () => ({
  PageMasthead: ({ section, title }: { section: string; title: string }) => (
    <header>
      <span>{section}</span>
      <h1>{title}</h1>
    </header>
  ),
}));

const PAUSED: DoseAlertsState = {
  paused: true,
  paused_since: '2026-12-01T17:00:00.000Z',
  answer: null,
  can_answer: true,
};
let view: DoseAlertsView;
const setView = (state: DoseAlertsState | null, over: Partial<DoseAlertsView> = {}) => {
  view = { state, settled: state !== null, isError: false, refetch: vi.fn(), ...over };
};
const mutateAsync = vi.fn();

function Probe(): React.ReactElement {
  const l = useLocation();
  return <div data-testid="where" data-path={l.pathname} />;
}
function renderAt(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/circles/c1/routine-check-in', state }]}>
      <Probe />
      <Routes>
        <Route path="/circles/:circleId/routine-check-in" element={<RoutineCheckInPage />} />
        <Route path="/circles/:circleId" element={<div data-testid="today" />} />
        <Route path="/circles/:circleId/meds" element={<div data-testid="meds" />} />
      </Routes>
    </MemoryRouter>
  );
}
const circle = (over: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) =>
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c1', owner_id: 'u1', recipient_name: 'Rose', is_self_care: false, ...over },
    members: [],
    timezone: 'America/New_York',
    isOwner: true,
    ...rest,
  } as unknown as ReturnType<typeof useCircle>);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
    isAuthenticated: true,
  });
  circle();
  setView(PAUSED);
  vi.mocked(useDoseAlerts).mockImplementation(() => view);
  mutateAsync.mockResolvedValue({ ...PAUSED, resumed: false });
  vi.mocked(useAnswerDoseAlerts).mockReturnValue({ mutateAsync, isPending: false } as never);
  vi.spyOn(Analytics, 'routineCheckinOpened').mockImplementation(() => {});
  vi.spyOn(Analytics, 'routineCheckinAnswered').mockImplementation(() => {});
});

const where = () => screen.getByTestId('where').dataset.path;

describe('RoutineCheckInPage', () => {
  it('asks the question with the three answers and their hints (caregiver copy), and "Paused since"', () => {
    renderAt({ checkinSource: 'inbox' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Has Rose's routine changed?");
    expect(screen.getByText(/Routines change: a hospital stay/)).toBeInTheDocument();
    expect(screen.getByTestId('routine-checkin-since')).toHaveTextContent('Paused since Dec 1');
    const answers = within(screen.getByTestId('routine-checkin-answers')).getAllByRole('button');
    // The hint is inside each button's accessible name (no aria-label swallowing it).
    expect(answers.map((b) => b.textContent)).toEqual([
      "We're still giving theseAlerts come back right away.",
      'The routine changedUpdate or discontinue medications',
      'Keep alerts paused for nowTurn them back on anytime from Today.',
    ]);
    expect(Analytics.routineCheckinOpened).toHaveBeenCalledWith({ source: 'inbox', isOwner: true });
  });

  it("self-care: \"your routine\" and \"I'm still taking these\"", () => {
    circle({ is_self_care: true });
    renderAt();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Has your routine changed?');
    expect(screen.getByRole('button', { name: /I'm still taking these/ })).toBeInTheDocument();
  });

  it('P still_giving calls the endpoint with the source and lands on Today', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ paused: false, paused_since: null, answer: null, can_answer: true, resumed: true });
    renderAt({ checkinSource: 'inbox' });
    await user.click(screen.getByTestId('routine-checkin-still_giving'));
    expect(mutateAsync).toHaveBeenCalledWith({ answer: 'still_giving', source: 'inbox' });
    expect(where()).toBe('/circles/c1');
    expect(Analytics.routineCheckinAnswered).toHaveBeenCalledWith({
      answer: 'still_giving',
      source: 'inbox',
      isOwner: true,
    });
  });

  it('P routine_changed lands on the meds list', async () => {
    const user = userEvent.setup();
    renderAt({ checkinSource: 'notice' });
    await user.click(screen.getByTestId('routine-checkin-routine_changed'));
    expect(mutateAsync).toHaveBeenCalledWith({ answer: 'routine_changed', source: 'notice' });
    expect(where()).toBe('/circles/c1/meds');
  });

  it('P keep_paused lands on Today; a link (no state) reports source "link"', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByTestId('routine-checkin-keep_paused'));
    expect(mutateAsync).toHaveBeenCalledWith({ answer: 'keep_paused', source: 'link' });
    expect(where()).toBe('/circles/c1');
    expect(Analytics.routineCheckinOpened).toHaveBeenCalledWith({ source: 'link', isOwner: true });
  });

  it('a failed answer stays on the page with the error and the buttons', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue({ error: { code: 'SERVER_ERROR' } });
    renderAt();
    await user.click(screen.getByTestId('routine-checkin-still_giving'));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your answer. Try again.");
    expect(where()).toBe('/circles/c1/routine-check-in');
    expect(screen.getAllByRole('button')).not.toHaveLength(0);
    expect(Analytics.routineCheckinAnswered).not.toHaveBeenCalled();
  });

  it('a 403 VIEW_ONLY answer re-reads the state instead of showing an error', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue({ error: { code: 'VIEW_ONLY' } });
    renderAt();
    await user.click(screen.getByTestId('routine-checkin-still_giving'));
    expect(view.refetch).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('N view-only: the question shows but NO answers, and nothing can be posted', () => {
    setView({ ...PAUSED, can_answer: false });
    renderAt({ checkinSource: 'inbox' });
    expect(screen.getByText(/Routines change/)).toBeInTheDocument();
    expect(screen.getByTestId('routine-checkin-view-only')).toHaveTextContent(
      'Caregivers who can make changes in this circle can answer this.'
    );
    expect(screen.queryByTestId('routine-checkin-answers')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('N not paused (already answered / resumed): "Alerts are on", no stale answer buttons', async () => {
    const user = userEvent.setup();
    setView({ paused: false, paused_since: null, answer: null, can_answer: true });
    renderAt();
    expect(screen.getByTestId('routine-checkin-alerts-on')).toHaveTextContent('Alerts are on');
    expect(screen.queryByTestId('routine-checkin-answers')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to Today' }));
    expect(where()).toBe('/circles/c1');
  });

  it('a failed read offers a retry (never a blank page)', async () => {
    const user = userEvent.setup();
    setView({ paused: false, paused_since: null, answer: null, can_answer: false }, { isError: true });
    renderAt();
    expect(screen.getByText("Couldn't load this right now.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(view.refetch).toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('checkinSourceFromState: only the closed set, else link', () => {
    expect(checkinSourceFromState({ checkinSource: 'inbox' })).toBe('inbox');
    expect(checkinSourceFromState({ checkinSource: 'notice' })).toBe('notice');
    expect(checkinSourceFromState({ checkinSource: 'evil' })).toBe('link');
    expect(checkinSourceFromState(null)).toBe('link');
  });
  it('formatPausedSince uses the circle zone', () => {
    // 03:00 UTC on Dec 2 is still Dec 1 in New York.
    expect(formatPausedSince('2026-12-02T03:00:00.000Z', 'America/New_York', 'en')).toBe('Dec 1');
    expect(formatPausedSince('not a date', 'America/New_York', 'en')).toBe('');
  });
});
