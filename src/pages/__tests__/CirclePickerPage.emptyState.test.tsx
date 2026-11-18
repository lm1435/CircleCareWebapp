import { render, screen, waitFor } from '@testing-library/react';
import { clearFirstRun, peekFirstRunDraft, setFirstRunDraft } from '@/lib/firstRunDraft';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import CirclePickerPage from '@/pages/CirclePickerPage';
import { ToastProvider } from '@/components/ui';
import { getCircles, type Circle } from '@/api/circles';
import { getPendingInvites, type PendingInvite } from '@/api/invites';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';

// 1.4.3 Circles empty state "A2-complete" on the PAGE: what the page wires around
// EmptyCircles (greeting, the two doors, the pending-invite banner, analytics),
// and that a person with circles is untouched. Mobile twin:
// mobile/src/__tests__/screens/CircleListEmptyStateA2.test.tsx.

vi.mock('@/api/circles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circles')>();
  return { ...actual, getCircles: vi.fn() };
});
vi.mock('@/api/invites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invites')>();
  return { ...actual, getPendingInvites: vi.fn() };
});
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
const mockGetPendingInvites = vi.mocked(getPendingInvites);

function makeCircle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: 'c1',
    name: "Mom's Care",
    recipient_name: 'Rose',
    recipient_photo_url: null,
    role: 'owner',
    is_care_recipient: false,
    member_count: 4,
    created_at: '2026-01-01T00:00:00Z',
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    read_only: false,
    ...overrides,
  };
}

const invite = {
  id: 'inv-1',
  member_type: 'caregiver',
  circle: { id: 'c9', name: "Todd's Circle", recipient_name: 'Todd' },
  invited_by: { email: 'luis@example.com', first_name: 'Luis', last_name: 'Meza' },
  created_at: '2026-08-02T00:00:00Z',
  expires_at: '2026-08-09T00:00:00Z',
} as PendingInvite;

function renderPicker(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/circles']}>
          <Routes>
            <Route path="/circles" element={<CirclePickerPage />} />
            <Route path="/circles/:circleId" element={<div data-testid="overview-page" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('CirclePickerPage empty state (A2)', () => {
  let viewed: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    clearFirstRun();
    vi.clearAllMocks();
    mockGetPendingInvites.mockResolvedValue([]);
    useAuthStore.setState({
      user: { id: 'user-1', email: 'u@example.com', first_name: 'Maria' } as never,
      isAuthenticated: true,
    });
    viewed = vi.spyOn(Analytics, 'emptyStateViewed').mockImplementation(() => {});
  });
  afterEach(() => {
    viewed.mockRestore();
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });

  describe('positive', () => {
    it('greets by name in the eyebrow and the empty state owns the only h1', async () => {
      mockGetCircles.mockResolvedValue([]);
      renderPicker();
      expect(await screen.findByRole('heading', { level: 1, name: 'One place for their care' })).toBeInTheDocument();
      expect(screen.getByText(/^Good (morning|afternoon|evening), Maria$/)).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      // The page header's editorial name steps aside for the empty state.
      expect(screen.queryByRole('heading', { name: 'Maria' })).not.toBeInTheDocument();
    });

    it('"Start a care circle" asks the one first-run question (first run v2), not the create form', async () => {
      const user = userEvent.setup();
      mockGetCircles.mockResolvedValue([]);
      renderPicker();
      await user.click(await screen.findByRole('button', { name: 'Start a care circle' }));
      expect(await screen.findByRole('heading', { name: 'Who are you caring for?' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'New care circle' })).not.toBeInTheDocument();
    });

    it('NEGATIVE: an invited person (pending invite) never gets the question or an automatic circle, and the stored name is deleted', async () => {
      setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
      mockGetCircles.mockResolvedValue([]);
      mockGetPendingInvites.mockResolvedValue([invite]);
      renderPicker();
      expect(await screen.findByText('You have 1 pending invitation')).toBeInTheDocument();
      expect(screen.queryByTestId('first-run-circle-moment')).not.toBeInTheDocument();
      expect(screen.queryByTestId('first-run-who')).not.toBeInTheDocument();
      await waitFor(() => expect(peekFirstRunDraft()).toBeNull());
    });

    it('"I have an invite code" opens the join modal', async () => {
      const user = userEvent.setup();
      mockGetCircles.mockResolvedValue([]);
      renderPicker();
      await user.click(await screen.findByRole('button', { name: 'I have an invite code' }));
      expect(await screen.findByRole('heading', { name: 'Join a circle' })).toBeInTheDocument();
    });

    it('still shows the pending-invite banner when there is one', async () => {
      mockGetCircles.mockResolvedValue([]);
      mockGetPendingInvites.mockResolvedValue([invite]);
      renderPicker();
      expect(await screen.findByText('You have 1 pending invitation')).toBeInTheDocument();
      expect(screen.getByRole('figure', { name: 'Example: Today for Rosa' })).toBeInTheDocument();
    });

    it('fires empty_state_viewed once with variant a2', async () => {
      mockGetCircles.mockResolvedValue([]);
      mockGetPendingInvites.mockResolvedValue([invite]);
      renderPicker();
      await screen.findByText('You have 1 pending invitation');
      expect(viewed).toHaveBeenCalledTimes(1);
      expect(viewed.mock.calls[0][0]).toBe('a2');
    });
  });

  describe('negative', () => {
    it('a person with circles never sees the example, and no empty_state_viewed', async () => {
      mockGetCircles.mockResolvedValue([makeCircle(), makeCircle({ id: 'c2', name: "Dad's Circle" })]);
      renderPicker();
      await screen.findByRole('link', { name: /Open Mom's Care/ });
      expect(screen.queryByTestId('empty-example-card')).not.toBeInTheDocument();
      expect(screen.queryByText('Example')).not.toBeInTheDocument();
      expect(screen.queryByText(/Rosa/)).not.toBeInTheDocument();
      expect(screen.queryByText('One place for their care')).not.toBeInTheDocument();
      expect(viewed).not.toHaveBeenCalled();
    });

    it('the circle list is unaffected: greeting header and the header pair still render', async () => {
      mockGetCircles.mockResolvedValue([makeCircle(), makeCircle({ id: 'c2', name: "Dad's Circle" })]);
      renderPicker();
      await screen.findByRole('link', { name: /Open Mom's Care/ });
      expect(screen.getByRole('heading', { name: 'Maria' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create circle' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Join a circle' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Start a care circle' })).not.toBeInTheDocument();
    });

    it('no banner when there is no pending invite', async () => {
      mockGetCircles.mockResolvedValue([]);
      renderPicker();
      await screen.findByRole('heading', { level: 1, name: 'One place for their care' });
      await vi.waitFor(() => expect(mockGetPendingInvites).toHaveBeenCalled());
      expect(screen.queryByText(/pending invitation/)).not.toBeInTheDocument();
    });

    it('the loading state shows no example and fires nothing', () => {
      mockGetCircles.mockReturnValue(new Promise<Circle[]>(() => {}));
      renderPicker();
      expect(screen.queryByTestId('empty-example-card')).not.toBeInTheDocument();
      expect(viewed).not.toHaveBeenCalled();
    });
  });
});
