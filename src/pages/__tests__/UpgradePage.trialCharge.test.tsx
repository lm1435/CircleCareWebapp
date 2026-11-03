import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { ToastProvider } from '@/components/ui';

/**
 * B (pricing report 2026-11): when the web purchase STARTS A TRIAL, the
 * success state says exactly when it ends and what the first charge is, from
 * the CustomerInfo RevenueCat returned (lib/trialCharge.ts). A purchase with
 * no trial shows the success state as before. Opening the page also blocks the
 * store-review banner for the tab session (lib/reviewMoments.ts).
 */

vi.mock('@/hooks/useWebBilling', () => ({
  useWebPlans: vi.fn(),
  usePurchasePlan: vi.fn(),
  useManageSubscription: vi.fn(),
}));
vi.mock('@/hooks/useSubscriptionStatus', () => ({ useSubscriptionStatus: vi.fn() }));
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
    planSelectionPurchaseCancelled: vi.fn(),
    paywallDismissed: vi.fn(),
    paywallShown: vi.fn(),
    trialChargeNoticeShown: vi.fn(),
  },
}));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import { formatTrialDate } from '@/lib/trialCharge';
import { PAYWALL_SESSION_KEY } from '@/lib/reviewMoments';
import UpgradePage from '@/pages/UpgradePage';

const mockedPlans = useWebPlans as unknown as ReturnType<typeof vi.fn>;
const mockedPurchase = usePurchasePlan as unknown as ReturnType<typeof vi.fn>;
const mockedManage = useManageSubscription as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = useSubscriptionStatus as unknown as ReturnType<typeof vi.fn>;
const mutate = vi.fn();

const trialPlan = {
  rcPackage: {},
  identifier: '$rc_annual',
  formattedPrice: '$59.99',
  priceMicros: 59_990_000,
  currency: 'USD',
  hasFreeTrial: true,
  trialPeriod: { number: 7, unit: 'day' },
};

const customerInfo = (periodType: string) => ({
  entitlements: {
    active: {
      'CircleCare Premium': {
        periodType,
        expirationDate: new Date('2026-11-10T18:00:00Z'),
        willRenew: true,
        store: 'rc_billing',
        productIdentifier: 'annual',
      },
    },
  },
});

const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
beforeEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(this: Intl.DateTimeFormat) {
    return { ...realResolvedOptions.call(this), timeZone: 'America/New_York' };
  };
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  useAuthStore.setState({ user: { id: 'user-1', email: 'u@example.com' } as never, isAuthenticated: true });
  mockedStatus.mockReturnValue({ data: { tier: 'free' } });
  mockedPlans.mockReturnValue({ data: { monthly: null, annual: trialPlan }, isLoading: false, isError: false });
  mockedPurchase.mockReturnValue({ mutate, isPending: false });
  mockedManage.mockReturnValue({ mutate: vi.fn(), isPending: false });
});
afterEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = realResolvedOptions;
});

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/upgrade', state: { paywallContext: 'general' } }]}>
      <ToastProvider>
        <Routes>
          <Route path="/upgrade" element={<UpgradePage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('UpgradePage: trial start states the exact charge', () => {
  it('a trial purchase shows the end date and the first charge with its price', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_plan, opts) => opts?.onSuccess?.(customerInfo('trial')));
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Start free trial' }));

    const date = formatTrialDate('2026-11-10T18:00:00.000Z', 'en');
    expect(await screen.findByTestId('upgrade-trial-charge')).toHaveTextContent(
      `Your free trial ends ${date}. You'll be charged $59.99 on ${date} unless you cancel before then.`
    );
    expect(Analytics.trialChargeNoticeShown).toHaveBeenCalledWith('paywall', 'web');
  });

  it('no trial in the entitlement: the success state without a charge line', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_plan, opts) => opts?.onSuccess?.(customerInfo('normal')));
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Start free trial' }));
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-trial-charge')).not.toBeInTheDocument();
    expect(Analytics.trialChargeNoticeShown).not.toHaveBeenCalled();
  });

  it('opening the page blocks the store-review banner for this tab session', () => {
    renderPage();
    expect(window.sessionStorage.getItem(PAYWALL_SESSION_KEY)).toBe('1');
  });
});
