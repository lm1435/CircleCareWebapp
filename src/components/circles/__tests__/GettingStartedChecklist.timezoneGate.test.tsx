import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';

// THE DOUBLE PRESENCE READ.
//
// `useCircle` used to report 'America/New_York' unconditionally — including
// while the circle detail query was still in flight — which made "still
// loading" indistinguishable from "the care recipient lives in New York". This
// checklist dates a 211-day presence window off that value, so it fired ONE
// read for a New-York-anchored window and then a SECOND for the recipient's
// real window the moment the detail landed.
//
// The e2e spec `e2e/unhappy/writes/home-events-requests.spec.ts` ("exactly one
// presence read") catches it, but only during the part of the day when New
// York and the recipient's zone are on different calendar days. This test pins
// the clock so it fails for the right reason at ANY wall-clock time.
//
// The SEAM: `useCircleMembers` (the detail fetcher) is mocked so the test owns
// "loading" vs "resolved", but `useCircle` itself is REAL — its null-vs-
// fallback decision is exactly what is under test — and so is the presence
// query underneath the checklist, so a request either leaves or it does not.

let detailState: {
  data: CircleDetail | undefined;
  members: CircleMember[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock('@/hooks/useCircleMembers', () => ({
  useCircleMembers: () => detailState,
}));
vi.mock('@/hooks/useCircles', () => ({
  useCircles: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: { gettingStartedStepTapped: vi.fn(), gettingStartedDismissed: vi.fn() },
}));

import { GettingStartedChecklist } from '../GettingStartedChecklist';

const get = apiClient.get as unknown as Mock;
const PRESENCE_URL = '/circles/circle-1/events/presence';

// 2026-09-16T02:30:00Z is deliberately a moment where the two zones disagree
// about the DATE: New York reads 2026-09-15 (22:30 EDT), Tokyo reads
// 2026-09-16 (11:30 JST). Anything anchored on the placeholder zone therefore
// produces a visibly different window from the correct one.
const INSTANT = new Date('2026-09-16T02:30:00Z');
const RECIPIENT_TZ = 'Asia/Tokyo';
/** Tokyo's 2026-09-16, minus 30 / plus 180 days. */
const TOKYO_WINDOW = { start_date: '2026-08-17', end_date: '2027-03-15' };
/** What New York's 2026-09-15 would have produced — the bug's fingerprint. */
const NEW_YORK_WINDOW = { start_date: '2026-08-16', end_date: '2027-03-14' };

const OWNER: CircleMember = {
  id: 'owner',
  email: 'owner@example.com',
  first_name: 'O',
  last_name: 'W',
  role: 'owner',
  is_care_recipient: false,
  is_medication_responsible: false,
  joined_at: '2026-01-01T00:00:00Z',
  timezone: RECIPIENT_TZ,
};

const RESOLVED_DETAIL = {
  id: 'circle-1',
  name: 'Mom',
  recipient_name: 'Mom',
  recipient_photo_url: null,
  recipient_dob: null,
  recipient_conditions: null,
  owner_id: 'owner',
  created_at: '2026-01-01T00:00:00Z',
  is_self_care: false,
  care_recipient_timezone: RECIPIENT_TZ,
  members: [OWNER],
  pending_invites: [],
  access_level: 'full',
  is_premium_circle: true,
  can_edit: true,
  view_only: false,
} as unknown as CircleDetail;

/** Every presence request that actually left, as `{start_date, end_date}`. */
const presenceWindows = (): Array<{ start_date?: string; end_date?: string }> =>
  get.mock.calls
    .filter(([url]) => url === PRESENCE_URL)
    .map(([, config]) => ({
      start_date: (config as { params?: Record<string, string> })?.params?.start_date,
      end_date: (config as { params?: Record<string, string> })?.params?.end_date,
    }));

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(INSTANT);
  get.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/circles/circle-1/emergency-info') {
      return Promise.resolve({ success: true, data: { emergency_info: null } });
    }
    if (url === PRESENCE_URL) {
      return Promise.resolve({
        success: true,
        data: { medication: true, appointment: false, task: false },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  localStorage.clear();
  detailState = {
    data: undefined,
    members: [],
    isLoading: true,
    isError: false,
    refetch: vi.fn(),
  };
  useAuthStore.setState({
    user: { id: 'owner', email: 'owner@example.com', first_name: 'O', last_name: 'W' },
    isAuthenticated: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

it('issues NO presence read while the care recipient timezone is unresolved, then exactly ONE anchored in that zone', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  const tree = (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <GettingStartedChecklist circleId="circle-1" />
      </QueryClientProvider>
    </MemoryRouter>
  );

  const { rerender } = render(tree);
  await settle();

  // The circle detail has not landed, so there is no zone to date a window in.
  // Before the fix this fired `2026-08-16..2027-03-14` — New York's answer,
  // dressed up as the recipient's.
  expect(presenceWindows()).toEqual([]);

  // The detail lands with the REAL zone.
  await act(async () => {
    detailState = {
      data: RESOLVED_DETAIL,
      members: [OWNER],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    rerender(tree);
    await Promise.resolve();
  });
  await waitFor(() => expect(presenceWindows().length).toBeGreaterThan(0));
  await settle();

  expect(presenceWindows()).toEqual([TOKYO_WINDOW]);
  expect(presenceWindows()).not.toContainEqual(NEW_YORK_WINDOW);
});
