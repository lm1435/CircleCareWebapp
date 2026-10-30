import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import CirclePickerPage from '@/pages/CirclePickerPage';
import { ToastProvider } from '@/components/ui';
import { getCircles, type Circle } from '@/api/circles';
import { getInboxUnread, type InboxUnread } from '@/api/inbox';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';

// The circle list's per-circle unread counts (inbox `by_circle`).

vi.mock('@/api/circles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circles')>();
  return { ...actual, getCircles: vi.fn() };
});
vi.mock('@/api/inbox', () => ({
  getInbox: vi.fn(),
  getInboxUnread: vi.fn(),
  markInboxRead: vi.fn(),
}));
vi.mock('@/api/activityFeed', () => ({
  getActivityFeed: vi.fn().mockResolvedValue({ activities: [], hasMore: false }),
}));
vi.mock('@/api/medicationConfirmations', () => ({
  getMedicationTodaySummary: vi.fn().mockResolvedValue({
    total_today: 0,
    taken: 0,
    overdue: 0,
    not_marked_today: 0,
    not_marked_yesterday: 0,
    not_marked_total: 0,
    next_due: null,
    next_due_medication: null,
    timezone: 'America/New_York',
  }),
}));
vi.mock('@/lib/onboardingAnalytics', () => ({ trackCirclesLoaded: vi.fn() }));

const mockGetCircles = vi.mocked(getCircles);
const mockUnread = vi.mocked(getInboxUnread);

const MOM = '11111111-1111-4111-8111-111111111111';
const DAD = '22222222-2222-4222-8222-222222222222';

function makeCircle(overrides: Partial<Circle>): Circle {
  return {
    id: MOM,
    name: 'Mom',
    recipient_name: 'Rose',
    recipient_photo_url: null,
    role: 'owner',
    is_care_recipient: false,
    member_count: 2,
    created_at: '2026-01-01T00:00:00Z',
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    read_only: false,
    ...overrides,
  };
}

const TWO = [makeCircle({ id: MOM, name: 'Mom' }), makeCircle({ id: DAD, name: 'Dad' })];

function Landed() {
  const l = useLocation();
  return (
    <div data-testid="landed" data-state={JSON.stringify(l.state)}>
      {l.pathname}
    </div>
  );
}

function renderPicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/circles']}>
          <Routes>
            <Route path="/circles" element={<CirclePickerPage />} />
            <Route path="/circles/:circleId/*" element={<Landed />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  const result = render(tree);
  return { ...result, client, rerenderSame: () => result.rerender(tree) };
}

function serve(unread: InboxUnread): void {
  mockUnread.mockResolvedValue(unread);
}

/** The card's main link (the whole card) for a circle. */
function cardLink(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(`^Open ${name}`) });
}

