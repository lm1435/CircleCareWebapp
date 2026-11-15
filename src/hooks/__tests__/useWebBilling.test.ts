import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/purchases', () => ({
  getWebOffering: vi.fn(),
  purchasePackage: vi.fn(),
  getManagementUrl: vi.fn(),
  toWebPlan: vi.fn((pkg: unknown) => pkg),
}));

vi.mock('@/api/users', () => ({
  refreshSubscriptionStatus: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/webBillingConfig', () => ({
  isWebBillingConfigured: vi.fn(() => true),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1', email: 'a@b.com' } }),
}));

import { getWebOffering, purchasePackage, getManagementUrl } from '@/lib/purchases';
import { refreshSubscriptionStatus } from '@/api/users';
import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';

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
  it('syncs the tier with the backend BEFORE invalidating subscription-status and circles', async () => {
    mockedPurchase.mockResolvedValue({});
    (refreshSubscriptionStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => usePurchasePlan(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ rcPackage: { identifier: '$rc_monthly' } } as never);

    const sync = refreshSubscriptionStatus as unknown as ReturnType<typeof vi.fn>;
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.invocationCallOrder[0]).toBeLessThan(invalidate.mock.invocationCallOrder[0]);
  });

  it('a failed sync still invalidates and resolves (never reports the purchase as failed)', async () => {
    mockedPurchase.mockResolvedValue({});
    (refreshSubscriptionStatus as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('x')
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => usePurchasePlan(), { wrapper: wrapper(client) });
    await expect(
      result.current.mutateAsync({ rcPackage: { identifier: '$rc_monthly' } } as never)
      // Resolves with the purchase's CustomerInfo (null when RevenueCat sent none).
    ).resolves.toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['subscription-status'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['circles'] });
  });
});

// BH-025: window.open returns null whenever 'noopener'/'noreferrer' is in the features
// string (HTML spec), even when the tab opened. The old code read that null as "popup
// blocked" and ALSO navigated the app tab. The stub below follows the spec.
describe('useManageSubscription (BH-025)', () => {
  const URL_ = 'https://billing.example.com/portal';
  const assign = vi.fn();
  let openSpy: ReturnType<typeof vi.fn>;
  const realLocation = window.location;
  const tab: { opener: unknown } = { opener: 'sentinel' };

  async function run() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useManageSubscription(), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current.mutateAsync();
    });
  }

  beforeEach(() => {
    assign.mockReset();
    tab.opener = 'sentinel';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, assign },
    });
    openSpy = vi.fn((_u: string, _t?: string, features?: string) =>
      features && /noopener|noreferrer/.test(features) ? null : tab
    );
    vi.stubGlobal('open', openSpy);
    (getManagementUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(URL_);
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    vi.unstubAllGlobals();
  });

  it('positive: opens the billing page in a new tab and severs the opener', async () => {
    await run();
    expect(openSpy).toHaveBeenCalledWith(URL_, '_blank');
    expect(tab.opener).toBeNull();
  });

  it('negative: does NOT navigate the current tab when the new tab opened', async () => {
    await run();
    expect(assign).not.toHaveBeenCalled();
  });

  it('positive: falls back to same-tab navigation when the popup is blocked', async () => {
    openSpy.mockImplementation(() => null);
    await run();
    expect(assign).toHaveBeenCalledWith(URL_);
  });

  it('negative: no open and no navigation when there is no management URL', async () => {
    (getManagementUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await run();
    expect(openSpy).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
