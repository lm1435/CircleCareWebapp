import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import CirclePickerPage from '@/pages/CirclePickerPage';
import { ToastProvider } from '@/components/ui';
import { getCircles, type Circle } from '@/api/circles';
import { queryKeys } from '@/lib/queryKeys';

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
  return { ...actual, getCircles: vi.fn() };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackCirclesLoaded: vi.fn() }));

const mockGetCircles = vi.mocked(getCircles);

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
            <Route path="/circles/:circleId" element={<div data-testid="overview-page" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return queryClient;
}

describe('CirclePickerPage: auto-skip never races a create in flight', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not jump into the new circle while the create modal is still open', async () => {
    const user = userEvent.setup();
    mockGetCircles.mockResolvedValue([]);
    const queryClient = renderPicker();

    await user.click(await screen.findByRole('button', { name: 'Create circle' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // The create's invalidation lands first: the list now holds the one new circle.
    mockGetCircles.mockResolvedValue([circle]);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    });

    // The modal (which owns the paywall / first-run hand-off) is still in charge.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // The second half of the race: the modal's onClose is an urgent update and its
  // navigate a router transition (v7_startTransition), so the picker re-renders with
  // the modal CLOSED before the route changes. Skipping then replaced the entry the
  // modal had just pushed (and its first-run / paywall state). So once a create has
  // started here, the auto-skip is retired for this mount.
  it('stays retired after the create modal closes (the modal already navigated)', async () => {
    const user = userEvent.setup();
    mockGetCircles.mockResolvedValue([]);
    const queryClient = renderPicker();

    await user.click(await screen.findByRole('button', { name: 'Create circle' }));
    const dialog = await screen.findByRole('dialog');
    mockGetCircles.mockResolvedValue([circle]);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.circles });
    });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
  });

  it('control: with no modal open, a single circle still auto-skips', async () => {
    mockGetCircles.mockResolvedValue([circle]);
    renderPicker();
    await waitFor(() => expect(screen.getByTestId('overview-page')).toBeInTheDocument());
  });
});