describe('CirclePickerPage: per-circle unread counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'on');
    useAuthStore.setState({ isAuthenticated: true });
    mockGetCircles.mockResolvedValue(TWO);
    vi.spyOn(Analytics, 'circleListUnreadShown').mockImplementation(() => {});
    vi.spyOn(Analytics, 'circleSelected').mockImplementation(() => {});
    vi.spyOn(Analytics, 'circleViewed').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('shows "N new" only on the card with unread; nothing at 0', async () => {
    serve({ unread_count: 2, by_circle: { [MOM]: 2 } });
    renderPicker();
    const count = await screen.findByTestId('circle-unread-count');
    expect(count).toHaveTextContent('2 new');
    expect(screen.getAllByTestId('circle-unread-count')).toHaveLength(1);
    const [momItem, dadItem] = screen.getAllByRole('listitem');
    expect(within(momItem).getByTestId('circle-unread-count')).toBe(count);
    expect(within(dadItem).queryByTestId('circle-unread-count')).toBeNull();
  });

  it('the count is its OWN control: a sibling of the card link, never inside it', async () => {
    serve({ unread_count: 3, by_circle: { [MOM]: 3 } });
    renderPicker();
    const count = await screen.findByTestId('circle-unread-count');
    const card = cardLink('Mom');
    expect(card.contains(count)).toBe(false);
    expect(count.closest('a')).toBe(count);
    expect(count.parentElement).toBe(card.parentElement);
    // The space reserved inside the card is inert: hidden from AT, not focusable.
    const spacer = within(card).getByTestId('circle-unread-spacer');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer.querySelector('a,button,[tabindex]')).toBeNull();
  });

  it('accessible name: "{name} notifications, N new" (plural)', async () => {
    serve({ unread_count: 4, by_circle: { [MOM]: 1, [DAD]: 3 } });
    renderPicker();
    expect(await screen.findByRole('link', { name: 'Mom notifications, 1 new' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dad notifications, 3 new' })).toBeInTheDocument();
  });

  it("opens that circle's notifications with source circle_list; the card still opens the circle", async () => {
    serve({ unread_count: 2, by_circle: { [DAD]: 2 } });
    renderPicker();
    const count = await screen.findByRole('link', { name: 'Dad notifications, 2 new' });
    expect(count).toHaveAttribute('href', `/circles/${DAD}/notifications`);
    expect(cardLink('Dad')).toHaveAttribute('href', `/circles/${DAD}`);
    await userEvent.click(count);
    const landed = await screen.findByTestId('landed');
    expect(landed).toHaveTextContent(`/circles/${DAD}/notifications`);
    expect(JSON.parse(landed.getAttribute('data-state')!)).toEqual({ inboxSource: 'circle_list' });
    // Opening the count is not "selecting the circle" from the card.
    expect(Analytics.circleSelected).not.toHaveBeenCalled();
  });

  it('cards keep their order', async () => {
    serve({ unread_count: 5, by_circle: { [DAD]: 5 } });
    renderPicker();
    await screen.findByTestId('circle-unread-count');
    const names = screen.getAllByRole('listitem').map((li) => within(li).getByText(/^(Mom|Dad)$/).textContent);
    expect(names).toEqual(['Mom', 'Dad']);
  });

  it('older backend (no by_circle): no card shows a count', async () => {
    serve({ unread_count: 7, by_circle: null });
    renderPicker();
    await screen.findByText('Dad');
    await waitFor(() => expect(mockUnread).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('circle-unread-count')).toBeNull();
    expect(Analytics.circleListUnreadShown).not.toHaveBeenCalled();
  });

  it('circle_list_unread_shown fires ONCE with the number of cards showing a count', async () => {
    serve({ unread_count: 4, by_circle: { [MOM]: 1, [DAD]: 3 } });
    const { client, rerenderSame } = renderPicker();
    await screen.findAllByTestId('circle-unread-count');
    await waitFor(() => expect(Analytics.circleListUnreadShown).toHaveBeenCalledTimes(1));
    expect(Analytics.circleListUnreadShown).toHaveBeenCalledWith({ circlesWithUnread: 2 });
    // A re-render or a refetch with a different count never refires it.
    rerenderSame();
    serve({ unread_count: 1, by_circle: { [MOM]: 1 } });
    await client.refetchQueries();
    await waitFor(() => expect(screen.getAllByTestId('circle-unread-count')).toHaveLength(1));
    expect(Analytics.circleListUnreadShown).toHaveBeenCalledTimes(1);
  });

  it('circle_list_unread_shown does not fire when no card shows a count', async () => {
    serve({ unread_count: 0, by_circle: {} });
    renderPicker();
    await screen.findByText('Dad');
    await waitFor(() => expect(mockUnread).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(Analytics.circleListUnreadShown).not.toHaveBeenCalled();
  });

  it('flag off: no request, no count', async () => {
    vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'off');
    serve({ unread_count: 2, by_circle: { [MOM]: 2 } });
    renderPicker();
    await screen.findByText('Dad');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUnread).not.toHaveBeenCalled();
    expect(screen.queryByTestId('circle-unread-count')).toBeNull();
  });
});

