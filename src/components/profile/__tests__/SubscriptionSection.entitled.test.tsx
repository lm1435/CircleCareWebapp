import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { ToastProvider } from '@/components/ui';

/**
 * 1.4.3 item 2, profile card: backend tier OR an active entitlement. P2-1:
 * backend free + RevenueCat active shows the Premium card with NO Upgrade
 * button and re-syncs the backend once. N2-1: free + inactive keeps Upgrade.
 */

const customerInfoHook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useWebBilling', () => ({
  useWebCustomerInfo: () => customerInfoHook(),
  useManageSubscription: () => ({ mutate: vi.fn(), isPending: false }),
  useWebPlans: () => ({ data: undefined }),
}));
const getStatus = vi.hoisted(() => vi.fn());
vi.mock('@/api/subscriptionStatus', () => ({
  getSubscriptionStatus: () => getStatus(),
  selectDowngradeCircle: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/api/users', () => ({ refreshSubscriptionStatus: () => refresh() }));
vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: vi.fn(() => true) }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    trialChargeNoticeShown: vi.fn(),
    paywallSuppressedEntitled: vi.fn(),
    entitlementTierMismatch: vi.fn(),
  },
}));

import { SubscriptionSection } from '@/components/profile/SubscriptionSection';
import { Analytics } from '@/lib/analytics';
import { resetEffectivePremiumSession } from '@/lib/effectivePremium';
import { useAuthStore } from '@/store/authStore';

const ENTITLED = { entitlements: { active: { 'CircleCare Premium': { periodType: 'NORMAL' } } } };
const free = { tier: 'free', needsCircleSelection: false };

function renderSection(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <SubscriptionSection />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetEffectivePremiumSession();
  useAuthStore.setState({ user: { id: 'user-1', email: 'u@example.com' } as never, isAuthenticated: true });
  refresh.mockResolvedValue(undefined);
});

describe('SubscriptionSection: entitled (item 2)', () => {
  it('P2-1 backend free + entitlement active: Premium card, no Upgrade, one re-sync', async () => {
    customerInfoHook.mockReturnValue({ data: ENTITLED, isPending: false, fetchStatus: 'idle' });
    getStatus.mockResolvedValue(free);
    renderSection();
    expect(await screen.findByText('CircleCare Premium')).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    expect(Analytics.paywallSuppressedEntitled).toHaveBeenCalledWith('profile');
  });

  it('a failed sync still shows Premium (RevenueCat says paid) and never an error', async () => {
    customerInfoHook.mockReturnValue({ data: ENTITLED, isPending: false, fetchStatus: 'idle' });
    getStatus.mockResolvedValue(free);
    refresh.mockRejectedValue(new Error('down'));
    renderSection();
    expect(await screen.findByText('CircleCare Premium')).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('N2-1 backend free + RevenueCat inactive: the Upgrade button stays, no re-sync', async () => {
    customerInfoHook.mockReturnValue({
      data: { entitlements: { active: {} } },
      isPending: false,
      fetchStatus: 'idle',
    });
    getStatus.mockResolvedValue(free);
    renderSection();
    expect(await screen.findByRole('button', { name: /upgrade/i })).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(Analytics.paywallSuppressedEntitled).not.toHaveBeenCalled();
  });

  it('N2-6 sign-out clears the once-per-session flag: the next account syncs its own mismatch', async () => {
    customerInfoHook.mockReturnValue({ data: ENTITLED, isPending: false, fetchStatus: 'idle' });
    getStatus.mockResolvedValue(free);
    renderSection();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    resetEffectivePremiumSession(); // authStore.clearLocalSession does this
    useAuthStore.setState({ user: { id: 'user-2', email: 'v@example.com' } as never });
    renderSection();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });
});
