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
  // The benefits are what Premium ADDS, the four mobile's paywall lists
  // (planSelection.feature*). The old "Full access to the calendar, tasks,
  // medications, documents, and vitals" overclaimed: free users have all of it.
  it('lists the four Premium benefits mobile lists, each with its subline', () => {
    renderPage();
    const items = screen.getAllByRole('listitem').filter((li) => li.closest('[data-benefits]'));
    expect(items.map((li) => li.textContent)).toEqual([
      'Up to 5 care circlesOne for Mom, Dad, or the whole family',
      'Unlimited caregiversInvite siblings, partners, and professionals',
      'AI care assistantSummarizes visits and surfaces what matters',
      'Adherence reports & calendar importShare medication history with providers, import appointments from your calendar',
    ]);
    expect(screen.queryByText(/Full access to the calendar/)).toBeNull();
  });

  // At 390px the ES pill ("Comienza con una prueba gratis de 2 semanas: hoy no
  // pagas nada.") was a nowrap Badge 415px wide: horizontal page scroll. The
  // trial pill must be allowed to wrap inside the viewport, centred.
  it('lets the trial pill wrap within the viewport (no whitespace-nowrap)', () => {
    renderPage();
    const pill = screen.getByText('Start with a free trial — nothing due today.');
    const classes = pill.className.split(/\s+/);
    expect(classes).not.toContain('whitespace-nowrap');
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('max-w-full');
    expect(classes).toContain('text-center');
    expect(classes).toContain('rounded-full');
  });

  // Coral-deep on coral-soft is the palette's alert look; "nothing due today"
  // is reassurance, so it wears the same moss as "Save 28%" and the CTA.
  it('renders the trial pill in moss, not the coral alert tint', () => {
    renderPage();
    const classes = screen.getByText('Start with a free trial — nothing due today.').className;
    expect(classes).toContain('bg-moss-soft');
    expect(classes).toContain('text-moss-deep');
    expect(classes).not.toMatch(/coral/);
  });

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

  // The selected card used to be `border-2 border-ink! bg-coral-soft! shadow-sm`:
  // a pink fill under a heavy black 2px frame read as an error state, was the
  // heaviest thing on the page, and — because the unselected card kept a 1px
  // border — the selected card's content sat ~2px lower and jumped on toggle.
  // Selection is now moss (the primary-action colour), drawn as a border COLOUR
  // plus a 1px ring (box-shadow, no layout), so both states share one border
  // width and the box/content never move.
  it('marks the selected plan card in moss with no layout-shifting border change, and flips on click', () => {
    renderPage();
    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const monthlyRadio = screen.getByRole('radio', { name: /Monthly/ });
    const tokens = (el: HTMLElement): string[] => el.className.split(/\s+/);
    const borderWidth = (el: HTMLElement): string[] =>
      tokens(el).filter((c) => /^border(-[0-9]+)?$/.test(c) || /^border-[xytrbl]-?[0-9]*$/.test(c));

    const assertSelected = (el: HTMLElement): void => {
      expect(el).toHaveAttribute('aria-checked', 'true');
      const c = tokens(el);
      expect(c).toContain('border-moss!');
      expect(c).toContain('ring-1');
      expect(c).toContain('ring-moss');
      // Never the old alert-looking treatment.
      expect(el.className).not.toMatch(/bg-coral-soft|border-ink|border-2/);
    };
    const assertUnselected = (el: HTMLElement): void => {
      expect(el).toHaveAttribute('aria-checked', 'false');
      const c = tokens(el);
      expect(c).toContain('border-line!');
      expect(c).not.toContain('ring-1');
      expect(el.className).not.toMatch(/moss!|bg-coral-soft|border-ink|border-2/);
    };

    assertSelected(annualRadio);
    assertUnselected(monthlyRadio);
    // Identical border-width token in both states: box size cannot change.
    expect(borderWidth(annualRadio)).toEqual(['border']);
    expect(borderWidth(monthlyRadio)).toEqual(['border']);

    fireEvent.click(monthlyRadio);

    assertSelected(monthlyRadio);
    assertUnselected(annualRadio);
    expect(borderWidth(annualRadio)).toEqual(['border']);
    expect(borderWidth(monthlyRadio)).toEqual(['border']);
  });

  it('keeps the plan cards moss/ink, not coral (savings pill + trial line)', () => {
    renderPage();
    const save = screen.getByText('Save 28%');
    expect(save.className).toContain('bg-moss-soft');
    expect(save.className).toContain('text-moss-deep');
    expect(save.className).not.toContain('coral');

    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const trialLine = annualRadio.querySelector('p:last-of-type') as HTMLElement;
    expect(trialLine.className).toContain('text-moss-deep');
    expect(annualRadio.innerHTML).not.toContain('coral');
  });

  // EN desktop broke "…for every circle you're part / of." — a one-word widow.
  it('balances the subtitle so it never leaves a one-word last line', () => {
    renderPage();
    const subtitle = screen.getByText(/Everything your family needs to coordinate care/);
    expect(subtitle.className.split(/\s+/)).toContain('text-balance');
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
