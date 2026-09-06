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
  isUserCancelledError: vi.fn(() => false),
}));
vi.mock('@/lib/webBillingConfig', () => ({
  isWebBillingConfigured: vi.fn(() => true),
}));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import * as purchases from '@/lib/purchases';
import * as webBillingConfig from '@/lib/webBillingConfig';
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
  // clearAllMocks() drops call records but KEEPS implementations. The
  // "billing not configured" test sets this to false, and without restoring it
  // every later test rendered the unconfigured state instead of the plans — so
  // the radios and prices were simply absent under a shuffled order.
  (webBillingConfig.isWebBillingConfigured as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    true
  );
  (purchases.isUserCancelledError as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
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

  // WCAG 1.4.3: plain (non-deep) coral is 3.92:1 on the page background at
  // this 12px/normal-weight eyebrow size — below the 4.5:1 AA text minimum.
  // `deep` renders coral-deep (5.4:1).
  it('renders the hero eyebrow in coral-deep, not plain coral (WCAG 1.4.3)', () => {
    renderPage();
    const eyebrow = screen.getByText('CircleCare Premium');
    expect(eyebrow.className).toContain('text-coral-deep!');
    expect(eyebrow.className).not.toContain('text-coral!');
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

  it('marks the selected plan card with the spec §6.7 selection classes, and flips them on click', () => {
    renderPage();
    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const monthlyRadio = screen.getByRole('radio', { name: /Monthly/ });

    expect(annualRadio).toHaveAttribute('aria-checked', 'true');
    expect(annualRadio.className).toContain('border-2');
    expect(annualRadio.className).toContain('border-ink');
    expect(annualRadio.className).toContain('bg-coral-soft!');
    expect(annualRadio.className).toContain('shadow-sm');
    expect(monthlyRadio).toHaveAttribute('aria-checked', 'false');
    expect(monthlyRadio.className).not.toContain('bg-coral-soft!');

    fireEvent.click(monthlyRadio);

    expect(monthlyRadio).toHaveAttribute('aria-checked', 'true');
    expect(monthlyRadio.className).toContain('border-2');
    expect(monthlyRadio.className).toContain('bg-coral-soft!');
    expect(annualRadio).toHaveAttribute('aria-checked', 'false');
    expect(annualRadio.className).not.toContain('bg-coral-soft!');
  });

  it('gives exactly one plan card a tab stop (roving tabindex)', () => {
    renderPage();
    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const monthlyRadio = screen.getByRole('radio', { name: /Monthly/ });

    // Annual is selected by default.
    expect(annualRadio).toHaveAttribute('tabIndex', '0');
    expect(monthlyRadio).toHaveAttribute('tabIndex', '-1');

    fireEvent.click(monthlyRadio);

    expect(monthlyRadio).toHaveAttribute('tabIndex', '0');
    expect(annualRadio).toHaveAttribute('tabIndex', '-1');
  });

  it('ArrowRight selects the other plan and moves focus to it (WAI-ARIA APG radiogroup)', () => {
    renderPage();
    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const monthlyRadio = screen.getByRole('radio', { name: /Monthly/ });

    annualRadio.focus();
    expect(annualRadio).toHaveFocus();

    fireEvent.keyDown(annualRadio, { key: 'ArrowRight' });

    expect(monthlyRadio).toHaveAttribute('aria-checked', 'true');
    expect(monthlyRadio).toHaveAttribute('tabIndex', '0');
    expect(annualRadio).toHaveAttribute('tabIndex', '-1');
    expect(monthlyRadio).toHaveFocus();

    // ArrowLeft (or wraparound ArrowRight) brings it back.
    fireEvent.keyDown(monthlyRadio, { key: 'ArrowLeft' });
    expect(annualRadio).toHaveAttribute('aria-checked', 'true');
    expect(annualRadio).toHaveFocus();
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

  // axe route crawl: page-has-heading-one. The already-premium state renders
  // only an EmptyState with no other heading on the page, so its title must be
  // the page's <h1> (EmptyState's titleAs="h1"), not the default <h2>.
  it('gives the already-premium state a level-1 heading', () => {
    mockedStatus.mockReturnValue({ data: { tier: 'premium' } });
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: "You're already Premium" })
    ).toBeInTheDocument();
  });

  it('degrades to an unavailable notice when web billing is off', async () => {
    const webBillingConfig = await import('@/lib/webBillingConfig');
    (
      webBillingConfig.isWebBillingConfigured as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue(false);
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
