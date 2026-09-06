import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { ReactElement } from 'react';
import '@/i18n';
import { ToastProvider } from '@/components/ui';

/**
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
import { Analytics } from '@/lib/analytics';
import { deferFirstRun, peekDeferredFirstRun } from '@/lib/onboardingPaywall';
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

/** Let the unmount-dismissal effect arm (it defers past a macrotask so React
 *  StrictMode's simulated remount cannot trip it). */
const flushArming = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

describe('UpgradePage — paywall_context', () => {
  it('reports the view with the context it was opened from', () => {
    renderAt({ paywallContext: 'onboarding' });

    expect(Analytics.planSelectionViewed).toHaveBeenCalledWith('onboarding');
  });

  it.each(['capacity', 'feature', 'general'] as const)(
    'reports the view with the %s context from an existing entry point',
    (context) => {
      renderAt({ paywallContext: context });

      expect(Analytics.planSelectionViewed).toHaveBeenCalledWith(context);
    }
  );

  it('falls back to general for an un-instrumented or forged entry', () => {
    // `location.state` is user-reachable via history.pushState. An unknown
    // value must land in an EXISTING bucket, never invent a cohort.
    renderAt({ paywallContext: 'not-a-real-context' });

    expect(Analytics.planSelectionViewed).toHaveBeenCalledWith('general');
  });

  it('falls back to general when the entry carried no state at all', () => {
    renderAt(null);

    expect(Analytics.planSelectionViewed).toHaveBeenCalledWith('general');
  });
});

