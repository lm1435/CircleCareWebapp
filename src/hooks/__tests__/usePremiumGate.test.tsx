import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));

vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: vi.fn() }));

import { isWebBillingConfigured } from '@/lib/webBillingConfig';
import { usePremiumGate } from '@/hooks/usePremiumGate';

const mockedConfigured = isWebBillingConfigured as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

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
