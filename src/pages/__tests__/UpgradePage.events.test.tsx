import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { ToastProvider } from '@/components/ui';

/**
 * 1.4.3 item 4 (web): `purchase_completed` on any successful purchase and
 * `trial_started` ONLY when the entitlement RevenueCat returned is a TRIAL (not
 * from what the page advertised). Web has no recovery path (a purchase resolves
 * in the same page), so `source` is always 'promise' and store 'web'.
 */

vi.mock('@/hooks/useWebBilling', () => ({
  useWebPlans: vi.fn(),
  usePurchasePlan: vi.fn(),
  useManageSubscription: vi.fn(),
}));
vi.mock('@/hooks/useSubscriptionStatus', () => ({ useSubscriptionStatus: vi.fn() }));
vi.mock('@/hooks/useEffectivePremium', async () => import('@/test/backendOnlyEffectivePremium'));
vi.mock('@/lib/purchases', () => ({ isUserCancelledError: vi.fn((e: unknown) => (e as { cancelled?: boolean })?.cancelled === true) }));
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
  },
}));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
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

const mutate = vi.fn();
const annualWithTrial = {
  rcPackage: {},
  identifier: '$rc_annual',
  formattedPrice: '$59.99',
  priceMicros: 59_990_000,
  currency: 'USD',
  hasFreeTrial: true,
  trialPeriod: { number: 7, unit: 'day' },
};
const monthly = {
  rcPackage: {},
  identifier: '$rc_monthly',
  formattedPrice: '$6.99',
  priceMicros: 6_990_000,
  currency: 'USD',
  hasFreeTrial: false,
  trialPeriod: null,
};

const info = (periodType: string) => ({
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

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  useAuthStore.setState({ user: { id: 'user-1', email: 'u@example.com' } as never, isAuthenticated: true });
  (useSubscriptionStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: { tier: 'free' } });
  (usePurchasePlan as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ mutate, isPending: false });
  (useManageSubscription as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false });
});

function renderPage(plans: { monthly: unknown; annual: unknown }): void {
  (useWebPlans as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: plans, isLoading: false, isError: false });
  render(
    <MemoryRouter initialEntries={[{ pathname: '/upgrade', state: { paywallContext: 'feature' } }]}>
      <ToastProvider>
        <Routes>
          <Route path="/upgrade" element={<UpgradePage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('UpgradePage: purchase and trial events', () => {
  it('P4-6 a TRIAL entitlement fires trial_started{store:web} and purchase_completed', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_p, opts) => opts?.onSuccess?.(info('trial')));
    renderPage({ monthly: null, annual: annualWithTrial });
    await user.click(screen.getByRole('button', { name: 'Start 7-day free trial' }));
    expect(Analytics.trialStarted).toHaveBeenCalledTimes(1);
    expect(Analytics.trialStarted).toHaveBeenCalledWith({
      plan: 'annual',
      store: 'web',
      source: 'promise',
      paywallContext: 'feature',
    });
    expect(Analytics.purchaseCompleted).toHaveBeenCalledWith({
      plan: 'annual',
      store: 'web',
      source: 'promise',
      paywallContext: 'feature',
    });
  });

  it('N4-5 an advertised trial but a NORMAL entitlement (a returning subscriber): no trial_started', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_p, opts) => opts?.onSuccess?.(info('normal')));
    renderPage({ monthly: null, annual: annualWithTrial });
    await user.click(screen.getByRole('button', { name: 'Start 7-day free trial' }));
    expect(Analytics.trialStarted).not.toHaveBeenCalled();
    expect(Analytics.purchaseCompleted).toHaveBeenCalledTimes(1);
  });

  it('N4-6 a monthly purchase: purchase_completed only, never a trial event', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_p, opts) => opts?.onSuccess?.(info('normal')));
    renderPage({ monthly, annual: null });
    await user.click(screen.getAllByTestId('upgrade-footer')[0].querySelector('button')!);
    expect(Analytics.purchaseCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'monthly', store: 'web' })
    );
    expect(Analytics.trialStarted).not.toHaveBeenCalled();
  });

  it('a cancelled checkout fires neither event', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_p, opts) => opts?.onError?.({ cancelled: true }));
    renderPage({ monthly: null, annual: annualWithTrial });
    await user.click(screen.getByRole('button', { name: 'Start 7-day free trial' }));
    expect(Analytics.purchaseCompleted).not.toHaveBeenCalled();
    expect(Analytics.trialStarted).not.toHaveBeenCalled();
    expect(Analytics.planSelectionPurchaseCancelled).toHaveBeenCalled();
  });
});