describe('UpgradePage — declining the onboarding paywall', () => {
  it('shows the explicit free-plan affordance ONLY on the onboarding context', () => {
    const { unmount } = renderAt({ paywallContext: 'onboarding' });
    expect(screen.getByRole('button', { name: /Continue with Free plan/i })).toBeInTheDocument();
    unmount();

    renderAt({ paywallContext: 'capacity' });
    expect(
      screen.queryByRole('button', { name: /Continue with Free plan/i })
    ).not.toBeInTheDocument();
  });

  it('continuing free reports the choice, the dismissal, and OPENS THE WIZARD', async () => {
    const user = userEvent.setup();
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    renderAt({ paywallContext: 'onboarding' });

    await user.click(screen.getByRole('button', { name: /Continue with Free plan/i }));

    expect(Analytics.planSelectionFreeSelected).toHaveBeenCalledWith('onboarding');
    // Mobile fires free_selected and THEN dismisses (PlanSelectionScreen:737).
    expect(Analytics.paywallDismissed).toHaveBeenCalledWith('onboarding');
    // Declining leads to the wizard, not a dead end — the deferral survived a
    // full route change.
    expect(await screen.findByTestId('wizard')).toHaveTextContent('wizard for circle-9 / Rose');
    expect(peekDeferredFirstRun()).toBeNull();
  });

  it('the back control also reaches the wizard, and is relabelled for onboarding', async () => {
    const user = userEvent.setup();
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    renderAt({ paywallContext: 'onboarding' });

    // "Back to profile" points at a page a brand-new user has never seen.
    expect(screen.queryByRole('button', { name: 'Back to profile' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(await screen.findByTestId('wizard')).toHaveTextContent('wizard for circle-9 / Rose');
    expect(Analytics.paywallDismissed).toHaveBeenCalledWith('onboarding');
  });

  it('records a dismissal exactly ONCE even though the exit also unmounts the page', async () => {
    const user = userEvent.setup();
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    renderAt({ paywallContext: 'onboarding' });
    await flushArming();

    await user.click(screen.getByRole('button', { name: /Continue with Free plan/i }));
    await screen.findByTestId('wizard');

    expect(Analytics.paywallDismissed).toHaveBeenCalledTimes(1);
  });

  it('records a dismissal when the user leaves without touching any control', async () => {
    const { unmount } = renderAt({ paywallContext: 'onboarding' });
    await flushArming();

    // Browser Back / tab close: no control on the page is ever clicked. Mobile
    // hears the same exit through `beforeRemove`.
    unmount();

    expect(Analytics.paywallDismissed).toHaveBeenCalledWith('onboarding');
  });

  it('falls back to the circle picker when the deferral is already gone', async () => {
    const user = userEvent.setup();
    renderAt({ paywallContext: 'onboarding' });

    await user.click(screen.getByRole('button', { name: /Continue with Free plan/i }));

    // Never a dead end, even with sessionStorage blocked or a second tab.
    expect(await screen.findByTestId('picker')).toBeInTheDocument();
  });

  it('keeps the original destination for a non-onboarding context', async () => {
    const user = userEvent.setup();
    // A stale deferral must NOT hijack a capacity paywall's back link.
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    renderAt({ paywallContext: 'capacity' });

    await user.click(screen.getByRole('button', { name: 'Back to profile' }));

    expect(await screen.findByTestId('profile')).toBeInTheDocument();
    expect(Analytics.paywallDismissed).toHaveBeenCalledWith('capacity');
    expect(peekDeferredFirstRun()).not.toBeNull();
  });
});

describe('UpgradePage — purchase', () => {
  it('reports the subscription with the plan term and the context', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_plan, opts) => opts?.onSuccess?.());
    renderAt({ paywallContext: 'onboarding' });

    await user.click(screen.getByRole('button', { name: 'Subscribe' }));

    expect(Analytics.planSelectionSubscribed).toHaveBeenCalledWith('annual', 'onboarding');
    // No trial on this offer, so no trial event.
    expect(Analytics.planSelectionTrialStarted).not.toHaveBeenCalled();
  });

  it('reports a trial start IN ADDITION to the subscription when the offer has one', async () => {
    const user = userEvent.setup();
    mockedPlans.mockReturnValue({
      data: { monthly: null, annual: plan({ hasFreeTrial: true }) },
      isLoading: false,
      isError: false,
    });
    mutate.mockImplementation((_plan, opts) => opts?.onSuccess?.());
    renderAt({ paywallContext: 'general' });

    await user.click(screen.getByRole('button', { name: 'Start free trial' }));

    expect(Analytics.planSelectionSubscribed).toHaveBeenCalledWith('annual', 'general');
    expect(Analytics.planSelectionTrialStarted).toHaveBeenCalledWith('annual', 'general');
  });

  it('reports the MONTHLY term when the monthly plan is the one bought', async () => {
    const user = userEvent.setup();
    mockedPlans.mockReturnValue({
      data: { monthly: plan({ identifier: '$rc_monthly' }), annual: null },
      isLoading: false,
      isError: false,
    });
    mutate.mockImplementation((_plan, opts) => opts?.onSuccess?.());
    renderAt({ paywallContext: 'onboarding' });

    await user.click(screen.getByRole('button', { name: 'Subscribe' }));

    expect(Analytics.planSelectionSubscribed).toHaveBeenCalledWith('monthly', 'onboarding');
  });

  it('reports a cancelled checkout without calling it a dismissal or a sale', async () => {
    const user = userEvent.setup();
    const purchases = await import('@/lib/purchases');
    (purchases.isUserCancelledError as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mutate.mockImplementation((_plan, opts) => opts?.onError?.(new Error('cancelled')));
    renderAt({ paywallContext: 'onboarding' });
    await flushArming();

    await user.click(screen.getByRole('button', { name: 'Subscribe' }));

    expect(Analytics.planSelectionPurchaseCancelled).toHaveBeenCalledWith('annual', 'onboarding');
    expect(Analytics.planSelectionSubscribed).not.toHaveBeenCalled();
    // The user is still sitting on the paywall — a later exit is the dismissal.
    expect(Analytics.paywallDismissed).not.toHaveBeenCalled();
    (purchases.isUserCancelledError as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('is NOT a dismissal — buying is the opposite of declining', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_plan, opts) => opts?.onSuccess?.());
    renderAt({ paywallContext: 'onboarding' });
    await flushArming();

    await user.click(screen.getByRole('button', { name: 'Subscribe' }));
    await screen.findByText(/Welcome to Premium/i);

    expect(Analytics.paywallDismissed).not.toHaveBeenCalled();
  });

  it('still runs the deferred wizard after a purchase', async () => {
    const user = userEvent.setup();
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    mutate.mockImplementation((_plan, opts) => opts?.onSuccess?.());
    renderAt({ paywallContext: 'onboarding' });

    await user.click(screen.getByRole('button', { name: 'Subscribe' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    // A paying first-circle owner needs the setup wizard just as much.
    expect(await screen.findByTestId('wizard')).toHaveTextContent('wizard for circle-9 / Rose');
  });
});

describe('UpgradePage — onboarding copy', () => {
  it('uses mobile onboarding headline on the onboarding context only', () => {
    const { unmount } = renderAt({ paywallContext: 'onboarding' });
    expect(screen.getByRole('heading', { name: 'Better care, together.' })).toBeInTheDocument();
    unmount();

    renderAt({ paywallContext: 'general' });
    expect(
      screen.queryByRole('heading', { name: 'Better care, together.' })
    ).not.toBeInTheDocument();
  });
});

describe('UpgradePage — degraded states still reach the wizard', () => {
  it('delivers the deferral even when checkout is unavailable', async () => {
    const user = userEvent.setup();
    deferFirstRun({ circleId: 'circle-9', recipientName: 'Rose' });
    mockedPlans.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderAt({ paywallContext: 'onboarding' });

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(screen.getByTestId('wizard')).toBeInTheDocument());
  });
});
