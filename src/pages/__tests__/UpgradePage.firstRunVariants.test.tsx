import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { deferFirstRun } from '@/lib/onboardingPaywall';
import { firstRunChoiceKey, recordFirstRunChoice, clearFirstRunChoices } from '@/lib/firstRunChoice';
import { PAYWALL_VARIANT_TABLE, PAYWALL_VARIANTS } from '@/lib/paywallVariant';

/**
 * FIRST-RUN PAYWALL VARIANTS (owner-approved 2026-11-26): the first thing added in first-run
 * setup picks the onboarding paywall's headline and the order of its eight reasons.
 * Twin of mobile's FirstRunPaywallVariants.test.tsx.
 */

vi.mock('@/hooks/useWebBilling', () => ({
  useWebPlans: vi.fn(),
  usePurchasePlan: vi.fn(),
  useManageSubscription: vi.fn(),
}));
vi.mock('@/hooks/useSubscriptionStatus', () => ({ useSubscriptionStatus: vi.fn() }));
vi.mock('@/hooks/useEffectivePremium', async () => import('@/test/backendOnlyEffectivePremium'));
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
  },
}));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { Analytics } from '@/lib/analytics';
import UpgradePage from '@/pages/UpgradePage';

const mockedPlans = useWebPlans as unknown as ReturnType<typeof vi.fn>;
const mockedPurchase = usePurchasePlan as unknown as ReturnType<typeof vi.fn>;
const mockedManage = useManageSubscription as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = useSubscriptionStatus as unknown as ReturnType<typeof vi.fn>;

const CIRCLE = 'circle-1';
const ANNUAL = {
  rcPackage: {},
  identifier: '$rc_annual',
  formattedPrice: '$59.99',
  priceMicros: 59_990_000,
  currency: 'USD',
  hasFreeTrial: true,
  trialPeriod: { number: 7, unit: 'day' },
};

function signIn(id: string): void {
  useAuthStore.setState({ user: { id, email: `${id}@x.com` } as never, isAuthenticated: true });
}

function renderAt(state: unknown): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/upgrade', state }]}>
      <ToastProvider>
        <Routes>
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/circles/:circleId" element={<p>today</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}
const ONBOARDING = { paywallContext: 'onboarding', paywallTrigger: 'after_first_med' };

/** The reason rows in DOM order: first the three on the first view. */
function topIds(): string[] {
  return Array.from(document.querySelectorAll('[data-reasons] [data-benefit]')).map(
    (el) => el.getAttribute('data-benefit') ?? ''
  );
}
function detailIds(): string[] {
  return Array.from(document.querySelectorAll('[data-details] [data-benefit]')).map(
    (el) => el.getAttribute('data-benefit') ?? ''
  );
}
async function openDetails(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'See everything included' }));
}

const HEADLINE = {
  default: 'Share the care with everyone who helps.',
  medication: 'Everyone who helps sees each dose marked.',
  invite: 'Bring in everyone who helps, not just one.',
  appointment: 'Plan who covers every visit.',
} as const;
const ALL_EIGHT = ['caregivers', 'shifts', 'circles', 'voice', 'team', 'exports', 'storage', 'ai'];

