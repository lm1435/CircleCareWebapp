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
    planSelectionPurchaseCancelled: vi.fn(),
    paywallDismissed: vi.fn(),
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
 * TWO-TONE HERO HEADLINE: mobile's PlanSelectionScreen renders `headline` in ink
 * and an ACCENT phrase in coral on its own line. Same words per context, EN+ES
 * (mobile en.json/es.json planSelection.*).
 */
const CASES: Array<[string, string, string]> = [
  ['onboarding', 'Better care,', 'together.'],
  ['general', 'Unlock the full', 'experience.'],
  ['capacity', 'More people,', 'better care.'],
  ['invite_cap', 'More people,', 'better care.'],
  ['feature', 'Get more from', 'CircleCare.'],
  ['earned_meds', "You're keeping", 'on track.'],
  ['earned_invite', 'Your circle is', 'growing.'],
];
const CASES_ES: Array<[string, string, string]> = [
  ['onboarding', 'Mejor cuidado,', 'juntos.'],
  ['general', 'Desbloquea la', 'experiencia completa.'],
  ['capacity', 'Más personas,', 'mejor cuidado.'],
  ['invite_cap', 'Más personas,', 'mejor cuidado.'],
  ['feature', 'Aprovecha todo', 'CircleCare.'],
  ['earned_meds', 'Vas por', 'buen camino.'],
  ['earned_invite', 'Tu círculo está', 'creciendo.'],
];

function hexLuminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) =>
    x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe.each([
  ['en', CASES],
  ['es', CASES_ES],
] as const)('UpgradePage two-tone headline (%s)', (lng, cases) => {
  it.each(cases)('%s renders lead in ink and the accent in coral inside ONE h1', async (ctx, lead, accent) => {
    await i18n.changeLanguage(lng);
    renderAt({ paywallContext: ctx });

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    const h1 = h1s[0];
    // One heading, one accessible name: "lead accent" (no double announcement).
    expect(h1).toHaveAccessibleName(`${lead} ${accent}`);
    const span = h1.querySelector('[data-headline-accent]') as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.textContent).toBe(accent);
    const cls = span.className.split(/\s+/);
    expect(cls).toContain('text-coral');
    expect(cls).toContain('block');
    expect(cls).toContain('font-semibold');
    expect(cls).toContain('text-[length:32px]');
    // Mobile's proportion: accent 24 / lead 32 = 0.75. Lead is editorialTitle 42px.
    expect(h1.className).toContain('text-[42px]');
    expect(32 / 42).toBeGreaterThanOrEqual(0.7);
    expect(32 / 42).toBeLessThanOrEqual(0.8);
    expect(h1.className.split(/\s+/)).toContain('text-balance');
    expect(h1.className.split(/\s+/)).toContain('text-ink');
  });
});

describe('UpgradePage accent contrast', () => {
  it('coral #C65D54 on the #FBF9F5 page is >= 3:1 (large text only)', () => {
    const l1 = hexLuminance('#fbf9f5');
    const l2 = hexLuminance('#c65d54');
    expect((l1 + 0.05) / (l2 + 0.05)).toBeGreaterThanOrEqual(3);
  });
});
