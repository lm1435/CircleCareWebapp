import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { ToastProvider } from '@/components/ui';

/**
 * 1.4.3 item 2 (web): premium = backend tier OR an active entitlement from the
 * web customer info, on the paywall. REAL `useEffectivePremium` and REAL
 * `useSubscriptionStatus` against a real QueryClient; only the HTTP functions and
 * RevenueCat's reads are stubbed.
 *
 * Fable S6: "already Premium" appears ONLY once the backend confirms; otherwise
 * "Activating your Premium" with Retry, never the packages, never a 402 loop.
 * S7: the page is not delayed by the entitlement read, and the Subscribe button
 * is held only briefly and then fails open.
 */

const customerInfoHook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useWebBilling', () => ({
  useWebPlans: vi.fn(),
  usePurchasePlan: vi.fn(),
  useManageSubscription: vi.fn(),
  useWebCustomerInfo: () => customerInfoHook(),
}));
const getStatus = vi.hoisted(() => vi.fn());
vi.mock('@/api/subscriptionStatus', () => ({
  getSubscriptionStatus: () => getStatus(),
  selectDowngradeCircle: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/api/users', () => ({ refreshSubscriptionStatus: () => refresh() }));
vi.mock('@/lib/purchases', () => ({ isUserCancelledError: vi.fn(() => false) }));
vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: vi.fn(() => true) }));
vi.mock('@/hooks/useAccountTimezone', () => ({
  useAccountTimezone: () => ({ timezone: 'America/New_York', isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    planSelectionViewed: vi.fn(),
    planSelectionFreeSelected: vi.fn(),
    planSelectionSubscribed: vi.fn(),
    planSelectionTrialStarted: vi.fn(),
    purchaseCompleted: vi.fn(),
    trialStarted: vi.fn(),
    planSelectionPurchaseCancelled: vi.fn(),
    planSelectionPlanChanged: vi.fn(),
    planSelectionDetailsToggled: vi.fn(),
    planSelectionCtaTapped: vi.fn(),
    planSelectionLegalOpened: vi.fn(),
    paywallDismissed: vi.fn(),
    paywallShown: vi.fn(),
    trialChargeNoticeShown: vi.fn(),
    paywallSuppressedEntitled: vi.fn(),
    entitlementTierMismatch: vi.fn(),
  },
}));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import { resetEffectivePremiumSession } from '@/lib/effectivePremium';
import { ENTITLEMENT_READ_HOLD_MS } from '@/lib/effectivePremium';
import UpgradePage from '@/pages/UpgradePage';

/**
 * The country gate's SECOND signal (the browser zone), read straight off `Intl`. Pinned to a US zone so the paywall
 * renders the web checkout under every zone of `npm run test:timezones` (unpinned, Europe/Berlin and the other non-US
 * zones get the app-store card and every assertion here fails). The gate itself is covered in `UpgradePage.test.tsx`.
 */
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
beforeEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(this: Intl.DateTimeFormat) {
    return { ...realResolvedOptions.call(this), timeZone: 'America/New_York' };
  };
});
afterEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = realResolvedOptions;
});

const plan = {
  rcPackage: {},
  identifier: '$rc_annual',
  formattedPrice: '$59.99',
  priceMicros: 59_990_000,
  currency: 'USD',
  hasFreeTrial: false,
  trialPeriod: null,
};

const ENTITLED = { entitlements: { active: { 'CircleCare Premium': { periodType: 'NORMAL' } } } };
const NOT_ENTITLED = { entitlements: { active: {} } };
const free = { tier: 'free', needsCircleSelection: false };
const premiumStatus = { tier: 'premium', needsCircleSelection: false };

function readResult(data: unknown, pending = false) {
  return { data, isPending: pending, fetchStatus: pending ? 'fetching' : 'idle' };
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/upgrade', state: { paywallContext: 'general' } }]}>
        <ToastProvider>
          <Routes>
            <Route path="/upgrade" element={<UpgradePage />} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return queryClient;
}

