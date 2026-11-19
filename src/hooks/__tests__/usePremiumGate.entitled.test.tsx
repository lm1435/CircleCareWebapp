import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * 1.4.3 item 2, owner-aware gates (memory project_owner_aware_premium_gates):
 * a Premium USER (an active RevenueCat entitlement on their own account) who is
 * a MEMBER of a FREE circle still gets the owner-required notice. Circle premium
 * is the OWNER's tier; the entitlement only ever hides a sell button on the
 * user's own surfaces. Nothing in usePremiumGate reads the entitlement, and this
 * proves it with the entitlement ON.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
  }),
}));
const showToast = vi.fn();
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: vi.fn(() => true) }));
// The member's own account IS entitled.
vi.mock('@/hooks/useWebBilling', () => ({
  useWebCustomerInfo: () => ({
    data: { entitlements: { active: { 'CircleCare Premium': { periodType: 'NORMAL' } } } },
    isPending: false,
    fetchStatus: 'idle',
  }),
}));

import { usePremiumGate } from '@/hooks/usePremiumGate';
import { hasActiveEntitlement } from '@/lib/effectivePremium';
import { useWebCustomerInfo } from '@/hooks/useWebBilling';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import type { CircleDetail } from '@/api/circleMembers';

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setQueryData(queryKeys.circleDetail('free-circle'), {
    id: 'free-circle',
    owner_id: 'owner-1',
    view_only: false,
    is_premium_circle: false,
    members: [
      { user_id: 'owner-1', role: 'owner', first_name: 'Ana' },
      { user_id: 'member-1', role: 'member', first_name: 'Luis' },
    ],
  } as unknown as CircleDetail);
  useAuthStore.setState({
    user: { id: 'member-1', email: 'm@example.com', first_name: null, last_name: null },
  });
});

describe('usePremiumGate with an entitled member of a free circle', () => {
  it('the member really is entitled (the precondition of every case below)', () => {
    expect(hasActiveEntitlement(useWebCustomerInfo(true).data)).toBe(true);
  });

  it('gets the owner-required notice with NO Upgrade action and no navigation', () => {
    const { result } = renderHook(() => usePremiumGate('capacity', { circleId: 'free-circle' }));
    result.current.promptUpgrade();
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type, action] = showToast.mock.calls[0];
    expect(message).toBe('upgradeGate.ownerOnlyNamed:{"ownerName":"Ana"}');
    expect(type).toBe('info');
    expect(action).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the lapsed notice for the same member is also owner-only, no action', () => {
    const { result } = renderHook(() => usePremiumGate('capacity', { circleId: 'free-circle' }));
    result.current.promptLapsed();
    const [message, , action] = showToast.mock.calls[0];
    expect(message).toBe('upgradeGate.lapsedMemberNamed:{"ownerName":"Ana"}');
    expect(action).toBeUndefined();
  });

  it('the OWNER of that circle is still offered Upgrade (the gate is unchanged)', () => {
    useAuthStore.setState({
      user: { id: 'owner-1', email: 'o@example.com', first_name: null, last_name: null },
    });
    const { result } = renderHook(() => usePremiumGate('capacity', { circleId: 'free-circle' }));
    result.current.promptUpgrade();
    const action = showToast.mock.calls[0][2];
    expect(action.label).toBe('upgradeGate.action');
    action.onClick();
    expect(navigate).toHaveBeenCalledWith('/upgrade', { state: { paywallContext: 'capacity' } });
  });
});
