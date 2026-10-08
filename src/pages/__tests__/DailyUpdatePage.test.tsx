import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import type { DailyUpdateData } from '@/api/dailyUpdate';
import DailyUpdatePage from '../DailyUpdatePage';

/**
 * Full update / dated view (plan §5.4, §6, §8.3). The route takes `:date` or `?date=`
 * within the last 7 recipient-local days.
 */
vi.mock('@/lib/analytics', () => ({ Analytics: { dailyUpdateOpened: vi.fn() } }));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/components/layout/PageMasthead', () => ({
  PageMasthead: ({ section, title, backTo }: { section: string; title: string; backTo?: string }) => (
    <header>
      <span data-testid="eyebrow">{section}</span>
      <h1>{title}</h1>
      <a href={backTo}>back</a>
    </header>
  ),
}));

const TZ = 'America/New_York';
const get = vi.mocked(apiClient.get);

function payload(over: Partial<DailyUpdateData> = {}): DailyUpdateData {
  return {
    enabled: true,
    date: '2026-10-08',
    is_today: true,
    timezone: TZ,
    window: { opens_at: '2026-10-08T23:00:00Z', closes_at: '2026-10-09T04:00:00Z' },
    eligible: true,
    has_activity: true,
    recipient_name: 'Rose',
    is_solo: false,
    doses: { taken: 2, taken_late: 0, skipped: 0, not_marked: 0, upcoming: 0 },
    as_needed: null,
    tasks: { done: 0 },
    appointments: { past_count: 0 },
    notes: { count: 0, authors: [], more_authors: 0 },
    still_to_do: [],
    still_to_do_more: 0,
    ...over,
  };
}

let respond: (date: string) => unknown = (date) => ({
  success: true,
  data: payload({ date, is_today: date === '2026-10-08' }),
});

