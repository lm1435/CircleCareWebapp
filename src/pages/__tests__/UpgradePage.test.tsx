import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import '@/i18n';
import { ToastProvider } from '@/components/ui';

vi.mock('@/hooks/useWebBilling', () => ({
  useWebPlans: vi.fn(),
  usePurchasePlan: vi.fn(),
  useManageSubscription: vi.fn(),
}));
vi.mock('@/hooks/useSubscriptionStatus', () => ({ useSubscriptionStatus: vi.fn() }));
vi.mock('@/lib/purchases', () => ({
  isWebBillingConfigured: vi.fn(() => true),
  isUserCancelledError: vi.fn(() => false),
}));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import UpgradePage from '@/pages/UpgradePage';

const mockedPlans = useWebPlans as unknown as ReturnType<typeof vi.fn>;
const mockedPurchase = usePurchasePlan as unknown as ReturnType<typeof vi.fn>;
const mockedManage = useManageSubscription as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = useSubscriptionStatus as unknown as ReturnType<typeof vi.fn>;

const mutate = vi.fn();
const manageMutate = vi.fn();

function renderPage(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <UpgradePage />
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedStatus.mockReturnValue({ data: { tier: 'free' } });
  mockedPlans.mockReturnValue({
    data: {
      monthly: {
        rcPackage: {},
        identifier: '$rc_monthly',
        formattedPrice: '$6.99',
        priceMicros: 6_990_000,
        currency: 'USD',
        hasFreeTrial: false,
      },
      annual: {
        rcPackage: {},
        identifier: '$rc_annual',
        formattedPrice: '$59.99',
        priceMicros: 59_990_000,
        currency: 'USD',
        hasFreeTrial: true,
      },
    },
    isLoading: false,
  });
  mockedPurchase.mockReturnValue({ mutate, isPending: false });
  mockedManage.mockReturnValue({ mutate: manageMutate, isPending: false });
});

describe('UpgradePage', () => {
  it('renders both plans with their Stripe prices', () => {
    renderPage();
    expect(screen.getByText('$6.99')).toBeInTheDocument();
    expect(screen.getByText('$59.99')).toBeInTheDocument();
  });

  it('shows the data-driven annual savings and per-month equivalent', () => {
    renderPage();
    // 59.99 vs 6.99×12 (83.88) → ~28% off; 59.99/12 → $5.00/mo
    expect(screen.getByText('Save 28%')).toBeInTheDocument();
    expect(screen.getByText('$5.00/mo, billed yearly')).toBeInTheDocument();
  });

  it('offers both plans as radio options, annual selected by default', () => {
    renderPage();
    expect(screen.getByRole('radio', { name: /Annual/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Monthly/ })).not.toBeChecked();
    // One shared CTA, reflecting the default (annual → free trial)
    expect(screen.getByRole('button', { name: 'Start free trial' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
  });

  it('confirms the selected plan (annual by default) via the shared CTA', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Start free trial' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ identifier: '$rc_annual' });
  });

  it('switches the CTA and the confirmed plan when monthly is selected', () => {
    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Monthly/ }));
    // Monthly has no trial → CTA becomes Subscribe
    const cta = screen.getByRole('button', { name: 'Subscribe' });
    fireEvent.click(cta);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ identifier: '$rc_monthly' });
  });

  it('shows the manage-subscription state for premium users', () => {
    mockedStatus.mockReturnValue({ data: { tier: 'premium' } });
    renderPage();
    expect(screen.getByText("You're already Premium")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
    expect(manageMutate).toHaveBeenCalledTimes(1);
  });

  it('degrades to an unavailable notice when web billing is off', async () => {
    const purchases = await import('@/lib/purchases');
    (purchases.isWebBillingConfigured as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    renderPage();
    expect(
      screen.getByText(/Online checkout isn't available/i)
    ).toBeInTheDocument();
  });

  it('degrades to the in-app upgrade notice when the offering loads no plans', () => {
    // Web billing configured, but the offering came back empty (bad key / CSP /
    // RC outage) — show the unavailable panel, never a dead Subscribe button.
    mockedPlans.mockReturnValue({ data: { monthly: null, annual: null }, isLoading: false });
    renderPage();
    expect(screen.getByText(/Online checkout isn't available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start free trial' })).not.toBeInTheDocument();
  });

  it('degrades to the in-app upgrade notice when the offering query errors', () => {
    mockedPlans.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText(/Online checkout isn't available/i)).toBeInTheDocument();
  });
});

// Type guard so the file is treated as a module under isolatedModules.
export type _ = ReactElement;
