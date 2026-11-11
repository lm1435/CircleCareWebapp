import { act, render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockUser: { id: string; timezone: string | null } | undefined;
let mockDevice = 'Europe/Madrid';
let useRealSync = false;
const mockSync = vi.fn();
const mockUpdateProfile = vi.fn();
vi.mock('@/api/users', () => ({
  getCurrentUser: () => Promise.resolve(mockUser),
  updateProfile: (...a: unknown[]) => mockUpdateProfile(...a),
  getTimezoneDependentCircles: () => Promise.resolve([]),
}));
// Delegates to the REAL sync unless a test installs its own outcome on `mockSync`.
vi.mock('@/utils/deviceTimezoneSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/deviceTimezoneSync')>();
  return {
    ...actual,
    syncDeviceTimezone: (...a: unknown[]) =>
      useRealSync
        ? (actual.syncDeviceTimezone as (...x: unknown[]) => unknown)(...a)
        : mockSync(...a),
  };
});
vi.mock('@/utils/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/timezone')>()),
  getDeviceTimezone: () => mockDevice,
}));
vi.mock('@/lib/analytics', () => ({ Analytics: { timezoneSynced: vi.fn() } }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: true }),
}));

import { queryClient } from '@/lib/queryClient';
import { DeviceTimezoneSync } from '../DeviceTimezoneSync';

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  mockUser = { id: 'u1', timezone: 'America/Denver' };
  mockDevice = 'Europe/Madrid';
  useRealSync = false;
  mockSync.mockResolvedValue('same');
});

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <DeviceTimezoneSync />
    </QueryClientProvider>
  );

describe('DeviceTimezoneSync (session start)', () => {
  it('syncs once with the stored and browser zones', async () => {
    const { rerender } = mount();
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('America/Denver', 'Europe/Madrid'));
    rerender(
      <QueryClientProvider client={queryClient}>
        <DeviceTimezoneSync />
      </QueryClientProvider>
    );
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('refetches the user after a write so the Profile row updates', async () => {
    mockSync.mockResolvedValue('written');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    mount();
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it("after a write, a cached circle's detail is stale too (a circle with no recipient account follows the owner's zone)", async () => {
    mockSync.mockResolvedValue('written');
    queryClient.setQueryData(['circle', 'c1'], { id: 'c1', care_recipient_timezone: 'America/New_York' });
    mount();
    await waitFor(() => expect(queryClient.getQueryState(['circle', 'c1'])?.isInvalidated).toBe(true));
  });

  it('does not refetch when nothing was written', async () => {
    mockSync.mockResolvedValue('same');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    mount();
    await waitFor(() => expect(mockSync).toHaveBeenCalled());
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });
});

// BC-9: the browser zone is re-read when a tab left open across travel comes back, throttled like mobile's
// foreground sync (FOREGROUND_SETTINGS_SYNC_THROTTLE_MS = 5 minutes), and a failed write is retried.
describe('DeviceTimezoneSync (return to the tab)', () => {
  const FIVE_MIN = 5 * 60 * 1000;
  beforeEach(() => {
    useRealSync = true;
    vi.useFakeTimers({ shouldAdvanceTime: false });
    // The stored zone stays as the user query returned it (the refetch after a write is not under test here).
    mockUpdateProfile.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  // Lets the user query, the write, and the invalidation-driven refetch all land (well inside the throttle).
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(100);
    });
  const comeBack = async (afterMs: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(afterMs);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
  };

  it('re-checks when the tab becomes visible and the browser zone changed', async () => {
    mockUser = { id: 'u1', timezone: 'Pacific/Auckland' };
    mockDevice = 'America/Denver';
    mount();
    await settle();
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenLastCalledWith({ timezone: 'America/Denver' });
    mockDevice = 'Europe/Madrid';
    await comeBack(FIVE_MIN + 1);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(2);
    expect(mockUpdateProfile).toHaveBeenLastCalledWith({ timezone: 'Europe/Madrid' });
  });

  it('does not re-check inside the 5-minute throttle', async () => {
    mockUser = { id: 'u1', timezone: 'Pacific/Auckland' };
    mockDevice = 'America/Denver';
    mount();
    await settle();
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    mockDevice = 'Europe/Madrid';
    await comeBack(FIVE_MIN - 1000);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
  });

  it('a failed write is retried on the next visibility change', async () => {
    mockUser = { id: 'u1', timezone: 'Pacific/Auckland' };
    mockDevice = 'America/Denver';
    mockUpdateProfile.mockRejectedValueOnce(new Error('offline'));
    mount();
    await settle();
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    await comeBack(FIVE_MIN + 1);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(2);
    expect(mockUpdateProfile).toHaveBeenLastCalledWith({ timezone: 'America/Denver' });
  });

  it('same zone under an alias (Asia/Calcutta vs Asia/Kolkata) writes nothing', async () => {
    mockUser = { id: 'u1', timezone: 'Asia/Calcutta' };
    mockDevice = 'Asia/Kolkata';
    mount();
    await settle();
    await comeBack(FIVE_MIN + 1);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('a hidden tab never re-checks', async () => {
    mockUser = { id: 'u1', timezone: 'Pacific/Auckland' };
    mockDevice = 'America/Denver';
    mount();
    await settle();
    mockDevice = 'Europe/Madrid';
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await comeBack(FIVE_MIN + 1);
    vis.mockRestore();
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
  });
});