function renderAt(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/circles/:circleId/daily-update" element={<DailyUpdatePage />} />
          <Route path="/circles/:circleId/daily-update/:date" element={<DailyUpdatePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const calls = () => get.mock.calls.filter(([url]) => url === '/circles/c1/daily-update');

describe('DailyUpdatePage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z')); // 20:00 EDT, Oct 8
    respond = (date) => ({ success: true, data: payload({ date, is_today: date === '2026-10-08' }) });
    get.mockImplementation(async (url: string, cfg?: { params?: unknown }) => {
      if (url === '/circles/c1/daily-update') {
        const r = respond((cfg?.params as { date?: string } | undefined)?.date ?? '');
        if (r instanceof Error || (r as { success?: boolean }).success === false) throw r;
        return r as never;
      }
      throw new Error(`unexpected GET ${url}`);
    });
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', recipient_name: 'Rose' },
      members: [{ id: 'u1', is_care_recipient: false }],
      timezone: TZ,
    } as unknown as ReturnType<typeof useCircle>);
    useAuthStore.setState({
      user: { id: 'u1', email: 'p@example.com', first_name: 'P', last_name: 'L' },
      isAuthenticated: true,
    });
    await i18n.changeLanguage('en');
  });
  afterEach(() => vi.useRealTimers());

  it('today: "{{name}}\'s day" with "Today so far" / "Still to do"', async () => {
    renderAt('/circles/c1/daily-update');
    expect(await screen.findByText('2 doses taken')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: "Rose's day" })).toBeInTheDocument();
    expect(screen.getByTestId('eyebrow')).toHaveTextContent('Daily update');
    expect(screen.getByRole('heading', { level: 2, name: 'Today so far' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Still to do' })).toBeInTheDocument();
    expect(screen.getByText('Nothing else on the schedule today.')).toBeInTheDocument();
    expect(calls()[0][1]).toEqual({ params: { date: '2026-10-08' } });
    expect(Analytics.dailyUpdateOpened).toHaveBeenCalledWith('link', false);
  });

  it('from the card: source "card"', async () => {
    renderAt({ pathname: '/circles/c1/daily-update', state: { dailyUpdateSource: 'card' } });
    await screen.findByText('2 doses taken');
    expect(Analytics.dailyUpdateOpened).toHaveBeenCalledTimes(1);
    expect(Analytics.dailyUpdateOpened).toHaveBeenCalledWith('card', false);
  });

  it('a past day: date heading, name eyebrow, "What happened" / "Not done that day"', async () => {
    respond = (date) => ({
      success: true,
      data: payload({
        date,
        is_today: false,
        doses: { taken: 1, taken_late: 0, skipped: 0, not_marked: 1, upcoming: 0 },
        still_to_do: [
          { kind: 'dose', id: 'e2', title: 'Lisinopril', time: '19:30', status: 'not_marked' },
          { kind: 'task', id: 't1', title: 'Groceries', time: null, status: 'open' },
        ],
      }),
    });
    renderAt('/circles/c1/daily-update/2026-10-07');
    expect(await screen.findByRole('heading', { level: 1, name: 'Wednesday, Oct 7' })).toBeInTheDocument();
    expect(screen.getByTestId('eyebrow')).toHaveTextContent("Rose's day");
    expect(screen.getByRole('heading', { level: 2, name: 'What happened' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Not done that day' })).toBeInTheDocument();
    expect(screen.getByText('1 dose not marked')).toBeInTheDocument();
    expect(screen.getByText('7:30 PM · Lisinopril · Not marked')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(calls()[0][1]).toEqual({ params: { date: '2026-10-07' } });
    expect(Analytics.dailyUpdateOpened).toHaveBeenCalledWith('link', true);
  });

  it('a past day with everything done says so', async () => {
    respond = (date) => ({ success: true, data: payload({ date, is_today: false }) });
    renderAt('/circles/c1/daily-update/2026-10-06');
    expect(await screen.findByText('Everything on the schedule was done.')).toBeInTheDocument();
  });

  it('accepts ?date= too', async () => {
    renderAt({ pathname: '/circles/c1/daily-update', search: '?date=2026-10-02' });
    await screen.findByText('2 doses taken');
    expect(calls()[0][1]).toEqual({ params: { date: '2026-10-02' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Friday, Oct 2' })).toBeInTheDocument();
  });

  it('a past day with nothing recorded: "Nothing was recorded on this day."', async () => {
    respond = (date) => ({
      success: true,
      data: payload({
        date,
        is_today: false,
        has_activity: false,
        doses: { taken: 0, taken_late: 0, skipped: 0, not_marked: 0, upcoming: 0 },
      }),
    });
    renderAt('/circles/c1/daily-update/2026-10-05');
    expect(await screen.findByText('Nothing was recorded on this day.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it.each([
    ['more than 7 days back', '2026-09-30'],
    ['in the future', '2026-10-09'],
    ['malformed', '2026-10-7'],
    ['impossible', '2026-02-30'],
  ])('a date %s is unavailable without a request', async (_label, date) => {
    renderAt(`/circles/c1/daily-update/${date}`);
    expect(await screen.findByText('This update is no longer available.')).toBeInTheDocument();
    expect(calls()).toHaveLength(0);
  });

  it('7 days back is still available (recipient-local today, not the device\'s)', async () => {
    // 20:00 EDT Oct 8 is already Oct 9 in UTC; the bound is from the recipient's Oct 8.
    renderAt('/circles/c1/daily-update/2026-10-01');
    await screen.findByText('2 doses taken');
    expect(calls()).toHaveLength(1);
  });

  it.each(['DATE_OUT_OF_RANGE', 'VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND'])(
    'a %s answer from the server reads as unavailable (no retry offered)',
    async (code) => {
      respond = () => ({ success: false, error: { code, message: 'x' } });
      renderAt('/circles/c1/daily-update/2026-10-01');
      expect(await screen.findByText('This update is no longer available.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    }
  );

  it('the rollout switch off reads as unavailable', async () => {
    respond = () => ({ success: true, data: { enabled: false } });
    renderAt('/circles/c1/daily-update');
    expect(await screen.findByText('This update is no longer available.')).toBeInTheDocument();
  });

  it('a failure shows the error with a working retry', async () => {
    let fail = true;
    respond = (date) =>
      fail
        ? new Error('network')
        : { success: true, data: payload({ date }) };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/circles/c1/daily-update');
    // One automatic retry for a transient failure comes first (useDailyUpdate).
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent("We couldn't load the update. Try again.");
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('2 doses taken')).toBeInTheDocument();
  });

  it('waits for the recipient zone before asking (no placeholder-zone date)', async () => {
    vi.mocked(useCircle).mockReturnValue({
      circle: undefined,
      members: [],
      timezone: null,
    } as unknown as ReturnType<typeof useCircle>);
    renderAt('/circles/c1/daily-update');
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(calls()).toHaveLength(0);
  });

  it('renders the dated view in Spanish', async () => {
    await i18n.changeLanguage('es');
    respond = (date) => ({ success: true, data: payload({ date, is_today: false }) });
    renderAt('/circles/c1/daily-update/2026-10-07');
    expect(await screen.findByRole('heading', { level: 1, name: 'miércoles, 7 oct' })).toBeInTheDocument();
    expect(screen.getByTestId('eyebrow')).toHaveTextContent('El día de Rose');
    expect(screen.getByRole('heading', { level: 2, name: 'Lo que pasó' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Quedó pendiente ese día' })).toBeInTheDocument();
    expect(screen.getByText('2 dosis tomadas')).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
