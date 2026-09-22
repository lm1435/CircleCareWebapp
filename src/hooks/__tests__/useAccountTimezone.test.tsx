import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/users', () => ({ getCurrentUser: vi.fn() }));

import { getCurrentUser, type User } from '@/api/users';
import { useAccountTimezone } from '@/hooks/useAccountTimezone';
import { useAuthStore } from '@/store/authStore';

// ONE OF the country gate's two inputs — `webCheckoutVerdict` combines it
// with the browser's live zone (lib/checkoutCountry.ts). This hook does not
// decide anything; what it owes the decision is an honest `timezone` and an
// honest `isPending`, so that "not answered yet" never looks like "answered
// with nothing", which is what separates a spinner from a retry.

const mockGetCurrentUser = vi.mocked(getCurrentUser);

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    email: 'a@b.com',
    timezone: 'America/Denver',
    notification_preferences: {
      medication_confirmations: true,
      missed_medications: true,
      task_assignments: true,
      appointment_reminders: true,
      activity_updates: true,
      chat_messages: true,
      note_nudges: true,
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup(): { wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: true });
});

describe('useAccountTimezone', () => {
  it("returns the account's saved zone once the row arrives", async () => {
    mockGetCurrentUser.mockResolvedValue(makeUser({ timezone: 'Australia/Sydney' }));
    const { wrapper } = setup();

    const { result } = renderHook(() => useAccountTimezone(), { wrapper });
    await waitFor(() => expect(result.current.timezone).toBe('Australia/Sydney'));
    expect(result.current.isPending).toBe(false);
  });

  it('is pending, with no zone, while the read is in flight', () => {
    mockGetCurrentUser.mockReturnValue(new Promise(() => {}) as Promise<User>);
    const { wrapper } = setup();

    const { result } = renderHook(() => useAccountTimezone(), { wrapper });
    expect(result.current.timezone).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });

  // Pending must go false, or the page waits forever on a read that is over.
  it('stops being pending, with no zone, when the read fails', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('offline'));
    const { wrapper } = setup();

    const { result } = renderHook(() => useAccountTimezone(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.timezone).toBeUndefined();
  });

  it('reports no zone when the row carries none at all', async () => {
    mockGetCurrentUser.mockResolvedValue(makeUser({ timezone: undefined }));
    const { wrapper } = setup();

    const { result } = renderHook(() => useAccountTimezone(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.timezone).toBeUndefined();
  });

  // `''` and whitespace are absence wearing a string's clothes, and must not
  // reach the gate as if they were a zone.
  it.each(['', '   ', '\t'])('reports no zone when the timezone is %p', async (timezone) => {
    mockGetCurrentUser.mockResolvedValue(makeUser({ timezone }));
    const { wrapper } = setup();

    const { result } = renderHook(() => useAccountTimezone(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.timezone).toBeUndefined();
  });

  // A disabled query reports `isPending` too. Reporting it here would hang the
  // page on a read that was never started.
  it('is not pending when signed out, and issues no request', () => {
    useAuthStore.setState({ isAuthenticated: false });
    const { wrapper } = setup();

    const { result } = renderHook(() => useAccountTimezone(), { wrapper });
    expect(result.current.isPending).toBe(false);
    expect(result.current.timezone).toBeUndefined();
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  it('re-runs the read when the retry affordance calls refetch', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(new Error('offline'));
    mockGetCurrentUser.mockResolvedValue(makeUser({ timezone: 'America/Toronto' }));
    const { wrapper } = setup();

    const { result } = renderHook(() => useAccountTimezone(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.timezone).toBeUndefined();

    result.current.refetch();
    await waitFor(() => expect(result.current.timezone).toBe('America/Toronto'));
  });
});
