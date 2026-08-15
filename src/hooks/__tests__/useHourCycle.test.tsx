import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/users', () => ({ getCurrentUser: vi.fn() }));

import { getCurrentUser, type User } from '@/api/users';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useAuthStore } from '@/store/authStore';

// useHourCycle reads the SHARED currentUser query and applies the web
// resolution chain (see utils/hourCycle.ts). The browser locale is pinned here
// so the runner's locale never decides the outcome.

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

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

/** Pin the browser-locale step (step 2 of the chain) to a 12-hour locale. */
function pinBrowserLocale(hour12: boolean): void {
  vi.stubGlobal('navigator', { ...globalThis.navigator, language: 'en-US' });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    hour12,
  } as unknown as Intl.ResolvedDateTimeFormatOptions);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useHourCycle', () => {
  it('uses the phone-synced uses_24h_clock when present', async () => {
    pinBrowserLocale(true); // locale says 12h — the synced value must win
    mockGetCurrentUser.mockResolvedValue(makeUser({ uses_24h_clock: true }));
    const { wrapper } = setup();

    const { result } = renderHook(() => useHourCycle(), { wrapper });
    await waitFor(() => expect(result.current).toBe('24h'));
  });

  it('returns 12h when the phone synced uses_24h_clock: false', async () => {
    pinBrowserLocale(false); // locale says 24h — the synced value must win
    mockGetCurrentUser.mockResolvedValue(
      makeUser({ uses_24h_clock: false, timezone: 'Europe/Madrid' })
    );
    const { wrapper } = setup();

    const { result } = renderHook(() => useHourCycle(), { wrapper });
    await waitFor(() => expect(result.current).toBe('12h'));
  });

  it('falls back to the browser locale when the column is null', async () => {
    pinBrowserLocale(false);
    mockGetCurrentUser.mockResolvedValue(
      makeUser({ uses_24h_clock: null, timezone: 'America/Denver' })
    );
    const { wrapper } = setup();

    const { result } = renderHook(() => useHourCycle(), { wrapper });
    await waitFor(() => expect(result.current).toBe('24h'));
  });

  it('returns a usable cycle while loading and when signed out', () => {
    pinBrowserLocale(true);
    useAuthStore.setState({ isAuthenticated: false });
    const { wrapper } = setup();

    const { result } = renderHook(() => useHourCycle(), { wrapper });
    expect(result.current).toBe('12h');
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });
});
