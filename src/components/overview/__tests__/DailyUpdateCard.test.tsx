import type { ReactElement } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { ToastProvider } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import type { DailyUpdateData } from '@/api/dailyUpdate';
import { DailyUpdateCard } from '../DailyUpdateCard';

/**
 * Home card twins of mobile's DailyUpdateCard cases (plan §8.2/§8.3), against the
 * §4.1 response contract with a mocked API and an injected clock.
 */
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    dailyUpdateCardShown: vi.fn(),
    dailyUpdateOpened: vi.fn(),
    dailyUpdateDismissed: vi.fn(),
    dailyUpdateTurnedOff: vi.fn(),
    dailyUpdateInviteTapped: vi.fn(),
    // The prefs mutation's onError reports through this.
    errorOccurred: vi.fn(),
  },
}));

const TZ = 'America/New_York';
const AT_2000 = '2026-10-09T00:00:00Z'; // 20:00 EDT on 2026-10-08
const AT_1859 = '2026-10-08T22:59:00Z';

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
    doses: { taken: 3, taken_late: 0, skipped: 1, not_marked: 1, upcoming: 1 },
    as_needed: null,
    tasks: { done: 2 },
    appointments: { past_count: 0 },
    notes: { count: 1, authors: ['Ana'], more_authors: 0 },
    still_to_do: [
      { kind: 'dose', id: 'e1', title: 'Metformin', time: '21:00:00', status: 'upcoming' },
      { kind: 'dose', id: 'e2', title: 'Lisinopril', time: '19:30:00', status: 'not_marked' },
    ],
    still_to_do_more: 0,
    doses_detail: [],
    tasks_done_detail: [
      { event_id: 'k1', title: 'Groceries', completed_by_name: 'Luis', completed_at: '11:20' },
      { event_id: 'k2', title: 'Pick up the refill', completed_by_name: 'Ana', completed_at: '16:05' },
    ],
    appointments_detail: [],
    notes_detail: [
      {
        note_id: 'n1',
        kind: 'care',
        event_id: null,
        author_name: 'Ana',
        created_at: '16:10',
        excerpt: 'Rose ate well at lunch.',
      },
    ],
    nav: { prev_date: '2026-10-07', next_date: null },
    ...over,
  };
}

let dailyResponse: unknown = { success: true, data: payload() };
let tipsPref: boolean | undefined = true;

const get = vi.mocked(apiClient.get);
const patch = vi.mocked(apiClient.patch);

function setupApi(): void {
  get.mockImplementation(async (url: string) => {
    if (url === '/users/me') {
      return {
        success: true,
        data: {
          user: {
            id: 'u1',
            email: 'pat@example.com',
            timezone: 'America/Denver',
            notification_preferences:
              tipsPref === undefined ? {} : { tips_and_suggestions: tipsPref },
          },
        },
      } as never;
    }
    if (url === '/circles/c1/daily-update') return dailyResponse as never;
    throw new Error(`unexpected GET ${url}`);
  });
}

