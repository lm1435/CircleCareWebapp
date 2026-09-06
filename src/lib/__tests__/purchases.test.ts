import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

/** Import lib/purchases with VITE_REVENUECAT_WEB_BILLING_KEY set or unset. */
async function loadWithKey(key: string | undefined) {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_REVENUECAT_WEB_BILLING_KEY: key,
    },
  }));
  return import('@/lib/purchases');
}

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('purchases wrapper', () => {
  it('reports web billing as unconfigured when the key is unset (test env)', async () => {
    const { isWebBillingConfigured } = await loadWithKey(undefined);
    expect(isWebBillingConfigured()).toBe(false);
  });

  it('rejects from getPurchases when the key is unset', async () => {
    const { getPurchases } = await loadWithKey(undefined);
    await expect(getPurchases('user-1')).rejects.toThrow(/not configured/i);
  });

  it('exposes the shared cross-platform identifiers', async () => {
    const { PREMIUM_ENTITLEMENT, WEB_OFFERING_ID } = await loadWithKey(undefined);
    expect(PREMIUM_ENTITLEMENT).toBe('CircleCare Premium');
    expect(WEB_OFFERING_ID).toBe('web');
  });

  it('flattens a package into a WebPlan with price + trial flag', async () => {
    const { toWebPlan } = await loadWithKey(undefined);
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

  it('marks a product with a free-trial phase as hasFreeTrial', async () => {
    const { toWebPlan } = await loadWithKey(undefined);
    const pkg = {
      identifier: '$rc_annual',
      webBillingProduct: {
        price: { formattedPrice: '$59.99' },
        freeTrialPhase: { periodDuration: 'P2W' },
      },
    };
    expect(toWebPlan(pkg as never).hasFreeTrial).toBe(true);
  });

  it('reports "not a cancel" for anything before the SDK has ever loaded', async () => {
    // No `getPurchases`/`purchasePackage` call in this test — the SDK chunk
    // never fetches, so `isUserCancelledError` must fail safe rather than
    // throw or false-positive on an un-configured module reference.
    const { isUserCancelledError } = await loadWithKey(undefined);
    expect(isUserCancelledError(new Error('anything'))).toBe(false);
    expect(isUserCancelledError(null)).toBe(false);
  });

  it('detects user-cancelled errors once a purchase attempt has loaded the SDK', async () => {
    const { getPurchases, isUserCancelledError } = await loadWithKey('rcb_sb_test');
    // Triggers the (mocked) dynamic import — after this resolves, the module's
    // cached SDK reference is populated and isUserCancelledError can classify.
    await getPurchases('user-1');
    const sdk = await import('@revenuecat/purchases-js');

    expect(isUserCancelledError(new sdk.PurchasesError(sdk.ErrorCode.UserCancelledError))).toBe(
      true
    );
    expect(isUserCancelledError(new sdk.PurchasesError(sdk.ErrorCode.UnknownError))).toBe(false);
    expect(isUserCancelledError(new Error('network'))).toBe(false);
    expect(isUserCancelledError(null)).toBe(false);
  });
});

describe('purchases.ts — a rejected import is not cached forever', () => {
  it('retries the fetch on the next getPurchases call instead of replaying the same rejection', async () => {
    let attempt = 0;
    vi.doMock('@revenuecat/purchases-js', () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('chunk load failed');
      }
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
          configure: vi.fn(() => ({ changeUser: vi.fn() })),
          getSharedInstance: vi.fn(),
          isConfigured: vi.fn(() => false),
        },
        PurchasesError: FakePurchasesError,
        ErrorCode: { UnknownError: 0, UserCancelledError: 1 },
      };
    });

    const { getPurchases } = await loadWithKey('rcb_sb_test');

    // vitest wraps whatever a mock factory throws in its own generic "there
    // was an error mocking a module" message, so the ORIGINAL message isn't
    // asserted here — the load-bearing assertion is `attempt` below, which
    // proves a genuinely NEW import() happened rather than a cached
    // rejection being replayed (which would brick checkout for the tab after
    // one failed fetch, e.g. a chunk 404 right after a redeploy).
    await expect(getPurchases('user-1')).rejects.toBeInstanceOf(Error);
    expect(attempt).toBe(1);

    await expect(getPurchases('user-1')).resolves.toBeDefined();
    expect(attempt).toBe(2);

    vi.doUnmock('@revenuecat/purchases-js');
  });
});

describe('purchases.ts bundle guard', () => {
  it('never statically imports @revenuecat/purchases-js — only type positions and a dynamic import()', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/purchases.ts'), 'utf8');
    // A top-level (column-0) `import ... from '@revenuecat/purchases-js'`
    // statement would pull the ~177 KB gzip SDK into the entry chunk. Type
    // positions use `import('pkg').Type` (no `from`, erased at compile time)
    // and the runtime load uses `import('@revenuecat/purchases-js')` inside a
    // function body (indented) — neither matches this pattern.
    expect(source).not.toMatch(/^import\b[\s\S]*?from\s+['"]@revenuecat\/purchases-js['"]/m);
    // Sanity: the dynamic load is actually present, so the guard above isn't
    // vacuously true because the SDK was removed outright.
    expect(source).toContain("import('@revenuecat/purchases-js')");
  });
});
