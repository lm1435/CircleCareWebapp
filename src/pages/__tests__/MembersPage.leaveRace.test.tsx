import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import MembersPage from '@/pages/MembersPage';
import CirclePickerPage from '@/pages/CirclePickerPage';
import { ToastProvider } from '@/components/ui';
import { getCircles, type Circle } from '@/api/circles';
import { leaveCircle, type CircleDetail, type CircleMember } from '@/api/circleMembers';
import { queryKeys } from '@/lib/queryKeys';

/**
 * PK16 — leaving a circle: `navigate('/circles')` must not auto-forward the user
 * back into the circle they just left.
 *
 * The picker AUTO-SKIPS into the only circle in the list. The leave handler used
 * to invalidate `['circles']` and navigate in the same tick, so a user whose
 * cached list held just the left circle landed on /circles, read the STALE one-item
 * list, and was forwarded to /circles/<left> (which then errors / shows
 * "no longer available"). REAL useLeaveCircle + REAL picker; only the HTTP
 * layer is mocked. Leaves the circle list fresh-looking in cache, as it is after
 * the user opened the picker/switcher earlier in the session.
 */
vi.mock('@/api/circles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circles')>();
  return { ...actual, getCircles: vi.fn() };
});
vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return { ...actual, leaveCircle: vi.fn() };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackCirclesLoaded: vi.fn() }));
vi.mock('@/store/authStore', () => {
  const state = { user: { id: 'u1' } };
  return {
    useAuthStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      { getState: () => state }
    ),
  };
});
vi.mock('@/hooks/useInvites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useInvites')>()),
  useCancelInvite: () => ({ mutate: vi.fn(), isPending: false }),
  useResendInvite: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateInvite: () => ({ mutate: vi.fn(), isPending: false }),
}));

const members: CircleMember[] = [
  {
    id: 'u-owner',
    email: 'luis@example.com',
    first_name: 'Luis',
    last_name: 'M',
    role: 'owner',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-02-10T15:00:00Z',
    timezone: 'America/Chicago',
  },
  {
    id: 'u1',
    email: 'ana@example.com',
    first_name: 'Ana',
    last_name: 'Reyes',
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-02-10T15:00:00Z',
    timezone: 'America/Chicago',
  },
];
const detail = {
  id: 'c1',
  name: "Mom's Care",
  recipient_name: 'Rose',
  recipient_photo_url: null,
  recipient_dob: null,
  recipient_conditions: null,
  owner_id: 'u-owner',
  created_at: '2026-01-01T00:00:00Z',
  is_self_care: false,
  care_recipient_timezone: 'America/Chicago',
  members,
  pending_invites: [],
  access_level: 'full',
  is_premium_circle: true,
  can_edit: true,
  view_only: false,
} as unknown as CircleDetail;
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    circle: detail,
    members: detail.members,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const leftCircle = {
  id: 'c1',
  name: "Mom's Care",
  recipient_name: 'Rose',
  recipient_photo_url: null,
  role: 'member',
  is_care_recipient: false,
  member_count: 2,
  created_at: '2026-01-01T00:00:00Z',
  access_level: 'full',
  is_premium_circle: true,
  can_edit: true,
  view_only: false,
  read_only: false,
} as unknown as Circle;

const visited: string[] = [];
function LocationProbe(): null {
  const loc = useLocation();
  visited.push(loc.pathname);
  return null;
}

describe('PK16: leaving the only circle never forwards back into it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visited.length = 0;
  });

  it('lands on the circle picker (empty), never on /circles/<left>', async () => {
    const user = userEvent.setup();
    vi.mocked(leaveCircle).mockResolvedValue(undefined);
    // Server truth after the leave: no circles. A slow response keeps the stale
    // one-item list on screen long enough for the auto-skip to read it.
    vi.mocked(getCircles).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 150))
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.circles, [leftCircle]);

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/circles/c1/members']}>
            <LocationProbe />
            <Routes>
              <Route path="/circles/:circleId/members" element={<MembersPage />} />
              <Route path="/circles" element={<CirclePickerPage />} />
              <Route path="/circles/:circleId" element={<div data-testid="overview-page" />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Leave circle' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave circle' }));

    await waitFor(() => expect(visited).toContain('/circles'));
    // Let the refetch land and every effect settle.
    await new Promise((r) => setTimeout(r, 400));

    expect(visited).not.toContain('/circles/c1');
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
    expect(visited[visited.length - 1]).toBe('/circles');
  });
});
