import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { CreateCircleModal } from '../CreateCircleModal';
import {
  ONBOARDING_PAYWALL_SEEN_KEY,
  PENDING_FIRST_RUN_KEY,
  markOnboardingPaywallSeen,
  peekDeferredFirstRun,
} from '@/lib/onboardingPaywall';
import { useAuthStore } from '@/store/authStore';

/**
 * THE ONBOARDING PAYWALL GATE, at its call site.
 *
 * PORT of mobile/src/screens/circle/CreateCircleScreen.tsx:254-262. The gate
 * itself is unit-tested in lib/__tests__/onboardingPaywall.test.ts; what is
 * asserted HERE is the wiring that a unit test cannot see — that the modal
 * reads the PRE-create circle list, that it marks the flag before navigating,
 * that it parks the wizard instead of dropping it, and that every non-paywall
 * branch still lands on the circle with the wizard flag as it did before.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const createMutate = vi.fn();
vi.mock('@/hooks/useCircleAdmin', () => ({
  useCreateCircle: () => ({ mutate: createMutate, isPending: false }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { first_name: 'Luis', last_name: 'Meza' } }),
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});

vi.mock('@/lib/onboardingAnalytics', () => ({
  trackOnboardingCompleted: vi.fn(),
}));

// The two gate inputs, controllable per test.
let circles: Array<{ id: string }> | undefined = [];
let tier: string | undefined = 'free';
vi.mock('@/hooks/useCircles', () => ({ useCircles: () => ({ data: circles }) }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: tier === undefined ? undefined : { tier } }),
}));

const USER_ID = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  useAuthStore.setState({
    user: { id: USER_ID, email: 'u@example.com' } as never,
    isAuthenticated: true,
  });
  circles = [];
  tier = 'free';
  // Every test drives the mutation straight to success with a created circle.
  createMutate.mockImplementation((_data, opts) => opts?.onSuccess?.({ id: 'circle-new' }));
});

async function createCircleNamed(name = 'Rose Meza'): Promise<void> {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <CreateCircleModal onClose={vi.fn()} />
    </MemoryRouter>
  );
  await user.type(screen.getByLabelText(/Care recipient name/), name);
  await user.click(screen.getByRole('button', { name: 'Create circle' }));
  await waitFor(() => expect(createMutate).toHaveBeenCalled());
}

describe('CreateCircleModal — onboarding paywall', () => {
  it('sends a first-circle free-tier user to the paywall with the ONBOARDING context', async () => {
    await createCircleNamed();

    // `paywall_context: 'onboarding'` is the property the whole cross-platform
    // ABA is computed from. A different value here does not merge into the
    // wrong cohort — it invents a third one.
    expect(navigate).toHaveBeenCalledWith('/upgrade', {
      state: { paywallContext: 'onboarding' },
    });
    // And NOT straight to the circle.
    expect(navigate).not.toHaveBeenCalledWith(
      '/circles/circle-new',
      expect.objectContaining({ state: expect.objectContaining({ firstRun: true }) })
    );
  });

  it('DEFERS the wizard rather than cancelling it', async () => {
    await createCircleNamed();

    // Mobile parks it in a ref across a screen push; web parks it in
    // sessionStorage across a route change. Either way the wizard still runs.
    expect(peekDeferredFirstRun()).toEqual({
      circleId: 'circle-new',
      recipientName: 'Rose Meza',
    });
  });

  it('marks the paywall seen once, in localStorage, at the moment of the ask', async () => {
    await createCircleNamed();

    expect(window.localStorage.getItem(`${ONBOARDING_PAYWALL_SEEN_KEY}:${USER_ID}`)).toBe('1');
    expect(
      Object.keys(window.localStorage).filter((k) => k.startsWith(ONBOARDING_PAYWALL_SEEN_KEY))
    ).toHaveLength(1);
  });

  it('skips the paywall for a PREMIUM user and opens the wizard directly', async () => {
    tier = 'premium';

    await createCircleNamed();

    expect(navigate).toHaveBeenCalledWith('/circles/circle-new', {
      state: { firstRun: true, firstRunRecipientName: 'Rose Meza' },
    });
    expect(navigate).not.toHaveBeenCalledWith('/upgrade', expect.anything());
    // Nothing to defer — the wizard opened on this very navigation.
    expect(window.sessionStorage.getItem(`${PENDING_FIRST_RUN_KEY}:${USER_ID}`)).toBeNull();
    // And a premium user must never be marked as "asked", so that a later
    // downgrade + first circle on a new account is still reachable.
    expect(window.localStorage.getItem(`${ONBOARDING_PAYWALL_SEEN_KEY}:${USER_ID}`)).toBeNull();
  });

  it('skips the paywall on a SECOND circle', async () => {
    circles = [{ id: 'already-have-one' }];

    await createCircleNamed();

    expect(navigate).toHaveBeenCalledWith('/circles/circle-new', {
      state: { firstRun: true, firstRunRecipientName: 'Rose Meza' },
    });
    expect(navigate).not.toHaveBeenCalledWith('/upgrade', expect.anything());
  });

  it('skips the paywall when this browser has ALREADY shown it to this user', async () => {
    markOnboardingPaywallSeen();

    await createCircleNamed();

    expect(navigate).toHaveBeenCalledWith('/circles/circle-new', {
      state: { firstRun: true, firstRunRecipientName: 'Rose Meza' },
    });
    expect(navigate).not.toHaveBeenCalledWith('/upgrade', expect.anything());
  });

  it('skips the paywall while the plan tier is still unknown', async () => {
    tier = undefined;

    await createCircleNamed();

    expect(navigate).not.toHaveBeenCalledWith('/upgrade', expect.anything());
  });
});
