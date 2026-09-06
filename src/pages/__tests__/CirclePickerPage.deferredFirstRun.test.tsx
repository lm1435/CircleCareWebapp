import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { ReactElement } from 'react';
import '@/i18n';
import CirclePickerPage from '@/pages/CirclePickerPage';
import { getCircles, type Circle } from '@/api/circles';
import { deferFirstRun, peekDeferredFirstRun } from '@/lib/onboardingPaywall';
import { useAuthStore } from '@/store/authStore';

/**
 * THE BROWSER-BACK ESCAPE HATCH.
 *
 * Mobile's deferral survives because backing out of the paywall returns to
 * CreateCircleScreen, whose `focus` listener replays the wizard. On web the
 * paywall is a route, so the Back button lands on `/circles` — the entry the
 * paywall was pushed from — and this page replays it instead. Without this,
 * one very ordinary exit turns the wizard into a dead end.
 */

vi.mock('@/api/circles', () => ({ getCircles: vi.fn() }));
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

function CircleProbe(): ReactElement {
  const { circleId } = useParams<{ circleId: string }>();
  const state = useLocation().state as
    | { firstRun?: boolean; firstRunRecipientName?: string }
    | null;
  return state?.firstRun ? (
    <p data-testid="wizard">
      wizard for {circleId} / {state.firstRunRecipientName}
    </p>
  ) : (
    <p data-testid="no-wizard">circle {circleId}</p>
  );
}

function renderPicker(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/circles']}>
        <Routes>
          <Route path="/circles" element={<CirclePickerPage />} />
          <Route path="/circles/:circleId" element={<CircleProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  useAuthStore.setState({
    user: { id: 'user-1', email: 'u@example.com' } as never,
    isAuthenticated: true,
  });
  mockGetCircles.mockResolvedValue([]);
});

describe('CirclePickerPage — deferred first run', () => {
  it('replays a wizard left parked by the onboarding paywall', async () => {
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });

    renderPicker();

    expect(await screen.findByTestId('wizard')).toHaveTextContent('wizard for circle-9 / Rose');
  });

  it('CONSUMES the record, so returning to the picker later does not re-open it', async () => {
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });

    renderPicker();
    await screen.findByTestId('wizard');

    expect(peekDeferredFirstRun()).toBeNull();
  });

  it('does nothing at all when no wizard is parked', async () => {
    renderPicker();

    // The ordinary landing: the picker renders, no redirect.
    await waitFor(() => expect(mockGetCircles).toHaveBeenCalled());
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('no-wizard')).not.toBeInTheDocument();
  });

  it('ignores another account deferral on a shared browser', async () => {
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    useAuthStore.setState({
      user: { id: 'user-2', email: 'other@example.com' } as never,
      isAuthenticated: true,
    });

    renderPicker();

    await waitFor(() => expect(mockGetCircles).toHaveBeenCalled());
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
  });

  // THE RACE the `deferredHandledRef` guard in CirclePickerPage exists for: a
  // brand-new owner, free tier, whose only circle triggered the onboarding
  // paywall — they back out of it and land back on `/circles` with BOTH a
  // parked wizard record AND exactly one circle (their new one). Without the
  // guard, the auto-skip effect would ALSO fire its own bare `replace` to the
  // very same circle, and whichever `navigate()` call wins the race strips
  // the wizard's `location.state` — a silent regression the single-circle
  // fixture in the OTHER auto-skip tests (CirclePickerPage.test.tsx) can
  // never exercise, since none of them ever also park a deferred record.
  it('the deferred wizard wins the single-circle auto-skip race — no bare replace fires', async () => {
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    mockGetCircles.mockResolvedValue([
      {
        id: 'circle-9',
        name: "Rose's Circle",
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
      } satisfies Circle,
    ]);

    renderPicker();

    expect(await screen.findByTestId('wizard')).toHaveTextContent('wizard for circle-9 / Rose');
    // The auto-skip's OWN (state-less) navigation never landed on top of it —
    // if it had, this would show instead (same route, no firstRun state).
    expect(screen.queryByTestId('no-wizard')).not.toBeInTheDocument();
  });
});
