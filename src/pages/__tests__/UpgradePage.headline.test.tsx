import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/ui';

vi.mock('@/hooks/useWebBilling', () => ({
  useWebPlans: vi.fn(),
  usePurchasePlan: vi.fn(),
  useManageSubscription: vi.fn(),
}));
vi.mock('@/hooks/useSubscriptionStatus', () => ({ useSubscriptionStatus: vi.fn() }));
vi.mock('@/hooks/useEffectivePremium', async () => import('@/test/backendOnlyEffectivePremium'));
vi.mock('@/lib/purchases', () => ({
  isUserCancelledError: vi.fn(() => false),
}));
vi.mock('@/lib/webBillingConfig', () => ({
  isWebBillingConfigured: vi.fn(() => true),
}));
// The country gate's FIRST signal (`users.timezone`); the second is the
// browser zone, pinned further down. This file gives the page no
// QueryClientProvider and the gate is not what it is testing, so the hook is
// injected with an allowed zone — exactly as `pickerCoarsePointer.test.tsx`
// injects `useHourCycle`. `UpgradePage.test.tsx` owns the gate's coverage.
vi.mock('@/hooks/useAccountTimezone', () => ({
  useAccountTimezone: () => ({
    timezone: 'America/New_York',
    isPending: false,
    refetch: vi.fn(),
  }),
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
  },
}));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useAuthStore } from '@/store/authStore';
import UpgradePage from '@/pages/UpgradePage';

const mockedPlans = useWebPlans as unknown as ReturnType<typeof vi.fn>;
const mockedPurchase = usePurchasePlan as unknown as ReturnType<typeof vi.fn>;
const mockedManage = useManageSubscription as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = useSubscriptionStatus as unknown as ReturnType<typeof vi.fn>;

const mutate = vi.fn();


function renderAt(state: unknown): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/upgrade', state }]}>
      <ToastProvider>
        <Routes>
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rcPackage: {},
    identifier: '$rc_annual',
    formattedPrice: '$59.99',
    priceMicros: 59_990_000,
    currency: 'USD',
    hasFreeTrial: false,
    trialPeriod: null,
    ...overrides,
  };
}

/**
 * The country gate's SECOND signal, which the page reads straight off `Intl`
 * rather than through the mocked hook above. It has to be pinned: unpinned it
 * is the runner's own `TZ`, and `scripts/run-unit-timezones.sh` runs this
 * suite under UTC, Asia/Tokyo, Pacific/Midway and seven more — every one of
 * which would send this file's paywall to the app-store card and fail every
 * analytics assertion in it. The gate has its own coverage in
 * `UpgradePage.test.tsx`; here it just has to stay out of the way.
 */
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
beforeEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(
    this: Intl.DateTimeFormat
  ) {
    return { ...realResolvedOptions.call(this), timeZone: 'America/New_York' };
  };
});
afterEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = realResolvedOptions;
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  useAuthStore.setState({
    user: { id: 'user-1', email: 'u@example.com' } as never,
    isAuthenticated: true,
  });
  mockedStatus.mockReturnValue({ data: { tier: 'free' } });
  mockedPlans.mockReturnValue({
    data: {
      monthly: plan({ identifier: '$rc_monthly', formattedPrice: '$6.99', priceMicros: 6_990_000 }),
      annual: plan(),
    },
    isLoading: false,
    isError: false,
  });
  mockedPurchase.mockReturnValue({ mutate, isPending: false });
  mockedManage.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

/**
 * ONE HEADLINE, ONE COLOUR (paywall redesign 1.4.2, spec §5): onboarding has its
 * own sentence; every other context keeps its own headline, now one plain line
 * in the page-title style. No coral accent word (one accent = moss, the buy button).
 */
const CASES: Array<[string, string]> = [
  ['onboarding', 'Share the care with everyone who helps.'],
  ['general', 'Unlock the full experience.'],
  ['capacity', 'More people, better care.'],
  ['invite_cap', 'More people, better care.'],
  ['feature', 'Get more from CircleCare.'],
  ['earned_meds', "You're keeping on track."],
  ['earned_invite', 'Your circle is growing.'],
  ['shifts', 'Share the care, shift by shift.'],
];
const CASES_ES: Array<[string, string]> = [
  ['onboarding', 'Comparte el cuidado con todos los que ayudan.'],
  ['general', 'Desbloquea la experiencia completa.'],
  ['capacity', 'Más personas, mejor cuidado.'],
  ['invite_cap', 'Más personas, mejor cuidado.'],
  ['feature', 'Aprovecha todo CircleCare.'],
  ['earned_meds', 'Vas por buen camino.'],
  ['earned_invite', 'Tu círculo está creciendo.'],
];

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe.each([
  ['en', CASES],
  ['es', CASES_ES],
] as const)('UpgradePage headline (%s)', (lng, cases) => {
  it.each(cases)('%s renders ONE h1 in one colour, the page-title style', async (ctx, text) => {
    await i18n.changeLanguage(lng);
    renderAt({ paywallContext: ctx });

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    const h1 = h1s[0];
    expect(h1).toHaveAccessibleName(text);
    expect(h1.textContent).toBe(text);
    // No accent span, no coral anywhere in the heading.
    expect(h1.querySelector('[data-headline-accent]')).toBeNull();
    expect(h1.innerHTML).not.toMatch(/coral/);
    expect(h1.className).toContain('text-xl');
    expect(h1.className).toContain('font-semibold');
    expect(h1.className.split(/\s+/)).toContain('text-balance');
    expect(h1.className.split(/\s+/)).toContain('text-ink');
  });
});

// Owner copy 1.4.0, kept: the circles row no longer assumes who the circles are for,
// and the buyer is never assumed to be a family.
describe.each([
  ['en', 'One for each person you care for.', /your family needs|Mom, Dad/],
  ['es', 'Uno para cada persona que cuidas.', /tu familia necesita|mamá, papá/],
] as const)('UpgradePage onboarding copy (%s)', (lng, circlesSub, old) => {
  it('renders the approved circles row, not the family-only wording', async () => {
    await i18n.changeLanguage(lng);
    const { container } = renderAt({ paywallContext: 'onboarding' });
    expect(screen.getByText(circlesSub)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(old);
  });
});
