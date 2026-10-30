import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api/inbox', () => ({
  getInbox: vi.fn(),
  getInboxUnread: vi.fn(),
  markInboxRead: vi.fn(),
}));
vi.mock('@/hooks/useCircles', () => ({ useCircles: vi.fn() }));

import { getInboxUnread } from '@/api/inbox';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { useCircles } from '@/hooks/useCircles';
import { useAuthStore } from '@/store/authStore';

const mockUnread = vi.mocked(getInboxUnread);
const mockCircles = vi.mocked(useCircles);
/** Total-only response (as an older backend sends it). */
const mockCount = {
  mockResolvedValue: (n: number) => mockUnread.mockResolvedValue({ unread_count: n, by_circle: null }),
};

const MOM = '11111111-1111-4111-8111-111111111111';
const DAD = '22222222-2222-4222-8222-222222222222';

function setCircles(n: number | undefined): void {
  const all = [
    { id: MOM, name: 'Mom' },
    { id: DAD, name: 'Dad' },
  ];
  mockCircles.mockReturnValue({ data: n === undefined ? undefined : all.slice(0, n) } as never);
}

function Where() {
  const l = useLocation();
  return (
    <div data-testid="where" data-state={JSON.stringify(l.state)}>
      {l.pathname}
    </div>
  );
}

function renderInCircle(circleId = MOM) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/circles/${circleId}`]}>
        <Routes>
          <Route path="/circles/:circleId" element={<NotificationBell circleId={circleId} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'on');
    useAuthStore.setState({ isAuthenticated: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('shows the count, an aria-hidden pill and the unread label', async () => {
    mockCount.mockResolvedValue(3);
    renderBell();
    const link = await screen.findByRole('link', { name: 'Notifications, 3 unread' });
    expect(link).toHaveAttribute('href', '/notifications');
    const pill = screen.getByTestId('notification-bell-count');
    expect(pill).toHaveTextContent('3');
    expect(pill).toHaveAttribute('aria-hidden', 'true');
  });

  it('zero unread: plain label and no pill', async () => {
    mockCount.mockResolvedValue(0);
    renderBell();
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByTestId('notification-bell-count')).toBeNull();
  });

  it('caps the pill at 99+', async () => {
    mockCount.mockResolvedValue(240);
    renderBell();
    expect(await screen.findByTestId('notification-bell-count')).toHaveTextContent('99+');
  });

  it('outside a circle: all-circles total, /notifications, source header_bell', async () => {
    mockUnread.mockResolvedValue({ unread_count: 5, by_circle: { [MOM]: 2, [DAD]: 3 } });
    renderBell();
    const link = await screen.findByRole('link', { name: 'Notifications, 5 unread' });
    expect(link).toHaveAttribute('href', '/notifications');
    expect(mockCircles).not.toHaveBeenCalled();
  });

  describe('inside a circle', () => {
    it('2+ circles: scoped to this circle (count from by_circle, links to its inbox)', async () => {
      setCircles(2);
      mockUnread.mockResolvedValue({ unread_count: 5, by_circle: { [MOM]: 2, [DAD]: 3 } });
      renderInCircle(MOM);
      const link = await screen.findByRole('link', { name: 'Notifications, 2 unread' });
      expect(link).toHaveAttribute('href', `/circles/${MOM}/notifications`);
      expect(link).toHaveAttribute('data-scoped', 'true');
      expect(screen.getByTestId('notification-bell-count')).toHaveTextContent('2');
    });

    it('2+ circles, this circle has none: plain bell, no pill', async () => {
      setCircles(2);
      mockUnread.mockResolvedValue({ unread_count: 3, by_circle: { [DAD]: 3 } });
      renderInCircle(MOM);
      const link = await screen.findByRole('link', { name: 'Notifications' });
      expect(link).toHaveAttribute('href', `/circles/${MOM}/notifications`);
      expect(screen.queryByTestId('notification-bell-count')).toBeNull();
    });

    it('exactly ONE circle: unchanged (total, /notifications)', async () => {
      setCircles(1);
      mockUnread.mockResolvedValue({ unread_count: 4, by_circle: { [MOM]: 3 } });
      renderInCircle(MOM);
      const link = await screen.findByRole('link', { name: 'Notifications, 4 unread' });
      expect(link).toHaveAttribute('href', '/notifications');
      expect(link).toHaveAttribute('data-scoped', 'false');
    });

    it('older backend (no by_circle): a scoped bell shows the total', async () => {
      setCircles(2);
      mockCount.mockResolvedValue(6);
      renderInCircle(MOM);
      const link = await screen.findByRole('link', { name: 'Notifications, 6 unread' });
      expect(link).toHaveAttribute('href', `/circles/${MOM}/notifications`);
    });

    it('circles still loading: no count yet (never flicks total -> scoped)', async () => {
      setCircles(undefined);
      mockUnread.mockResolvedValue({ unread_count: 5, by_circle: { [MOM]: 2 } });
      renderInCircle(MOM);
      await waitFor(() => expect(mockUnread).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
      expect(screen.queryByTestId('notification-bell-count')).toBeNull();
    });

    it('passes source today_bell in router state', async () => {
      setCircles(2);
      mockUnread.mockResolvedValue({ unread_count: 2, by_circle: { [MOM]: 2 } });
      renderInCircle(MOM);
      await userEvent.click(await screen.findByRole('link', { name: 'Notifications, 2 unread' }));
      const where = await screen.findByTestId('where');
      expect(where).toHaveTextContent(`/circles/${MOM}/notifications`);
      expect(JSON.parse(where.getAttribute('data-state')!)).toEqual({ inboxSource: 'today_bell' });
    });
  });

  it('flag off: renders nothing and makes no request', async () => {
    vi.stubEnv('VITE_NOTIFICATIONS_INBOX', 'off');
    const { container } = renderBell();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(mockUnread).not.toHaveBeenCalled();
  });
});
