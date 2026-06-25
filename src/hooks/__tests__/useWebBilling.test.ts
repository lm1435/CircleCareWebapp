import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/purchases', () => ({
  getWebOffering: vi.fn(),
  purchasePackage: vi.fn(),
  getManagementUrl: vi.fn(),
  toWebPlan: vi.fn((pkg: unknown) => pkg),
  isWebBillingConfigured: vi.fn(() => true),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1', email: 'a@b.com' } }),
}));

import { getWebOffering, purchasePackage } from '@/lib/purchases';
import { useWebPlans, usePurchasePlan } from '@/hooks/useWebBilling';

const mockedGetOffering = getWebOffering as unknown as ReturnType<typeof vi.fn>;
const mockedPurchase = purchasePackage as unknown as ReturnType<typeof vi.fn>;

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWebPlans', () => {
  it('maps the web offering monthly + annual packages', async () => {
    mockedGetOffering.mockResolvedValue({
      monthly: { identifier: '$rc_monthly' },
      annual: { identifier: '$rc_annual' },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useWebPlans(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.monthly?.identifier).toBe('$rc_monthly');
    expect(result.current.data?.annual?.identifier).toBe('$rc_annual');
    expect(mockedGetOffering).toHaveBeenCalledWith('user-1');
  });

  it('tolerates an offering missing a package type', async () => {
    mockedGetOffering.mockResolvedValue({ monthly: { identifier: '$rc_monthly' }, annual: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useWebPlans(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.annual).toBeNull();
  });
});

describe('usePurchasePlan', () => {
  it('purchases the package and refreshes entitlement caches', async () => {
    mockedPurchase.mockResolvedValue({});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => usePurchasePlan(), { wrapper: wrapper(client) });
    const plan = { rcPackage: { identifier: '$rc_monthly' } } as never;
    await result.current.mutateAsync(plan);

    expect(mockedPurchase).toHaveBeenCalledWith(
      'user-1',
      { identifier: '$rc_monthly' },
      'a@b.com'
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['subscription-status'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['circles'] });
  });
});
