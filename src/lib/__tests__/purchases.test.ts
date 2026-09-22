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
  // One fake instance behind both configure() and getSharedInstance(), so a
  // test can stub getOfferings() no matter which branch of getPurchases ran.
  // Exposed as `__instance` because the factory is hoisted and cannot close
  // over a top-level variable — see `mockInstance` below.
  const instance = {
    getOfferings: vi.fn(),
    getCustomerInfo: vi.fn(),
    purchase: vi.fn(),
    changeUser: vi.fn(),
  };
  return {
    Purchases: {
      configure: vi.fn(() => instance),
      getSharedInstance: vi.fn(() => instance),
      isConfigured: vi.fn(() => false),
      __instance: instance,
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

/** The fake Purchases instance the mocked SDK hands back. `loadWithKey` calls
 *  `vi.resetModules()`, which re-runs the mock factory, so this must be read
 *  from the SDK import taken AFTER the reload — otherwise the stub lands on a
 *  stale instance that lib/purchases no longer holds. */
function mockInstance(sdk: typeof import('@revenuecat/purchases-js')): {
  getOfferings: ReturnType<typeof vi.fn>;
} {
  return (sdk.Purchases as unknown as { __instance: { getOfferings: ReturnType<typeof vi.fn> } })
    .__instance;
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

  // The real shape: purchases-js parses the product's ISO trial duration into a
  // `period` object, so `web_premium_yearly_1wk`'s P1W arrives as
  // {number: 1, unit: 'week'}. The old fixture passed a bare `periodDuration`
  // string, which no SDK version emits — so the trialPeriod mapping was never
  // exercised and the paywall's duration copy rode on an untested field.
  it('marks a product with a free-trial phase as hasFreeTrial and carries its duration', async () => {
    const { toWebPlan } = await loadWithKey(undefined);
    const pkg = {
      identifier: '$rc_annual',
      webBillingProduct: {
        price: { formattedPrice: '$59.99' },
        freeTrialPhase: { period: { number: 1, unit: 'week' } },
      },
    };
    const plan = toWebPlan(pkg as never);
    expect(plan.hasFreeTrial).toBe(true);
    expect(plan.trialPeriod).toEqual({ number: 1, unit: 'week' });
  });

  // A trial phase the SDK couldn't parse a period out of is still a trial, but
  // it has no length to advertise: trialPeriod must be null so the paywall
  // falls back to the duration-less "Free trial included" copy rather than
  // reading `.number` off undefined.
  it('leaves trialPeriod null when the free-trial phase carries no period', async () => {
    const { toWebPlan } = await loadWithKey(undefined);
    const pkg = {
      identifier: '$rc_annual',
      webBillingProduct: {
        price: { formattedPrice: '$59.99' },
        freeTrialPhase: { periodDuration: 'P1W' },
      },
    };
    const plan = toWebPlan(pkg as never);
    expect(plan.hasFreeTrial).toBe(true);
    expect(plan.trialPeriod).toBeNull();
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

describe('getPurchases — SDK analytics are off', () => {
  // purchases-js defaults collectAnalyticsEvents to TRUE (events posted to
  // https://e.revenue.cat). Flags are fixed at configure() and can't follow a
  // consent change, and the SDK now loads on the home page for every owner —
  // so the flag must be passed on every configure, consent or not.
  it('configures with flags.collectAnalyticsEvents === false, apiKey and the Supabase user id', async () => {
    const { getPurchases } = await loadWithKey('rcb_sb_test');
    const sdk = await import('@revenuecat/purchases-js');
    await getPurchases('user-1');

    const configure = sdk.Purchases.configure as unknown as ReturnType<typeof vi.fn>;
    // The mock may carry calls from earlier tests in this file; assert the
    // call THIS getPurchases made (and that every configure passed the flag).
    expect(configure).toHaveBeenLastCalledWith({
      apiKey: 'rcb_sb_test',
      appUserId: 'user-1',
      flags: { collectAnalyticsEvents: false },
    });
    for (const [config] of configure.mock.calls as [{ flags?: unknown }][]) {
      expect(config.flags).toEqual({ collectAnalyticsEvents: false });
    }
  });

  it('leaves autoCollectUTMAsMetadata at the SDK default (purchase-time only)', async () => {
    const { getPurchases } = await loadWithKey('rcb_sb_test');
    const sdk = await import('@revenuecat/purchases-js');
    await getPurchases('user-1');

    const configure = sdk.Purchases.configure as unknown as ReturnType<typeof vi.fn>;
    const [config] = configure.mock.lastCall as [{ flags: Record<string, unknown> }];
    expect(config.flags).not.toHaveProperty('autoCollectUTMAsMetadata');
  });
});

describe('getWebOffering — resolves by id, never offerings.current', () => {
  it('returns the `web` offering even when a different offering is current', async () => {
    const { getWebOffering } = await loadWithKey('rcb_sb_test');
    const sdk = await import('@revenuecat/purchases-js');
    const webOffering = { identifier: 'web' };
    const other = { identifier: 'default' };
    mockInstance(sdk).getOfferings.mockResolvedValue({
      all: { web: webOffering, default: other },
      current: other,
    });

    await expect(getWebOffering('user-1')).resolves.toBe(webOffering);
  });

  it('throws (and logs which offerings came back) rather than falling back to current', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getWebOffering } = await loadWithKey('rcb_sb_test');
    const sdk = await import('@revenuecat/purchases-js');
    // `default`/`add_circle` package App Store + Play products, so `current`
    // could only produce a checkout with zero purchasable packages. Returning
    // it would turn a broken dashboard into a silent "checkout unavailable"
    // card with nothing in the console to explain it.
    const current = { identifier: 'default' };
    mockInstance(sdk).getOfferings.mockResolvedValue({
      all: { default: current, add_circle: { identifier: 'add_circle' } },
      current,
    });

    await expect(getWebOffering('user-1')).rejects.toThrow(/No web offering available/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"web"'), ['default', 'add_circle']);

    warn.mockRestore();
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
