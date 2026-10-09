import { render, screen, waitFor, within } from '@testing-library/react';
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

function dose(
  id: string,
  name: string,
  status: 'taken' | 'taken_late' | 'skipped' | 'not_marked' | 'upcoming',
  by: string | null,
  at: string | null = null
) {
  return {
    event_id: id,
    medication_id: id === 'd1' ? 'm1' : `m-${id}`,
    medication_name: name,
    dosage: null,
    time: status === 'upcoming' ? '21:00' : '13:00',
    status,
    marked_by_name: by,
    marked_at: at,
  };
}

/** The B2 evening with every Contract v2 detail field. */
function full(date: string): DailyUpdateData {
  return payload({
    date,
    is_today: date === '2026-10-08',
    doses: { taken: 1, taken_late: 1, skipped: 1, not_marked: 0, upcoming: 1 },
    tasks: { done: 2 },
    appointments: { past_count: 1 },
    notes: { count: 2, authors: ['Ana'], more_authors: 1 },
    still_to_do: [
      { kind: 'dose', id: 'e9', title: 'Escitalopram', time: '21:00', status: 'upcoming' },
      { kind: 'task', id: 't9', title: 'Call the pharmacy', time: null, status: 'open' },
    ],
    doses_detail: [
      dose('d1', 'Sertraline', 'taken', 'Ana'),
      dose('d2', 'Metformin', 'taken_late', 'Luis', '14:10'),
      dose('d3', 'Vitamin D', 'skipped', 'Luis'),
      dose('d4', 'Escitalopram', 'upcoming', null),
    ],
    tasks_done_detail: [
      { event_id: 'k1', title: 'Groceries', completed_by_name: 'Luis', completed_at: '11:20' },
      { event_id: null, title: 'Gone task', completed_by_name: 'Ana', completed_at: '16:05' },
    ],
    appointments_detail: [{ event_id: 'a1', title: 'Dr. Patel', time: '10:30', location: null }],
    notes_detail: [
      { note_id: 'n1', kind: 'care', event_id: null, author_name: 'Ana', created_at: '16:10', excerpt: 'Ate well.' },
      { note_id: 'n2', kind: 'event', event_id: 'a1', author_name: null, created_at: '11:00', excerpt: 'BP fine.' },
    ],
    nav: date === '2026-10-08' ? { prev_date: '2026-10-07', next_date: null } : undefined,
  });
}

let respond: (date: string) => unknown = (date) => ({
  success: true,
  data: payload({ date, is_today: date === '2026-10-08' }),
});

