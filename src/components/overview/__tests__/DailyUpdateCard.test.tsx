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

  it('shows at 20:00 recipient time with both sections, zero counts omitted', async () => {
    renderCard();
    const card = await screen.findByTestId('daily-update-card');
    expect(within(card).getByRole('heading', { level: 2, name: "Rose's day" })).toBeInTheDocument();
    expect(within(card).getByText('Daily update')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Today so far' })).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Still to do' })).toBeInTheDocument();
    const lines = within(card)
      .getByTestId('daily-update-summary')
      .querySelectorAll('li');
    expect(Array.from(lines).map((l) => l.textContent)).toEqual([
      '3 doses taken',
      '1 dose skipped',
      '1 dose not marked yet',
      '2 tasks done',
      '1 note from Ana',
    ]);
    expect(within(card).getByText('9:00 PM · Metformin')).toBeInTheDocument();
    expect(within(card).getByText('7:30 PM · Lisinopril · Not marked')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/taken late|missed/i);
    // The request is keyed on the RECIPIENT's date.
    expect(dailyCalls()[0][1]).toEqual({ params: { date: '2026-10-08' } });
  });

  it('is a labelled region with a named dismiss button', async () => {
    renderCard();
    const region = await screen.findByRole('region', { name: "Rose's day" });
    expect(within(region).getByRole('button', { name: 'Hide until tomorrow' })).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'See the full update' })).toHaveAttribute(
      'href',
      '/circles/c1/daily-update'
    );
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

  it('falls back to "Today\'s update" when the recipient has no name', async () => {
    dailyResponse = { success: true, data: payload({ recipient_name: null }) };
    renderCard();
    expect(await screen.findByRole('heading', { name: "Today's update" })).toBeInTheDocument();
  });

  it('shows "Nothing else on the schedule today." when nothing is left', async () => {
    dailyResponse = { success: true, data: payload({ still_to_do: [] }) };
    renderCard();
    expect(await screen.findByText('Nothing else on the schedule today.')).toBeInTheDocument();
  });

  it('renders "+N more" after the items', async () => {
    dailyResponse = { success: true, data: payload({ still_to_do_more: 3 }) };
    renderCard();
    expect(await screen.findByText('+3 more')).toBeInTheDocument();
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
    expect(within(card).getByRole('heading', { level: 2, name: 'El día de Rose' })).toBeInTheDocument();
    expect(within(card).getByText('Hoy hasta ahora')).toBeInTheDocument();
    expect(within(card).getByText('Falta por hacer')).toBeInTheDocument();
    expect(within(card).getByText('1 dosis omitida')).toBeInTheDocument();
    expect(within(card).getByText('2 notas de Ana e Isabel')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Ocultar hasta mañana' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