/** The subscription-status read has answered and its effects have run. */
async function settled(): Promise<void> {
  await waitFor(() => expect(getStatus).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const subscribeButton = () => screen.queryByRole('button', { name: /subscribe|start|continue|upgrade|get premium/i });

beforeEach(() => {
  vi.clearAllMocks();
  resetEffectivePremiumSession();
  window.localStorage.clear();
  window.sessionStorage.clear();
  useAuthStore.setState({ user: { id: 'user-1', email: 'u@example.com' } as never, isAuthenticated: true });
  (useWebPlans as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { monthly: null, annual: plan },
    isLoading: false,
    isError: false,
  });
  (usePurchasePlan as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false });
  (useManageSubscription as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false });
  refresh.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('UpgradePage: entitled (item 2)', () => {
  it('P2-5 tier free + entitlement active: syncs once, then shows already-premium once the backend confirms', async () => {
    customerInfoHook.mockReturnValue(readResult(ENTITLED));
    // free on the first read, premium after the re-sync's refetch.
    getStatus.mockResolvedValueOnce(free).mockResolvedValue(premiumStatus);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: "You're already Premium" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(Analytics.paywallSuppressedEntitled).toHaveBeenCalledWith('paywall');
    expect(Analytics.entitlementTierMismatch).toHaveBeenCalledWith('rc_active_backend_free', true);
  });

  it('entitled but the sync FAILS: "Activating your Premium" with Retry, no packages, no already-premium', async () => {
    const user = userEvent.setup();
    customerInfoHook.mockReturnValue(readResult(ENTITLED));
    getStatus.mockResolvedValue(free);
    refresh.mockRejectedValueOnce(new Error('network'));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Activating your Premium' })).toBeInTheDocument();
    expect(screen.queryByText("You're already Premium")).not.toBeInTheDocument();
    expect(subscribeButton()).not.toBeInTheDocument();
    expect(Analytics.entitlementTierMismatch).toHaveBeenCalledWith('rc_active_backend_free', false);

    // Retry runs the sync again; the backend has caught up now.
    getStatus.mockResolvedValue(premiumStatus);
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: "You're already Premium" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('the sync succeeds but the backend still says free: stays on Activating, never a sell page', async () => {
    customerInfoHook.mockReturnValue(readResult(ENTITLED));
    getStatus.mockResolvedValue(free);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Activating your Premium' })).toBeInTheDocument();
    expect(subscribeButton()).not.toBeInTheDocument();
  });

  it('N2-3 the mismatch sync fires once per session, not on every render', async () => {
    customerInfoHook.mockReturnValue(readResult(ENTITLED));
    getStatus.mockResolvedValue(free);
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Activating your Premium' });
    // A second mount of the page in the same session does not sync again.
    renderPage();
    await act(async () => {});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('N2-1 backend free + RevenueCat inactive: the packages show and Subscribe works', async () => {
    customerInfoHook.mockReturnValue(readResult(NOT_ENTITLED));
    getStatus.mockResolvedValue(free);
    renderPage();
    expect(await screen.findByTestId('upgrade-footer')).toBeInTheDocument();
    await settled();
    expect(screen.getByTestId('upgrade-footer')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(Analytics.paywallSuppressedEntitled).not.toHaveBeenCalled();
  });

  it('N2-2 RevenueCat read fails (null): falls back to the backend tier, packages show, CTA enabled (fail open)', async () => {
    customerInfoHook.mockReturnValue(readResult(null));
    getStatus.mockResolvedValue(free);
    renderPage();
    expect(await screen.findByTestId('upgrade-footer')).toBeInTheDocument();
    await settled();
    expect(screen.getByTestId('upgrade-footer')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Activating your Premium' })).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    const cta = screen.getByTestId('upgrade-footer').querySelector('button');
    expect(cta).not.toBeDisabled();
  });

  it('N2-5 backend premium + RevenueCat inactive (a webhook-granted purchase): premium stays', async () => {
    customerInfoHook.mockReturnValue(readResult(NOT_ENTITLED));
    getStatus.mockResolvedValue(premiumStatus);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: "You're already Premium" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(Analytics.entitlementTierMismatch).toHaveBeenCalledWith('backend_premium_rc_inactive', false);
  });

  it('S7 the page is not delayed: plans render while the entitlement read is out, Subscribe is held, then re-enabled at the cap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    customerInfoHook.mockReturnValue(readResult(undefined, true));
    getStatus.mockResolvedValue(free);
    renderPage();
    // Plans are on screen at once (nothing waits for RevenueCat).
    expect(await screen.findByTestId('upgrade-footer')).toBeInTheDocument();
    const cta = () => screen.getByTestId('upgrade-footer').querySelector('button') as HTMLButtonElement;
    expect(cta()).toBeDisabled();
    // The read never answers: after the cap the button fails open.
    await act(async () => {
      vi.advanceTimersByTime(ENTITLEMENT_READ_HOLD_MS + 50);
    });
    expect(cta()).not.toBeDisabled();
  });

  it('the read answers "not entitled": the held button re-enables at once', async () => {
    customerInfoHook.mockReturnValue(readResult(undefined, true));
    getStatus.mockResolvedValue(free);
    const queryClient = renderPage();
    await screen.findByTestId('upgrade-footer');
    const cta = () => screen.getByTestId('upgrade-footer').querySelector('button') as HTMLButtonElement;
    expect(cta()).toBeDisabled();
    customerInfoHook.mockReturnValue(readResult(NOT_ENTITLED));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['subscription-status'] });
    });
    await waitFor(() => expect(cta()).not.toBeDisabled());
  });
});