const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
beforeEach(async () => {
  Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(this: Intl.DateTimeFormat) {
    return { ...realResolvedOptions.call(this), timeZone: 'America/New_York' };
  };
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  await i18n.changeLanguage('en');
  signIn('user-1');
  deferFirstRun({ circleId: CIRCLE });
  mockedStatus.mockReturnValue({ data: { tier: 'free' } });
  mockedPlans.mockReturnValue({ data: { annual: ANNUAL, monthly: null }, isLoading: false, isError: false });
  mockedPurchase.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockedManage.mockReturnValue({ mutate: vi.fn(), isPending: false });
});
afterEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = realResolvedOptions;
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe('first-run paywall variants (positive)', () => {
  it.each(['medication', 'invite', 'appointment'] as const)(
    '%s: its headline, its top three and its details order',
    async (choice) => {
      recordFirstRunChoice(CIRCLE, choice);
      renderAt(ONBOARDING);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADLINE[choice]);
      expect(topIds()).toEqual([...PAYWALL_VARIANT_TABLE[choice].top]);
      await openDetails();
      expect(detailIds()).toEqual([...PAYWALL_VARIANT_TABLE[choice].details]);
    }
  );

  it.each(PAYWALL_VARIANTS)('%s: all eight benefits, no duplicate, none missing', async (choice) => {
    if (choice !== 'default') recordFirstRunChoice(CIRCLE, choice);
    renderAt(ONBOARDING);
    await openDetails();
    const all = [...topIds(), ...detailIds()];
    expect(all).toHaveLength(8);
    expect([...all].sort()).toEqual([...ALL_EIGHT].sort());
  });

  it('the variant reaches the onboarding analytics events', async () => {
    recordFirstRunChoice(CIRCLE, 'appointment');
    renderAt(ONBOARDING);
    expect(Analytics.paywallShown).toHaveBeenCalledWith('after_first_med', false, 'appointment');
    expect(Analytics.planSelectionViewed).toHaveBeenCalledWith(
      'onboarding',
      expect.objectContaining({ variant: 'appointment' })
    );
  });

  it('the default variant is exactly today: headline and order', async () => {
    renderAt(ONBOARDING);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADLINE.default);
    expect(topIds()).toEqual(['caregivers', 'shifts', 'circles']);
    await openDetails();
    expect(detailIds()).toEqual(['voice', 'team', 'exports', 'storage', 'ai']);
  });
});

describe('first-run paywall variants (negative)', () => {
  it.each(['emergency', 'skip', 'garbage', '<b>x</b>', '', 'Medication'])(
    'a stored %j is the default paywall',
    (stored) => {
      window.localStorage.setItem(firstRunChoiceKey(CIRCLE), stored);
      renderAt(ONBOARDING);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADLINE.default);
      expect(topIds()).toEqual(['caregivers', 'shifts', 'circles']);
      expect(Analytics.paywallShown).toHaveBeenCalledWith('after_first_med', false, 'default');
    }
  );

  it('nothing recorded is the default paywall', () => {
    renderAt(ONBOARDING);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADLINE.default);
  });

  it('a storage read failure is the default paywall, not a crash', () => {
    recordFirstRunChoice(CIRCLE, 'medication');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderAt(ONBOARDING);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADLINE.default);
    expect(topIds()).toEqual(['caregivers', 'shifts', 'circles']);
  });

  it('a choice recorded for ANOTHER circle is not used', () => {
    recordFirstRunChoice('circle-2', 'medication');
    renderAt(ONBOARDING);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADLINE.default);
  });

  it('a choice recorded by ANOTHER user is not used', () => {
    signIn('user-2');
    recordFirstRunChoice(CIRCLE, 'medication');
    signIn('user-1');
    renderAt(ONBOARDING);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADLINE.default);
  });

  it('no parked circle (no return target) is the default paywall', () => {
    window.sessionStorage.clear();
    recordFirstRunChoice(CIRCLE, 'medication');
    renderAt(ONBOARDING);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HEADLINE.default);
  });

  it.each(['general', 'capacity', 'invite_cap', 'feature', 'earned_meds', 'earned_invite', 'shifts'])(
    '%s context ignores a stored choice: its own headline, the default order, no variant sent',
    async (ctx) => {
      recordFirstRunChoice(CIRCLE, 'medication');
      renderAt({ paywallContext: ctx });
      const h1 = screen.getByRole('heading', { level: 1 }).textContent;
      expect(Object.values(HEADLINE)).not.toContain(h1);
      expect(topIds()).toEqual(['caregivers', 'shifts', 'circles']);
      await openDetails();
      expect(detailIds()).toEqual(['voice', 'team', 'exports', 'storage', 'ai']);
      expect(Analytics.paywallShown).not.toHaveBeenCalled();
      expect(Analytics.planSelectionViewed).not.toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ variant: 'medication' })
      );
    }
  );

  it('sign-out clears every recorded choice', () => {
    recordFirstRunChoice(CIRCLE, 'medication');
    recordFirstRunChoice('circle-9', 'invite');
    window.localStorage.setItem('cc:other', 'keep');
    clearFirstRunChoices();
    expect(window.localStorage.getItem(firstRunChoiceKey(CIRCLE))).toBeNull();
    expect(window.localStorage.getItem(firstRunChoiceKey('circle-9'))).toBeNull();
    expect(window.localStorage.getItem('cc:other')).toBe('keep');
  });
});
