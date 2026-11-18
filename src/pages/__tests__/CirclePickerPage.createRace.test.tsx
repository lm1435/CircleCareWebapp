import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import CirclePickerPage from '@/pages/CirclePickerPage';
import { ToastProvider } from '@/components/ui';
import { createCircle, getCircles, type Circle } from '@/api/circles';
import { clearFirstRun, setFirstRunDraft } from '@/lib/firstRunDraft';
import { resetFirstCircleCreateForTests } from '@/lib/firstRunCreate';

/**
 * PROVEN DEFECT (2026-09-30, docs/plans/prompts-modals-coverage-2026-09-30.md §7):
 * creating the FIRST circle from the picker invalidates `circles` (useCreateCircle's
 * hook-level onSuccess, not awaited). When that refetch lands BEFORE the modal's
 * per-call onSuccess runs (a slower client: 8/8 at CPU x12 in Playwright, 0/8 at x1),
 * the picker's single-circle AUTO-SKIP navigates into the new circle first — with no
 * first-run state — which unmounts the modal, and React Query drops the per-call
 * callbacks of an unmounted observer. The user lands on the circle with NO first-run
 * wizard and, if free, NO onboarding paywall (the flag is never written either).
 *
 * This reproduces the ordering deterministically: the create modal is still open when
 * the circles query settles at one circle. The picker must leave that navigation to
 * the modal.
 */
vi.mock('@/api/circles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circles')>();
  return { ...actual, getCircles: vi.fn(), createCircle: vi.fn() };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackCirclesLoaded: vi.fn() }));

const mockGetCircles = vi.mocked(getCircles);
const mockCreateCircle = vi.mocked(createCircle);
let lastState: unknown = null;
function OverviewProbe() {
  lastState = useLocation().state;
  return <div data-testid="overview-page" />;
}

const circle = {
  id: 'c1',
  name: 'Rose',
  recipient_name: 'Rose',
  recipient_photo_url: null,
  role: 'owner',
  is_care_recipient: false,
  member_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  access_level: 'full',
  is_premium_circle: true,
  can_edit: true,
  view_only: false,
  read_only: false,
} as unknown as Circle;

function renderPicker(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/circles']}>
          <Routes>
            <Route path="/circles" element={<CirclePickerPage />} />
            <Route path="/circles/:circleId" element={<OverviewProbe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return queryClient;
}

describe('CirclePickerPage: auto-skip never races a create in flight', () => {
  beforeEach(() => vi.clearAllMocks());

  // First run v2 (1.4.3): the FIRST circle is no longer made by the create modal from the empty
  // state; the one question + the circle moment make it. The same race (the list refetching to ONE
  // circle while the create is still finishing) must not auto-skip into the circle WITHOUT its
  // first-run state: the moment is latched and owns that navigation.
  it('NEGATIVE: the list landing at one circle mid-moment does not auto-skip; the moment navigates WITH first-run state', async () => {
    resetFirstCircleCreateForTests();
    clearFirstRun();
    setFirstRunDraft({ recipientName: 'Rose', isSelfCare: false });
    // GET /circles: empty for the page, empty for the create's pre-check, then one circle.
    mockGetCircles.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([circle]);
    mockCreateCircle.mockResolvedValue(circle);
    renderPicker();

    expect(await screen.findByTestId('first-run-circle-moment')).toBeInTheDocument();
    await waitFor(() => expect(mockCreateCircle).toHaveBeenCalledTimes(1));
    // The refetch has landed at ONE circle; the moment is still up, no wizard-less skip.
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('first-run-circle-moment')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('overview-page')).toBeInTheDocument(), { timeout: 3000 });
    expect(lastState).toMatchObject({ firstRun: true, firstRunRecipientName: 'Rose' });
  });

  it('control: with no modal open, a single circle still auto-skips', async () => {
    mockGetCircles.mockResolvedValue([circle]);
    renderPicker();
    await waitFor(() => expect(screen.getByTestId('overview-page')).toBeInTheDocument());
  });
});
