import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { ReactElement } from 'react';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/ui';

/**
 * K3 (web test gaps 2026-09-29): the checkout's non-cancel error path and its
 * same-tick double-click guard. Mocks/renderAt are copied from
 * UpgradePage.paywall.test.tsx.
 *
 * (historic header of the copied file follows)
 * THE WEB PAYWALL'S ANALYTICS AND ITS ONWARD NAVIGATION.
 *
 * Two things are asserted here and they are the whole point of the task:
 *
 * 1. Every `plan_selection_*` / `paywall_dismissed` event carries the
 *    `paywall_context` mobile sends. The 1.1.3–1.1.10 ABA (2.9% vs 22.1%) is
 *    computed by splitting on that property; a wrong or missing value does not
 *    merge into another cohort, it silently creates a third.
 * 2. The deferred first-run wizard SURVIVES the route change. The routes below
 *    are real — the wizard hand-off is proved by rendering the destination and
 *    reading its `location.state`, not by asserting a mocked navigate() call.
 *    A mocked navigate would pass even if OverviewPage could never open.
 */

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
import { isUserCancelledError } from '@/lib/purchases';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import UpgradePage from '@/pages/UpgradePage';

const mockedPlans = useWebPlans as unknown as ReturnType<typeof vi.fn>;
const mockedPurchase = usePurchasePlan as unknown as ReturnType<typeof vi.fn>;
const mockedManage = useManageSubscription as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = useSubscriptionStatus as unknown as ReturnType<typeof vi.fn>;

const mutate = vi.fn();

/** Stands in for OverviewPage: renders the wizard hand-off it would read. */
function CircleProbe(): ReactElement {
  const { circleId } = useParams<{ circleId: string }>();
  const state = useLocation().state as
    | { firstRun?: boolean; firstRunRecipientName?: string }
    | null;
  return (
    <div>
      {state?.firstRun ? (
        <p data-testid="wizard">
          wizard for {circleId} / {state.firstRunRecipientName}
        </p>
      ) : (
        <p data-testid="no-wizard">circle {circleId}, no wizard</p>
      )}
    </div>
  );
}

function renderAt(state: unknown): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/upgrade', state }]}>
      <ToastProvider>
        <Routes>
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/circles" element={<p data-testid="picker">circle picker</p>} />
          <Route path="/circles/:circleId" element={<CircleProbe />} />
          <Route path="/profile" element={<p data-testid="profile">profile</p>} />
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


const EN_ERROR = 'Something went wrong starting checkout. Please try again.';
const ES_ERROR = 'Algo salió mal al iniciar el pago. Inténtalo de nuevo.';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('UpgradePage — checkout failure (non-cancel)', () => {
  it('toasts once, records no sale, stays on the paywall and re-enables Subscribe', async () => {
    const user = userEvent.setup();
    (isUserCancelledError as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mutate.mockImplementation((_p, o) => o?.onError?.(new Error('card_declined')));
    renderAt({ paywallContext: 'general' });

    await user.click(screen.getByRole('button', { name: 'Subscribe' }));

    const alerts = screen.getAllByRole('alert').filter((a) => a.textContent === EN_ERROR);
    expect(alerts).toHaveLength(1);
    expect(Analytics.planSelectionSubscribed).not.toHaveBeenCalled();
    expect(Analytics.planSelectionPurchaseCancelled).not.toHaveBeenCalled();
    expect(screen.queryByText(/Welcome to Premium/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeEnabled();
  });

  it('shows the Spanish copy', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('es');
    (isUserCancelledError as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mutate.mockImplementation((_p, o) => o?.onError?.(new Error('card_declined')));
    renderAt({ paywallContext: 'general' });

    await user.click(screen.getByRole('button', { name: /Suscribirme/i }));

    expect(screen.getAllByRole('alert').filter((a) => a.textContent === ES_ERROR)).toHaveLength(1);
  });
});

describe('UpgradePage — same-tick double click', () => {
  it('starts exactly one checkout, and is not latched after the first settles', async () => {
    (isUserCancelledError as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // never settles: isPending stays false, as in the frame before React commits.
    mutate.mockImplementation(() => undefined);
    renderAt({ paywallContext: 'general' });
    const btn = screen.getByRole('button', { name: 'Subscribe' });

    act(() => {
      btn.click();
      btn.click();
    });

    expect(mutate).toHaveBeenCalledTimes(1);

    // The first call settles (declined): a new click must start a new checkout.
    act(() => {
      (mutate.mock.calls[0][1] as { onSettled?: () => void }).onSettled?.();
    });
    act(() => {
      screen.getByRole('button', { name: 'Subscribe' }).click();
    });
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
