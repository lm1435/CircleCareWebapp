import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { CreateCircleModal } from '../CreateCircleModal';
import {
  ONBOARDING_PAYWALL_PENDING_KEY,
  ONBOARDING_PAYWALL_SEEN_KEY,
  markOnboardingPaywallSeen,
  peekDeferredFirstRun,
  peekOnboardingPaywallPending,
} from '@/lib/onboardingPaywall';
import { useAuthStore } from '@/store/authStore';

/**
 * THE ONBOARDING PAYWALL GATE, at its call site.
 *
 * PORT of mobile/src/screens/circle/CreateCircleScreen.tsx:254-262. The gate
 * itself is unit-tested in lib/__tests__/onboardingPaywall.test.ts; what is
 * asserted HERE is the wiring that a unit test cannot see — that the modal
 * reads the PRE-create circle list and that it only RECORDS the paywall as owed (the wizard runs
 * first; the paywall shows after the first med or at the next Today).
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

const FIRST_RUN_NAV = [
  '/circles/circle-new',
  { state: { firstRun: true, firstRunRecipientName: 'Rose Meza' } },
] as const;

describe('CreateCircleModal — onboarding paywall (owed, not shown: onboarding 1.3.1)', () => {
  it('goes to the first-run wizard, NEVER to /upgrade, at creation', async () => {
    await createCircleNamed();

    expect(navigate).toHaveBeenCalledWith(...FIRST_RUN_NAV);
    expect(navigate).not.toHaveBeenCalledWith('/upgrade', expect.anything());
  });

  it('records the paywall as OWED for the new circle for a first-circle free-tier user', async () => {
    await createCircleNamed();

    expect(peekOnboardingPaywallPending()).toBe('circle-new');
    expect(window.localStorage.getItem(`${ONBOARDING_PAYWALL_PENDING_KEY}:${USER_ID}`)).not.toBeNull();
  });

  it('does NOT write the seen flag at creation (it is written when the paywall is presented)', async () => {
    await createCircleNamed();

    expect(window.localStorage.getItem(`${ONBOARDING_PAYWALL_SEEN_KEY}:${USER_ID}`)).toBeNull();
    expect(peekDeferredFirstRun()).toBeNull();
  });

  it('owes nothing to a PREMIUM user', async () => {
    tier = 'premium';

    await createCircleNamed();

    expect(navigate).toHaveBeenCalledWith(...FIRST_RUN_NAV);
    expect(peekOnboardingPaywallPending()).toBeNull();
    expect(window.localStorage.getItem(`${ONBOARDING_PAYWALL_SEEN_KEY}:${USER_ID}`)).toBeNull();
  });

  it('owes nothing on a SECOND circle', async () => {
    circles = [{ id: 'already-have-one' }];

    await createCircleNamed();

    expect(navigate).toHaveBeenCalledWith(...FIRST_RUN_NAV);
    expect(peekOnboardingPaywallPending()).toBeNull();
  });

  it('owes nothing when this browser has ALREADY shown it to this user', async () => {
    markOnboardingPaywallSeen();

    await createCircleNamed();

    expect(navigate).toHaveBeenCalledWith(...FIRST_RUN_NAV);
    expect(peekOnboardingPaywallPending()).toBeNull();
  });

  it('owes nothing while the plan tier is still unknown', async () => {
    tier = undefined;

    await createCircleNamed();

    expect(navigate).toHaveBeenCalledWith(...FIRST_RUN_NAV);
    expect(peekOnboardingPaywallPending()).toBeNull();
  });
});
