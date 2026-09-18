import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
// Partial mock: `@/store/authStore` pulls in the real i18n bootstrap, which
// needs `initReactI18next`.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
  }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));

vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: vi.fn() }));

import { isWebBillingConfigured } from '@/lib/webBillingConfig';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import type { CircleDetail } from '@/api/circleMembers';

const mockedConfigured = isWebBillingConfigured as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  useAuthStore.setState({ user: null });
});

function seedCircle(overrides: Partial<CircleDetail> = {}): void {
  queryClient.setQueryData(queryKeys.circleDetail('c1'), {
    id: 'c1',
    owner_id: 'owner-1',
    view_only: false,
    is_premium_circle: false,
    members: [
      { user_id: 'owner-1', role: 'owner', first_name: 'Ana' },
      { user_id: 'member-1', role: 'member', first_name: 'Luis' },
    ],
    ...overrides,
  } as unknown as CircleDetail);
}

function signInAs(id: string): void {
  useAuthStore.setState({
    user: { id, email: `${id}@example.com`, first_name: null, last_name: null },
  });
}

describe('usePremiumGate', () => {
  it('shows a toast with an Upgrade action that routes to /upgrade when web billing is on', () => {
    mockedConfigured.mockReturnValue(true);
    const { result } = renderHook(() => usePremiumGate());

    result.current.promptUpgrade();

    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type, action] = showToast.mock.calls[0];
    expect(message).toBe('upgradeGate.message');
    expect(type).toBe('info');
    expect(action.label).toBe('upgradeGate.action');

    // The action navigates to the web upgrade page.
    action.onClick();
    expect(navigate).toHaveBeenCalledWith('/upgrade', {
      state: { paywallContext: 'general' },
    });
  });

  // The paywall funnel is split on `paywall_context` (lib/paywallContext.ts).
  // A gate that fails to carry its own context pools with 'general' and makes
  // limit-moment conversion unreadable, so the hand-off is asserted here.
  it('carries the caller-supplied paywall context onto /upgrade', () => {
    mockedConfigured.mockReturnValue(true);
    const { result } = renderHook(() => usePremiumGate('capacity'));

    result.current.promptUpgrade();
    showToast.mock.calls[0][2].onClick();

    expect(navigate).toHaveBeenCalledWith('/upgrade', {
      state: { paywallContext: 'capacity' },
    });
  });

  it('falls back to the in-app pointer toast when web billing is off', () => {
    mockedConfigured.mockReturnValue(false);
    const { result } = renderHook(() => usePremiumGate());

    result.current.promptUpgrade();

    expect(showToast).toHaveBeenCalledWith('errors.subscriptionRequired', 'error');
    expect(navigate).not.toHaveBeenCalled();
  });
});

// A circle's premium status is the OWNER's tier and nobody else's
// (backend services/circleAccess.ts -> getUserTier(circle.owner_id)). A
// non-owner who pays upgrades their OWN account and this circle stays locked,
// so a circle-level gate must never sell to them. Mirrors mobile's
// services/premiumGate.ts.
describe('usePremiumGate — circle-level (owner-aware)', () => {
  it('the OWNER keeps the Upgrade action to /upgrade', () => {
    mockedConfigured.mockReturnValue(true);
    seedCircle();
    signInAs('owner-1');
    const { result } = renderHook(() => usePremiumGate('feature', { circleId: 'c1' }));

    result.current.promptUpgrade();

    const [message, type, action] = showToast.mock.calls[0];
    expect(message).toBe('upgradeGate.message');
    expect(type).toBe('info');
    action.onClick();
    expect(navigate).toHaveBeenCalledWith('/upgrade', { state: { paywallContext: 'feature' } });
  });

  it('a NON-OWNER gets the owner-only notice naming the owner, with NO action', () => {
    mockedConfigured.mockReturnValue(true);
    seedCircle();
    signInAs('member-1');
    const { result } = renderHook(() => usePremiumGate('feature', { circleId: 'c1' }));

    result.current.promptUpgrade();

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]).toEqual([
      'upgradeGate.ownerOnlyNamed:{"ownerName":"Ana"}',
      'info',
    ]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a non-owner of a circle whose owner has no name gets the nameless copy', () => {
    mockedConfigured.mockReturnValue(true);
    seedCircle({
      members: [{ user_id: 'owner-1', role: 'owner', first_name: '  ' }] as unknown as CircleDetail['members'],
    });
    signInAs('member-1');
    const { result } = renderHook(() => usePremiumGate('feature', { circleId: 'c1' }));

    result.current.promptUpgrade();

    expect(showToast.mock.calls[0]).toEqual(['upgradeGate.ownerOnly', 'info']);
  });

  // The server reports is_premium_circle:false for a view-only SEAT even when
  // the owner pays, so "Premium feature for this circle" would be false.
  it('a VIEW-ONLY seat gets the seat wording, not the Premium sentence', () => {
    mockedConfigured.mockReturnValue(true);
    seedCircle({ view_only: true });
    signInAs('member-1');
    const { result } = renderHook(() => usePremiumGate('feature', { circleId: 'c1' }));

    result.current.promptUpgrade();

    expect(showToast.mock.calls[0]).toEqual(['upgradeGate.viewOnlySeat', 'info']);
  });

  // Unknown ownership fails CLOSED: costing an owner a tap beats selling a
  // subscription that unlocks nothing.
  it('unknown ownership (circle not cached) is treated as a non-owner', () => {
    mockedConfigured.mockReturnValue(true);
    signInAs('owner-1');
    const { result } = renderHook(() => usePremiumGate('feature', { circleId: 'c1' }));

    result.current.promptUpgrade();

    expect(showToast.mock.calls[0]).toEqual(['upgradeGate.ownerOnly', 'info']);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a signed-out viewer never matches an absent owner_id', () => {
    mockedConfigured.mockReturnValue(true);
    seedCircle({ owner_id: undefined as unknown as string });
    const { result } = renderHook(() => usePremiumGate('feature', { circleId: 'c1' }));

    result.current.promptUpgrade();

    expect(showToast.mock.calls[0][2]).toBeUndefined();
  });

  it('a caller-specific message is kept for a non-owner, still with no action', () => {
    mockedConfigured.mockReturnValue(true);
    seedCircle();
    signInAs('member-1');
    const { result } = renderHook(() => usePremiumGate('capacity', { circleId: 'c1' }));

    result.current.promptUpgrade('Your one invitation is held by x@example.com');

    expect(showToast.mock.calls[0]).toEqual(['Your one invitation is held by x@example.com', 'info']);
  });

  it('a non-owner gets the owner-only notice even when web billing is off', () => {
    mockedConfigured.mockReturnValue(false);
    seedCircle();
    signInAs('member-1');
    const { result } = renderHook(() => usePremiumGate('feature', { circleId: 'c1' }));

    result.current.promptUpgrade();

    expect(showToast.mock.calls[0]).toEqual([
      'upgradeGate.ownerOnlyNamed:{"ownerName":"Ana"}',
      'info',
    ]);
  });

  it('the owner with web billing off keeps the in-app pointer', () => {
    mockedConfigured.mockReturnValue(false);
    seedCircle();
    signInAs('owner-1');
    const { result } = renderHook(() => usePremiumGate('feature', { circleId: 'c1' }));

    result.current.promptUpgrade();

    expect(showToast).toHaveBeenCalledWith('errors.subscriptionRequired', 'error');
  });
});
