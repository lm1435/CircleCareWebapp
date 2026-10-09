import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { useLatestDailyUpdatePath } from '../useDailyUpdate';

/**
 * The way back to the daily updates (Quick access row + Activity feed link;
 * docs/plans/daily-update.md "Design v2 B2"): shown only while rollout is on for
 * the viewer and the viewer is not the care recipient; opens today's update
 * from 19:00 recipient time when today has activity, else yesterday's.
 */
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
const get = vi.mocked(apiClient.get);
const TZ = 'America/New_York';

let today: unknown;
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setCircle(recipientIsViewer = false): void {
  vi.mocked(useCircle).mockReturnValue({
    timezone: TZ,
    members: [{ id: 'u1', is_care_recipient: recipientIsViewer }],
  } as unknown as ReturnType<typeof useCircle>);
}

function data(over: Record<string, unknown> = {}) {
  return { success: true, data: { enabled: true, date: '2026-10-08', eligible: true, has_activity: true, ...over } };
}

describe('useLatestDailyUpdatePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useAuthStore.setState({ user: { id: 'u1', email: 'p@example.com', first_name: 'P', last_name: 'L' } });
    setCircle();
    today = data();
    get.mockImplementation(async (url: string) => {
      if (url === '/circles/c1/daily-update') return today as never;
      throw new Error(`unexpected GET ${url}`);
    });
  });
  afterEach(() => vi.useRealTimers());

  it('19:00+ recipient time with activity today → today', async () => {
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z')); // 20:00 EDT Oct 8
    const { result } = renderHook(() => useLatestDailyUpdatePath('c1'), { wrapper });
    await waitFor(() => expect(result.current).toBe('/circles/c1/daily-update'));
    // The date-less read (the recipient's today), shared with the invite line.
    expect(get).toHaveBeenCalledWith('/circles/c1/daily-update', undefined);
  });

  it('before 19:00 → yesterday', async () => {
    vi.setSystemTime(new Date('2026-10-08T16:00:00Z')); // 12:00 EDT
    const { result } = renderHook(() => useLatestDailyUpdatePath('c1'), { wrapper });
    await waitFor(() => expect(result.current).toBe('/circles/c1/daily-update/2026-10-07'));
  });

  it('19:00+ but no activity today → yesterday', async () => {
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    today = data({ has_activity: false });
    const { result } = renderHook(() => useLatestDailyUpdatePath('c1'), { wrapper });
    await waitFor(() => expect(result.current).toBe('/circles/c1/daily-update/2026-10-07'));
  });

  it('hidden while rollout is off for the viewer', async () => {
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    today = { success: true, data: { enabled: false } };
    const { result } = renderHook(() => useLatestDailyUpdatePath('c1'), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
  });

  it('hidden for the care recipient (member flag, and the server\'s eligible:false)', async () => {
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    setCircle(true);
    const a = renderHook(() => useLatestDailyUpdatePath('c1'), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(a.result.current).toBeNull();

    setCircle(false);
    today = data({ eligible: false });
    const b = renderHook(() => useLatestDailyUpdatePath('c1'), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(b.result.current).toBeNull();
  });
});
