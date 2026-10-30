import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { CIRCLE_A, CIRCLE_B, EVENT_ID, local, makeItem } from '@/test/fixtures/inbox';

vi.mock('@/api/inbox', () => ({
  getInbox: vi.fn(),
  getInboxUnread: vi.fn(),
  markInboxRead: vi.fn(),
}));
vi.mock('@/hooks/useCircles', () => ({ useCircles: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({
  Analytics: { inboxViewed: vi.fn(), inboxRowOpened: vi.fn(), inboxMarkAllRead: vi.fn() },
}));

import { getInbox, getInboxUnread, markInboxRead } from '@/api/inbox';
import { useCircles } from '@/hooks/useCircles';
import { Analytics } from '@/lib/analytics';
import NotificationsPage from '@/pages/NotificationsPage';
import CircleNotificationsPage from '@/pages/CircleNotificationsPage';
import { useAuthStore } from '@/store/authStore';
import type { InboxItem } from '@/lib/notificationsInbox';

const mockGet = vi.mocked(getInbox);
const mockMark = vi.mocked(markInboxRead);
const mockCircles = vi.mocked(useCircles);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Where />
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function circles(n: number) {
  const all = [
    { id: CIRCLE_A, name: 'Mom' },
    { id: CIRCLE_B, name: 'Dad' },
  ].slice(0, n);
  mockCircles.mockReturnValue({ data: all } as never);
}

function serve(items: InboxItem[]) {
  mockGet.mockResolvedValue({ items, unread_count: items.filter((i) => !i.read_at).length });
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 29, 15, 0, 0));
    vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'on');
    useAuthStore.setState({ isAuthenticated: true });
    circles(1);
    mockMark.mockResolvedValue(1);
    vi.mocked(getInboxUnread).mockResolvedValue({ unread_count: 0, by_circle: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('flag off: nothing renders, no request, redirected away', async () => {
    vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'off');
    renderPage();
    expect(await screen.findByText('elsewhere')).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-page')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('groups into Today / Yesterday / 2 days ago and drops older rows', async () => {
    serve([
      makeItem({ title: 'T-today', updated_at: local(2026, 10, 29, 9) }),
      makeItem({ title: 'T-yest', updated_at: local(2026, 10, 28, 9) }),
      makeItem({ title: 'T-two', updated_at: local(2026, 10, 27, 9) }),
      makeItem({ title: 'T-old', updated_at: local(2026, 10, 26, 9) }),
    ]);
    renderPage();
    expect(await screen.findByText('T-today')).toBeInTheDocument();
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(['Today', 'Yesterday', '2 days ago']));
    expect(screen.getByText('T-yest')).toBeInTheDocument();
    expect(screen.getByText('T-two')).toBeInTheDocument();
    expect(screen.queryByText('T-old')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
  });

  it('renders a collapsed dose row from state, not from the stored title', async () => {
    serve([
      makeItem({
        type: 'medication_confirmation',
        title: 'STORED',
        body: 'STORED BODY',
        updated_at: local(2026, 10, 29, 8, 12),
        state: {
          status: 'taken',
          medication_name: 'Lisinopril',
          scheduled_time: '08:00:00',
          scheduled_date: '2026-10-29',
          actor_first_name: 'Ana',
        },
      }),
    ]);
    renderPage();
    expect(await screen.findByText('Lisinopril 8:00 AM · Taken by Ana')).toBeInTheDocument();
    expect(screen.getByText('Marked at 8:12 AM')).toBeInTheDocument();
    expect(screen.queryByText('STORED')).toBeNull();
  });

  it('unread rows carry an Unread label and bolder title; read rows do not', async () => {
    serve([
      makeItem({ title: 'U', read_at: null }),
      makeItem({ title: 'R', read_at: local(2026, 10, 29, 10) }),
    ]);
    renderPage();
    await screen.findByText('U');
    const [u, r] = screen.getAllByTestId('inbox-row');
    expect(u).toHaveAttribute('data-unread', 'true');
    expect(within(u).getByText('Unread.')).toBeInTheDocument();
    expect(within(u).getByText('U').className).toContain('font-semibold');
    expect(within(r).queryByText('Unread.')).toBeNull();
  });

  it('shows the circle name only with 2+ circles', async () => {
    serve([makeItem({ circle_name: 'Mom', updated_at: local(2026, 10, 29, 14, 10) })]);
    circles(1);
    const first = renderPage();
    expect(await screen.findByText('2:10 PM')).toBeInTheDocument();
    first.unmount();
    circles(2);
    renderPage();
    expect(await screen.findByText('Mom · 2:10 PM')).toBeInTheDocument();
  });

  it('empty state', async () => {
    serve([makeItem({ updated_at: local(2026, 10, 20, 9) })]);
    renderPage();
    expect(await screen.findByTestId('inbox-empty')).toHaveTextContent(
      'Reminders and updates from your circles show up here for 3 days. Older ones live in Activity.'
    );
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  // Dark e2e 2026-10-30 (axe landmark-unique at desktop width): the app sidebar is an <aside> too,
  // so this page's side column must carry its own accessible name.
  it('the side column is a NAMED complementary landmark (its heading)', async () => {
    serve([makeItem({ updated_at: local(2026, 10, 20, 9) })]);
    renderPage();
    await screen.findByTestId('inbox-side-card');
    const side = screen.getByRole('complementary');
    expect(side).toHaveAttribute('aria-labelledby', 'inbox-side-title');
    expect(side).toHaveAccessibleName(document.getElementById('inbox-side-title')!.textContent!);
  });

  it('loading shows skeleton rows (no spinner text), then error with Try again', async () => {
    let reject!: (e: Error) => void;
    mockGet.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    renderPage();
    expect(await screen.findByTestId('inbox-loading')).toHaveAttribute('aria-busy', 'true');
    reject(new Error('x'));
    expect(await screen.findByText("Couldn't load notifications.")).toBeInTheDocument();
    expect(
      screen.getByText('Check your connection and try again. Your reminders still arrive as usual.')
    ).toBeInTheDocument();
    serve([makeItem({ title: 'Back' })]);
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back')).toBeInTheDocument();
  });

  it('fires inbox_viewed once with the unread bucket', async () => {
    serve([makeItem(), makeItem(), makeItem(), makeItem()]);
    renderPage();
    await screen.findAllByTestId('inbox-row');
    await waitFor(() => expect(Analytics.inboxViewed).toHaveBeenCalledTimes(1));
    // Reached with no entry-point state (direct URL, email link): source 'other'.
    expect(Analytics.inboxViewed).toHaveBeenCalledWith({
      unreadBucket: '4_9',
      source: 'other',
      scoped: false,
    });
  });

  it('Mark all read: calls the API with all, fires inbox_mark_all_read with the count', async () => {
    const items = [makeItem(), makeItem(), makeItem({ read_at: local(2026, 10, 29, 10) })];
    serve(items);
    // The server answers the post-mutation refetch with everything read.
    mockMark.mockImplementation(async () => {
      mockGet.mockResolvedValue({
        items: items.map((i) => ({ ...i, read_at: local(2026, 10, 29, 14) })),
        unread_count: 0,
      });
      return 2;
    });
    renderPage();
    await screen.findAllByTestId('inbox-row');
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(mockMark).toHaveBeenCalledWith({ all: true });
    expect(Analytics.inboxMarkAllRead).toHaveBeenCalledWith({ count: 2 });
    await waitFor(() =>
      screen.getAllByTestId('inbox-row').forEach((row) => expect(row).toHaveAttribute('data-unread', 'false'))
    );
    // a11y (4.1.3): the always-mounted polite region says it; the button is aria-disabled
    // (focus kept), never natively disabled (which would drop keyboard focus to <body>).
    await waitFor(() =>
      expect(screen.getByTestId('inbox-announcer')).toHaveTextContent('All notifications marked as read.')
    );
    expect(screen.getByTestId('inbox-announcer')).toHaveAttribute('role', 'status');
    const button = screen.getByRole('button', { name: 'Mark all read' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
  });

  it.each([
    ['medication_reminder', { eventId: EVENT_ID, scheduledDate: '2026-10-29' }, `/circles/${CIRCLE_A}/calendar?date=2026-10-29&eventId=${EVENT_ID}`],
    ['refill_reminder', { medicationId: EVENT_ID }, `/circles/${CIRCLE_A}/meds?medication=${EVENT_ID}`],
    ['care_note_added', { noteDate: '2026-10-28' }, `/circles/${CIRCLE_A}/notes?date=2026-10-28`],
    ['daily_update', { date: '2026-10-28' }, `/circles/${CIRCLE_A}/daily-update/2026-10-28`],
    ['shift', {}, `/circles/${CIRCLE_A}/calendar?mode=shifts`],
    ['recognition', {}, `/circles/${CIRCLE_A}`],
  ])('row tap (%s): marks read, fires inbox_row_opened, navigates', async (type, data, to) => {
    const item = makeItem({ type, data: data as never, title: 'Tap me' });
    serve([item]);
    renderPage();
    await userEvent.setup({ advanceTimers: () => {} }).click(await screen.findByRole('button', { name: /Tap me/ }));
    expect(mockMark).toHaveBeenCalledWith({ ids: [item.id] });
    expect(Analytics.inboxRowOpened).toHaveBeenCalledWith({ type, targetFound: true });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(to));
  });

  it('a gone row shows the removed state with its own title, body and time; OK returns', async () => {
    serve([
      makeItem({
        type: 'medication_reminder',
        target_status: 'removed',
        title: 'Gone title',
        body: 'Gone body',
        updated_at: local(2026, 10, 29, 14, 10),
      }),
    ]);
    renderPage();
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(await screen.findByRole('button', { name: /Gone title/ }));
    const panel = await screen.findByTestId('inbox-gone');
    expect(within(panel).getByTestId('inbox-gone-title')).toHaveTextContent('Gone title');
    expect(within(panel).getByText('Gone body')).toBeInTheDocument();
    expect(within(panel).getByText('2:10 PM')).toBeInTheDocument();
    expect(within(panel).getByText('This was removed')).toBeInTheDocument();
    expect(Analytics.inboxRowOpened).toHaveBeenCalledWith({ type: 'medication_reminder', targetFound: false });
    expect(screen.getByTestId('where')).toHaveTextContent('/notifications');
    // a11y: the removed state took focus to its heading...
    expect(within(panel).getByRole('heading', { name: 'This was removed' })).toHaveFocus();
    await user.click(within(panel).getByRole('button', { name: 'OK' }));
    expect(await screen.findByTestId('inbox-row')).toBeInTheDocument();
    // ...and OK hands it back to the row that was opened, not <body>.
    await waitFor(() => expect(screen.getByRole('button', { name: /Gone title/ })).toHaveFocus());
  });

  it('member_removed opens the no-access state with a way back', async () => {
    serve([makeItem({ type: 'member_removed', title: 'Removed from circle' })]);
    renderPage();
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(await screen.findByRole('button', { name: /Removed from circle/ }));
    expect(await screen.findByText('You no longer have access to this circle.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to notifications' }));
    expect(await screen.findByTestId('inbox-row')).toBeInTheDocument();
  });

  it('side card: See older in Activity targets the single circle; Notification settings -> profile', async () => {
    serve([makeItem()]);
    renderPage();
    await screen.findByTestId('inbox-row');
    expect(screen.getByRole('link', { name: /See older in Activity/ })).toHaveAttribute(
      'href',
      `/circles/${CIRCLE_A}/activity`
    );
    expect(screen.getByRole('link', { name: 'Notification settings' })).toHaveAttribute('href', '/profile');
  });

  describe('scoped to one circle (/circles/:circleId/notifications)', () => {
    function renderScoped(state?: unknown) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: `/circles/${CIRCLE_A}/notifications`, state }]}>
            <Where />
            <Routes>
              <Route path="/circles/:circleId/notifications" element={<CircleNotificationsPage />} />
              <Route path="*" element={<div>elsewhere</div>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );
    }

    beforeEach(() => circles(2));

    it('asks for that circle only and shows "Notifications" + "Mom · N new"', async () => {
      mockGet.mockResolvedValue({ items: [makeItem(), makeItem()], unread_count: 2 });
      renderScoped();
      expect(await screen.findAllByTestId('inbox-row')).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledWith(CIRCLE_A);
      expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
      expect(screen.getByTestId('inbox-scoped-subtitle')).toHaveTextContent('Mom · 2 new');
      // Every row is this circle: no per-row circle name.
      expect(screen.queryByText(/^Mom · /, { selector: '.text-xs' })).toBeNull();
    });

    it('singular, and just the circle name at 0 unread', async () => {
      mockGet.mockResolvedValue({ items: [makeItem()], unread_count: 1 });
      const { unmount } = renderScoped();
      await screen.findByTestId('inbox-row');
      expect(screen.getByTestId('inbox-scoped-subtitle')).toHaveTextContent('Mom · 1 new');
      unmount();
      mockGet.mockResolvedValue({ items: [makeItem({ read_at: local(2026, 10, 29, 10) })], unread_count: 0 });
      renderScoped();
      await screen.findByTestId('inbox-row');
      expect(screen.getByTestId('inbox-scoped-subtitle').textContent).toBe('Mom');
    });

    it('never shows another circle\'s rows (older backend ignoring circle_id)', async () => {
      mockGet.mockResolvedValue({
        items: [makeItem({ title: 'Mine' }), makeItem({ circle_id: CIRCLE_B, title: 'Theirs' })],
        unread_count: 2,
      });
      renderScoped();
      expect(await screen.findByText('Mine')).toBeInTheDocument();
      expect(screen.queryByText('Theirs')).toBeNull();
      expect(screen.getByTestId('inbox-scoped-subtitle')).toHaveTextContent('Mom · 1 new');
    });

    it('back arrow goes to the circle; All notifications -> /notifications with 2+ circles', async () => {
      serve([makeItem()]);
      renderScoped();
      await screen.findByTestId('inbox-row');
      expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', `/circles/${CIRCLE_A}`);
      expect(screen.getByRole('link', { name: /All notifications/ })).toHaveAttribute(
        'href',
        '/notifications'
      );
      expect(screen.getByRole('link', { name: /See older in Activity/ })).toHaveAttribute(
        'href',
        `/circles/${CIRCLE_A}/activity`
      );
    });

    it('one circle: no All notifications link', async () => {
      circles(1);
      serve([makeItem()]);
      renderScoped();
      await screen.findByTestId('inbox-row');
      expect(screen.queryByRole('link', { name: /All notifications/ })).toBeNull();
    });

    it('Mark all read sends { all: true, circle_id }', async () => {
      serve([makeItem(), makeItem()]);
      renderScoped();
      await screen.findAllByTestId('inbox-row');
      await userEvent
        .setup({ advanceTimers: () => {} })
        .click(screen.getByRole('button', { name: 'Mark all read' }));
      expect(mockMark).toHaveBeenCalledWith({ all: true, circle_id: CIRCLE_A });
    });

    it('inbox_viewed: scoped, source from the entry point (circle_list), once', async () => {
      serve([makeItem()]);
      renderScoped({ inboxSource: 'circle_list' });
      await screen.findByTestId('inbox-row');
      await waitFor(() => expect(Analytics.inboxViewed).toHaveBeenCalledTimes(1));
      expect(Analytics.inboxViewed).toHaveBeenCalledWith({
        unreadBucket: '1_3',
        source: 'circle_list',
        scoped: true,
      });
    });

    it('inbox_viewed: today_bell source; unknown state falls back to other', async () => {
      serve([makeItem()]);
      const { unmount } = renderScoped({ inboxSource: 'today_bell' });
      await waitFor(() =>
        expect(Analytics.inboxViewed).toHaveBeenLastCalledWith(
          expect.objectContaining({ source: 'today_bell', scoped: true })
        )
      );
      unmount();
      renderScoped({ inboxSource: 'bogus' });
      await waitFor(() =>
        expect(Analytics.inboxViewed).toHaveBeenLastCalledWith(
          expect.objectContaining({ source: 'other', scoped: true })
        )
      );
    });

    it('flag off: redirected to the circle, no request', async () => {
      vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'off');
      renderScoped();
      expect(await screen.findByText('elsewhere')).toBeInTheDocument();
      expect(screen.getByTestId('where')).toHaveTextContent(`/circles/${CIRCLE_A}`);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
