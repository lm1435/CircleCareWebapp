import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * THE INVITE 402, END TO END THROUGH THE REAL GATE.
 *
 * `useInvites.test.tsx` mocks `usePremiumGate` and asserts the context the
 * hook asks for; `usePremiumGate.test.tsx` asserts the gate hands whatever
 * context it was given on to `/upgrade`. This file closes the seam between
 * the two: a create-invite 402 ends in a navigation whose `location.state`
 * carries `paywallContext: 'invite_cap'` — the value the funnel is split on
 * (lib/paywallContext.ts) — with nothing mocked between the mutation and the
 * router.
 */

vi.mock('@/api/invites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invites')>();
  return { ...actual, createInvite: vi.fn(), resendInvite: vi.fn() };
});

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));

vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: () => true }));

vi.mock('@/lib/analytics', () => ({
  Analytics: { inviteSent: vi.fn(), inviteFailed: vi.fn() },
}));

import { createInvite, resendInvite } from '@/api/invites';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { useCreateInvite, useResendInvite } from '@/hooks/useInvites';
import type { CircleDetail } from '@/api/circleMembers';

const CIRCLE_ID = 'circle-1';
const OWNER_ID = 'owner-1';

const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'upgrade' },
};

// The gate is owner-aware and reads ownership from the SINGLETON client, so
// the hook is rendered under that same client and the circle is seeded there
// with the signed-in user as owner — the only viewer who is offered Upgrade.
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setQueryData(queryKeys.circleDetail(CIRCLE_ID), {
    id: CIRCLE_ID,
    owner_id: OWNER_ID,
    view_only: false,
    is_premium_circle: false,
    members: [{ user_id: OWNER_ID, role: 'owner', first_name: 'Ana' }],
  } as unknown as CircleDetail);
  useAuthStore.setState({
    user: { id: OWNER_ID, email: 'ana@example.com', first_name: null, last_name: null },
  });
});

/** The Upgrade action attached to the one toast the gate shows. */
function upgradeAction(): { label: string; onClick: () => void } {
  expect(showToast).toHaveBeenCalledTimes(1);
  const [, , action] = showToast.mock.calls[0];
  return action as { label: string; onClick: () => void };
}

describe('invite 402 → /upgrade carries invite_cap', () => {
  it('create: the owner is offered Upgrade, and taking it lands on /upgrade as invite_cap', async () => {
    vi.mocked(createInvite).mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const action = upgradeAction();
    expect(action.label).toBe('upgradeGate.action');

    action.onClick();
    expect(navigate).toHaveBeenCalledWith('/upgrade', { state: { paywallContext: 'invite_cap' } });
    expect(navigate).not.toHaveBeenCalledWith('/upgrade', {
      state: { paywallContext: 'capacity' },
    });
  });

  it('resend: reviving an invite past the cap lands on /upgrade as invite_cap too', async () => {
    vi.mocked(resendInvite).mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useResendInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: 'invite-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    upgradeAction().onClick();
    expect(navigate).toHaveBeenCalledWith('/upgrade', { state: { paywallContext: 'invite_cap' } });
  });

  it('a non-owner is told who can upgrade and is never routed anywhere', async () => {
    useAuthStore.setState({
      user: { id: 'member-2', email: 'luis@example.com', first_name: null, last_name: null },
    });
    vi.mocked(createInvite).mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('upgradeGate.ownerOnlyNamed', 'info');
    expect(navigate).not.toHaveBeenCalled();
  });
});
