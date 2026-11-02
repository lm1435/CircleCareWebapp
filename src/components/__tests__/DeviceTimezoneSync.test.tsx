import { render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockUser: { id: string; timezone: string | null } | undefined;
const mockSync = vi.fn();
vi.mock('@/api/users', () => ({ getCurrentUser: () => Promise.resolve(mockUser) }));
vi.mock('@/utils/deviceTimezoneSync', () => ({
  syncDeviceTimezone: (...a: unknown[]) => mockSync(...a),
}));
vi.mock('@/utils/timezone', () => ({ getDeviceTimezone: () => 'Europe/Madrid' }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: true }),
}));

import { queryClient } from '@/lib/queryClient';
import { DeviceTimezoneSync } from '../DeviceTimezoneSync';

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  mockUser = { id: 'u1', timezone: 'America/Denver' };
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

  it('does not refetch when nothing was written', async () => {
    mockSync.mockResolvedValue('same');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    mount();
    await waitFor(() => expect(mockSync).toHaveBeenCalled());
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });
});