function renderAt(
  entry: string | { pathname: string; search?: string; hash?: string; state?: unknown }
) {
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

  it('today: date title, "Daily update" eyebrow, arrows (prev only + "Today"), sentence, glance', async () => {
    renderAt('/circles/c1/daily-update');
    expect(await screen.findByText('A smooth day for Rose.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Thursday, Oct 8' })).toBeInTheDocument();
    expect(screen.getByTestId('eyebrow')).toHaveTextContent('Daily update');
    expect(screen.getByTestId('daily-update-glance')).toHaveTextContent('2 of 2 doses taken so far');
    const nav = screen.getByRole('navigation', { name: 'Other days' });
    const prev = within(nav).getByRole('link', { name: 'Previous day, Wed, Oct 7' });
    expect(prev).toHaveAttribute('href', '/circles/c1/daily-update/2026-10-07');
    expect(within(nav).getByText('Today')).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Next day/ })).toBeNull();
    expect(calls()[0][1]).toEqual({ params: { date: '2026-10-08' } });
    expect(Analytics.dailyUpdateOpened).toHaveBeenCalledWith('link', false);
  });

  it('from the card: source "card"', async () => {
    renderAt({ pathname: '/circles/c1/daily-update', state: { dailyUpdateSource: 'card' } });
    await screen.findByText('A smooth day for Rose.');
    expect(Analytics.dailyUpdateOpened).toHaveBeenCalledTimes(1);
    expect(Analytics.dailyUpdateOpened).toHaveBeenCalledWith('card', false);
  });

  it('today: section cards in order, Still to do first, every item row linked to its detail', async () => {
    respond = (date) => ({ success: true, data: full(date) });
    renderAt('/circles/c1/daily-update');
    await screen.findByText('A steady day for Rose.');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Still to do',
      'Medications',
      'Tasks',
      'Appointments',
      'Notes',
    ]);
    expect(screen.getByTestId('daily-update-glance')).toHaveTextContent(
      '2 of 3 doses taken so far · 1 skipped · 1 to come'
    );
    const still = screen.getByRole('region', { name: 'Still to do' });
    expect(within(still).getByText('Escitalopram')).toBeInTheDocument();
    expect(within(still).getByText('Coming up')).toBeInTheDocument();
    expect(within(still).getByText('Open task')).toBeInTheDocument();
    // Still-to-do rows are not pressable (contract: ids are list keys only).
    expect(within(still).queryAllByRole('link')).toHaveLength(0);

    const meds = screen.getByRole('region', { name: 'Medications' });
    // The upcoming dose is under Still to do only: never listed twice.
    expect(within(meds).queryByText('Escitalopram')).toBeNull();
    expect(within(meds).getByRole('link', { name: /Sertraline/ })).toHaveAttribute(
      'href',
      '/circles/c1/meds?medication=m1'
    );
    expect(within(meds).getByText('Taken by Ana')).toBeInTheDocument();
    expect(within(meds).getByText('Taken by Luis at 2:10 PM, a little late')).toBeInTheDocument();
    expect(within(meds).getByText('Skipped by Luis')).toBeInTheDocument();

    const tasks = screen.getByRole('region', { name: 'Tasks' });
    expect(within(tasks).getByRole('link', { name: /Groceries/ })).toHaveAttribute(
      'href',
      '/circles/c1/calendar?eventId=k1'
    );
    expect(within(tasks).getByText('Done by Luis')).toBeInTheDocument();
    // A task whose row is gone is plain text, no link.
    expect(within(tasks).getByText('Gone task')).toBeInTheDocument();
    expect(within(tasks).queryByRole('link', { name: /Gone task/ })).toBeNull();

    expect(
      within(screen.getByRole('region', { name: 'Appointments' })).getByRole('link', {
        name: /Dr\. Patel/,
      })
    ).toHaveAttribute('href', '/circles/c1/calendar?date=2026-10-08&eventId=a1');

    const notes = screen.getByRole('region', { name: 'Notes' });
    expect(within(notes).getByRole('link', { name: /Ana/ })).toHaveAttribute(
      'href',
      '/circles/c1/notes?date=2026-10-08'
    );
    expect(within(notes).getByRole('link', { name: /A former member/ })).toHaveAttribute(
      'href',
      '/circles/c1/calendar?eventId=a1&panel=notes'
    );
  });

  it('#tasks lands on the Tasks section and focuses its heading', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    respond = (date) => ({ success: true, data: full(date) });
    renderAt({ pathname: '/circles/c1/daily-update', hash: '#tasks' });
    await screen.findByText('A steady day for Rose.');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Tasks' }))
    );
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('a past day: date title, both arrows, no Still to do, unmarked doses under Medications', async () => {
    respond = (date) => ({
      success: true,
      data: {
        ...full(date),
        is_today: false,
        doses: { taken: 3, taken_late: 0, skipped: 0, not_marked: 1, upcoming: 0 },
        doses_detail: [
          dose('d1', 'Sertraline', 'taken', 'Ana'),
          dose('d4', 'Escitalopram', 'not_marked', null),
        ],
        nav: undefined,
      },
    });
    renderAt('/circles/c1/daily-update/2026-10-07');
    expect(await screen.findByRole('heading', { level: 1, name: 'Wednesday, Oct 7' })).toBeInTheDocument();
    expect(screen.getByTestId('eyebrow')).toHaveTextContent('Daily update');
    expect(screen.getByTestId('daily-update-glance')).toHaveTextContent(
      '3 of 4 doses taken · 1 not marked'
    );
    expect(screen.queryByRole('heading', { name: 'Still to do' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Medications' })).getByText('Not marked')
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Other days' });
    expect(within(nav).getByRole('link', { name: 'Previous day, Tue, Oct 6' })).toHaveAttribute(
      'href',
      '/circles/c1/daily-update/2026-10-06'
    );
    expect(within(nav).getByRole('link', { name: 'Next day, Thu, Oct 8' })).toHaveAttribute(
      'href',
      '/circles/c1/daily-update/2026-10-08'
    );
    expect(calls()[0][1]).toEqual({ params: { date: '2026-10-07' } });
    expect(Analytics.dailyUpdateOpened).toHaveBeenCalledWith('link', true);
  });

  it('the oldest day in range has no previous arrow', async () => {
    respond = (date) => ({ success: true, data: payload({ date, is_today: false }) });
    renderAt('/circles/c1/daily-update/2026-10-01');
    await screen.findByText('A smooth day for Rose.');
    const nav = screen.getByRole('navigation', { name: 'Other days' });
    expect(within(nav).queryByRole('link', { name: /Previous day/ })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Next day, Fri, Oct 2' })).toBeInTheDocument();
  });

  it('an older backend (counts only): sentence + glance + Still to do, no item sections', async () => {
    respond = (date) => ({
      success: true,
      data: payload({
        date,
        doses: { taken: 1, taken_late: 0, skipped: 0, not_marked: 0, upcoming: 1 },
        tasks: { done: 2 },
        still_to_do: [
          { kind: 'dose', id: 'e9', title: 'Escitalopram', time: '21:00', status: 'upcoming' },
        ],
        still_to_do_more: 2,
      }),
    });
    renderAt('/circles/c1/daily-update');
    await screen.findByText('A smooth day for Rose.');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Still to do',
    ]);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('accepts ?date= too', async () => {
    renderAt({ pathname: '/circles/c1/daily-update', search: '?date=2026-10-02' });
    await screen.findByText('A smooth day for Rose.');
    expect(calls()[0][1]).toEqual({ params: { date: '2026-10-02' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Friday, Oct 2' })).toBeInTheDocument();
  });

  it('a past day with nothing recorded: "Nothing was recorded for Rose."', async () => {
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
    expect(await screen.findByText('Nothing was recorded for Rose.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByTestId('daily-update-glance')).toBeNull();
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
    await screen.findByText('A smooth day for Rose.');
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
    expect(await screen.findByText('A smooth day for Rose.')).toBeInTheDocument();
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
    respond = (date) => ({ success: true, data: { ...full(date), is_today: false } });
    renderAt('/circles/c1/daily-update/2026-10-07');
    expect(await screen.findByRole('heading', { level: 1, name: 'Miércoles, 7 oct' })).toBeInTheDocument();
    expect(screen.getByTestId('eyebrow')).toHaveTextContent('Resumen del día');
    expect(screen.getByText('Un día estable para Rose.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Medicamentos' })).toBeInTheDocument();
    expect(screen.getByText('Tomada, marcó Ana')).toBeInTheDocument();
    expect(screen.getByText('Hecha por Luis')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Día anterior, mar, 6 oct' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
