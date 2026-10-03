import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { ToastProvider } from '@/components/ui';
import { AppLayout } from '@/components/layout/AppLayout';
import EmergencyInfoPage from '@/pages/EmergencyInfoPage';
import MedicationsPage from '@/pages/MedicationsPage';

/**
 * A REMOVED member's circle pages must settle, not loop (parity with mobile
 * EmergencyInfoRemovedMemberLoop.test.tsx, 2026-09-30). Mobile looped because the PK14 purge
 * clears the failed circle read's data and React Query refetches a data-less errored query on
 * every observer mount while a full-screen loader remounted the other circle readers. Web uses
 * the REAL lib/queryClient (QueryCache onError purge + list purge) and renders AppLayout, which
 * swaps the page for CircleAccessLost on FORBIDDEN, so nothing remounts: requests stay bounded.
 */
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('@/components/NeedsCircleSelectionBanner', () => ({ NeedsCircleSelectionBanner: () => null }));
vi.mock('@/components/ai/AIChatModal', () => ({ AIChatModal: () => null }));
vi.mock('@/components/calendar/AddEventModal', () => ({ AddEventModal: () => null }));
vi.mock('@/lib/onboardingAnalytics', () => ({ trackCirclesLoaded: vi.fn() }));

const mockedGet = vi.mocked(apiClient.get);
const circle = {
  id: 'c1', owner_id: 'u1', name: 'Susan', recipient_name: 'Susan', recipient_dob: null,
  recipient_conditions: null, timezone: 'America/Denver', care_recipient_timezone: 'America/Denver',
  can_edit: false, view_only: false, members: [], pending_invites: [],
};
const FORBIDDEN = { success: false, error: { code: 'FORBIDDEN', message: 'Not a member' } };
let removed = false;

function route(): void {
  mockedGet.mockImplementation((url: string) => {
    if (removed) return Promise.reject(FORBIDDEN);
    if (url === '/circles/c1') return Promise.resolve({ success: true, data: { circle } });
    if (url === '/circles') return Promise.resolve({ success: true, data: { circles: [circle] } });
    if (url.includes('emergency-info'))
      return Promise.resolve({ success: true, data: { emergency_info: { emergency_contacts: [] } } });
    return Promise.resolve({ success: true, data: { events: [], medications: [], items: [] } });
  });
}

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  removed = false;
  queryClient.clear();
  mockedGet.mockReset();
  route();
});
afterEach(() => queryClient.clear());

it.each([
  ['emergency', '/circles/c1/emergency'],
  ['meds', '/circles/c1/meds'],
])('%s: after the circle read answers 403 the request count settles', async (_n, path) => {
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/circles/:circleId" element={<AppLayout />}>
              <Route path="emergency" element={<EmergencyInfoPage />} />
              <Route path="meds" element={<MedicationsPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  await wait(500);
  removed = true;
  act(() => { void queryClient.invalidateQueries({ queryKey: ['circle', 'c1'], exact: true }); });
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: 'Access removed' })).toBeInTheDocument()
  , { timeout: 5000 });
  await wait(1500);
  const settled = mockedGet.mock.calls.length;
  await wait(2500);
  expect(mockedGet.mock.calls.length).toBe(settled);
  expect(mockedGet.mock.calls.filter(([u]) => u === '/circles/c1').length).toBeLessThanOrEqual(3);
}, 20000);