function Where(): ReactElement {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderCard(props: Partial<{ isOwner: boolean; isRecipient: boolean }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/circles/c1']}>
          <Routes>
            <Route
              path="/circles/:circleId"
              element={
                <main id="main" tabIndex={-1}>
                  <DailyUpdateCard
                    circleId="c1"
                    timezone={TZ}
                    isOwner={props.isOwner ?? true}
                    isRecipient={props.isRecipient ?? false}
                  />
                </main>
              }
            />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const dailyCalls = () => get.mock.calls.filter(([url]) => url === '/circles/c1/daily-update');

describe('DailyUpdateCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    dailyResponse = { success: true, data: payload() };
    tipsPref = true;
    setupApi();
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(AT_2000));
    await i18n.changeLanguage('en');
  });
  afterEach(() => vi.useRealTimers());

  it('shows at 20:00 recipient time: eyebrow, sentence, clause line and the rows (B2)', async () => {
    renderCard();
    const card = await screen.findByTestId('daily-update-card');
    expect(within(card).getByText('This evening')).toBeInTheDocument();
    // 3 taken, 1 skipped, 1 not marked → 3/5 < 2/3 → mixed.
    expect(
      within(card).getByRole('heading', { level: 2, name: 'A mixed day for Rose.' })
    ).toBeInTheDocument();
    expect(
      within(card).getByText('3 of 5 doses taken · 1 not marked · 2 tasks done · Ana left a note')
    ).toBeInTheDocument();
    const links = within(card).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      '2 tasks doneGroceries, Pick up the refill',
      'A note from AnaRose ate well at lunch.',
      'See the full update',
    ]);
    // No dose list on the card: Home's Medications card is that.
    expect(card.textContent).not.toMatch(/Metformin|Lisinopril/);
    expect(card.textContent).not.toMatch(/missed/i);
    // The request is keyed on the RECIPIENT's date.
    expect(dailyCalls()[0][1]).toEqual({ params: { date: '2026-10-08' } });
  });

  it('is a region named by its sentence, with a named dismiss button', async () => {
    renderCard();
    const region = await screen.findByRole('region', { name: 'A mixed day for Rose.' });
    expect(within(region).getByRole('button', { name: 'Hide until tomorrow' })).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'See the full update' })).toHaveAttribute(
      'href',
      '/circles/c1/daily-update'
    );
  });

  describe('row targets', () => {
    it('2+ tasks → the full update at Tasks; a care note → that day on Notes', async () => {
      renderCard();
      const card = await screen.findByTestId('daily-update-card');
      expect(within(card).getByRole('link', { name: /^2 tasks done/ })).toHaveAttribute(
        'href',
        '/circles/c1/daily-update#tasks'
      );
      expect(within(card).getByRole('link', { name: /^A note from Ana/ })).toHaveAttribute(
        'href',
        '/circles/c1/notes?date=2026-10-08'
      );
    });

    it('exactly 1 task → that task; the first appointment → its detail; an event note → its event', async () => {
      dailyResponse = {
        success: true,
        data: payload({
          tasks: { done: 1 },
          tasks_done_detail: [
            { event_id: 'k1', title: 'Groceries', completed_by_name: 'Luis', completed_at: '11:20' },
          ],
          appointments: { past_count: 2 },
          appointments_detail: [
            { event_id: 'a1', title: 'Dr. Patel', time: '10:30', location: null },
            { event_id: 'a2', title: 'Dentist', time: '15:00', location: null },
          ],
          notes_detail: [
            {
              note_id: 'n9',
              kind: 'event',
              event_id: 'a1',
              author_name: null,
              created_at: '11:00',
              excerpt: 'BP 120/80',
            },
          ],
        }),
      };
      renderCard();
      const card = await screen.findByTestId('daily-update-card');
      expect(within(card).getByRole('link', { name: /^1 task done/ })).toHaveAttribute(
        'href',
        '/circles/c1/calendar?eventId=k1'
      );
      const appt = within(card).getByRole('link', { name: /^Dr\. Patel/ });
      expect(appt).toHaveAttribute('href', '/circles/c1/calendar?date=2026-10-08&eventId=a1');
      expect(appt).toHaveTextContent('10:30 AM');
      // Only the FIRST appointment gets a row.
      expect(within(card).queryByText('Dentist')).toBeNull();
      // A departed author reads "a former member".
      expect(
        within(card).getByRole('link', { name: /^A note from a former member/ })
      ).toHaveAttribute('href', '/circles/c1/calendar?eventId=a1&panel=notes');
    });

    it('a mood-only care note (empty excerpt) has no excerpt line', async () => {
      dailyResponse = {
        success: true,
        data: payload({
          notes_detail: [
            { note_id: 'n1', kind: 'care', event_id: null, author_name: 'Ana', created_at: '16:10', excerpt: '' },
          ],
        }),
      };
      renderCard();
      const card = await screen.findByTestId('daily-update-card');
      expect(within(card).getByRole('link', { name: /^A note from Ana/ })).toHaveTextContent(
        /^A note from Ana$/
      );
    });

    it('a row whose target is gone is plain text, not a link', async () => {
      dailyResponse = {
        success: true,
        data: payload({
          appointments: { past_count: 1 },
          appointments_detail: [{ event_id: null, title: 'Dr. Patel', time: '10:30', location: null }],
        }),
      };
      renderCard();
      const card = await screen.findByTestId('daily-update-card');
      expect(within(card).getByText('Dr. Patel')).toBeInTheDocument();
      expect(within(card).queryByRole('link', { name: /Dr\. Patel/ })).toBeNull();
    });

    it('an older backend (counts only): the clause line, the tasks row and See the full update', async () => {
      const {
        doses_detail: _d,
        tasks_done_detail: _t,
        appointments_detail: _a,
        notes_detail: _n,
        nav: _v,
        ...countsOnly
      } = payload();
      dailyResponse = { success: true, data: countsOnly };
      renderCard();
      const card = await screen.findByTestId('daily-update-card');
      expect(within(card).getAllByRole('link').map((l) => l.textContent)).toEqual([
        '2 tasks done',
        'See the full update',
      ]);
      expect(within(card).getByRole('link', { name: '2 tasks done' })).toHaveAttribute(
        'href',
        '/circles/c1/daily-update'
      );
    });
  });

  it('is hidden before 19:00 and makes no request', async () => {
    vi.setSystemTime(new Date(AT_1859));
    renderCard();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/users/me'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
    expect(dailyCalls()).toHaveLength(0);
  });

  it('appears at 19:00 without a reload', async () => {
    vi.setSystemTime(new Date(AT_1859));
    renderCard();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await screen.findByTestId('daily-update-card')).toBeInTheDocument();
  });

  it('disappears at the recipient\'s midnight while the tab stays open', async () => {
    vi.setSystemTime(new Date('2026-10-09T03:59:50Z')); // 23:59:50 EDT
    renderCard();
    expect(await screen.findByTestId('daily-update-card')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
  });

  it.each([
    ['no activity today', { has_activity: false }],
    ['the viewer is not eligible (care recipient)', { eligible: false }],
    ['the data is for another day', { date: '2026-10-07' }],
    ['the server window already closed', { window: { opens_at: 'x', closes_at: '2026-10-08T23:59:00Z' } }],
  ])('stays hidden when %s', async (_label, over) => {
    dailyResponse = { success: true, data: payload(over as Partial<DailyUpdateData>) };
    renderCard();
    await waitFor(() => expect(dailyCalls()).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
  });

  it('stays hidden when the rollout switch is off ({ enabled: false })', async () => {
    dailyResponse = { success: true, data: { enabled: false } };
    renderCard();
    await waitFor(() => expect(dailyCalls()).toHaveLength(1));
    expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
  });

  it('never asks when the "Daily update & tips" preference is off', async () => {
    tipsPref = false;
    renderCard();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/users/me'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(dailyCalls()).toHaveLength(0);
    expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
  });

  it('treats an absent preference as ON (the DB default)', async () => {
    tipsPref = undefined;
    renderCard();
    expect(await screen.findByTestId('daily-update-card')).toBeInTheDocument();
  });

  it('never shows to the care recipient, and never asks', async () => {
    renderCard({ isRecipient: true });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/users/me'));
    expect(dailyCalls()).toHaveLength(0);
    expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
  });

  it('falls back to "your loved one" when the recipient has no name', async () => {
    dailyResponse = { success: true, data: payload({ recipient_name: null }) };
    renderCard();
    expect(
      await screen.findByRole('heading', { name: 'A mixed day for your loved one.' })
    ).toBeInTheDocument();
  });

  describe('card_shown analytics', () => {
    it('fires once per circle per recipient-day per browser, with booleans only', async () => {
      const first = renderCard({ isOwner: false });
      await screen.findByTestId('daily-update-card');
      await waitFor(() => expect(Analytics.dailyUpdateCardShown).toHaveBeenCalledTimes(1));
      expect(Analytics.dailyUpdateCardShown).toHaveBeenCalledWith({
        is_owner: false,
        is_solo: false,
        has_still_to_do: true,
      });
      first.unmount();
      renderCard({ isOwner: false });
      await screen.findByTestId('daily-update-card');
      expect(Analytics.dailyUpdateCardShown).toHaveBeenCalledTimes(1);
    });
  });

  describe('dismiss (X)', () => {
    it('hides it for the rest of the recipient-day, on this browser, and brings it back tomorrow', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const first = renderCard();
      await user.click(await screen.findByRole('button', { name: 'Hide until tomorrow' }));
      expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
      expect(localStorage.getItem('circlecare:dailyUpdateDismissed:c1')).toBe('2026-10-08');
      expect(Analytics.dailyUpdateDismissed).toHaveBeenCalledTimes(1);
      // Focus moves to the main landmark, not <body>.
      expect(document.activeElement?.id).toBe('main');
      first.unmount();

      // Reload the same evening: still hidden.
      const second = renderCard();
      await waitFor(() => expect(dailyCalls().length).toBeGreaterThan(0));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
      second.unmount();

      // The next evening: back.
      vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
      dailyResponse = {
        success: true,
        data: payload({
          date: '2026-10-09',
          window: { opens_at: '2026-10-09T23:00:00Z', closes_at: '2026-10-10T04:00:00Z' },
        }),
      };
      renderCard();
      expect(await screen.findByTestId('daily-update-card')).toBeInTheDocument();
    });
  });

  describe('Turn off', () => {
    it('confirms (noting tips stop too), writes tips_and_suggestions:false, hides and toasts', async () => {
      patch.mockResolvedValue({
        success: true,
        data: { user: { id: 'u1', notification_preferences: { tips_and_suggestions: false } } },
      } as never);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderCard();
      await user.click(await screen.findByRole('button', { name: 'Turn off' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Turn off the daily update?')).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          'This also turns off tips. You can turn both back on in Profile, under Notifications.'
        )
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));

      expect(patch).toHaveBeenCalledWith('/users/me/notification-preferences', {
        tips_and_suggestions: false,
      });
      expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
      expect(await screen.findByText('Daily update turned off')).toBeInTheDocument();
      expect(Analytics.dailyUpdateTurnedOff).toHaveBeenCalledTimes(1);
    });

    it('"Keep it" changes nothing', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderCard();
      await user.click(await screen.findByRole('button', { name: 'Turn off' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep it' }));
      expect(patch).not.toHaveBeenCalled();
      expect(screen.getByTestId('daily-update-card')).toBeInTheDocument();
      expect(Analytics.dailyUpdateTurnedOff).not.toHaveBeenCalled();
    });

    it('brings the card back when the save fails', async () => {
      patch.mockRejectedValue({ success: false, error: { code: 'INTERNAL', message: 'x' } });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderCard();
      await user.click(await screen.findByRole('button', { name: 'Turn off' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn off' }));
      expect(await screen.findByTestId('daily-update-card')).toBeInTheDocument();
      expect(Analytics.dailyUpdateTurnedOff).not.toHaveBeenCalled();
    });
  });

  describe('solo-owner line', () => {
    it('shows "Invite someone to share this" to a solo owner and routes to Members', async () => {
      dailyResponse = { success: true, data: payload({ is_solo: true }) };
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderCard({ isOwner: true });
      await user.click(await screen.findByRole('link', { name: 'Invite someone to share this' }));
      expect(Analytics.dailyUpdateInviteTapped).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('where')).toHaveTextContent('/circles/c1/members');
    });

    it('is not shown to a member (including a view-only member), who still sees the card', async () => {
      dailyResponse = { success: true, data: payload({ is_solo: true }) };
      renderCard({ isOwner: false });
      await screen.findByTestId('daily-update-card');
      expect(screen.queryByRole('link', { name: 'Invite someone to share this' })).toBeNull();
    });

    it('is not shown to an owner with company', async () => {
      renderCard({ isOwner: true });
      await screen.findByTestId('daily-update-card');
      expect(screen.queryByRole('link', { name: 'Invite someone to share this' })).toBeNull();
    });
  });

  it('renders in Spanish', async () => {
    await i18n.changeLanguage('es');
    dailyResponse = {
      success: true,
      data: payload({ notes: { count: 2, authors: ['Ana', 'Isabel'], more_authors: 0 } }),
    };
    renderCard();
    const card = await screen.findByTestId('daily-update-card');
    expect(within(card).getByText('Esta noche')).toBeInTheDocument();
    expect(
      within(card).getByRole('heading', { level: 2, name: 'Un día irregular para Rose.' })
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        '3 de 5 dosis tomadas · 1 sin marcar · 2 tareas hechas · Ana e Isabel dejaron notas'
      )
    ).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /^Una nota de Ana/ })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Ver el resumen completo' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Ocultar hasta mañana' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
