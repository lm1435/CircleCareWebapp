import { describe, it, expect, vi } from 'vitest';

// Mock the SDK so the wrapper's pure logic is testable without a network/config.
// The fake error class is declared INSIDE the factory (vi.mock is hoisted, so it
// can't close over top-level variables).
vi.mock('@revenuecat/purchases-js', () => {
  class FakePurchasesError extends Error {
    constructor(
      public errorCode: number,
      message?: string
    ) {
      super(message);
    }
  }
  return {
    Purchases: {
      configure: vi.fn(),
      getSharedInstance: vi.fn(),
      isConfigured: vi.fn(() => false),
    },
    PurchasesError: FakePurchasesError,
    ErrorCode: { UnknownError: 0, UserCancelledError: 1 },
  };
});

import { PurchasesError, ErrorCode } from '@revenuecat/purchases-js';
import {
  isWebBillingConfigured,
  getPurchases,
  toWebPlan,
  isUserCancelledError,
  PREMIUM_ENTITLEMENT,
  WEB_OFFERING_ID,
} from '@/lib/purchases';

describe('purchases wrapper', () => {
  it('reports web billing as unconfigured when the key is unset (test env)', () => {
    expect(isWebBillingConfigured()).toBe(false);
  });

  it('throws from getPurchases when the key is unset', () => {
    expect(() => getPurchases('user-1')).toThrow(/not configured/i);
  });

  it('exposes the shared cross-platform identifiers', () => {
    expect(PREMIUM_ENTITLEMENT).toBe('CircleCare Premium');
    expect(WEB_OFFERING_ID).toBe('web');
  });

  it('flattens a package into a WebPlan with price + trial flag', () => {
    const pkg = {
      identifier: '$rc_monthly',
      webBillingProduct: {
        price: { formattedPrice: '$6.99' },
        freeTrialPhase: null,
      },
    };
    const plan = toWebPlan(pkg as never);
    expect(plan).toMatchObject({
      identifier: '$rc_monthly',
      formattedPrice: '$6.99',
      hasFreeTrial: false,
    });
    expect(plan.rcPackage).toBe(pkg);
  });

  it('marks a product with a free-trial phase as hasFreeTrial', () => {
    const pkg = {
      identifier: '$rc_annual',
      webBillingProduct: {
        price: { formattedPrice: '$59.99' },
        freeTrialPhase: { periodDuration: 'P2W' },
      },
    };
    expect(toWebPlan(pkg as never).hasFreeTrial).toBe(true);
  });

  it('detects user-cancelled errors and ignores everything else', () => {
    expect(isUserCancelledError(new PurchasesError(ErrorCode.UserCancelledError))).toBe(true);
    expect(isUserCancelledError(new PurchasesError(ErrorCode.UnknownError))).toBe(false);
    expect(isUserCancelledError(new Error('network'))).toBe(false);
    expect(isUserCancelledError(null)).toBe(false);
  });
});
